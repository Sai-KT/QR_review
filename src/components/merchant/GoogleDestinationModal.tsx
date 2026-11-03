/**
 * Google Destination Setup Modal Component (SCR-OWN-05)
 *
 * Source: docs/ROADMAP.md (v1.1) §10.6 Task M5-T04
 *
 * Provides a dialog container hosting GoogleDestinationForm for convenient
 * in-context destination editing from ProfileSettingsPage or dashboard cards.
 */

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { GoogleDestinationForm } from './GoogleDestinationForm';
import type { Business } from '../../types/domain';

export interface GoogleDestinationModalProps {
  business: Business;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => Promise<void> | void;
}

export function GoogleDestinationModal({
  business,
  open,
  onOpenChange,
  onSuccess,
}: GoogleDestinationModalProps): React.JSX.Element {
  const handleSuccess = async () => {
    if (onSuccess) {
      await onSuccess();
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-xl max-h-[90vh] overflow-y-auto"
        data-testid="google-destination-modal"
      >
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-text-primary">
            Google Review Destination Setup
          </DialogTitle>
          <DialogDescription className="text-xs text-text-secondary">
            Configure, test, and save your official Google Maps review prompt link.
          </DialogDescription>
        </DialogHeader>

        <GoogleDestinationForm
          business={business}
          onSuccess={handleSuccess}
          onCancel={() => onOpenChange(false)}
          isModal={true}
        />
      </DialogContent>
    </Dialog>
  );
}

