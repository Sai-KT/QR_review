import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchMerchantBusiness,
  updateMerchantBusiness,
  updateGoogleDestination,
  fetchMerchantFeedback,
  fetchSurveyOptionsMap,
  fetchSurveyQuestionsMap,
  deriveResponseSentiment,
  type SurveyQuestionOptionMeta,
} from './merchant';
import type { CustomerFeedback } from '../adapters/feedback';
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

describe('fetchMerchantFeedback (API-OWN-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createFeedbackQueryMock(response: {
    data: unknown;
    count?: number | null;
    error: unknown;
  }) {
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    builder.eq = vi.fn().mockImplementation(() => builder);
    builder.gte = vi.fn().mockImplementation(() => builder);
    builder.lte = vi.fn().mockImplementation(() => builder);
    builder.order = vi.fn().mockImplementation(() => builder);
    builder.range = vi.fn().mockImplementation(() => builder);

    // Make the builder thenable
    Object.assign(builder, {
      then: (resolve: (val: unknown) => void) => Promise.resolve(response).then(resolve),
    });

    const mockSelect = vi.fn().mockReturnValue(builder);
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as unknown as ReturnType<typeof supabase.from>);

    return { mockSelect, builder };
  }

  it('rejects empty or whitespace-only businessId', async () => {
    const res1 = await fetchMerchantFeedback({ businessId: '' });
    expect(res1.data).toBeNull();
    expect(res1.error?.message).toBe('A valid business ID is required to fetch feedback.');

    const res2 = await fetchMerchantFeedback({ businessId: '   ' });
    expect(res2.data).toBeNull();
    expect(res2.error?.message).toBe('A valid business ID is required to fetch feedback.');
  });

  it('fetches customer feedback with pagination and deterministic ordering', async () => {
    const mockRows = [
      {
        id: 'r0000000-0000-4000-8000-000000000001',
        business_id: 'b0000000-0000-4000-8000-000000000001',
        category_id: 'salon',
        selected_options: [{ questionId: 'q1', optionId: 'opt1' }],
        affirmed_facts_snapshot: ['Masterful hair styling'],
        optional_note: 'Loved the service!',
        session_uuid: 's0000000-0000-4000-8000-000000000001',
        purged_at: null,
        created_at: '2026-10-25T14:30:00Z',
        authenticity_confirmed: true,
      },
    ];

    const { mockSelect, builder } = createFeedbackQueryMock({
      data: mockRows,
      count: 1,
      error: null,
    });

    const result = await fetchMerchantFeedback({
      businessId: 'b0000000-0000-4000-8000-000000000001',
      page: 1,
      pageSize: 50,
    });

    expect(supabase.from).toHaveBeenCalledWith('survey_responses');
    expect(mockSelect).toHaveBeenCalledWith(
      'id, business_id, category_id, selected_options, affirmed_facts_snapshot, optional_note, session_uuid, purged_at, created_at, authenticity_confirmed',
      { count: 'exact' },
    );
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'b0000000-0000-4000-8000-000000000001');
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(builder.order).toHaveBeenCalledWith('id', { ascending: false });
    expect(builder.range).toHaveBeenCalledWith(0, 49);

    expect(result.error).toBeNull();
    expect(result.totalCount).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]?.id).toBe('r0000000-0000-4000-8000-000000000001');
    expect(result.data?.[0]?.optionalNote).toBe('Loved the service!');
    expect(result.data?.[0]?.purgedAt).toBeNull();
    expect(result.data?.[0]?.authenticityConfirmed).toBe(true);
  });

  it('calculates pagination range correctly for page 2', async () => {
    const { builder } = createFeedbackQueryMock({
      data: [],
      count: 75,
      error: null,
    });

    const result = await fetchMerchantFeedback({
      businessId: 'b0000000-0000-4000-8000-000000000001',
      page: 2,
      pageSize: 50,
    });

    expect(builder.range).toHaveBeenCalledWith(50, 99);
    expect(result.totalCount).toBe(75);
    expect(result.data).toEqual([]);
  });

  it('applies date filters when provided', async () => {
    const { builder } = createFeedbackQueryMock({
      data: [],
      count: 0,
      error: null,
    });

    await fetchMerchantFeedback({
      businessId: 'b0000000-0000-4000-8000-000000000001',
      startDate: '2026-10-01',
      endDate: '2026-10-15',
    });

    expect(builder.gte).toHaveBeenCalledWith('created_at', '2026-10-01T00:00:00.000Z');
    expect(builder.lte).toHaveBeenCalledWith('created_at', '2026-10-15T23:59:59.999Z');
  });

  it('returns database error safely', async () => {
    createFeedbackQueryMock({
      data: null,
      count: null,
      error: { message: 'RLS policy violated or connection dropped' },
    });

    const result = await fetchMerchantFeedback({
      businessId: 'b0000000-0000-4000-8000-000000000001',
    });

    expect(result.data).toBeNull();
    expect(result.totalCount).toBe(0);
    expect(result.error?.message).toBe('RLS policy violated or connection dropped');
  });
});

describe('fetchSurveyOptionsMap & fetchSurveyQuestionsMap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads and indexes active survey options', async () => {
    const mockRows = [
      {
        id: 'opt-1',
        question_id: 'q-1',
        option_text: 'Expert Haircut',
        emoji_anchor: '✂️',
        sentiment_label: 'positive',
        is_neutral_na: false,
      },
      {
        id: 'opt-2',
        question_id: 'q-1',
        option_text: 'Poor Hygiene',
        emoji_anchor: '⚠️',
        sentiment_label: 'negative',
        is_neutral_na: false,
      },
    ];

    const mockEq = vi.fn().mockResolvedValue({ data: mockRows, error: null });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as unknown as ReturnType<typeof supabase.from>);

    const result = await fetchSurveyOptionsMap();

    expect(supabase.from).toHaveBeenCalledWith('survey_options');
    expect(result.error).toBeNull();
    expect(result.data).toBeInstanceOf(Map);
    expect(result.data?.size).toBe(2);
    expect(result.data?.get('opt-1')).toEqual({
      id: 'opt-1',
      questionId: 'q-1',
      optionText: 'Expert Haircut',
      emojiAnchor: '✂️',
      sentimentLabel: 'positive',
      isNeutralNa: false,
    });
  });

  it('returns error when loading survey options fails', async () => {
    const mockEq = vi.fn().mockResolvedValue({ data: null, error: { message: 'Network failed' } });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as unknown as ReturnType<typeof supabase.from>);

    const result = await fetchSurveyOptionsMap();

    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('Network failed');
  });

  it('loads survey questions map and respects categoryId filter', async () => {
    const mockRows = [
      { id: 'q-1', question_text: 'How was the service?', display_order: 1 },
      { id: 'q-2', question_text: 'How was the hygiene?', display_order: 2 },
    ];

    const mockEqCategory = vi.fn().mockResolvedValue({ data: mockRows, error: null });
    const mockEqActive = vi.fn().mockReturnValue({ eq: mockEqCategory });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEqActive });
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as unknown as ReturnType<typeof supabase.from>);

    const questionsMap = await fetchSurveyQuestionsMap('salon');

    expect(supabase.from).toHaveBeenCalledWith('survey_questions');
    expect(mockSelect).toHaveBeenCalledWith('id, question_text, display_order');
    expect(mockEqActive).toHaveBeenCalledWith('is_active', true);
    expect(mockEqCategory).toHaveBeenCalledWith('category_id', 'salon');
    expect(questionsMap.size).toBe(2);
    expect(questionsMap.get('q-1')?.questionText).toBe('How was the service?');
  });
});

describe('deriveResponseSentiment', () => {
  const optionsMap = new Map<string, SurveyQuestionOptionMeta>([
    [
      'opt-pos',
      {
        id: 'opt-pos',
        questionId: 'q1',
        optionText: 'Masterful cut',
        emojiAnchor: '✂️',
        sentimentLabel: 'positive',
        isNeutralNa: false,
      },
    ],
    [
      'opt-neg',
      {
        id: 'opt-neg',
        questionId: 'q2',
        optionText: 'Rushed service',
        emojiAnchor: '⏳',
        sentimentLabel: 'negative',
        isNeutralNa: false,
      },
    ],
    [
      'opt-na',
      {
        id: 'opt-na',
        questionId: 'q3',
        optionText: 'Not Applicable',
        emojiAnchor: '➖',
        sentimentLabel: 'neutral',
        isNeutralNa: true,
      },
    ],
  ]);

  it('classifies feedback as positive when all applicable selections are positive', () => {
    const feedback: CustomerFeedback = {
      id: 'f-1',
      businessId: 'b-1',
      categoryId: 'salon',
      selectedOptions: [{ questionId: 'q1', optionId: 'opt-pos' }],
      affirmedFactsSnapshot: ['Masterful cut'],
      optionalNote: null,
      sessionUuid: 's-1',
      purgedAt: null,
      createdAt: '2026-10-25T10:00:00Z',
      authenticityConfirmed: true,
    };

    const sentiment = deriveResponseSentiment(feedback, optionsMap);
    expect(sentiment).toBe('positive');
  });

  it('classifies feedback as critical if any selection has negative sentiment', () => {
    const feedback: CustomerFeedback = {
      id: 'f-2',
      businessId: 'b-1',
      categoryId: 'salon',
      selectedOptions: [
        { questionId: 'q1', optionId: 'opt-pos' },
        { questionId: 'q2', optionId: 'opt-neg' },
      ],
      affirmedFactsSnapshot: ['Masterful cut', 'Rushed service'],
      optionalNote: null,
      sessionUuid: 's-2',
      purgedAt: null,
      createdAt: '2026-10-25T10:00:00Z',
      authenticityConfirmed: true,
    };

    const sentiment = deriveResponseSentiment(feedback, optionsMap);
    expect(sentiment).toBe('critical');
  });

  it('classifies mixed positive and neutral selections as positive', () => {
    const feedback: CustomerFeedback = {
      id: 'f-2b',
      businessId: 'b-1',
      categoryId: 'salon',
      selectedOptions: [
        { questionId: 'q1', optionId: 'opt-pos' },
        { questionId: 'q3', optionId: 'opt-na' },
      ],
      affirmedFactsSnapshot: ['Masterful cut'],
      optionalNote: null,
      sessionUuid: 's-2b',
      purgedAt: null,
      createdAt: '2026-10-25T10:00:00Z',
      authenticityConfirmed: true,
    };

    const sentiment = deriveResponseSentiment(feedback, optionsMap);
    expect(sentiment).toBe('positive');
  });

  it('classifies feedback as neutral when all selections are neutral/NA', () => {
    const feedback: CustomerFeedback = {
      id: 'f-3',
      businessId: 'b-1',
      categoryId: 'salon',
      selectedOptions: [{ questionId: 'q3', optionId: 'opt-na' }],
      affirmedFactsSnapshot: ['Not Applicable'],
      optionalNote: null,
      sessionUuid: 's-3',
      purgedAt: null,
      createdAt: '2026-10-25T10:00:00Z',
      authenticityConfirmed: true,
    };

    const sentiment = deriveResponseSentiment(feedback, optionsMap);
    expect(sentiment).toBe('neutral');
  });

  it('classifies feedback as neutral when option metadata is missing, retired, or invalid', () => {
    const feedback: CustomerFeedback = {
      id: 'f-retired',
      businessId: 'b-1',
      categoryId: 'salon',
      selectedOptions: [
        { questionId: 'q1', optionId: 'opt-retired-version-a' },
      ],
      affirmedFactsSnapshot: ['Historical option text'],
      optionalNote: null,
      sessionUuid: 's-retired',
      purgedAt: null,
      createdAt: '2026-10-20T10:00:00Z',
      authenticityConfirmed: true,
    };

    // Since opt-retired-version-a is not in active optionsMap, it must not fabricate 'positive'
    const sentiment = deriveResponseSentiment(feedback, optionsMap);
    expect(sentiment).toBe('neutral');
  });

  it('classifies feedback as critical even if one option is retired as long as a negative option is present', () => {
    const feedback: CustomerFeedback = {
      id: 'f-mixed-retired-neg',
      businessId: 'b-1',
      categoryId: 'salon',
      selectedOptions: [
        { questionId: 'q1', optionId: 'opt-retired-version-a' },
        { questionId: 'q2', optionId: 'opt-neg' },
      ],
      affirmedFactsSnapshot: ['Historical option text', 'Rushed service'],
      optionalNote: null,
      sessionUuid: 's-mixed',
      purgedAt: null,
      createdAt: '2026-10-20T10:00:00Z',
      authenticityConfirmed: true,
    };

    const sentiment = deriveResponseSentiment(feedback, optionsMap);
    expect(sentiment).toBe('critical');
  });

  it('falls back to affirmedFactsSnapshot when optionsMap is missing', () => {
    const feedback: CustomerFeedback = {
      id: 'f-4',
      businessId: 'b-1',
      categoryId: 'salon',
      selectedOptions: [],
      affirmedFactsSnapshot: [
        { questionId: 'q2', optionText: 'Long wait', sentimentLabel: 'negative' },
      ],
      optionalNote: null,
      sessionUuid: 's-4',
      purgedAt: null,
      createdAt: '2026-10-25T10:00:00Z',
      authenticityConfirmed: true,
    };

    const sentiment = deriveResponseSentiment(feedback);
    expect(sentiment).toBe('critical');
  });

  it('defaults to neutral safely when no facts or options exist', () => {
    const feedback: CustomerFeedback = {
      id: 'f-5',
      businessId: 'b-1',
      categoryId: 'salon',
      selectedOptions: [],
      affirmedFactsSnapshot: [],
      optionalNote: null,
      sessionUuid: 's-5',
      purgedAt: null,
      createdAt: '2026-10-25T10:00:00Z',
      authenticityConfirmed: true,
    };

    const sentiment = deriveResponseSentiment(feedback);
    expect(sentiment).toBe('neutral');
  });
});



