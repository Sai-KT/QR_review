import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import { getSupabaseClient } from '../../lib/supabase.ts';
import { getAuthErrorMessage, validateEmail } from '../../lib/auth/authUtils.ts';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { useToast } from '../../components/ui/toast.tsx';

/**
 * ForgotPasswordPage (`SCR-OWN-02`)
 *
 * Password reset request flow for merchant owners.
 * Allows entering a registered email to receive a secure recovery magic link.
 * Implements strict anti-enumeration: generic confirmation is presented regardless
 * of whether the account exists, preventing email reconnaissance attacks.
 */
export function ForgotPasswordPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [email, setEmail] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [emailError, setEmailError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = React.useState<string | null>(null);

  React.useEffect(() => {
    document.title = 'Forgot Password | QR_review';
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    setFormError(null);

    const emailValidation = validateEmail(email);
    setEmailError(emailValidation.error ?? null);

    if (!emailValidation.isValid) {
      return;
    }

    setIsLoading(true);

    try {
      const supabase = getSupabaseClient();
      const redirectTo = `${window.location.origin}/reset-password`;

      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      });

      if (error) {
        const errorMsg = getAuthErrorMessage(error);
        setFormError(errorMsg);
        toast({
          title: 'Reset Request Failed',
          description: errorMsg,
          variant: 'destructive',
        });
        return;
      }

      // Success: display generic anti-enumeration confirmation message
      setSubmittedEmail(email.trim());
      toast({
        title: 'Recovery Link Sent',
        description: 'If an account exists with this email, instructions have been sent.',
        variant: 'success',
      });
    } catch (err) {
      const errorMsg = getAuthErrorMessage(err);
      setFormError(errorMsg);
      toast({
        title: 'Reset Request Failed',
        description: errorMsg,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-1">
        <h2 className="text-base sm:text-lg font-bold text-foreground">Forgot Password</h2>
        <p className="text-xs text-muted-foreground">
          Enter your registered merchant email address to receive password reset instructions.
        </p>
      </div>

      {formError && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-md bg-state-danger/10 border border-state-danger/30 p-3 text-xs sm:text-sm text-state-danger flex items-start gap-2 text-left"
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

      {submittedEmail ? (
        <div
          className="rounded-lg bg-state-success/10 border border-state-success/30 p-4 text-center space-y-3"
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
          <h3 className="text-sm font-semibold text-foreground">Recovery Email Dispatched</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            If an account is associated with{' '}
            <strong className="text-foreground font-semibold">{submittedEmail}</strong>,
            you will receive an email containing a link to reset your password.
          </p>
          <p className="text-[11px] text-muted-foreground">
            Please check your spam or junk folder if you don't see it within a few minutes.
          </p>
          <div className="pt-2 flex flex-col sm:flex-row gap-2 justify-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => {
                setSubmittedEmail(null);
                setEmail('');
              }}
            >
              Try another email
            </Button>
            <Button
              type="button"
              size="sm"
              className="text-xs w-full sm:w-auto"
              onClick={() => navigate('/login')}
            >
              Back to Sign In
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-4 text-left">
          <div className="space-y-1.5">
            <label
              htmlFor="reset-email"
              className="text-xs sm:text-sm font-medium text-foreground block"
            >
              Email Address
            </label>
            <Input
              id="reset-email"
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
              aria-describedby={emailError ? 'reset-email-error' : undefined}
              required
            />
            {emailError && (
              <p id="reset-email-error" className="text-xs text-state-danger font-medium mt-1">
                {emailError}
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
            {isLoading ? 'Sending Link...' : 'Send Recovery Link'}
          </Button>

          <div className="text-center pt-2">
            <Link
              to="/login"
              className="text-xs text-brand-accent hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-xs inline-flex items-center gap-1"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span>Back to Sign In</span>
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
