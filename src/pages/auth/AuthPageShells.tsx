import * as React from 'react';
import { Link } from 'react-router';
import { RoutePlaceholderCard } from '../shared/RoutePlaceholderCard.tsx';

// Fully Implemented Merchant Auth Pages (M5-T01)
export { MerchantLoginPage } from '../merchant/LoginPage.tsx';
export { ForgotPasswordPage } from '../merchant/ForgotPasswordPage.tsx';
export { ResetPasswordPage } from '../merchant/ResetPasswordPage.tsx';

/**
 * AdminLoginPage (/admin/login)
 */
export function AdminLoginPage(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <RoutePlaceholderCard
        screenId="SCR-ADM-01"
        screenName="Admin Initial Sign-In Shell (Step 1)"
        routePath="/admin/login"
        surface="Super-Admin"
        description="Privileged super-admin email and password credentials entry. Requires active record in public.admin_users."
      />
      <div className="text-center text-xs space-x-3">
        <Link to="/admin/mfa" className="text-brand-accent hover:underline">
          MFA Challenge Step →
        </Link>
        <span>•</span>
        <Link to="/login" className="text-muted-foreground hover:underline">
          Merchant Login
        </Link>
      </div>
    </div>
  );
}

/**
 * AdminMfaPage (/admin/mfa)
 */
export function AdminMfaPage(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <RoutePlaceholderCard
        screenId="SCR-ADM-01-MFA"
        screenName="Admin TOTP MFA Challenge Shell (Step 2)"
        routePath="/admin/mfa"
        surface="Super-Admin"
        description="Enforced aal2 TOTP multi-factor authentication challenge verifying 6-digit cryptographic authenticator token."
      />
      <div className="text-center text-xs">
        <Link to="/admin/login" className="text-brand-accent hover:underline">
          ← Back to Credentials
        </Link>
      </div>
    </div>
  );
}
