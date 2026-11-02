import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { LoginPage } from './LoginPage.tsx';
import { ForgotPasswordPage } from './ForgotPasswordPage.tsx';
import { ResetPasswordPage } from './ResetPasswordPage.tsx';
import { ToastProvider } from '../../components/ui/toast.tsx';
import {
  clearRecoverySession,
  markRecoverySessionActive,
} from '../../lib/auth/authUtils.ts';

// Mock Supabase client
const mockSignInWithPassword = vi.fn();
const mockSignInWithOtp = vi.fn();
const mockResetPasswordForEmail = vi.fn();
const mockUpdateUser = vi.fn();
const mockGetSession = vi.fn();
const mockOnAuthStateChange = vi.fn();

vi.mock('../../lib/supabase.ts', () => ({
  getSupabaseClient: () => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
      signInWithOtp: mockSignInWithOtp,
      resetPasswordForEmail: mockResetPasswordForEmail,
      updateUser: mockUpdateUser,
      getSession: mockGetSession,
      onAuthStateChange: mockOnAuthStateChange,
    },
  }),
}));

function renderWithProviders(ui: React.ReactElement, initialEntries = ['/login']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={ui} />
          <Route path="/forgot-password" element={ui} />
          <Route path="/reset-password" element={ui} />
          <Route path="/dashboard" element={<div data-testid="dashboard-screen">Dashboard</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('M5-T01: Merchant Authentication Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRecoverySession();
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
  });

  // ── TC-OWN-01: Successful Password Login ──────────────────────────────────
  describe('TC-OWN-01: Successful Password Login (SCR-OWN-01)', () => {
    it('submits valid credentials, calls Supabase Auth, and navigates to dashboard', async () => {
      const user = userEvent.setup();
      mockSignInWithPassword.mockResolvedValueOnce({
        data: {
          user: { id: '00000000-0000-4000-8000-000000000002', email: 'merchant.luxe@local.test' },
          session: { access_token: 'valid-jwt-token' },
        },
        error: null,
      });

      renderWithProviders(<LoginPage />);

      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/^password$/i, { selector: 'input' });
      const submitButton = screen.getByRole('button', { name: /^sign in$/i });

      await user.type(emailInput, 'merchant.luxe@local.test');
      await user.type(passwordInput, 'LocalDevPass123!');
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockSignInWithPassword).toHaveBeenCalledWith({
          email: 'merchant.luxe@local.test',
          password: 'LocalDevPass123!',
        });
      });

      // Assert navigation to dashboard
      await waitFor(() => {
        expect(screen.getByTestId('dashboard-screen')).toBeInTheDocument();
      });
    });

    it('navigates to safe redirect_to parameter when provided', async () => {
      const user = userEvent.setup();
      mockSignInWithPassword.mockResolvedValueOnce({
        data: {
          user: { id: '00000000-0000-4000-8000-000000000002', email: 'merchant.luxe@local.test' },
          session: { access_token: 'valid-jwt-token' },
        },
        error: null,
      });

      render(
        <MemoryRouter initialEntries={['/login?redirect_to=/dashboard/profile']}>
          <ToastProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                path="/dashboard/profile"
                element={<div data-testid="profile-screen">Merchant Profile</div>}
              />
            </Routes>
          </ToastProvider>
        </MemoryRouter>,
      );

      await user.type(screen.getByLabelText(/email address/i), 'merchant.luxe@local.test');
      await user.type(screen.getByLabelText(/^password$/i, { selector: 'input' }), 'LocalDevPass123!');
      await user.click(screen.getByRole('button', { name: /^sign in$/i }));

      await waitFor(() => {
        expect(screen.getByTestId('profile-screen')).toBeInTheDocument();
      });
    });

    it('toggles password visibility between masked and plain text', async () => {
      const user = userEvent.setup();
      renderWithProviders(<LoginPage />);

      const passwordInput = screen.getByLabelText(/^password$/i, { selector: 'input' });
      const toggleButton = screen.getByRole('button', { name: /show password/i });

      expect(passwordInput).toHaveAttribute('type', 'password');

      await user.click(toggleButton);
      expect(passwordInput).toHaveAttribute('type', 'text');
      expect(screen.getByRole('button', { name: /hide password/i })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /hide password/i }));
      expect(passwordInput).toHaveAttribute('type', 'password');
    });
  });

  // ── TC-OWN-02: Failed Login & Inline Error Feedback ───────────────────────
  describe('TC-OWN-02: Failed Login & Validation (SCR-OWN-01)', () => {
    it('displays safe inline error feedback on invalid password and stays on login', async () => {
      const user = userEvent.setup();
      mockSignInWithPassword.mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials', code: 'invalid_credentials', status: 400 },
      });

      renderWithProviders(<LoginPage />);

      await user.type(screen.getByLabelText(/email address/i), 'merchant.luxe@local.test');
      await user.type(screen.getByLabelText(/^password$/i, { selector: 'input' }), 'WrongPassword123!');
      await user.click(screen.getByRole('button', { name: /^sign in$/i }));

      await waitFor(() => {
        expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
        expect(screen.getAllByText(/invalid email or password/i).length).toBeGreaterThan(0);
      });

      // Does not navigate away
      expect(screen.queryByTestId('dashboard-screen')).not.toBeInTheDocument();
    });

    it('rejects empty inputs locally without invoking Supabase', async () => {
      const user = userEvent.setup();
      renderWithProviders(<LoginPage />);

      const submitButton = screen.getByRole('button', { name: /^sign in$/i });
      await user.click(submitButton);

      expect(mockSignInWithPassword).not.toHaveBeenCalled();
      expect(screen.getByText(/email address is required/i)).toBeInTheDocument();
      expect(screen.getByText(/password is required/i)).toBeInTheDocument();
    });

    it('rejects malformed email format', async () => {
      const user = userEvent.setup();
      renderWithProviders(<LoginPage />);

      await user.type(screen.getByLabelText(/email address/i), 'not-an-email');
      await user.type(screen.getByLabelText(/^password$/i, { selector: 'input' }), 'Password123!');
      await user.click(screen.getByRole('button', { name: /^sign in$/i }));

      expect(mockSignInWithPassword).not.toHaveBeenCalled();
      expect(screen.getByText(/valid email address/i)).toBeInTheDocument();
    });

    it('allows repeat submission after error is resolved', async () => {
      const user = userEvent.setup();
      mockSignInWithPassword
        .mockResolvedValueOnce({
          data: { user: null, session: null },
          error: { message: 'Invalid login credentials' },
        })
        .mockResolvedValueOnce({
          data: {
            user: { id: '00000000-0000-4000-8000-000000000002', email: 'merchant.luxe@local.test' },
            session: { access_token: 'valid-jwt-token' },
          },
          error: null,
        });

      renderWithProviders(<LoginPage />);

      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/^password$/i, { selector: 'input' });
      const submitBtn = screen.getByRole('button', { name: /^sign in$/i });

      // First attempt fails
      await user.type(emailInput, 'merchant.luxe@local.test');
      await user.type(passwordInput, 'WrongPass123!');
      await user.click(submitBtn);

      await waitFor(() => {
        expect(screen.getAllByText(/invalid email or password/i).length).toBeGreaterThan(0);
      });

      // Clear password and retry with correct one
      await user.clear(passwordInput);
      await user.type(passwordInput, 'CorrectPass123!');
      await user.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByTestId('dashboard-screen')).toBeInTheDocument();
      });
    });
  });

  // ── Magic Link Sign-In Suite ──────────────────────────────────────────────
  describe('Magic Link Sign-In Flow (SCR-OWN-01)', () => {
    it('switches to magic link mode and dispatches OTP with shouldCreateUser: false', async () => {
      const user = userEvent.setup();
      mockSignInWithOtp.mockResolvedValueOnce({ data: {}, error: null });

      renderWithProviders(<LoginPage />);

      // Switch to Magic Link tab
      const magicTab = screen.getByRole('tab', { name: /magic link/i });
      await user.click(magicTab);

      const emailInput = screen.getByLabelText(/email address/i);
      const sendButton = screen.getByRole('button', { name: /send magic link/i });

      await user.type(emailInput, 'merchant.luxe@local.test');
      await user.click(sendButton);

      await waitFor(() => {
        expect(mockSignInWithOtp).toHaveBeenCalledWith({
          email: 'merchant.luxe@local.test',
          options: {
            emailRedirectTo: expect.stringContaining('/dashboard'),
            shouldCreateUser: false,
          },
        });
      });

      // Success notification rendered
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /check your email/i, level: 3 })).toBeInTheDocument();
        expect(screen.getAllByText(/merchant.luxe@local.test/).length).toBeGreaterThan(0);
      });
    });

    it('handles magic link dispatch errors gracefully', async () => {
      const user = userEvent.setup();
      mockSignInWithOtp.mockResolvedValueOnce({
        data: {},
        error: { message: 'over_email_send_rate_limit', status: 429 },
      });

      renderWithProviders(<LoginPage />);

      await user.click(screen.getByRole('tab', { name: /magic link/i }));
      await user.type(screen.getByLabelText(/email address/i), 'merchant.luxe@local.test');
      await user.click(screen.getByRole('button', { name: /send magic link/i }));

      await waitFor(() => {
        expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
        expect(screen.getAllByText(/too many.*attempts/i).length).toBeGreaterThan(0);
      });
    });

    it('masks unregistered email error (otp_disabled) and renders standard confirmation card without error', async () => {
      const user = userEvent.setup();
      mockSignInWithOtp.mockResolvedValueOnce({
        data: {},
        error: { code: 'otp_disabled', message: 'Signups not allowed for otp', status: 422 },
      });

      renderWithProviders(<LoginPage />);

      await user.click(screen.getByRole('tab', { name: /magic link/i }));
      await user.type(screen.getByLabelText(/email address/i), 'unregistered@local.test');
      await user.click(screen.getByRole('button', { name: /send magic link/i }));

      await waitFor(() => {
        expect(mockSignInWithOtp).toHaveBeenCalledWith({
          email: 'unregistered@local.test',
          options: {
            emailRedirectTo: expect.stringContaining('/dashboard'),
            shouldCreateUser: false,
          },
        });
      });

      // Renders standard confirmation card, NOT an error alert
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /check your email/i, level: 3 })).toBeInTheDocument();
        expect(screen.getAllByText(/unregistered@local.test/).length).toBeGreaterThan(0);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      });
    });
  });

  // ── TC-OWN-03: Password Recovery Request ──────────────────────────────────
  describe('TC-OWN-03: Password Recovery Request (SCR-OWN-02 / ForgotPasswordPage)', () => {
    it('submits recovery request to Supabase and displays anti-enumeration confirmation', async () => {
      const user = userEvent.setup();
      mockResetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: null });

      renderWithProviders(<ForgotPasswordPage />, ['/forgot-password']);

      const emailInput = screen.getByLabelText(/email address/i);
      const submitButton = screen.getByRole('button', { name: /send recovery link/i });

      await user.type(emailInput, 'merchant.luxe@local.test');
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockResetPasswordForEmail).toHaveBeenCalledWith('merchant.luxe@local.test', {
          redirectTo: expect.stringContaining('/reset-password'),
        });
      });

      // Confirmation banner rendered with generic anti-enumeration notice
      await waitFor(() => {
        expect(screen.getByText(/recovery email dispatched/i)).toBeInTheDocument();
        expect(screen.getByText(/merchant.luxe@local.test/)).toBeInTheDocument();
      });
    });

    it('rejects invalid email format locally', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ForgotPasswordPage />, ['/forgot-password']);

      const submitButton = screen.getByRole('button', { name: /send recovery link/i });
      await user.click(submitButton);

      expect(mockResetPasswordForEmail).not.toHaveBeenCalled();
      expect(screen.getByText(/email address is required/i)).toBeInTheDocument();
    });
  });

  // ── Password Reset / Update Flow ──────────────────────────────────────────
  describe('Password Reset / Set New Password (ResetPasswordPage)', () => {
    it('shows invalid link state when visited without an active recovery session or tokens', async () => {
      mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: null });

      renderWithProviders(<ResetPasswordPage />, ['/reset-password']);

      // Immediately renders invalid link notice without grace-period race conditions
      await waitFor(() => {
        expect(screen.getByText(/invalid or expired reset link/i)).toBeInTheDocument();
      });

      expect(screen.getByRole('link', { name: /request new reset link/i })).toHaveAttribute(
        'href',
        '/forgot-password',
      );
    });

    it('shows invalid link state when visited with an ordinary active session without recovery context', async () => {
      // Ordinary active user session (e.g. standard login) without PASSWORD_RECOVERY event
      mockGetSession.mockResolvedValue({
        data: {
          session: {
            user: { id: '00000000-0000-4000-8000-000000000002', email: 'merchant.luxe@local.test' },
          },
        },
        error: null,
      });

      renderWithProviders(<ResetPasswordPage />, ['/reset-password']);

      // Must NOT unlock the recovery form
      await waitFor(() => {
        expect(screen.getByText(/invalid or expired reset link/i)).toBeInTheDocument();
      });

      expect(screen.queryByLabelText(/^new password$/i)).not.toBeInTheDocument();
    });

    it('renders password update form when recovery session is active and updates password', async () => {
      const user = userEvent.setup();
      markRecoverySessionActive();
      mockGetSession.mockResolvedValue({
        data: {
          session: {
            user: { id: '00000000-0000-4000-8000-000000000002', email: 'merchant.luxe@local.test' },
          },
        },
        error: null,
      });
      mockUpdateUser.mockResolvedValueOnce({ data: { user: {} }, error: null });

      renderWithProviders(<ResetPasswordPage />, ['/reset-password']);

      await waitFor(() => {
        expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument();
      });

      const newPassInput = screen.getByLabelText(/^new password$/i);
      const confirmInput = screen.getByLabelText(/confirm new password/i);
      const updateButton = screen.getByRole('button', { name: /update password/i });

      await user.type(newPassInput, 'NewSecurePass123!');
      await user.type(confirmInput, 'NewSecurePass123!');
      await user.click(updateButton);

      await waitFor(() => {
        expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'NewSecurePass123!' });
      });

      // Success screen displayed
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /password updated/i, level: 2 })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /continue to dashboard/i })).toBeInTheDocument();
      });
    });

    it('rejects mismatched password confirmation', async () => {
      const user = userEvent.setup();
      markRecoverySessionActive();
      mockGetSession.mockResolvedValue({
        data: { session: { user: { id: 'test-user-id' } } },
        error: null,
      });

      renderWithProviders(<ResetPasswordPage />, ['/reset-password']);

      await waitFor(() => {
        expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText(/^new password$/i), 'NewSecurePass123!');
      await user.type(screen.getByLabelText(/confirm new password/i), 'MismatchPass123!');
      await user.click(screen.getByRole('button', { name: /update password/i }));

      expect(mockUpdateUser).not.toHaveBeenCalled();
      expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
    });

    it('rejects passwords shorter than 8 characters', async () => {
      const user = userEvent.setup();
      markRecoverySessionActive();
      mockGetSession.mockResolvedValue({
        data: { session: { user: { id: 'test-user-id' } } },
        error: null,
      });

      renderWithProviders(<ResetPasswordPage />, ['/reset-password']);

      await waitFor(() => {
        expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText(/^new password$/i), 'short');
      await user.type(screen.getByLabelText(/confirm new password/i), 'short');
      await user.click(screen.getByRole('button', { name: /update password/i }));

      expect(mockUpdateUser).not.toHaveBeenCalled();
      expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
    });

    it('cleans up subscription and timer safely upon component unmount', () => {
      const unsubscribeMock = vi.fn();
      mockOnAuthStateChange.mockReturnValueOnce({
        data: { subscription: { unsubscribe: unsubscribeMock } },
      });

      const { unmount } = renderWithProviders(<ResetPasswordPage />, [
        '/reset-password#access_token=slow-token&type=recovery',
      ]);

      unmount();
      expect(unsubscribeMock).toHaveBeenCalled();
    });
  });
});
