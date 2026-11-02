import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { getSupabaseClient } from '../../lib/supabase.ts';
import {
  getAuthErrorMessage,
  getSafeRedirectUrl,
  validateEmail,
  validatePassword,
} from '../../lib/auth/authUtils.ts';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { useToast } from '../../components/ui/toast.tsx';

type LoginMode = 'password' | 'magic-link';

/**
 * MerchantLoginPage (`SCR-OWN-01`)
 *
 * Primary merchant owner authentication portal.
 * Supports standard email/password authentication as well as passwordless email OTP magic links.
 * Enforces strict client-side validation, password visibility toggling, accessible error alerts,
 * and safe local redirection to the merchant dashboard.
 */
export function MerchantLoginPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  const [mode, setMode] = React.useState<LoginMode>('password');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);

  // Validation state
  const [emailError, setEmailError] = React.useState<string | null>(null);
  const [passwordError, setPasswordError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);

  // Magic link success notification state
  const [magicLinkSentTo, setMagicLinkSentTo] = React.useState<string | null>(null);

  // Target post-login redirect
  const redirectTarget = getSafeRedirectUrl(searchParams.get('redirect_to') ?? searchParams.get('redirectTo'));

  React.useEffect(() => {
    document.title = 'Merchant Sign In | QR_review';
  }, []);

  // Reset errors when switching modes
  const handleModeChange = (newMode: LoginMode) => {
    setMode(newMode);
    setEmailError(null);
    setPasswordError(null);
    setFormError(null);
    setMagicLinkSentTo(null);
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    setFormError(null);

    // Validate inputs
    const emailValidation = validateEmail(email);
    const passwordValidation = validatePassword(password);

    setEmailError(emailValidation.error ?? null);
    setPasswordError(passwordValidation.error ?? null);

    if (!emailValidation.isValid || !passwordValidation.isValid) {
      return;
    }

    setIsLoading(true);

    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        const errorMsg = getAuthErrorMessage(error);
        setFormError(errorMsg);
        toast({
          title: 'Sign In Failed',
          description: errorMsg,
          variant: 'destructive',
        });
        return;
      }

      if (data.session) {
        toast({
          title: 'Welcome Back',
          description: 'You have signed in successfully.',
          variant: 'success',
        });
        navigate(redirectTarget, { replace: true });
      }
    } catch (err) {
      const errorMsg = getAuthErrorMessage(err);
      setFormError(errorMsg);
      toast({
        title: 'Sign In Failed',
        description: errorMsg,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleMagicLinkLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    setFormError(null);
    setMagicLinkSentTo(null);

    const emailValidation = validateEmail(email);
    setEmailError(emailValidation.error ?? null);

    if (!emailValidation.isValid) {
      return;
    }

    setIsLoading(true);

    try {
      const supabase = getSupabaseClient();
      const redirectUrl = `${window.location.origin}${redirectTarget}`;

      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: redirectUrl,
          shouldCreateUser: false, // Security constraint: do not create arbitrary accounts via magic link
        },
      });

      if (error) {
        // Anti-enumeration defense: When GoTrue returns otp_disabled ("Signups not allowed for otp"),
        // an unregistered email was supplied. Mask this response and render the standard confirmation
        // card to prevent revealing account existence, while strictly preserving shouldCreateUser: false.
        const errObj = error as { message?: string; code?: string; status?: number };
        const isUnregistered =
          errObj.code === 'otp_disabled' ||
          (errObj.message || '').toLowerCase().includes('signups not allowed for otp') ||
          errObj.status === 422;

        if (isUnregistered) {
          setMagicLinkSentTo(email.trim());
          toast({
            title: 'Check Your Email',
            description: `If an account exists for ${email.trim()}, a sign-in link has been sent.`,
            variant: 'success',
          });
          return;
        }

        const errorMsg = getAuthErrorMessage(error);
        setFormError(errorMsg);
        toast({
          title: 'Magic Link Error',
          description: errorMsg,
          variant: 'destructive',
        });
        return;
      }

      setMagicLinkSentTo(email.trim());
      toast({
        title: 'Check Your Email',
        description: `If an account exists for ${email.trim()}, a sign-in link has been sent.`,
        variant: 'success',
      });
    } catch (err) {
      const errorMsg = getAuthErrorMessage(err);
      setFormError(errorMsg);
      toast({
        title: 'Magic Link Error',
        description: errorMsg,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Mode Switcher Tabs */}
      <div
        className="flex rounded-lg bg-surface-subtle p-1 border border-border-subtle"
        role="tablist"
        aria-label="Sign-in methods"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'password'}
          aria-controls="password-login-panel"
          id="password-tab"
          onClick={() => handleModeChange('password')}
          className={`flex-1 py-1.5 px-3 text-xs sm:text-sm font-medium rounded-md transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            mode === 'password'
              ? 'bg-surface-base text-foreground shadow-xs font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Password
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'magic-link'}
          aria-controls="magic-link-panel"
          id="magic-link-tab"
          onClick={() => handleModeChange('magic-link')}
          className={`flex-1 py-1.5 px-3 text-xs sm:text-sm font-medium rounded-md transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            mode === 'magic-link'
              ? 'bg-surface-base text-foreground shadow-xs font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Magic Link
        </button>
      </div>

      {/* Global Form Error Alert */}
      {formError && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-md bg-state-danger/10 border border-state-danger/30 p-3 text-xs sm:text-sm text-state-danger flex items-start gap-2"
        >
          <svg
            className="h-4 w-4 shrink-0 mt-0.5 text-state-danger"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <span>{formError}</span>
        </div>
      )}

      {/* Password Mode Panel */}
      {mode === 'password' && (
        <form
          id="password-login-panel"
          role="tabpanel"
          aria-label="Password sign-in panel"
          onSubmit={handlePasswordLogin}
          noValidate
          className="space-y-4"
        >
          {/* Email Input */}
          <div className="space-y-1.5 text-left">
            <label
              htmlFor="merchant-email"
              className="text-xs sm:text-sm font-medium text-foreground block"
            >
              Email Address
            </label>
            <Input
              id="merchant-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="owner@yourbusiness.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError) setEmailError(null);
                if (formError) setFormError(null);
              }}
              disabled={isLoading}
              isInvalid={Boolean(emailError)}
              aria-describedby={emailError ? 'email-error' : undefined}
              required
            />
            {emailError && (
              <p id="email-error" className="text-xs text-state-danger font-medium mt-1">
                {emailError}
              </p>
            )}
          </div>

          {/* Password Input */}
          <div className="space-y-1.5 text-left">
            <div className="flex items-center justify-between">
              <label
                htmlFor="merchant-password"
                className="text-xs sm:text-sm font-medium text-foreground block"
              >
                Password
              </label>
              <Link
                to="/forgot-password"
                className="text-xs text-brand-accent hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-xs"
              >
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <Input
                id="merchant-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (passwordError) setPasswordError(null);
                  if (formError) setFormError(null);
                }}
                disabled={isLoading}
                isInvalid={Boolean(passwordError)}
                aria-describedby={passwordError ? 'password-error' : undefined}
                className="pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-0 top-0 h-full px-3 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-r-md flex items-center justify-center"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={0}
              >
                {showPassword ? (
                  // Eye Slash SVG
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"
                    />
                  </svg>
                ) : (
                  // Eye SVG
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    />
                  </svg>
                )}
              </button>
            </div>
            {passwordError && (
              <p id="password-error" className="text-xs text-state-danger font-medium mt-1">
                {passwordError}
              </p>
            )}
          </div>

          {/* Submit Button */}
          <Button
            type="submit"
            className="w-full mt-2"
            size="default"
            isLoading={isLoading}
            disabled={isLoading}
          >
            {isLoading ? 'Signing In...' : 'Sign In'}
          </Button>
        </form>
      )}

      {/* Magic Link Mode Panel */}
      {mode === 'magic-link' && (
        <div id="magic-link-panel" role="tabpanel" aria-label="Magic link sign-in panel" className="space-y-4">
          {magicLinkSentTo ? (
            <div
              className="rounded-lg bg-state-success/10 border border-state-success/30 p-4 text-center space-y-2"
              role="status"
              aria-live="polite"
            >
              <div className="h-8 w-8 mx-auto rounded-full bg-state-success/20 text-state-success flex items-center justify-center">
                <svg
                  className="h-5 w-5"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-foreground">Check Your Email</h3>
              <p className="text-xs text-muted-foreground">
                If an account exists for{' '}
                <strong className="text-foreground font-semibold">{magicLinkSentTo}</strong>,
                a secure sign-in link has been sent. Click the link in the email to access your dashboard.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2 text-xs"
                onClick={() => {
                  setMagicLinkSentTo(null);
                  setEmail('');
                }}
              >
                Send to a different email
              </Button>
            </div>
          ) : (
            <form onSubmit={handleMagicLinkLogin} noValidate className="space-y-4">
              <div className="space-y-1.5 text-left">
                <label
                  htmlFor="magic-email"
                  className="text-xs sm:text-sm font-medium text-foreground block"
                >
                  Email Address
                </label>
                <Input
                  id="magic-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="owner@yourbusiness.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (emailError) setEmailError(null);
                    if (formError) setFormError(null);
                  }}
                  disabled={isLoading}
                  isInvalid={Boolean(emailError)}
                  aria-describedby={emailError ? 'magic-email-error' : undefined}
                  required
                />
                {emailError && (
                  <p id="magic-email-error" className="text-xs text-state-danger font-medium mt-1">
                    {emailError}
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground mt-1">
                  We will email you a one-time sign-in link. No password required.
                </p>
              </div>

              <Button
                type="submit"
                className="w-full"
                size="default"
                isLoading={isLoading}
                disabled={isLoading}
              >
                {isLoading ? 'Sending Link...' : 'Send Magic Link'}
              </Button>
            </form>
          )}
        </div>
      )}

      {/* Footer Navigation Links */}
      <div className="pt-2 border-t border-border-subtle text-center text-xs text-muted-foreground space-x-3">
        <Link
          to="/forgot-password"
          className="hover:text-foreground text-brand-accent hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-xs"
        >
          Password Recovery
        </Link>
        <span>•</span>
        <Link
          to="/admin/login"
          className="hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-xs"
        >
          Admin Console
        </Link>
      </div>
    </div>
  );
}

export { MerchantLoginPage as LoginPage };

