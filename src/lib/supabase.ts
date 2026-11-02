/**
 * Typed Supabase Browser Client
 *
 * Source: docs/TECH_STACK.md (v1.1), docs/ARCHITECTURE.md (v1.1), docs/API_SPEC.md (v1.2)
 *
 * Configured with client-safe environment variables (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).
 * Elevated secrets (e.g. SUPABASE_SERVICE_ROLE_KEY) are strictly forbidden here.
 *
 * Lazy initialization pattern:
 * The client is not instantiated until getSupabaseBrowserClient() is called or the
 * lazy proxy `supabase` is first accessed by an authorized consumer.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';
import { clearRecoverySession, markRecoverySessionActive } from './auth/authUtils.ts';

let clientInstance: SupabaseClient<Database> | null = null;

/**
 * Helper to safely inspect process.env in Node test environments without
 * conflicting with browser-only TypeScript global declarations.
 */
function getProcessEnv(key: string): string | undefined {
  const g = globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
  };
  return g.process?.env?.[key];
}

/**
 * Retrieves the public Supabase URL from Vite client environment or Node runtime.
 */
export function getSupabaseUrl(): string | undefined {
  if (
    typeof import.meta !== 'undefined' &&
    import.meta.env &&
    'VITE_SUPABASE_URL' in import.meta.env
  ) {
    return import.meta.env.VITE_SUPABASE_URL;
  }
  return getProcessEnv('VITE_SUPABASE_URL');
}

/**
 * Retrieves the public/anon key from Vite client environment or Node runtime.
 */
export function getSupabaseAnonKey(): string | undefined {
  if (
    typeof import.meta !== 'undefined' &&
    import.meta.env &&
    'VITE_SUPABASE_ANON_KEY' in import.meta.env
  ) {
    return import.meta.env.VITE_SUPABASE_ANON_KEY;
  }
  return getProcessEnv('VITE_SUPABASE_ANON_KEY');
}

/**
 * Checks whether browser Supabase environment variables are configured.
 * Returns false if variables are missing or set to placeholder values.
 */
export function isSupabaseConfigured(): boolean {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();

  return Boolean(
    url &&
    key &&
    url !== 'https://your-project.supabase.co' &&
    key !== 'YOUR_PUBLIC_SUPABASE_ANON_KEY',
  );
}

/**
 * Lazily creates and returns a typed Supabase singleton client instance.
 * Throws a descriptive error if environment variables are missing.
 */
export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  if (clientInstance) {
    return clientInstance;
  }

  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();

  if (!url || !key) {
    throw new Error(
      'Supabase client initialization failed: Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in browser environment.',
    );
  }

  clientInstance = createClient<Database>(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  // Track authenticated recovery events arriving before or during component mounting
  clientInstance.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
      markRecoverySessionActive();
    } else if (event === 'SIGNED_OUT') {
      clearRecoverySession();
    }
  });

  return clientInstance;
}

/**
 * Explicit client accessor matching M1-T05 prompt convention.
 */
export const getSupabaseClient = getSupabaseBrowserClient;

/**
 * Lazy proxy allowing consumers to import `supabase` directly.
 * Initialization is deferred until a property or method is first accessed.
 */
export const supabase = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop, receiver) {
    const client = getSupabaseBrowserClient();
    return Reflect.get(client, prop, receiver);
  },
});
