import * as React from 'react';
import { Link } from 'react-router';
import { RoutePlaceholderCard } from '../shared/RoutePlaceholderCard.tsx';

/**
 * MerchantLoginPage (/login)
 */
export function MerchantLoginPage(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <RoutePlaceholderCard
        screenId="SCR-OWN-01"
        screenName="Merchant Login Shell"
        routePath="/login"
        surface="Auth"
        description="Merchant owner sign-in portal supporting password authentication and email magic-link OTP via Supabase Auth."
      />
      <div className="text-center text-xs text-muted-foreground space-x-3">
        <Link to="/forgot-password" className="text-brand-accent hover:underline">
          Forgot Password?
        </Link>
        <span>•</span>
        <Link to="/admin/login" className="text-muted-foreground hover:underline">
          Admin Console
        </Link>
      </div>
    </div>
  );
}

/**
 * ForgotPasswordPage (/forgot-password)
 */
export function ForgotPasswordPage(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <RoutePlaceholderCard
        screenId="SCR-OWN-02"
        screenName="Password Recovery Shell"
        routePath="/forgot-password"
        surface="Auth"
        description="Password reset flow: merchant enters registered email address to receive password recovery link."
      />
      <div className="text-center text-xs">
        <Link to="/login" className="text-brand-accent hover:underline">
          ← Back to Merchant Login
        </Link>
      </div>
    </div>
  );
}

/**
 * ResetPasswordPage (/reset-password)
 */
export function ResetPasswordPage(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <RoutePlaceholderCard
        screenId="AUTH-RESET-PASS"
        screenName="Set New Password Shell"
        routePath="/reset-password"
        surface="Auth"
        description="Authenticated password reset screen reached via verified magic recovery link to establish a new password."
      />
      <div className="text-center text-xs">
        <Link to="/login" className="text-brand-accent hover:underline">
          ← Return to Login
        </Link>
      </div>
    </div>
  );
}

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
