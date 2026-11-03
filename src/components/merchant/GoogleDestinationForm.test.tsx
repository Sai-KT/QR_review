import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GoogleDestinationForm } from './GoogleDestinationForm';
import { updateGoogleDestination } from '../../lib/api/merchant';
import type { Business } from '../../types/domain';

vi.mock('../../lib/api/merchant', () => ({
  updateGoogleDestination: vi.fn(),
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

describe('GoogleDestinationForm (SCR-OWN-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders current configured Google review destination URL and Place ID', () => {
    render(<GoogleDestinationForm business={MOCK_BUSINESS} />);

    expect(screen.getByTestId('current-destination-url')).toHaveTextContent(
      'https://search.google.com/local/writereview?placeid=ChIJLUXE00000001',
    );
    expect(screen.getByTestId('current-place-id')).toHaveTextContent(
      'ChIJLUXE00000001',
    );
    expect(screen.getByText(/Active & Routing/i)).toBeInTheDocument();
  });

  it('renders unconfigured state when business lacks a Google review destination', () => {
    const unconfiguredBusiness: Business = {
      ...MOCK_BUSINESS,
      googleReviewUrl: null,
      googlePlaceId: null,
    };

    render(<GoogleDestinationForm business={unconfiguredBusiness} />);

    expect(screen.getByTestId('destination-unconfigured-notice')).toBeInTheDocument();
    expect(screen.getByText(/Configuration Required/i)).toBeInTheDocument();
  });

  it('shows real-time validation error when invalid or lookalike domain is entered', async () => {
    render(<GoogleDestinationForm business={MOCK_BUSINESS} />);

    const input = screen.getByTestId('destination-url-input');
    await userEvent.clear(input);
    await userEvent.type(input, 'https://search.google.com.attacker.com/review');

    expect(
      screen.getByText(/URL must be an approved Google Maps review link/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId('destination-test-btn')).toBeDisabled();
    expect(screen.getByTestId('destination-save-btn')).toBeDisabled();
  });

  it('shows real-time valid badge when an approved Google review link is entered', async () => {
    render(<GoogleDestinationForm business={MOCK_BUSINESS} />);

    const input = screen.getByTestId('destination-url-input');
    await userEvent.clear(input);
    await userEvent.type(input, 'https://maps.app.goo.gl/AbCd12345');

    expect(screen.getByTestId('destination-validation-valid')).toHaveTextContent(
      'Valid Google Review Link Format (maps.app.goo.gl)',
    );
    expect(screen.getByTestId('destination-test-btn')).toBeEnabled();
  });

  it('TC-OWN-10: mandates clicking Test Review Link before Save button is enabled', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(<GoogleDestinationForm business={MOCK_BUSINESS} />);

    const input = screen.getByTestId('destination-url-input');
    await userEvent.clear(input);
    await userEvent.type(
      input,
      'https://search.google.com/local/writereview?placeid=ChIJNEW_PLACE_0000001',
    );

    // Save button must be disabled before testing
    const saveBtn = screen.getByTestId('destination-save-btn');
    expect(saveBtn).toBeDisabled();

    // Click Test Review Link
    const testBtn = screen.getByTestId('destination-test-btn');
    await userEvent.click(testBtn);

    expect(openSpy).toHaveBeenCalledWith(
      'https://search.google.com/local/writereview?placeid=ChIJNEW_PLACE_0000001',
      '_blank',
      'noopener,noreferrer',
    );
    expect(screen.getByTestId('destination-test-notice')).toBeInTheDocument();

    // Now Save button must be enabled
    expect(saveBtn).toBeEnabled();

    // Modifying the URL should invalidate the test and re-disable Save
    await userEvent.type(input, '2');
    expect(saveBtn).toBeDisabled();
  });

  it('resets inputs to pristine baseline when Discard Changes is clicked', async () => {
    render(<GoogleDestinationForm business={MOCK_BUSINESS} />);

    const input = screen.getByTestId('destination-url-input');
    await userEvent.clear(input);
    await userEvent.type(input, 'https://maps.app.goo.gl/Modified');

    const discardBtn = screen.getByTestId('destination-discard-btn');
    await userEvent.click(discardBtn);

    expect(screen.getByTestId('destination-url-input')).toHaveValue(
      'https://search.google.com/local/writereview?placeid=ChIJLUXE00000001',
    );
    expect(screen.queryByTestId('destination-discard-btn')).not.toBeInTheDocument();
  });

  it('submits valid destination update and renders success banner', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => null);
    const mockOnSuccess = vi.fn();

    vi.mocked(updateGoogleDestination).mockResolvedValue({
      data: {
        status: 'updated',
        businessId: MOCK_BUSINESS.id,
        googleReviewUrl:
          'https://search.google.com/local/writereview?placeid=ChIJNEW_000000000001',
        googlePlaceId: 'ChIJNEW_000000000001',
      },
      error: null,
    });

    render(<GoogleDestinationForm business={MOCK_BUSINESS} onSuccess={mockOnSuccess} />);

    const input = screen.getByTestId('destination-url-input');
    await userEvent.clear(input);
    await userEvent.type(
      input,
      'https://search.google.com/local/writereview?placeid=ChIJNEW_000000000001',
    );

    const testBtn = screen.getByTestId('destination-test-btn');
    await userEvent.click(testBtn);

    const saveBtn = screen.getByTestId('destination-save-btn');
    await userEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateGoogleDestination).toHaveBeenCalledWith(
        MOCK_BUSINESS.id,
        'https://search.google.com/local/writereview?placeid=ChIJNEW_000000000001',
        'ChIJNEW_000000000001',
      );
    });

    expect(screen.getByTestId('destination-success-alert')).toBeInTheDocument();
    expect(mockOnSuccess).toHaveBeenCalledTimes(1);
  });

  it('surfaces API errors and preserves entered inputs', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => null);

    vi.mocked(updateGoogleDestination).mockResolvedValue({
      data: null,
      error: new Error('This Google Place ID is already associated with another registered business.'),
    });

    render(<GoogleDestinationForm business={MOCK_BUSINESS} />);

    const input = screen.getByTestId('destination-url-input');
    await userEvent.clear(input);
    await userEvent.type(
      input,
      'https://search.google.com/local/writereview?placeid=ChIJCOLLISION0000001',
    );

    const testBtn = screen.getByTestId('destination-test-btn');
    await userEvent.click(testBtn);

    const saveBtn = screen.getByTestId('destination-save-btn');
    await userEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByTestId('destination-error-alert')).toBeInTheDocument();
    });

    expect(
      screen.getByText(/This Google Place ID is already associated with another registered business/i),
    ).toBeInTheDocument();
    // Input must be preserved
    expect(screen.getByTestId('destination-url-input')).toHaveValue(
      'https://search.google.com/local/writereview?placeid=ChIJCOLLISION0000001',
    );
  });
});

