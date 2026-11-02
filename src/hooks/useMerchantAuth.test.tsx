import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { Session, User } from '@supabase/supabase-js';
import { MerchantAuthProvider, useMerchantAuth } from './useMerchantAuth';
import { supabase } from '../lib/supabase';
import { fetchMerchantBusiness } from '../lib/api/merchant';
import type { Business } from '../types/domain';

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

vi.mock('../lib/api/merchant', () => ({
  fetchMerchantBusiness: vi.fn(),
}));

describe('useMerchantAuth', () => {
  let authListener: (event: string, session: Session | null) => void;
  const mockUnsubscribe = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(supabase.auth.onAuthStateChange).mockImplementation(((cb: (event: string, session: Session | null) => void) => {
      authListener = cb;
      return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
    }) as unknown as typeof supabase.auth.onAuthStateChange);
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MerchantAuthProvider>{children}</MerchantAuthProvider>
  );

  it('initializes to unauthenticated state when getSession returns null', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    });

    const { result } = renderHook(() => useMerchantAuth(), { wrapper });

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.session).toBeNull();
    expect(result.current.user).toBeNull();
    expect(result.current.business).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('fetches business profile when valid session exists', async () => {
    const mockUser = { id: '00000000-0000-4000-8000-000000000002', email: 'merchant.luxe@local.test' } as User;
    const mockSession = { user: mockUser, access_token: 'fake_jwt' } as Session;
    const mockBusiness: Partial<Business> = {
      id: 'b0000000-0000-4000-8000-000000000001',
      name: 'Luxe Studio Unisex Salon',
      accountStatus: 'active',
      categoryId: 'salon',
    };

    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: mockSession },
      error: null,
    });

    vi.mocked(fetchMerchantBusiness).mockResolvedValue({
      data: mockBusiness as Business,
      error: null,
    });

    const { result } = renderHook(() => useMerchantAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.session).toEqual(mockSession);
    expect(result.current.user).toEqual(mockUser);
    expect(result.current.business).toEqual(mockBusiness);
    expect(result.current.error).toBeNull();
  });

  it('sets error state when business profile fetch fails', async () => {
    const mockUser = { id: '00000000-0000-4000-8000-000000000002', email: 'merchant.luxe@local.test' } as User;
    const mockSession = { user: mockUser, access_token: 'fake_jwt' } as Session;

    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: mockSession },
      error: null,
    });

    vi.mocked(fetchMerchantBusiness).mockResolvedValue({
      data: null,
      error: new Error('Database connection failed'),
    });

    const { result } = renderHook(() => useMerchantAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.business).toBeNull();
    expect(result.current.error).toBe('Database connection failed');
  });

  it('clears session and business state on signOut', async () => {
    const mockUser = { id: '00000000-0000-4000-8000-000000000002', email: 'merchant.luxe@local.test' } as User;
    const mockSession = { user: mockUser, access_token: 'fake_jwt' } as Session;
    const mockBusiness: Partial<Business> = {
      id: 'b0000000-0000-4000-8000-000000000001',
      name: 'Luxe Studio Unisex Salon',
    };

    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: mockSession },
      error: null,
    });

    vi.mocked(fetchMerchantBusiness).mockResolvedValue({
      data: mockBusiness as Business,
      error: null,
    });

    vi.mocked(supabase.auth.signOut).mockResolvedValue({ error: null });

    const { result } = renderHook(() => useMerchantAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.business).toBeDefined();
    });

    await act(async () => {
      await result.current.signOut();
    });

    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(result.current.session).toBeNull();
    expect(result.current.user).toBeNull();
    expect(result.current.business).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('clears state on onAuthStateChange SIGNED_OUT event', async () => {
    const mockUser = { id: '00000000-0000-4000-8000-000000000002', email: 'merchant.luxe@local.test' } as User;
    const mockSession = { user: mockUser, access_token: 'fake_jwt' } as Session;

    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: mockSession },
      error: null,
    });

    vi.mocked(fetchMerchantBusiness).mockResolvedValue({
      data: { name: 'Test Business' } as unknown as Business,
      error: null,
    });

    const { result } = renderHook(() => useMerchantAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.business).toBeDefined();
    });

    act(() => {
      authListener('SIGNED_OUT', null);
    });

    expect(result.current.session).toBeNull();
    expect(result.current.business).toBeNull();
  });

  it('unsubscribes auth listener on unmount', () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    });

    const { unmount } = renderHook(() => useMerchantAuth(), { wrapper });
    unmount();

    expect(mockUnsubscribe).toHaveBeenCalled();
  });
});
