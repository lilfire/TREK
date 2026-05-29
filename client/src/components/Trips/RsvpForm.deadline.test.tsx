// RSVP-DEADLINE-FE-001 to RSVP-DEADLINE-FE-010
// Tests for RSVP deadline feature in RsvpForm (LSO-1443)
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '../../../tests/helpers/render';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../tests/helpers/msw/server';
import { resetAllStores, seedStore } from '../../../tests/helpers/store';
import { buildUser } from '../../../tests/helpers/factories';
import { useAuthStore } from '../../store/authStore';
import RsvpForm from './RsvpForm';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock('../shared/Toast', async () => {
  const actual = await vi.importActual('../shared/Toast');
  return {
    ...actual,
    useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
  };
});

vi.mock('@paypal/react-paypal-js', () => ({
  PayPalScriptProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PayPalButtons: () => <div data-testid="paypal-buttons" />,
}));

const PAST_DATE = '2000-01-01';
const FUTURE_DATE = '2099-12-31';

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

beforeEach(() => {
  resetAllStores();
  vi.clearAllMocks();
});

describe('RsvpForm — RSVP deadline: registration closed', () => {
  it('RSVP-DEADLINE-FE-001: shows "Registration is closed." when deadline is in the past', () => {
    render(<RsvpForm tripId="42" rsvpDeadline={PAST_DATE} />);

    expect(screen.getByTestId('rsvp-registration-closed')).toBeInTheDocument();
    expect(screen.getByTestId('rsvp-registration-closed')).toHaveTextContent(/registration is closed/i);
  });

  it('RSVP-DEADLINE-FE-002: hides the RSVP form when deadline is in the past', () => {
    render(<RsvpForm tripId="42" rsvpDeadline={PAST_DATE} />);

    expect(screen.queryByTestId('rsvp-form')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirm my spot/i })).not.toBeInTheDocument();
  });

  it('RSVP-DEADLINE-FE-003: shows closed for authenticated non-member when deadline is past', () => {
    seedStore(useAuthStore, { user: buildUser(), isAuthenticated: true });
    render(<RsvpForm tripId="42" rsvpDeadline={PAST_DATE} isMember={false} />);

    expect(screen.getByTestId('rsvp-registration-closed')).toBeInTheDocument();
    expect(screen.queryByTestId('rsvp-join-btn')).not.toBeInTheDocument();
  });

  it('RSVP-DEADLINE-FE-004: still shows "on the list" for members even when deadline is past', () => {
    seedStore(useAuthStore, { user: buildUser(), isAuthenticated: true });
    render(<RsvpForm tripId="42" rsvpDeadline={PAST_DATE} isMember={true} />);

    expect(screen.getByTestId('rsvp-on-the-list')).toBeInTheDocument();
    expect(screen.queryByTestId('rsvp-registration-closed')).not.toBeInTheDocument();
  });
});

describe('RsvpForm — RSVP deadline: registration closes on {date}', () => {
  it('RSVP-DEADLINE-FE-005: shows "Registration closes on {date}." notice when deadline is in the future', () => {
    render(<RsvpForm tripId="42" rsvpDeadline={FUTURE_DATE} />);

    expect(screen.getByTestId('rsvp-deadline-notice')).toBeInTheDocument();
    expect(screen.getByTestId('rsvp-deadline-notice')).toHaveTextContent(/registration closes on/i);
    expect(screen.getByTestId('rsvp-deadline-notice')).toHaveTextContent('2099');
  });

  it('RSVP-DEADLINE-FE-006: shows form normally alongside the deadline notice', () => {
    render(<RsvpForm tripId="42" rsvpDeadline={FUTURE_DATE} />);

    expect(screen.getByTestId('rsvp-form')).toBeInTheDocument();
    expect(screen.getByTestId('rsvp-deadline-notice')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm my spot/i })).toBeInTheDocument();
  });

  it('RSVP-DEADLINE-FE-007: shows notice when deadline is today', () => {
    render(<RsvpForm tripId="42" rsvpDeadline={todayStr()} />);

    expect(screen.getByTestId('rsvp-deadline-notice')).toBeInTheDocument();
    expect(screen.getByTestId('rsvp-form')).toBeInTheDocument();
  });
});

describe('RsvpForm — RSVP deadline: no deadline set', () => {
  it('RSVP-DEADLINE-FE-008: renders form normally when rsvpDeadline is null', () => {
    render(<RsvpForm tripId="42" rsvpDeadline={null} />);

    expect(screen.queryByTestId('rsvp-registration-closed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rsvp-deadline-notice')).not.toBeInTheDocument();
    expect(screen.getByTestId('rsvp-form')).toBeInTheDocument();
  });

  it('RSVP-DEADLINE-FE-009: renders form normally when rsvpDeadline is undefined', () => {
    render(<RsvpForm tripId="42" />);

    expect(screen.queryByTestId('rsvp-registration-closed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rsvp-deadline-notice')).not.toBeInTheDocument();
    expect(screen.getByTestId('rsvp-form')).toBeInTheDocument();
  });
});

describe('RsvpForm — RSVP deadline: 400 registration closed error', () => {
  it('RSVP-DEADLINE-FE-010: shows registrationClosed error message on 400 with error code', async () => {
    server.use(
      http.post('/api/public/trips/:id/rsvp', () =>
        HttpResponse.json({ error: 'rsvp.error.registrationClosed' }, { status: 400 }),
      ),
    );

    const user = userEvent.setup();
    render(<RsvpForm tripId="42" rsvpDeadline={FUTURE_DATE} />);

    await user.type(screen.getByLabelText(/your name/i), 'Alice');
    await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
    await user.click(screen.getByRole('button', { name: /confirm my spot/i }));

    const errorEl = await screen.findByTestId('rsvp-error');
    expect(errorEl).toHaveTextContent(/registration for this trip is closed/i);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
