import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchMerchantBusiness } from './merchant';
import { supabase } from '../supabase';

vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
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
