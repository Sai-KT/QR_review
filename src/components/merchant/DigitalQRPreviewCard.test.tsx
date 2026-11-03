/**
 * DigitalQRPreviewCard Unit Tests (CMP-14 / SCR-OWN-06)
 *
 * Source: docs/UI_UX.md (v1.1) §9.1; docs/ROADMAP.md (v1.1) Task M5-T06
 *
 * Verifies:
 * - Rendering of permanent public QR ID, business name, and first-party review link.
 * - Interactive QR canvas lifecycle (loading shimmer, rendered canvas, error state with retry).
 * - 1-tap review link clipboard copy with feedback toast and visual indicator.
 * - Fallback link copy when navigator.clipboard is unavailable.
 * - High-resolution PNG download trigger (1024x1024) with safe filename.
 * - Multi-channel digital sharing targets (WhatsApp, Email, Device Share).
 * - External inspection link to customer portal.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { DigitalQRPreviewCard } from './DigitalQRPreviewCard';
import type { Business } from '../../types/domain';
import * as qrGen from '../../lib/qrGenerator';

const MOCK_BUSINESS: Business = {
  id: 'b1111111-1111-4111-8111-111111111111',
  ownerId: 'u1111111-1111-4111-8111-111111111111',
  categoryId: 'salon',
  publicQrId: 'luxe000001',
  vanitySlug: 'luxe-salon',
  name: 'Luxe Salon',
  logoUrl: 'https://example.com/logo.png',
  googlePlaceId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
  googleReviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4',
  whatsappNumber: '+919876543210',
  accountStatus: 'active',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockToast = vi.fn();
vi.mock('../ui/toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

describe('M5-T06: DigitalQRPreviewCard (CMP-14)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockToast.mockClear();

    // Mock HTMLCanvasElement.getContext('2d') for jsdom
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      fillStyle: '',
      fillRect: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arcTo: vi.fn(),
      fillText: vi.fn(),
      drawImage: vi.fn(),
      clip: vi.fn(),
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  describe('1. Information & Visual Elements', () => {
    it('renders business name, permanent public QR ID, and first-party review URL', async () => {
      render(<DigitalQRPreviewCard business={MOCK_BUSINESS} />);

      expect(screen.getByText('Digital QR Code Studio')).toBeInTheDocument();
      expect(screen.getByTestId('qr-business-name')).toHaveTextContent('Luxe Salon');
      expect(screen.getByText('luxe000001')).toBeInTheDocument();

      const input = screen.getByTestId('review-url-input') as HTMLInputElement;
      expect(input.value).toContain('/q/luxe000001');

      await waitFor(() => {
        expect(screen.getByTestId('digital-qr-canvas')).toBeInTheDocument();
      });
    });

    it('renders monogram badge branding when business has no custom logo', async () => {
      const bizWithoutLogo: Business = {
        ...MOCK_BUSINESS,
        logoUrl: null,
      };

      const spy = vi.spyOn(qrGen, 'renderQrToCanvas');
      render(<DigitalQRPreviewCard business={bizWithoutLogo} />);

      await waitFor(() => {
        expect(spy).toHaveBeenCalledWith(
          expect.any(HTMLCanvasElement),
          expect.stringContaining('/q/luxe000001'),
          expect.objectContaining({
            fallbackMonogram: 'LS',
            logoUrl: null,
          }),
        );
      });
    });
  });

  describe('2. Clipboard Copy Interactions', () => {
    it('copies review URL to clipboard and renders visual confirmation', async () => {
      const onCopied = vi.fn();
      const writeTextMock = vi.fn().mockResolvedValue(undefined);

      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        configurable: true,
        writable: true,
      });

      render(<DigitalQRPreviewCard business={MOCK_BUSINESS} onLinkCopied={onCopied} />);

      const copyBtn = screen.getByTestId('copy-review-link-button');
      fireEvent.click(copyBtn);

      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining('/q/luxe000001'));
      });
      expect(screen.getByTestId('copy-success-indicator')).toBeInTheDocument();
      expect(screen.getByText('Link Copied!')).toBeInTheDocument();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Review Link Copied',
          variant: 'success',
        }),
      );
      expect(onCopied).toHaveBeenCalledTimes(1);
    });

    it('uses textarea fallback when navigator.clipboard writeText throws', async () => {
      const onCopied = vi.fn();

      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: vi.fn().mockRejectedValue(new Error('Permission denied')),
        },
        configurable: true,
        writable: true,
      });

      const execCommandSpy = vi.fn().mockReturnValue(true);
      document.execCommand = execCommandSpy;

      render(<DigitalQRPreviewCard business={MOCK_BUSINESS} onLinkCopied={onCopied} />);

      const copyBtn = screen.getByTestId('copy-review-link-button');
      fireEvent.click(copyBtn);

      await waitFor(() => {
        expect(execCommandSpy).toHaveBeenCalledWith('copy');
      });
      expect(screen.getByText('Link Copied!')).toBeInTheDocument();
      expect(onCopied).toHaveBeenCalledTimes(1);
    });
  });

  describe('3. High-Resolution PNG Export (TC-OWN-12)', () => {
    it('invokes downloadQrPng with 1024x1024 target size and safe filename', async () => {
      const onDownloaded = vi.fn();
      const downloadSpy = vi.spyOn(qrGen, 'downloadQrPng').mockResolvedValue(undefined);

      render(<DigitalQRPreviewCard business={MOCK_BUSINESS} onPngDownloaded={onDownloaded} />);

      const downloadBtn = screen.getByTestId('download-png-button');
      fireEvent.click(downloadBtn);

      await waitFor(() => {
        expect(downloadSpy).toHaveBeenCalledWith(
          expect.stringContaining('/q/luxe000001'),
          'luxe-salon-review-qr-1024.png',
          expect.objectContaining({
            size: 1024,
            quietZone: 4,
            errorCorrectionLevel: 'H',
          }),
        );
      });

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'High-Res QR Downloaded',
          variant: 'success',
        }),
      );
      expect(onDownloaded).toHaveBeenCalledTimes(1);
    });

    it('handles download failure with error toast', async () => {
      vi.spyOn(qrGen, 'downloadQrPng').mockRejectedValue(new Error('Canvas export failure'));

      render(<DigitalQRPreviewCard business={MOCK_BUSINESS} />);

      const downloadBtn = screen.getByTestId('download-png-button');
      fireEvent.click(downloadBtn);

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Download Failed',
            description: 'Canvas export failure',
            variant: 'destructive',
          }),
        );
      });
    });
  });

  describe('4. Multi-Channel Sharing Targets & Customer Navigation', () => {
    it('provides WhatsApp share link with pre-encoded message', () => {
      render(<DigitalQRPreviewCard business={MOCK_BUSINESS} />);

      const whatsappBtn = screen.getByTestId('whatsapp-share-button');
      expect(whatsappBtn).toHaveAttribute('href');
      const href = whatsappBtn.getAttribute('href') || '';
      expect(href).toContain('https://wa.me/?text=');
      expect(href).toContain(encodeURIComponent('Luxe Salon'));
      expect(href).toContain(encodeURIComponent('/q/luxe000001'));
      expect(whatsappBtn).toHaveAttribute('target', '_blank');
      expect(whatsappBtn).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('provides Email share link with pre-encoded subject and body', () => {
      render(<DigitalQRPreviewCard business={MOCK_BUSINESS} />);

      const emailBtn = screen.getByTestId('email-share-button');
      expect(emailBtn).toHaveAttribute('href');
      const href = emailBtn.getAttribute('href') || '';
      expect(href).toContain('mailto:?subject=');
      expect(href).toContain(encodeURIComponent('Luxe Salon'));
      expect(href).toContain(encodeURIComponent('/q/luxe000001'));
    });

    it('renders Native Share button when navigator.share is available', async () => {
      const mockShare = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        share: mockShare,
      });

      render(<DigitalQRPreviewCard business={MOCK_BUSINESS} />);

      const shareBtn = screen.getByTestId('native-share-button');
      expect(shareBtn).toBeInTheDocument();

      fireEvent.click(shareBtn);
      await waitFor(() => {
        expect(mockShare).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Review Luxe Salon',
            url: expect.stringContaining('/q/luxe000001'),
          }),
        );
      });
    });

    it('renders Open Customer Portal secondary action opening /q/:public_qr_id', () => {
      render(<DigitalQRPreviewCard business={MOCK_BUSINESS} />);

      const portalBtn = screen.getByTestId('test-review-link-button');
      expect(portalBtn).toHaveAttribute('href', expect.stringContaining('/q/luxe000001'));
      expect(portalBtn).toHaveAttribute('target', '_blank');
      expect(portalBtn).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });

  describe('5. Canvas Render Error & Recovery', () => {
    it('displays accessible error message and allows retry when canvas rendering fails', async () => {
      let callCount = 0;
      vi.spyOn(qrGen, 'renderQrToCanvas').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Canvas 2D context lost');
        }
      });

      render(<DigitalQRPreviewCard business={MOCK_BUSINESS} />);

      await waitFor(() => {
        expect(screen.getByTestId('qr-render-error')).toBeInTheDocument();
      });
      expect(screen.getByText('Failed to generate QR')).toBeInTheDocument();

      // Tap retry
      const retryBtn = screen.getByRole('button', { name: /retry/i });
      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(screen.getByTestId('digital-qr-canvas')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('qr-render-error')).not.toBeInTheDocument();
    });
  });
});
