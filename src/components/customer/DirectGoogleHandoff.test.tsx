import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DirectGoogleHandoff } from './DirectGoogleHandoff';
import type { PublicBusinessProjection } from '../../types/domain';

const mockBusiness: PublicBusinessProjection = {
  name: 'Luxe Salon & Spa',
  publicQrId: 'luxe000001',
  categoryId: 'salon',
  googleReviewUrl: 'https://g.page/r/luxe-salon/review',
  whatsappNumber: '+91 98765 43210',
  logoUrl: 'https://cdn.example.com/luxe.png',
  isActive: true,
  isSuspended: false,
  isDirectGoogleOnly: false,
  subscriptionStatus: 'active',
  accountStatus: 'active',
};

describe('DirectGoogleHandoff Component (SCR-CUST-09)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  it('renders store branding and direct handoff explanation', () => {
    render(<DirectGoogleHandoff business={mockBusiness} />);

    expect(screen.getByRole('heading', { name: 'Luxe Salon & Spa' })).toBeInTheDocument();
    expect(screen.getByAltText('Luxe Salon & Spa logo')).toBeInTheDocument();
    expect(screen.getByText('Salon')).toBeInTheDocument();
    expect(screen.getByText('Direct Google Review Handoff')).toBeInTheDocument();
    expect(
      screen.getByText(
        /You are heading directly to Google Maps to review Luxe Salon & Spa\. We appreciate your honest feedback!/i,
      ),
    ).toBeInTheDocument();
  });

  it('falls back to monogram initials if logo image fails to load or is null', () => {
    const { rerender } = render(<DirectGoogleHandoff business={mockBusiness} />);

    const logoImg = screen.getByAltText('Luxe Salon & Spa logo');
    fireEvent.error(logoImg);

    expect(screen.queryByAltText('Luxe Salon & Spa logo')).not.toBeInTheDocument();
    expect(screen.getByText('LS')).toBeInTheDocument();

    rerender(<DirectGoogleHandoff business={{ ...mockBusiness, logoUrl: null }} />);
    expect(screen.getByText('LS')).toBeInTheDocument();
  });

  it('navigates to configured Google review URL when primary action is tapped', async () => {
    const user = userEvent.setup();
    const handleHandoffClick = vi.fn();

    render(
      <DirectGoogleHandoff business={mockBusiness} onHandoffClick={handleHandoffClick} />,
    );

    const openBtn = screen.getByRole('button', { name: /Open Google Maps to Review →/i });
    expect(openBtn).toBeInTheDocument();

    await user.click(openBtn);

    expect(handleHandoffClick).toHaveBeenCalledTimes(1);
    expect(window.open).toHaveBeenCalledWith(
      'https://g.page/r/luxe-salon/review',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('safely falls back to Google Maps search when googleReviewUrl is missing or invalid', async () => {
    const user = userEvent.setup();
    const handleHandoffClick = vi.fn();

    render(
      <DirectGoogleHandoff
        business={{ ...mockBusiness, googleReviewUrl: null }}
        onHandoffClick={handleHandoffClick}
      />,
    );

    expect(
      screen.getByText(
        /A direct review link is not configured for this location\. You can search for "Luxe Salon & Spa" directly on Google Maps\./i,
      ),
    ).toBeInTheDocument();

    const searchBtn = screen.getByRole('button', { name: /Search on Google Maps ↗/i });
    expect(searchBtn).toBeInTheDocument();

    await user.click(searchBtn);

    expect(handleHandoffClick).toHaveBeenCalledTimes(1);
    expect(window.open).toHaveBeenCalledWith(
      'https://www.google.com/maps',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('triggers onBack callback when Back to Quick Survey button is clicked', async () => {
    const user = userEvent.setup();
    const handleBack = vi.fn();

    render(<DirectGoogleHandoff business={mockBusiness} onBack={handleBack} />);

    const backBtn = screen.getByRole('button', { name: /← Back to Quick Survey/i });
    expect(backBtn).toBeInTheDocument();

    await user.click(backBtn);

    expect(handleBack).toHaveBeenCalledTimes(1);
  });

  it('renders activeTokenText in footer if provided', () => {
    render(
      <DirectGoogleHandoff
        business={mockBusiness}
        activeTokenText='Active QR token parameter: "luxe000001"'
      />,
    );

    expect(screen.getByText(/Active QR token parameter: "luxe000001"/i)).toBeInTheDocument();
  });
});
