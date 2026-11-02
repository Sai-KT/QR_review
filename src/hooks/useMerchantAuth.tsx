/**
 * Merchant Authentication & Business Context Hook
 *
 * Source: docs/ROADMAP.md (M5-T02); docs/SECURITY.md (v1.1) §4; docs/API_SPEC.md (v1.2) §11.1
 *
 * Manages active Supabase session state, automatically fetches the authenticated
 * merchant's associated business profile via API-OWN-01, and provides secure sign-out.
 *
 * Security Invariants:
 * - Direct PostgREST via RLS: `owner_id = auth.uid()`
 * - Never trusts client-supplied business IDs for authorization proof.
 * - Clears private merchant state immediately on sign-out or session expiry.
 * - Deduplicates profile requests and avoids redirect loops.
 */

import * as React from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { fetchMerchantBusiness } from '../lib/api/merchant';
import type { Business } from '../types/domain';

export interface MerchantAuthState {
  session: Session | null;
  user: User | null;
  business: Business | null;
  loading: boolean;
  error: string | null;
  signOut: () => Promise<void>;
  refreshBusiness: () => Promise<void>;
}

const MerchantAuthContext = React.createContext<MerchantAuthState | null>(null);

export interface MerchantAuthProviderProps {
  children: React.ReactNode;
}

export function MerchantAuthProvider({ children }: MerchantAuthProviderProps): React.JSX.Element {
  const [session, setSession] = React.useState<Session | null>(null);
  const [user, setUser] = React.useState<User | null>(null);
  const [business, setBusiness] = React.useState<Business | null>(null);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);

  const mountedRef = React.useRef<boolean>(true);
  const activeUserIdRef = React.useRef<string | null>(null);

  const loadBusiness = React.useCallback(async (forUserId: string) => {
    try {
      const { data, error: fetchErr } = await fetchMerchantBusiness();
      if (!mountedRef.current) return;

      // If user changed while fetch was in flight, discard result
      if (activeUserIdRef.current !== forUserId) return;

      if (fetchErr) {
        setError(fetchErr.message);
        setBusiness(null);
      } else {
        setBusiness(data);
        setError(null);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      if (activeUserIdRef.current !== forUserId) return;
      setError(err instanceof Error ? err.message : 'Failed to load business profile');
      setBusiness(null);
    } finally {
      if (mountedRef.current && activeUserIdRef.current === forUserId) {
        setLoading(false);
      }
    }
  }, []);

  const refreshBusiness = React.useCallback(async () => {
    if (!activeUserIdRef.current) return;
    await loadBusiness(activeUserIdRef.current);
  }, [loadBusiness]);

  const signOut = React.useCallback(async () => {
    activeUserIdRef.current = null;
    setLoading(true);
    try {
      await supabase.auth.signOut();
    } catch {
      // Best effort sign out
    } finally {
      if (mountedRef.current) {
        setSession(null);
        setUser(null);
        setBusiness(null);
        setError(null);
        setLoading(false);
      }
    }
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;

    // 1. Initial Session Resolution
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      if (!mountedRef.current) return;

      if (initialSession?.user) {
        setSession(initialSession);
        setUser(initialSession.user);
        activeUserIdRef.current = initialSession.user.id;
        loadBusiness(initialSession.user.id);
      } else {
        setSession(null);
        setUser(null);
        setBusiness(null);
        activeUserIdRef.current = null;
        setLoading(false);
      }
    }).catch(() => {
      if (mountedRef.current) {
        setSession(null);
        setUser(null);
        setBusiness(null);
        activeUserIdRef.current = null;
        setLoading(false);
      }
    });

    // 2. Auth State Change Listener
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mountedRef.current) return;

      if (event === 'SIGNED_OUT' || !newSession?.user) {
        activeUserIdRef.current = null;
        setSession(null);
        setUser(null);
        setBusiness(null);
        setError(null);
        setLoading(false);
        return;
      }

      setSession(newSession);
      setUser(newSession.user);

      // Only re-fetch business profile if authenticated user ID changed or business is not yet loaded
      if (activeUserIdRef.current !== newSession.user.id) {
        activeUserIdRef.current = newSession.user.id;
        setLoading(true);
        loadBusiness(newSession.user.id);
      }
    });

    return () => {
      mountedRef.current = false;
      subscription?.unsubscribe();
    };
  }, [loadBusiness]);

  const contextValue = React.useMemo<MerchantAuthState>(
    () => ({
      session,
      user,
      business,
      loading,
      error,
      signOut,
      refreshBusiness,
    }),
    [session, user, business, loading, error, signOut, refreshBusiness],
  );

  return (
    <MerchantAuthContext.Provider value={contextValue}>
      {children}
    </MerchantAuthContext.Provider>
  );
}

/**
 * Custom hook to access merchant auth and business context.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useMerchantAuth(): MerchantAuthState {
  const context = React.useContext(MerchantAuthContext);
  if (!context) {
    throw new Error('useMerchantAuth must be used within a MerchantAuthProvider');
  }
  return context;
}
