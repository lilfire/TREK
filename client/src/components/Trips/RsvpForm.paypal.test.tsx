// PAYPAL-RSVP-001 to PAYPAL-RSVP-003
// Tests for PayPal auto-join flow in RsvpForm (LSO-1587)
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '../../../tests/helpers/render';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../tests/helpers/msw/server';
import { resetAllStores } from '../../../tests/helpers/store';
import RsvpForm from './RsvpForm';

const mockNavigate = vi.fn();
const mockToastSuccess = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../shared/Toast', async () => {
  const actual = await vi.importActual('../shared/Toast');
  return {
    ...actual,
    useToast: () => ({ success: mockToastSuccess, error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
  };
});

// PayPal mock: exposes onApprove via the approve button
vi.mock('@paypal/react-paypal-js', () => {
  const MockPayPalButtons = ({
    onApprove,
    onError,
    onCancel,
    disabled,
  }: {
    disabled?: boolean;
    onApprove?: (data: unknown, actions: { orderID: string }) => Promise<void>;
    onError?: () => void;
    onCancel?: () => void;
    createOrder?: () => Promise<string>;
  }) => (
    <div data-testid="paypal-buttons">
      <button
        data-testid="paypal-btn-approve"
        type="button"
        disabled={disabled}
        onClick={() => onApprove?.({}, { orderID: 'ORDER-123' })}
      >
        PayPal Approve
      </button>
      <button
        data-testid="paypal-btn-cancel"
        type="button"
        onClick={() => onCancel?.()}
        disabled={disabled}
      >
        PayPal Cancel
      </button>
      <button
        data-testid="paypal-btn-error"
        type="button"
        onClick={() => onError?.()}
        disabled={disabled}
      >
        PayPal Error
      </button>
    </div>
  );

  return {
    PayPalScriptProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    PayPalButtons: MockPayPalButtons,
  };
});

const PAYPAL_PROPS = {
  tripId: '42',
  registrationFee: 500,
  feeMode: 'rsvp' as const,
  currency: 'NOK',
  paypalClientId: 'test-client-id',
};

beforeEach(() => {
  resetAllStores();
  vi.clearAllMocks();
});

describe('RsvpForm — PayPal auto-join after payment (LSO-1587)', () => {
  describe('PAYPAL-RSVP-001: Successful payment navigates to /dashboard with toast', () => {
    it('calls toast.success and navigate("/dashboard") after successful onApprove', async () => {
      const user = userEvent.setup();
      render(<RsvpForm {...PAYPAL_PROPS} />);

      await user.type(screen.getByLabelText(/your name/i), 'Alice');
      await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
      await user.click(screen.getByTestId('paypal-btn-approve'));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
      });

      expect(mockToastSuccess).toHaveBeenCalledWith(
        "🎉 You're in! Welcome to TREK — check your inbox for a confirmation email.",
      );
    });

    it('does not show a static payment-success banner after navigation', async () => {
      const user = userEvent.setup();
      render(<RsvpForm {...PAYPAL_PROPS} />);

      await user.type(screen.getByLabelText(/your name/i), 'Alice');
      await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
      await user.click(screen.getByTestId('paypal-btn-approve'));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
      });

      expect(screen.queryByTestId('rsvp-payment-success')).not.toBeInTheDocument();
    });
  });

  describe('PAYPAL-RSVP-002: Auth failure after payment shows fallback with login link', () => {
    it('shows auth-failed fallback when loadUser fails after payment', async () => {
      // Override auth/me to return 401 so loadUser fails to authenticate
      server.use(
        http.get('/api/auth/me', () =>
          HttpResponse.json({ error: 'unauthorized' }, { status: 401 }),
        ),
      );

      const user = userEvent.setup();
      render(<RsvpForm {...PAYPAL_PROPS} />);

      await user.type(screen.getByLabelText(/your name/i), 'Alice');
      await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
      await user.click(screen.getByTestId('paypal-btn-approve'));

      await waitFor(() => {
        expect(screen.getByTestId('rsvp-auth-failed')).toBeInTheDocument();
      });

      expect(screen.getByTestId('rsvp-auth-failed')).toHaveTextContent(
        /your payment was received/i,
      );
    });

    it('shows a login link in the auth-failed fallback', async () => {
      server.use(
        http.get('/api/auth/me', () =>
          HttpResponse.json({ error: 'unauthorized' }, { status: 401 }),
        ),
      );

      const user = userEvent.setup();
      render(<RsvpForm {...PAYPAL_PROPS} />);

      await user.type(screen.getByLabelText(/your name/i), 'Alice');
      await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
      await user.click(screen.getByTestId('paypal-btn-approve'));

      await waitFor(() => {
        expect(screen.getByTestId('rsvp-auth-failed')).toBeInTheDocument();
      });

      const loginLink = screen.getByRole('link', { name: /log in here/i });
      expect(loginLink).toBeInTheDocument();
      expect(loginLink).toHaveAttribute('href', '/login');
    });

    it('does NOT navigate when auth fails after payment', async () => {
      server.use(
        http.get('/api/auth/me', () =>
          HttpResponse.json({ error: 'unauthorized' }, { status: 401 }),
        ),
      );

      const user = userEvent.setup();
      render(<RsvpForm {...PAYPAL_PROPS} />);

      await user.type(screen.getByLabelText(/your name/i), 'Alice');
      await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
      await user.click(screen.getByTestId('paypal-btn-approve'));

      await waitFor(() => {
        expect(screen.getByTestId('rsvp-auth-failed')).toBeInTheDocument();
      });

      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe('PAYPAL-RSVP-003: RSVP/payment API failure shows existing error handling', () => {
    it('shows error when RSVP creation fails', async () => {
      server.use(
        http.post('/api/public/trips/:id/rsvp', () =>
          HttpResponse.json({ error: 'internal_error' }, { status: 500 }),
        ),
      );

      const user = userEvent.setup();
      render(<RsvpForm {...PAYPAL_PROPS} />);

      await user.type(screen.getByLabelText(/your name/i), 'Alice');
      await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
      await user.click(screen.getByTestId('paypal-btn-approve'));

      await waitFor(() => {
        expect(screen.getByTestId('rsvp-error')).toBeInTheDocument();
      });

      expect(screen.getByTestId('rsvp-error')).toHaveTextContent(/something went wrong/i);
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(screen.queryByTestId('rsvp-auth-failed')).not.toBeInTheDocument();
    });
  });
});
