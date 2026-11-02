import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileSettingsPage } from './ProfileSettingsPage';
import { useMerchantAuth } from '../../hooks/useMerchantAuth';
import { updateMerchantBusiness } from '../../lib/api/merchant';
import type { Business } from '../../types/domain';

vi.mock('../../hooks/useMerchantAuth', () => ({
  useMerchantAuth: vi.fn(),
}));

vi.mock('../../lib/api/merchant', () => ({
  updateMerchantBusiness: vi.fn(),
}));

const MOCK_BUSINESS: Business = {
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
};

describe('ProfileSettingsPage (SCR-OWN-04)', () => {
  const mockRefreshBusiness = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useMerchantAuth).mockReturnValue({
      business: MOCK_BUSINESS,
      loading: false,
      error: null,
      session: null,
      user: null,
      signOut: vi.fn(),
      refreshBusiness: mockRefreshBusiness,
    });
  });

  it('renders loading skeleton while fetching initial business context', () => {
    vi.mocked(useMerchantAuth).mockReturnValue({
      business: null,
      loading: true,
      error: null,
      session: null,
      user: null,
      signOut: vi.fn(),
      refreshBusiness: mockRefreshBusiness,
    });

    render(<ProfileSettingsPage />);
    expect(screen.getByTestId('profile-loading-skeleton')).toBeInTheDocument();
  });

  it('renders error state with retry button when business profile fails to load', async () => {
    vi.mocked(useMerchantAuth).mockReturnValue({
      business: null,
      loading: false,
      error: 'Network error loading profile',
      session: null,
      user: null,
      signOut: vi.fn(),
      refreshBusiness: mockRefreshBusiness,
    });

    render(<ProfileSettingsPage />);
    expect(screen.getByTestId('profile-error-state')).toBeInTheDocument();
    expect(screen.getByText(/Network error loading profile/i)).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: /Retry Loading Profile/i });
    await userEvent.click(retryBtn);
    expect(mockRefreshBusiness).toHaveBeenCalledTimes(1);
  });

  it('renders populated form and read-only platform cards with business data', () => {
    render(<ProfileSettingsPage />);

    expect(screen.getByRole('heading', { name: /Business Profile & Brand Settings/i })).toBeInTheDocument();
    expect(screen.getByTestId('business-name-input')).toHaveValue('Luxe Studio Unisex Salon');
    expect(screen.getByTestId('vanity-slug-input')).toHaveValue('luxe-studio');
    expect(screen.getByTestId('whatsapp-input')).toHaveValue('9876543210');

    // Read-only cards
    expect(screen.getByTestId('public-qr-id-display')).toHaveTextContent('luxe000001');
    expect(screen.getByText(/Salon & Personal Care/i)).toBeInTheDocument();
    expect(screen.getByText(/active/i)).toBeInTheDocument();

    // Buttons should initially be disabled because form is pristine
    expect(screen.getByTestId('profile-save-btn')).toBeDisabled();
    expect(screen.getByTestId('profile-reset-btn')).toBeDisabled();
  });

  it('dynamically updates live character counter and preview slug', async () => {
    render(<ProfileSettingsPage />);

    const nameInput = screen.getByTestId('business-name-input');
    const slugInput = screen.getByTestId('vanity-slug-input');

    expect(screen.getByTestId('business-name-counter')).toHaveTextContent('24/100');

    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'New Luxe Studio');
    expect(screen.getByTestId('business-name-counter')).toHaveTextContent('15/100');

    await userEvent.clear(slugInput);
    await userEvent.type(slugInput, 'new-luxe');
    expect(screen.getByTestId('vanity-slug-preview')).toHaveTextContent('/r/new-luxe');

    // Form is now dirty, so buttons should be enabled
    expect(screen.getByTestId('profile-save-btn')).toBeEnabled();
    expect(screen.getByTestId('profile-reset-btn')).toBeEnabled();
  });

  it('reverts modifications when clicking Discard Changes', async () => {
    render(<ProfileSettingsPage />);

    const nameInput = screen.getByTestId('business-name-input');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Altered Business Name');

    expect(nameInput).toHaveValue('Altered Business Name');
    expect(screen.getByTestId('profile-reset-btn')).toBeEnabled();

    await userEvent.click(screen.getByTestId('profile-reset-btn'));

    expect(nameInput).toHaveValue('Luxe Studio Unisex Salon');
    expect(screen.getByTestId('profile-save-btn')).toBeDisabled();
    expect(screen.getByTestId('profile-reset-btn')).toBeDisabled();
  });

  it('enforces client-side validation for empty name, invalid slug, and invalid phone', async () => {
    render(<ProfileSettingsPage />);

    const nameInput = screen.getByTestId('business-name-input');
    const slugInput = screen.getByTestId('vanity-slug-input');
    const phoneInput = screen.getByTestId('whatsapp-input');
    const saveBtn = screen.getByTestId('profile-save-btn');

    // 1. Clear name
    await userEvent.clear(nameInput);
    // 2. Set invalid slug with trailing hyphen
    await userEvent.clear(slugInput);
    await userEvent.type(slugInput, 'invalid-slug-');
    // 3. Set invalid phone
    await userEvent.clear(phoneInput);
    await userEvent.type(phoneInput, '12345');

    await userEvent.click(saveBtn);

    expect(screen.getByText(/Business name is required/i)).toBeInTheDocument();
    expect(screen.getByText(/Vanity slug may only contain lowercase letters/i)).toBeInTheDocument();
    expect(screen.getByText(/Enter a valid 10-digit Indian mobile number/i)).toBeInTheDocument();
    expect(updateMerchantBusiness).not.toHaveBeenCalled();
  });

  it('successfully submits valid updates, shows success alert, and refreshes business', async () => {
    const updatedBusiness: Business = {
      ...MOCK_BUSINESS,
      name: 'Luxe Salon & Luxury Spa',
      vanitySlug: 'luxe-spa',
      whatsappNumber: '9876543299',
    };

    vi.mocked(updateMerchantBusiness).mockResolvedValue({
      data: updatedBusiness,
      error: null,
    });

    render(<ProfileSettingsPage />);

    const nameInput = screen.getByTestId('business-name-input');
    const slugInput = screen.getByTestId('vanity-slug-input');
    const phoneInput = screen.getByTestId('whatsapp-input');
    const saveBtn = screen.getByTestId('profile-save-btn');

    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Luxe Salon & Luxury Spa');

    await userEvent.clear(slugInput);
    await userEvent.type(slugInput, 'luxe-spa');

    await userEvent.clear(phoneInput);
    await userEvent.type(phoneInput, '9876543299');

    await userEvent.click(saveBtn);

    expect(updateMerchantBusiness).toHaveBeenCalledWith('b0000000-0000-4000-8000-000000000001', {
      name: 'Luxe Salon & Luxury Spa',
      vanitySlug: 'luxe-spa',
      whatsappNumber: '9876543299',
    });

    await waitFor(() => {
      expect(screen.getByTestId('profile-success-alert')).toBeInTheDocument();
    });
    expect(screen.getByText(/Business profile updated successfully/i)).toBeInTheDocument();
    expect(mockRefreshBusiness).toHaveBeenCalledTimes(1);
  });

  it('displays user-friendly error when backend rejects vanity slug with collision', async () => {
    vi.mocked(updateMerchantBusiness).mockResolvedValue({
      data: null,
      error: new Error('This vanity slug is already taken. Please choose another.'),
    });

    render(<ProfileSettingsPage />);

    const slugInput = screen.getByTestId('vanity-slug-input');
    const saveBtn = screen.getByTestId('profile-save-btn');

    await userEvent.clear(slugInput);
    await userEvent.type(slugInput, 'taken-slug');

    await userEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByTestId('profile-error-alert')).toBeInTheDocument();
    });
    expect(
      screen.getByText(/This vanity slug is already taken. Please choose another./i),
    ).toBeInTheDocument();
  });

  it('preserves unsaved changes and displays notice when background refresh occurs', async () => {
    const { rerender } = render(<ProfileSettingsPage />);

    const nameInput = screen.getByTestId('business-name-input');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Unsaved Custom Name');

    // Simulate background refresh of business record with updated timestamp
    const refreshedBusiness: Business = {
      ...MOCK_BUSINESS,
      updatedAt: '2026-10-01T10:15:00Z',
    };

    vi.mocked(useMerchantAuth).mockReturnValue({
      business: refreshedBusiness,
      loading: false,
      error: null,
      session: null,
      user: null,
      signOut: vi.fn(),
      refreshBusiness: mockRefreshBusiness,
    });

    rerender(<ProfileSettingsPage />);

    // User's unsaved changes MUST be preserved
    expect(screen.getByTestId('business-name-input')).toHaveValue('Unsaved Custom Name');
    // Notice banner should inform user of background refresh
    expect(screen.getByTestId('profile-external-update-notice')).toBeInTheDocument();
  });

  it('completely resets form and avoids cross-tenant state leakage on tenant switch', async () => {
    const { rerender } = render(<ProfileSettingsPage />);

    const nameInput = screen.getByTestId('business-name-input');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Unsaved Tenant 1 Name');

    // Switch to Tenant 2
    const tenant2Business: Business = {
      ...MOCK_BUSINESS,
      id: 'b0000000-0000-4000-8000-000000000002',
      name: 'The Daily Roast Cafe',
      vanitySlug: 'daily-roast',
      categoryId: 'cafe',
      publicQrId: 'daily00001',
    };

    vi.mocked(useMerchantAuth).mockReturnValue({
      business: tenant2Business,
      loading: false,
      error: null,
      session: null,
      user: null,
      signOut: vi.fn(),
      refreshBusiness: mockRefreshBusiness,
    });

    rerender(<ProfileSettingsPage />);

    // Must NOT leak Tenant 1's unsaved input
    expect(screen.getByTestId('business-name-input')).toHaveValue('The Daily Roast Cafe');
    expect(screen.getByTestId('vanity-slug-input')).toHaveValue('daily-roast');
    expect(screen.getByTestId('public-qr-id-display')).toHaveTextContent('daily00001');
    expect(screen.queryByTestId('profile-external-update-notice')).not.toBeInTheDocument();
  });
});

