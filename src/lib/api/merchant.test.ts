import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchMerchantBusiness,
  updateMerchantBusiness,
  updateGoogleDestination,
} from './merchant';
import { supabase, getSupabaseUrl, getSupabaseAnonKey } from '../supabase';

vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: {
      getSession: vi.fn(),
    },
  },
  getSupabaseUrl: vi.fn(() => 'https://test.supabase.co'),
  getSupabaseAnonKey: vi.fn(() => 'mock-anon-key'),
}));

describe('fetchMerchantBusiness (API-OWN-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches and adapts raw snake_case business row into camelCase DTO', async () => {
    const mockRow = {
      id: 'b0000000-0000-4000-8000-000000000001',
      owner_id: '00000000-0000-4000-8000-000000000002',
      category_id: 'salon',
      public_qr_id: 'luxe000001',
      vanity_slug: 'luxe-studio',
      name: 'Luxe Studio Unisex Salon',
      logo_url: 'https://local.test/logos/luxe-studio.png',
      google_place_id: 'ChIJLUXE00000001',
      google_review_url: 'https://search.google.com/local/writereview?placeid=ChIJLUXE00000001',
      whatsapp_number: '9876543210',
      account_status: 'active',
      is_active: true,
      created_at: '2026-10-01T10:00:00Z',
      updated_at: '2026-10-01T10:00:00Z',
    };

    const mockLimit = vi.fn().mockResolvedValue({ data: [mockRow], error: null });
    const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockSelect = vi.fn().mockReturnValue({ order: mockOrder });
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as unknown as ReturnType<typeof supabase.from>);

    const result = await fetchMerchantBusiness();

    expect(supabase.from).toHaveBeenCalledWith('businesses');
    expect(mockSelect).toHaveBeenCalledWith('*');
    expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(mockLimit).toHaveBeenCalledWith(1);

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      id: 'b0000000-0000-4000-8000-000000000001',
      ownerId: '00000000-0000-4000-8000-000000000002',
      categoryId: 'salon',
      publicQrId: 'luxe000001',
      vanitySlug: 'luxe-studio',
      name: 'Luxe Studio Unisex Salon',
      logoUrl: 'https://local.test/logos/luxe-studio.png',
      googlePlaceId: 'ChIJLUXE00000001',
      googleReviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJLUXE00000001',
      whatsappNumber: '9876543210',
      accountStatus: 'active',
      isActive: true,
      createdAt: '2026-10-01T10:00:00Z',
      updatedAt: '2026-10-01T10:00:00Z',
    });
  });

  it('returns null data when merchant has no associated business', async () => {
    const mockLimit = vi.fn().mockResolvedValue({ data: [], error: null });
    const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockSelect = vi.fn().mockReturnValue({ order: mockOrder });
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as unknown as ReturnType<typeof supabase.from>);

    const result = await fetchMerchantBusiness();

    expect(result.error).toBeNull();
    expect(result.data).toBeNull();
  });

  it('returns error when Supabase query fails', async () => {
    const mockLimit = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Database connection failed', code: 'PGRST500' },
    });
    const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockSelect = vi.fn().mockReturnValue({ order: mockOrder });
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as unknown as ReturnType<typeof supabase.from>);

    const result = await fetchMerchantBusiness();

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe('Database connection failed');
  });

  it('handles unexpected exceptions safely', async () => {
    vi.mocked(supabase.from).mockImplementation(() => {
      throw new Error('Network failure');
    });

    const result = await fetchMerchantBusiness();

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe('Network failure');
  });
});

describe('updateMerchantBusiness (API-OWN-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects empty or whitespace-only businessId', async () => {
    const result = await updateMerchantBusiness('', { name: 'New Name' });
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('A valid business ID is required for profile update.');

    const resultSpaces = await updateMerchantBusiness('   ', { name: 'New Name' });
    expect(resultSpaces.data).toBeNull();
    expect(resultSpaces.error?.message).toBe('A valid business ID is required for profile update.');
  });

  it('rejects updates with no valid safe fields', async () => {
    // Only privileged / excluded fields provided
    const result = await updateMerchantBusiness('b0000000-0000-4000-8000-000000000001', {
      logoUrl: 'https://attacker.com/logo.png',
    });
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('No valid fields provided for profile update.');
  });

  it('successfully updates safe profile fields and returns updated Business DTO', async () => {
    const updatedRow = {
      id: 'b0000000-0000-4000-8000-000000000001',
      owner_id: '00000000-0000-4000-8000-000000000002',
      category_id: 'salon',
      public_qr_id: 'luxe000001',
      vanity_slug: 'luxe-spa',
      name: 'Luxe Salon & Spa',
      logo_url: 'https://local.test/logos/luxe-studio.png',
      google_place_id: 'ChIJLUXE00000001',
      google_review_url: 'https://search.google.com/local/writereview?placeid=ChIJLUXE00000001',
      whatsapp_number: '9876543299',
      account_status: 'active',
      is_active: true,
      created_at: '2026-10-01T10:00:00Z',
      updated_at: '2026-10-02T10:00:00Z',
    };

    const mockSingle = vi.fn().mockResolvedValue({ data: updatedRow, error: null });
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
    const mockEq = vi.fn().mockReturnValue({ select: mockSelect });
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as unknown as ReturnType<typeof supabase.from>);

    const result = await updateMerchantBusiness('b0000000-0000-4000-8000-000000000001', {
      name: 'Luxe Salon & Spa',
      vanitySlug: 'luxe-spa',
      whatsappNumber: '9876543299',
    });

    expect(supabase.from).toHaveBeenCalledWith('businesses');
    expect(mockUpdate).toHaveBeenCalledWith({
      name: 'Luxe Salon & Spa',
      vanity_slug: 'luxe-spa',
      whatsapp_number: '9876543299',
    });
    expect(mockEq).toHaveBeenCalledWith('id', 'b0000000-0000-4000-8000-000000000001');
    expect(mockSelect).toHaveBeenCalledWith('*');
    expect(mockSingle).toHaveBeenCalled();

    expect(result.error).toBeNull();
    expect(result.data?.name).toBe('Luxe Salon & Spa');
    expect(result.data?.vanitySlug).toBe('luxe-spa');
    expect(result.data?.whatsappNumber).toBe('9876543299');
  });

  it('translates unique constraint 23505 violation into user-friendly vanity slug error', async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "businesses_vanity_slug_uq"',
        details: 'Key (vanity_slug)=(taken-slug) already exists.',
      },
    });
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
    const mockEq = vi.fn().mockReturnValue({ select: mockSelect });
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as unknown as ReturnType<typeof supabase.from>);

    const result = await updateMerchantBusiness('b0000000-0000-4000-8000-000000000001', {
      vanitySlug: 'taken-slug',
    });

    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('This vanity slug is already taken. Please choose another.');
  });

  it('translates PGRST116 (0 rows returned / permission denied) into descriptive error', async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: 'PGRST116',
        message: 'JSON object requested, multiple (or no) rows returned',
      },
    });
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
    const mockEq = vi.fn().mockReturnValue({ select: mockSelect });
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as unknown as ReturnType<typeof supabase.from>);

    const result = await updateMerchantBusiness('b0000000-0000-4000-8000-000000000001', {
      name: 'Another Name',
    });

    expect(result.data).toBeNull();
    expect(result.error?.message).toBe(
      'Business record not found or you do not have permission to update it.',
    );
  });

  it('translates trigger protection ERR_IMMUTABLE_FIELD / ERR_PRIVILEGED_FIELD', async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: 'P0001',
        message: 'ERR_IMMUTABLE_FIELD: public_qr_id is hardware-locked and permanently immutable',
      },
    });
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
    const mockEq = vi.fn().mockReturnValue({ select: mockSelect });
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as unknown as ReturnType<typeof supabase.from>);

    const result = await updateMerchantBusiness('b0000000-0000-4000-8000-000000000001', {
      name: 'Any Name',
    });

    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('Privileged or immutable fields cannot be modified.');
  });

  it('handles unexpected runtime exceptions safely', async () => {
    vi.mocked(supabase.from).mockImplementation(() => {
      throw new Error('Supabase client crashed');
    });

    const result = await updateMerchantBusiness('b0000000-0000-4000-8000-000000000001', {
      name: 'New Name',
    });

    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('Supabase client crashed');
  });
});

describe('updateGoogleDestination (API-OWN-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSupabaseUrl).mockReturnValue('https://test.supabase.co');
    vi.mocked(getSupabaseAnonKey).mockReturnValue('mock-anon-key');
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: {
        session: {
          access_token: 'mock-access-token',
        } as unknown,
      },
      error: null,
    } as unknown as Awaited<ReturnType<typeof supabase.auth.getSession>>);
  });

  it('rejects empty or missing businessId', async () => {
    const result = await updateGoogleDestination('', 'https://search.google.com/local/writereview?placeid=123');
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('A valid business ID is required.');
  });

  it('rejects empty or missing googleReviewUrl', async () => {
    const result = await updateGoogleDestination('b0000000-0000-4000-8000-000000000001', '');
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('Google review URL is required.');
  });

  it('rejects when active authentication session is missing', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    } as unknown as Awaited<ReturnType<typeof supabase.auth.getSession>>);

    const result = await updateGoogleDestination(
      'b0000000-0000-4000-8000-000000000001',
      'https://search.google.com/local/writereview?placeid=123',
    );

    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('Authentication session required to update review destination.');
  });

  it('successfully calls update-destination Edge Function and returns updated DTO', async () => {
    const mockResponse = {
      status: 'updated',
      businessId: 'b0000000-0000-4000-8000-000000000001',
      googleReviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJLUXE00000001',
      googlePlaceId: 'ChIJLUXE00000001',
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    } as Response);

    const result = await updateGoogleDestination(
      'b0000000-0000-4000-8000-000000000001',
      'https://search.google.com/local/writereview?placeid=ChIJLUXE00000001',
      'ChIJLUXE00000001',
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://test.supabase.co/functions/v1/update-destination',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer mock-access-token',
          apikey: 'mock-anon-key',
        }),
      }),
    );

    expect(result.error).toBeNull();
    expect(result.data).toEqual(mockResponse);
  });

  it('surfaces server error code ERR_INVALID_DESTINATION_URL', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error: {
          code: 'ERR_INVALID_DESTINATION_URL',
          message: 'URL must be an approved Google Maps review link.',
        },
      }),
    } as Response);

    const result = await updateGoogleDestination(
      'b0000000-0000-4000-8000-000000000001',
      'https://google.com.attacker.com',
    );

    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('URL must be an approved Google Maps review link.');
  });

  it('surfaces server error code ERR_PLACE_ID_MISMATCH', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error: {
          code: 'ERR_PLACE_ID_MISMATCH',
          message: 'Provided Google Place ID does not match the Place ID in the destination URL.',
        },
      }),
    } as Response);

    const result = await updateGoogleDestination(
      'b0000000-0000-4000-8000-000000000001',
      'https://search.google.com/local/writereview?placeid=ChIJAAA',
      'ChIJBBB',
    );

    expect(result.data).toBeNull();
    expect(result.error?.message).toBe(
      'Provided Google Place ID does not match the Place ID in the destination URL.',
    );
  });
});


