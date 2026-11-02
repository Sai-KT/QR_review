import * as React from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { getSupabaseClient } from '../../lib/supabase.ts';
import {
  clearRecoverySession,
  getAuthErrorMessage,
  isRecoverySessionActive,
  markRecoverySessionActive,
  validatePassword,
} from '../../lib/auth/authUtils.ts';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { useToast } from '../../components/ui/toast.tsx';

type RecoveryState = 'checking' | 'ready' | 'invalid_link' | 'success';

function getInitialRecoveryState(hash = '', search = ''): RecoveryState {
  const searchParams = new URLSearchParams(
    search || (hash.startsWith('#') ? hash.substring(1) : hash),
  );
  if (searchParams.get('error') || searchParams.get('error_code')) {
    return 'invalid_link';
  }

  // If no recovery session was tracked and the URL contains no recovery tokens/parameters,
  // this is an unauthenticated direct visit — fail safely to invalid_link immediately.
  const hasRecoveryHint =
    hash.includes('type=recovery') ||
    search.includes('type=recovery') ||
    search.includes('code=');

  if (!hasRecoveryHint && !isRecoverySessionActive()) {
    return 'invalid_link';
  }

  return 'checking';
}

/**
 * ResetPasswordPage (`AUTH-RESET-PASS` / `SCR-OWN-11`)
 *
 * Handles authenticated password updates arriving via Supabase Auth recovery magic links.
 * Verifies recovery session integrity, enforces minimum password rules, provides password
 * visibility toggling, and updates credentials securely via supabase.auth.updateUser().
 */
export function ResetPasswordPage(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  const urlHash = location.hash || (typeof window !== 'undefined' ? window.location.hash : '');
  const urlSearch = location.search || (typeof window !== 'undefined' ? window.location.search : '');

  const [recoveryState, setRecoveryState] = React.useState<RecoveryState>(() =>
    getInitialRecoveryState(urlHash, urlSearch),
  );
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);

  const [passwordError, setPasswordError] = React.useState<string | null>(null);
  const [confirmError, setConfirmError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);

  React.useEffect(() => {
    document.title = 'Reset Password | QR_review';
  }, []);

  // Recovery session check & auth-state listener
  React.useEffect(() => {
    let isMounted = true;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    const supabase = getSupabaseClient();

    if (getInitialRecoveryState(urlHash, urlSearch) === 'invalid_link') {
      return () => {
        isMounted = false;
      };
    }

    // Always attach auth listener to capture genuine PASSWORD_RECOVERY events
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;
      if (event === 'PASSWORD_RECOVERY' && session) {
        if (fallbackTimer) {
          clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
        markRecoverySessionActive();
        setRecoveryState('ready');
      }
    });

    // Check if a recovery event was already verified and active
    if (isRecoverySessionActive()) {
      supabase.auth.getSession().then(({ data: { session }, error }) => {
        if (!isMounted) return;
        if (session && !error) {
          setRecoveryState('ready');
        } else {
          clearRecoverySession();
          setRecoveryState('invalid_link');
        }
      });
    } else {
      // Provide a deterministic safety ceiling (5000 ms) for slow-device hash/token processing.
      fallbackTimer = setTimeout(() => {
        if (!isMounted) return;
        if (!isRecoverySessionActive()) {
          setRecoveryState('invalid_link');
        }
      }, 5000);
    }

    return () => {
      isMounted = false;
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
      }
      subscription.unsubscribe();
    };
  }, [urlHash, urlSearch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    setFormError(null);

    const passwordValidation = validatePassword(password);
    setPasswordError(passwordValidation.error ?? null);
    setConfirmError(password !== confirmPassword ? 'Passwords do not match.' : null);

    if (!passwordValidation.isValid || password !== confirmPassword) {
      return;
    }

    setIsLoading(true);

    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) {
        const errorMsg = getAuthErrorMessage(error);
        setFormError(errorMsg);
        toast({
          title: 'Update Failed',
          description: errorMsg,
          variant: 'destructive',
        });
        return;
      }

      clearRecoverySession();
      setRecoveryState('success');
      toast({
        title: 'Password Updated',
        description: 'Your password has been changed successfully.',
        variant: 'success',
      });
    } catch (err) {
      const errorMsg = getAuthErrorMessage(err);
      setFormError(errorMsg);
      toast({
        title: 'Update Failed',
        description: errorMsg,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  // State 1: Checking recovery context
  if (recoveryState === 'checking') {
    return (
      <div className="py-8 text-center space-y-3" role="status" aria-live="polite">
        <span
          className="inline-block h-6 w-6 rounded-full border-2 border-brand-accent border-t-transparent animate-spin"
          aria-hidden="true"
        />
        <p className="text-sm font-medium text-muted-foreground">
          Verifying password recovery session...
        </p>
      </div>
    );
  }

  // State 2: Invalid or expired recovery link
  if (recoveryState === 'invalid_link') {
    return (
      <div className="space-y-4 text-center">
        <div className="h-10 w-10 mx-auto rounded-full bg-state-danger/10 text-state-danger flex items-center justify-center">
          <svg
            className="h-6 w-6"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <h2 className="text-base sm:text-lg font-bold text-foreground">
          Invalid or Expired Reset Link
        </h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          This password reset link is invalid or has expired. Password reset links are strictly
          single-use and expire within 1 hour for your security.
        </p>
        <div className="pt-2 flex flex-col sm:flex-row gap-2 justify-center">
          <Link
            to="/forgot-password"
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:scale-[0.98] h-8 px-3 rounded-md text-xs w-full sm:w-auto"
          >
            Request New Reset Link
          </Link>
          <Link
            to="/login"
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background border border-border bg-surface-base text-foreground shadow-sm hover:bg-muted active:scale-[0.98] h-8 px-3 rounded-md text-xs w-full sm:w-auto"
          >
            Back to Sign In
          </Link>
        </div>
      </div>
    );
  }

  // State 3: Password successfully updated
  if (recoveryState === 'success') {
    return (
      <div className="space-y-4 text-center" role="status" aria-live="polite">
        <div className="h-10 w-10 mx-auto rounded-full bg-state-success/10 text-state-success flex items-center justify-center">
          <svg
            className="h-6 w-6"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <h2 className="text-base sm:text-lg font-bold text-foreground">Password Updated</h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Your new password has been established securely. You may now continue to your merchant
          dashboard.
        </p>
        <div className="pt-2">
          <Button
            size="default"
            className="w-full text-xs sm:text-sm"
            onClick={() => navigate('/dashboard', { replace: true })}
          >
            Continue to Dashboard →
          </Button>
        </div>
      </div>
    );
  }

  // State 4: Ready to reset password
  return (
    <div className="space-y-6 text-left">
      <div className="text-center space-y-1">
        <h2 className="text-base sm:text-lg font-bold text-foreground">Set New Password</h2>
        <p className="text-xs text-muted-foreground">
          Enter and confirm your new merchant account password.
        </p>
      </div>

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

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* New Password */}
        <div className="space-y-1.5">
          <label
            htmlFor="new-password"
            className="text-xs sm:text-sm font-medium text-foreground block"
          >
            New Password
          </label>
          <div className="relative">
            <Input
              id="new-password"
              name="new-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (passwordError) setPasswordError(null);
                if (formError) setFormError(null);
              }}
              disabled={isLoading}
              isInvalid={Boolean(passwordError)}
              aria-describedby={passwordError ? 'new-password-error' : 'password-rule'}
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
          {passwordError ? (
            <p id="new-password-error" className="text-xs text-state-danger font-medium mt-1">
              {passwordError}
            </p>
          ) : (
            <p id="password-rule" className="text-[11px] text-muted-foreground mt-1">
              Must be at least 8 characters long.
            </p>
          )}
        </div>

        {/* Confirm Password */}
        <div className="space-y-1.5">
          <label
            htmlFor="confirm-password"
            className="text-xs sm:text-sm font-medium text-foreground block"
          >
            Confirm New Password
          </label>
          <Input
            id="confirm-password"
            name="confirm-password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="Re-enter your new password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              if (confirmError) setConfirmError(null);
              if (formError) setFormError(null);
            }}
            disabled={isLoading}
            isInvalid={Boolean(confirmError)}
            aria-describedby={confirmError ? 'confirm-password-error' : undefined}
            required
          />
          {confirmError && (
            <p id="confirm-password-error" className="text-xs text-state-danger font-medium mt-1">
              {confirmError}
            </p>
          )}
        </div>

        <Button
          type="submit"
          className="w-full mt-2"
          size="default"
          isLoading={isLoading}
          disabled={isLoading}
        >
          {isLoading ? 'Updating Password...' : 'Update Password'}
        </Button>

        <div className="text-center pt-2">
          <Link
            to="/login"
            className="text-xs text-brand-accent hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-xs"
          >
            Cancel and return to Sign In
          </Link>
        </div>
      </form>
    </div>
  );
}
