import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WelcomeCard } from './WelcomeCard';
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

describe('WelcomeCard Component (SCR-CUST-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  it('renders store branding: name, logo image, category badge, and intro copy', () => {
    render(<WelcomeCard business={mockBusiness} />);

    expect(screen.getByRole('heading', { name: 'Luxe Salon & Spa' })).toBeInTheDocument();
    const logoImg = screen.getByAltText('Luxe Salon & Spa logo');
    expect(logoImg).toBeInTheDocument();
    expect(logoImg).toHaveAttribute('src', 'https://cdn.example.com/luxe.png');
    expect(screen.getByText('Salon')).toBeInTheDocument();
    expect(
      screen.getByText(/How was your experience today\? Help us improve or share your thoughts on Google Maps\./i),
    ).toBeInTheDocument();
  });

  it('falls back to monogram initials if logo image fails to load', () => {
    render(<WelcomeCard business={mockBusiness} />);

    const logoImg = screen.getByAltText('Luxe Salon & Spa logo');
    fireEvent.error(logoImg);

    // After image error, img should disappear and monogram should appear
    expect(screen.queryByAltText('Luxe Salon & Spa logo')).not.toBeInTheDocument();
    expect(screen.getByText('LS')).toBeInTheDocument();
  });

  it('renders monogram initials directly when logoUrl is null', () => {
    render(<WelcomeCard business={{ ...mockBusiness, logoUrl: null }} />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('LS')).toBeInTheDocument();
  });

  it('renders Cafe category badge correctly', () => {
    render(
      <WelcomeCard
        business={{
          ...mockBusiness,
          name: 'The Daily Roast Café',
          categoryId: 'cafe',
        }}
      />,
    );

    expect(screen.getByText('Café')).toBeInTheDocument();
  });

  it('triggers onStartReview callback when primary CTA is clicked', async () => {
    const user = userEvent.setup();
    const handleStartReview = vi.fn();

    render(<WelcomeCard business={mockBusiness} onStartReview={handleStartReview} />);

    const startBtn = screen.getByRole('button', { name: /Start 30-Second Review/i });
    expect(startBtn).toBeInTheDocument();
    await user.click(startBtn);

    expect(handleStartReview).toHaveBeenCalledTimes(1);
  });

  it('displays started survey state when isStarted prop is true', () => {
    render(<WelcomeCard business={mockBusiness} isStarted={true} />);

    expect(
      screen.getByRole('button', { name: /Survey Started \(3 Quick MCQs\)/i }),
    ).toBeInTheDocument();
  });

  it('renders anti-gating direct Google review bypass and handles external navigation', async () => {
    const user = userEvent.setup();
    const handleDirectClick = vi.fn();

    render(<WelcomeCard business={mockBusiness} onDirectGoogleClick={handleDirectClick} />);

    const googleBtn = screen.getByRole('button', { name: /Review Directly on Google Maps ↗/i });
    expect(googleBtn).toBeInTheDocument();

    await user.click(googleBtn);

    expect(handleDirectClick).toHaveBeenCalledTimes(1);
    expect(window.open).toHaveBeenCalledWith(
      'https://g.page/r/luxe-salon/review',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('renders Google Maps search fallback when googleReviewUrl is null', async () => {
    const user = userEvent.setup();
    const handleDirectClick = vi.fn();

    render(
      <WelcomeCard
        business={{ ...mockBusiness, googleReviewUrl: null }}
        onDirectGoogleClick={handleDirectClick}
      />,
    );

    expect(
      screen.getByText(/A direct review link is not configured for this location\./i),
    ).toBeInTheDocument();

    const searchBtn = screen.getByRole('button', { name: /Search on Google Maps ↗/i });
    expect(searchBtn).toBeInTheDocument();

    await user.click(searchBtn);

    expect(handleDirectClick).toHaveBeenCalledTimes(1);
    expect(window.open).toHaveBeenCalledWith(
      'https://www.google.com/maps',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('renders universal WhatsApp manager link when number is provided', async () => {
    const user = userEvent.setup();
    const handleWhatsAppClick = vi.fn();

    render(<WelcomeCard business={mockBusiness} onWhatsAppClick={handleWhatsAppClick} />);

    const waLink = screen.getByRole('link', { name: /Message Manager on WhatsApp/i });
    expect(waLink).toBeInTheDocument();
    expect(waLink).toHaveAttribute(
      'href',
      'https://wa.me/919876543210?text=Hello%2C%20I%20visited%20your%20business%20and%20would%20like%20to%20get%20in%20touch.',
    );

    await user.click(waLink);
    expect(handleWhatsAppClick).toHaveBeenCalledTimes(1);
  });

  it('omits WhatsApp link when number is null or whitespace', () => {
    render(<WelcomeCard business={{ ...mockBusiness, whatsappNumber: null }} />);

    expect(screen.queryByRole('link', { name: /Message Manager on WhatsApp/i })).not.toBeInTheDocument();
  });

  it('renders activeTokenText in footer if provided', () => {
    render(
      <WelcomeCard business={mockBusiness} activeTokenText='Active QR token parameter: "luxe000001"' />,
    );

    expect(screen.getByText(/Active QR token parameter: "luxe000001"/i)).toBeInTheDocument();
  });
});
