import * as React from 'react';
import { Button } from '../ui/button';
import { uploadBusinessLogo, deleteBusinessLogo, prevalidateLogoFile } from '../../lib/storage';

function UploadCloudIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
      />
    </svg>
  );
}

function ImageIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  );
}

function AlertCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="12" y1="16" x2="12.01" y2="16" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className || ''}`}
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

export interface LogoUploaderProps {
  businessId: string;
  businessName: string;
  currentLogoUrl: string | null;
  onLogoUpdated: (newLogoUrl: string | null) => Promise<void> | void;
  disabled?: boolean;
}

export function LogoUploader({
  businessId,
  businessName,
  currentLogoUrl,
  onLogoUpdated,
  disabled = false,
}: LogoUploaderProps): React.JSX.Element {
  const [prevPropUrl, setPrevPropUrl] = React.useState(currentLogoUrl);
  const [logoUrl, setLogoUrl] = React.useState<string | null>(currentLogoUrl);
  const [isDragging, setIsDragging] = React.useState(false);
  const [isUploading, setIsUploading] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = React.useState<string | null>(null);
  const [imageFailed, setImageFailed] = React.useState(false);

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Synchronize state during render when parent prop changes (React recommended pattern)
  if (currentLogoUrl !== prevPropUrl) {
    setPrevPropUrl(currentLogoUrl);
    setLogoUrl(currentLogoUrl);
    setImageFailed(false);
  }

  // Monogram initials fallback
  const monogram = React.useMemo(() => {
    const trimmed = (businessName || '').trim();
    if (!trimmed) return 'QR';
    const words = trimmed.split(/\s+/);
    if (words.length >= 2) {
      return ((words[0]?.[0] || '') + (words[1]?.[0] || '')).toUpperCase();
    }
    return trimmed.slice(0, 2).toUpperCase();
  }, [businessName]);

  const handleFileSelection = async (file: File) => {
    setUploadError(null);
    setUploadSuccess(null);

    // 1. Client-Side Pre-validation
    const validation = await prevalidateLogoFile(file);
    if (!validation.isValid) {
      setUploadError(validation.errorMessage);
      return;
    }

    // 2. Upload via Server Gateway
    setIsUploading(true);
    try {
      const result = await uploadBusinessLogo(businessId, file);
      if (result.error) {
        setUploadError(result.error.message);
      } else if (result.data) {
        setLogoUrl(result.data.logoUrl);
        setUploadSuccess('Brand logo uploaded and verified successfully.');
        await onLogoUpdated(result.data.logoUrl);
      }
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'An unexpected error occurred during logo upload.',
      );
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0 && files[0]) {
      handleFileSelection(files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && !isUploading && !isDeleting) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (disabled || isUploading || isDeleting) return;

    const files = e.dataTransfer.files;
    if (files && files.length > 0 && files[0]) {
      handleFileSelection(files[0]);
    }
  };

  const handleDeleteLogo = async () => {
    setUploadError(null);
    setUploadSuccess(null);
    setIsDeleting(true);

    try {
      const result = await deleteBusinessLogo(businessId);
      if (result.error) {
        setUploadError(result.error.message);
      } else {
        setLogoUrl(null);
        setUploadSuccess('Custom brand logo removed successfully.');
        await onLogoUpdated(null);
      }
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'An unexpected error occurred while deleting logo.',
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-4 min-w-0" data-testid="logo-uploader">
      {/* Current Logo Preview & Management */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-3 bg-surface-subtle border border-border-subtle rounded-lg">
        <div className="flex items-center gap-3 min-w-0">
          {logoUrl && !imageFailed ? (
            <div className="relative shrink-0">
              <img
                src={logoUrl}
                alt={`${businessName} logo`}
                data-testid="current-logo-preview"
                className="h-14 w-14 rounded-md object-contain border border-border-subtle bg-surface-base p-1"
                onError={() => setImageFailed(true)}
              />
            </div>
          ) : (
            <div
              className="h-14 w-14 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-sm shrink-0"
              data-testid="logo-monogram-placeholder"
            >
              {monogram}
            </div>
          )}

          <div className="min-w-0">
            <h4 className="text-xs font-semibold text-text-primary">
              {logoUrl ? 'Active Brand Logo' : 'Default Store Avatar'}
            </h4>
            <p className="text-[11px] text-text-secondary truncate">
              {logoUrl
                ? 'Rendered on customer surveys, Google review prompts, and digital QR codes.'
                : 'Using business initials until a custom brand logo is uploaded.'}
            </p>
          </div>
        </div>

        {logoUrl && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleDeleteLogo}
            disabled={disabled || isUploading || isDeleting}
            data-testid="logo-remove-btn"
            className="text-feedback-error border-feedback-error/30 hover:bg-feedback-error/10 shrink-0 min-h-[44px] sm:min-h-[36px]"
          >
            {isDeleting ? (
              <>
                <SpinnerIcon className="h-4 w-4 mr-1.5" />
                Removing...
              </>
            ) : (
              <>
                <TrashIcon className="h-4 w-4 mr-1.5" />
                Remove Logo
              </>
            )}
          </Button>
        )}
      </div>

      {/* Hidden file input associated semantically with dropzone label */}
      <input
        id={`logo-file-input-${businessId}`}
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handleInputChange}
        disabled={disabled || isUploading || isDeleting}
        className="sr-only"
        data-testid="logo-file-input"
      />

      {/* Upload Dropzone semantic label */}
      <label
        htmlFor={`logo-file-input-${businessId}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        data-testid="logo-dropzone"
        className={`relative border-2 border-dashed rounded-lg p-5 flex flex-col items-center justify-center text-center cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-primary/40 ${
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-border-subtle hover:border-border-hover bg-surface-base'
        } ${disabled || isUploading || isDeleting ? 'opacity-60 cursor-not-allowed pointer-events-none' : ''}`}
      >
        <div className="flex flex-col items-center gap-2">
          {isUploading ? (
            <div
              className="flex flex-col items-center gap-2 py-2"
              data-testid="logo-uploading-indicator"
            >
              <SpinnerIcon className="h-8 w-8 text-primary" />
              <p className="text-xs font-medium text-text-primary">
                Uploading and verifying logo...
              </p>
              <p className="text-[11px] text-text-secondary">
                Running binary magic-byte inspection and format-preserving storage.
              </p>
            </div>
          ) : (
            <>
              <div className="h-10 w-10 rounded-full bg-surface-subtle flex items-center justify-center text-text-secondary mb-1">
                {isDragging ? (
                  <UploadCloudIcon className="h-5 w-5 text-primary" />
                ) : (
                  <ImageIcon className="h-5 w-5" />
                )}
              </div>
              <p className="text-xs font-semibold text-text-primary">
                <span className="text-primary hover:underline">Click to upload</span> or drag and
                drop
              </p>
              <p className="text-[11px] text-text-secondary">
                PNG, JPEG, or WebP (max 2 MB, up to 2048&times;2048px)
              </p>
              <p className="text-[10px] text-text-muted mt-1">
                SVG files are strictly prohibited for security reasons.
              </p>
            </>
          )}
        </div>
      </label>

      {/* Success Notification */}
      {uploadSuccess && (
        <div
          role="status"
          data-testid="logo-success-alert"
          className="flex items-center gap-2 p-3 text-xs bg-surface-subtle text-text-primary border border-border-subtle rounded-md"
        >
          <CheckCircleIcon className="h-4 w-4 text-primary shrink-0" />
          <span>{uploadSuccess}</span>
        </div>
      )}

      {/* Error Notification */}
      {uploadError && (
        <div
          role="alert"
          data-testid="logo-error-alert"
          className="flex items-center gap-2 p-3 text-xs bg-feedback-error/10 text-feedback-error border border-feedback-error/20 rounded-md"
        >
          <AlertCircleIcon className="h-4 w-4 shrink-0" />
          <span className="font-medium">{uploadError}</span>
        </div>
      )}
    </div>
  );
}
