import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LogoUploader } from './LogoUploader';
import * as storage from '../../lib/storage';

vi.mock('../../lib/storage', () => ({
  uploadBusinessLogo: vi.fn(),
  deleteBusinessLogo: vi.fn(),
  prevalidateLogoFile: vi.fn(),
}));

const MOCK_BUSINESS_ID = 'b0000000-0000-4000-8000-000000000001';
const MOCK_BUSINESS_NAME = 'Luxe Studio Unisex Salon';

describe('LogoUploader component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders monogram avatar fallback when currentLogoUrl is null', () => {
    render(
      <LogoUploader
        businessId={MOCK_BUSINESS_ID}
        businessName={MOCK_BUSINESS_NAME}
        currentLogoUrl={null}
        onLogoUpdated={vi.fn()}
      />,
    );

    expect(screen.getByTestId('logo-monogram-placeholder')).toHaveTextContent('LS');
    expect(screen.getByText(/Default Store Avatar/i)).toBeInTheDocument();
    expect(screen.queryByTestId('logo-remove-btn')).not.toBeInTheDocument();
  });

  it('renders active logo image when currentLogoUrl is provided', () => {
    render(
      <LogoUploader
        businessId={MOCK_BUSINESS_ID}
        businessName={MOCK_BUSINESS_NAME}
        currentLogoUrl="https://local.test/logos/logo.png"
        onLogoUpdated={vi.fn()}
      />,
    );

    const img = screen.getByTestId('current-logo-preview');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://local.test/logos/logo.png');
    expect(screen.getByText(/Active Brand Logo/i)).toBeInTheDocument();
    expect(screen.getByTestId('logo-remove-btn')).toBeInTheDocument();
  });

  it('falls back to monogram initials if image load errors out', () => {
    render(
      <LogoUploader
        businessId={MOCK_BUSINESS_ID}
        businessName={MOCK_BUSINESS_NAME}
        currentLogoUrl="https://broken.test/logo.png"
        onLogoUpdated={vi.fn()}
      />,
    );

    const img = screen.getByTestId('current-logo-preview');
    fireEvent.error(img);

    expect(screen.getByTestId('logo-monogram-placeholder')).toHaveTextContent('LS');
  });

  it('TC-UPL-04: rejects SVG selection on client and displays security error alert', async () => {
    vi.mocked(storage.prevalidateLogoFile).mockResolvedValueOnce({
      isValid: false,
      errorCode: 'ERR_INVALID_IMAGE_TYPE',
      errorMessage: 'SVG files are strictly prohibited for security reasons. Please upload PNG, JPEG, or WebP.',
    });

    render(
      <LogoUploader
        businessId={MOCK_BUSINESS_ID}
        businessName={MOCK_BUSINESS_NAME}
        currentLogoUrl={null}
        onLogoUpdated={vi.fn()}
      />,
    );

    const fileInput = screen.getByTestId('logo-file-input');
    const svgFile = new File(['<svg></svg>'], 'test.svg', { type: 'image/svg+xml' });

    fireEvent.change(fileInput, { target: { files: [svgFile] } });

    await waitFor(() => {
      const errorAlert = screen.getByTestId('logo-error-alert');
      expect(errorAlert).toBeVisible();
      expect(errorAlert).toHaveTextContent(/SVG files are strictly prohibited/i);
    });

    expect(storage.uploadBusinessLogo).not.toHaveBeenCalled();
  });

  it('TC-UPL-05: rejects file exceeding 2 MB and displays file size error', async () => {
    vi.mocked(storage.prevalidateLogoFile).mockResolvedValueOnce({
      isValid: false,
      errorCode: 'ERR_FILE_TOO_LARGE',
      errorMessage: 'File size (2.50 MB) exceeds the 2 MB limit.',
    });

    render(
      <LogoUploader
        businessId={MOCK_BUSINESS_ID}
        businessName={MOCK_BUSINESS_NAME}
        currentLogoUrl={null}
        onLogoUpdated={vi.fn()}
      />,
    );

    const fileInput = screen.getByTestId('logo-file-input');
    const largeFile = new File(['x'], 'huge.png', { type: 'image/png' });

    fireEvent.change(fileInput, { target: { files: [largeFile] } });

    await waitFor(() => {
      const errorAlert = screen.getByTestId('logo-error-alert');
      expect(errorAlert).toBeVisible();
      expect(errorAlert).toHaveTextContent(/exceeds the 2 MB limit/i);
    });

    expect(storage.uploadBusinessLogo).not.toHaveBeenCalled();
  });

  it('TC-UPL-01: successfully uploads valid PNG, displays success alert, and notifies parent', async () => {
    const onLogoUpdated = vi.fn();
    const newLogoUrl = 'https://local.test/storage/v1/object/public/business-logos/biz/logo.png?v=123';

    vi.mocked(storage.prevalidateLogoFile).mockResolvedValueOnce({
      isValid: true,
      format: 'png',
      extension: 'png',
      mimeType: 'image/png',
      width: 200,
      height: 200,
      aspectRatio: 1.0,
      byteLength: 5000,
    });

    vi.mocked(storage.uploadBusinessLogo).mockResolvedValueOnce({
      data: {
        status: 'uploaded',
        businessId: MOCK_BUSINESS_ID,
        logoUrl: newLogoUrl,
      },
      error: null,
    });

    render(
      <LogoUploader
        businessId={MOCK_BUSINESS_ID}
        businessName={MOCK_BUSINESS_NAME}
        currentLogoUrl={null}
        onLogoUpdated={onLogoUpdated}
      />,
    );

    const fileInput = screen.getByTestId('logo-file-input');
    const validFile = new File(['png-data'], 'logo.png', { type: 'image/png' });

    fireEvent.change(fileInput, { target: { files: [validFile] } });

    await waitFor(() => {
      expect(screen.getByTestId('logo-success-alert')).toBeVisible();
      expect(screen.getByTestId('logo-success-alert')).toHaveTextContent(/uploaded and verified successfully/i);
    });

    expect(storage.uploadBusinessLogo).toHaveBeenCalledWith(MOCK_BUSINESS_ID, validFile);
    expect(onLogoUpdated).toHaveBeenCalledWith(newLogoUrl);
  });

  it('removes logo when remove button is clicked and notifies parent with null', async () => {
    const onLogoUpdated = vi.fn();

    vi.mocked(storage.deleteBusinessLogo).mockResolvedValueOnce({
      data: {
        status: 'deleted',
        businessId: MOCK_BUSINESS_ID,
      },
      error: null,
    });

    render(
      <LogoUploader
        businessId={MOCK_BUSINESS_ID}
        businessName={MOCK_BUSINESS_NAME}
        currentLogoUrl="https://local.test/logos/logo.png"
        onLogoUpdated={onLogoUpdated}
      />,
    );

    const removeBtn = screen.getByTestId('logo-remove-btn');
    fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(screen.getByTestId('logo-success-alert')).toBeVisible();
      expect(screen.getByTestId('logo-success-alert')).toHaveTextContent(/removed successfully/i);
    });

    expect(storage.deleteBusinessLogo).toHaveBeenCalledWith(MOCK_BUSINESS_ID);
    expect(onLogoUpdated).toHaveBeenCalledWith(null);
  });

  it('disables interactions when disabled prop is true', () => {
    render(
      <LogoUploader
        businessId={MOCK_BUSINESS_ID}
        businessName={MOCK_BUSINESS_NAME}
        currentLogoUrl="https://local.test/logos/logo.png"
        onLogoUpdated={vi.fn()}
        disabled={true}
      />,
    );

    expect(screen.getByTestId('logo-remove-btn')).toBeDisabled();
    expect(screen.getByTestId('logo-file-input')).toBeDisabled();
    expect(screen.getByTestId('logo-dropzone')).toHaveClass('opacity-60');
  });
});
