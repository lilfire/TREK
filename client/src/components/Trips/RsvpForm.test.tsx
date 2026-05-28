// FE-COMP-RSVP-001 to FE-COMP-RSVP-017
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '../../../tests/helpers/render';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../tests/helpers/msw/server';
import { resetAllStores, seedStore } from '../../../tests/helpers/store';
import { buildUser } from '../../../tests/helpers/factories';
import { useAuthStore } from '../../store/authStore';
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

beforeEach(() => {
  resetAllStores();
  vi.clearAllMocks();
});

function rsvpSuccess(userId = 99) {
  return HttpResponse.json({ rsvpId: 1, userId, authToken: 'mock-rsvp-token' }, { status: 201 });
}

function renderForm(tripId = '42') {
  return render(<RsvpForm tripId={tripId} />);
}

describe('RsvpForm', () => {
  describe('FE-COMP-RSVP-001: Renders form with required fields', () => {
    it('shows name, email, message inputs and submit button', () => {
      renderForm();

      expect(screen.getByLabelText(/your name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/message/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /confirm my spot/i })).toBeInTheDocument();
    });

    it('has data-testid="rsvp-form"', () => {
      renderForm();
      expect(screen.getByTestId('rsvp-form')).toBeInTheDocument();
    });

    it('shows intro text with login link', () => {
      renderForm();
      const intro = screen.getByTestId('rsvp-intro');
      expect(intro).toBeInTheDocument();
      expect(intro).toHaveTextContent(/create a trek account/i);
      expect(screen.getByRole('link', { name: /already have an account/i })).toBeInTheDocument();
    });

    it('shows account creation notice between email and message', () => {
      renderForm();
      const notice = screen.getByTestId('rsvp-account-notice');
      expect(notice).toBeInTheDocument();
      expect(notice).toHaveTextContent(/trek account will be created/i);
    });
  });

  describe('FE-COMP-RSVP-002: UX copy matches design document', () => {
    it('name label is "Your name"', () => {
      renderForm();
      expect(screen.getByLabelText(/your name/i)).toBeInTheDocument();
    });

    it('email label is "Email address"', () => {
      renderForm();
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    });

    it('message label includes "(optional)"', () => {
      renderForm();
      expect(screen.getByLabelText(/message.*optional/i)).toBeInTheDocument();
    });

    it('submit button text is "Confirm my spot"', () => {
      renderForm();
      expect(screen.getByRole('button', { name: /confirm my spot/i })).toBeInTheDocument();
    });
  });

  describe('FE-COMP-RSVP-003: Required field validation — name', () => {
    it('shows an error when name is empty and form is submitted', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
      await user.click(screen.getByRole('button', { name: /confirm my spot/i }));

      await waitFor(() => {
        expect(screen.getByTestId('rsvp-error')).toHaveTextContent(/name is required/i);
      });
    });

    it('does not call the API when name is missing', async () => {
      const postSpy = vi.fn(() => rsvpSuccess());
      server.use(http.post('/api/public/trips/:id/rsvp', postSpy));

      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
      await user.click(screen.getByRole('button', { name: /confirm my spot/i }));

      expect(postSpy).not.toHaveBeenCalled();
    });
  });

  describe('FE-COMP-RSVP-004: Required field validation — email', () => {
    it('shows an error when email is empty and form is submitted', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/your name/i), 'Alice');
      await user.click(screen.getByRole('button', { name: /confirm my spot/i }));

      await waitFor(() => {
        expect(screen.getByTestId('rsvp-error')).toHaveTextContent(/email is required/i);
      });
    });
  });

  describe('FE-COMP-RSVP-005: Loading state during submission', () => {
    it('disables the submit button and shows "Confirming" while in flight', async () => {
      let resolveRsvp!: (v: unknown) => void;
      server.use(
        http.post('/api/public/trips/:id/rsvp', () =>
          new Promise(resolve => { resolveRsvp = resolve; }),
        ),
      );

      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/your name/i), 'Alice');
      await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');

      fireEvent.click(screen.getByRole('button', { name: /confirm my spot/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirming/i })).toBeDisabled();
      });

      // Resolve with an error to avoid leaking auth state into subsequent tests
      resolveRsvp(HttpResponse.json({ error: 'cancelled' }, { status: 500 }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm my spot/i })).not.toBeDisabled();
      });
    });
  });

  describe('FE-COMP-RSVP-006: Successful RSVP — redirect, auth, and toast', () => {
    it('navigates to /dashboard after a successful submission', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/your name/i), 'Alice');
      await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
      await user.click(screen.getByRole('button', { name: /confirm my spot/i }));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
      });
    });

    it('authenticates the user via loadUser after successful RSVP', async () => {
      const rsvpUser = buildUser({ email: 'alice@example.com' });
      server.use(
        http.post('/api/public/trips/:id/rsvp', () =>
          HttpResponse.json({ rsvpId: 1, userId: rsvpUser.id, authToken: 'tok' }, { status: 201 }),
        ),
        http.get('/api/auth/me', () => HttpResponse.json({ user: rsvpUser })),
      );

      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/your name/i), 'Alice');
      await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
      await user.click(screen.getByRole('button', { name: /confirm my spot/i }));

      await waitFor(() => {
        expect(useAuthStore.getState().isAuthenticated).toBe(true);
        expect(useAuthStore.getState().user?.email).toBe('alice@example.com');
      });
    });

    it('shows the correct success toast message', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/your name/i), 'Alice');
      await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
      await user.click(screen.getByRole('button', { name: /confirm my spot/i }));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
      });

      expect(mockToastSuccess).toHaveBeenCalledWith(
        "🎉 You're in! Welcome to TREK — check your inbox for a confirmation email.",
      );
    });
  });

  describe('FE-COMP-RSVP-007: Error handling — 409 duplicate RSVP', () => {
    it('shows the duplicate RSVP message', async () => {
      server.use(
        http.post('/api/public/trips/:id/rsvp', () =>
          HttpResponse.json({ error: 'duplicate_rsvp', message: 'Already RSVPed.' }, { status: 409 }),
        ),
      );

      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/your name/i), 'Alice');
      await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
      await user.click(screen.getByRole('button', { name: /confirm my spot/i }));

      await waitFor(() => {
        expect(screen.getByTestId('rsvp-error')).toHaveTextContent(/already on the list/i);
      });
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe('FE-COMP-RSVP-008: Error handling — 409 email linked to account', () => {
    it('shows the email-linked-to-account message with login link', async () => {
      server.use(
        http.post('/api/public/trips/:id/rsvp', () =>
          HttpResponse.json({ error: 'email_account_conflict' }, { status: 409 }),
        ),
      );

      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/your name/i), 'Alice');
      await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
      await user.click(screen.getByRole('button', { name: /confirm my spot/i }));

      await waitFor(() => {
        expect(screen.getByTestId('rsvp-error')).toHaveTextContent(/linked to a trek account/i);
      });
      expect(screen.getByRole('link', { name: /log in here/i })).toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe('FE-COMP-RSVP-009: Error handling — 404', () => {
    it('shows the trip-no-longer-available message', async () => {
      server.use(
        http.post('/api/public/trips/:id/rsvp', () =>
          HttpResponse.json({ error: 'not_found' }, { status: 404 }),
        ),
      );

      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/your name/i), 'Alice');
      await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
      await user.click(screen.getByRole('button', { name: /confirm my spot/i }));

      await waitFor(() => {
        expect(screen.getByTestId('rsvp-error')).toHaveTextContent(/no longer accepting rsvps/i);
      });
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe('FE-COMP-RSVP-010: Error handling — 429 rate limit', () => {
    it('shows the rate limit message', async () => {
      server.use(
        http.post('/api/public/trips/:id/rsvp', () =>
          HttpResponse.json({ error: 'rate_limited' }, { status: 429 }),
        ),
      );

      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/your name/i), 'Alice');
      await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
      await user.click(screen.getByRole('button', { name: /confirm my spot/i }));

      await waitFor(() => {
        expect(screen.getByTestId('rsvp-error')).toHaveTextContent(/too many attempts/i);
      });
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe('FE-COMP-RSVP-011: Error handling — 5xx server error', () => {
    it('shows the server error message for 500', async () => {
      server.use(
        http.post('/api/public/trips/:id/rsvp', () =>
          HttpResponse.json({ error: 'internal_error' }, { status: 500 }),
        ),
      );

      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/your name/i), 'Alice');
      await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
      await user.click(screen.getByRole('button', { name: /confirm my spot/i }));

      await waitFor(() => {
        expect(screen.getByTestId('rsvp-error')).toHaveTextContent(/something went wrong on our end/i);
      });
    });

    it('re-enables the submit button after a server error', async () => {
      server.use(
        http.post('/api/public/trips/:id/rsvp', () =>
          HttpResponse.json({ error: 'internal_error' }, { status: 500 }),
        ),
      );

      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/your name/i), 'Alice');
      await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
      await user.click(screen.getByRole('button', { name: /confirm my spot/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm my spot/i })).not.toBeDisabled();
      });
    });
  });

  describe('FE-COMP-RSVP-012: Message field is optional', () => {
    it('submits successfully without a message', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/your name/i), 'Alice');
      await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
      await user.click(screen.getByRole('button', { name: /confirm my spot/i }));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
      });
    });
  });

  describe('FE-COMP-RSVP-013: Authenticated non-member state (no isMember prop)', () => {
    it('hides the RSVP form and shows Join Trip button when authenticated but not a member', () => {
      seedStore(useAuthStore, { user: buildUser(), isAuthenticated: true });

      renderForm();

      expect(screen.queryByTestId('rsvp-form')).not.toBeInTheDocument();
      expect(screen.getByTestId('rsvp-join-form')).toBeInTheDocument();
      expect(screen.getByTestId('rsvp-join-btn')).toBeInTheDocument();
      expect(screen.getByTestId('rsvp-join-btn')).toHaveTextContent(/join trip/i);
    });
  });

  describe('FE-COMP-RSVP-016: Authenticated member state (isMember=true)', () => {
    it('shows "You\'re on the list." and hides the form when isMember=true', () => {
      seedStore(useAuthStore, { user: buildUser(), isAuthenticated: true });

      render(<RsvpForm tripId="42" isMember={true} />);

      expect(screen.queryByTestId('rsvp-form')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rsvp-join-form')).not.toBeInTheDocument();
      expect(screen.getByTestId('rsvp-on-the-list')).toBeInTheDocument();
      expect(screen.getByTestId('rsvp-on-the-list')).toHaveTextContent(/on the list/i);
    });

    it('includes a link to /dashboard in the member view', () => {
      seedStore(useAuthStore, { user: buildUser(), isAuthenticated: true });

      render(<RsvpForm tripId="42" isMember={true} />);

      const link = screen.getByRole('link', { name: /view the trip in your dashboard/i });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', '/dashboard');
    });
  });

  describe('FE-COMP-RSVP-017: Authenticated non-member Join Trip flow', () => {
    it('calls rsvpAuthenticated endpoint when Join Trip is clicked', async () => {
      const rsvpHandler = vi.fn(() => HttpResponse.json({ ok: true }, { status: 201 }));
      server.use(http.post('/api/public/trips/:id/rsvp', rsvpHandler));

      seedStore(useAuthStore, { user: buildUser(), isAuthenticated: true });

      const user = userEvent.setup();
      renderForm();

      await user.click(screen.getByTestId('rsvp-join-btn'));

      await waitFor(() => {
        expect(rsvpHandler).toHaveBeenCalledTimes(1);
      });
    });

    it('shows success state after joining', async () => {
      server.use(
        http.post('/api/public/trips/:id/rsvp', () =>
          HttpResponse.json({ ok: true }, { status: 201 }),
        ),
      );

      seedStore(useAuthStore, { user: buildUser(), isAuthenticated: true });

      const user = userEvent.setup();
      renderForm();

      await user.click(screen.getByTestId('rsvp-join-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('rsvp-join-success')).toBeInTheDocument();
      });
      expect(screen.getByTestId('rsvp-join-success')).toHaveTextContent(/on the list/i);
    });

    it('shows error message when join fails', async () => {
      server.use(
        http.post('/api/public/trips/:id/rsvp', () =>
          HttpResponse.json({ error: 'internal_error' }, { status: 500 }),
        ),
      );

      seedStore(useAuthStore, { user: buildUser(), isAuthenticated: true });

      const user = userEvent.setup();
      renderForm();

      await user.click(screen.getByTestId('rsvp-join-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('rsvp-error')).toBeInTheDocument();
      });
      expect(screen.getByTestId('rsvp-error')).toHaveTextContent(/something went wrong/i);
    });

    it('disables the Join Trip button while submitting', async () => {
      let resolveJoin!: (v: unknown) => void;
      server.use(
        http.post('/api/public/trips/:id/rsvp', () =>
          new Promise(resolve => { resolveJoin = resolve; }),
        ),
      );

      seedStore(useAuthStore, { user: buildUser(), isAuthenticated: true });

      const user = userEvent.setup();
      renderForm();

      fireEvent.click(screen.getByTestId('rsvp-join-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('rsvp-join-btn')).toBeDisabled();
      });

      resolveJoin(HttpResponse.json({ error: 'cancelled' }, { status: 500 }));
      await waitFor(() => {
        expect(screen.getByTestId('rsvp-join-btn')).not.toBeDisabled();
      });
    });
  });

  describe('FE-COMP-RSVP-014: Message field is submitted when provided', () => {
    it('includes the message in the API payload', async () => {
      const capturedBodies: unknown[] = [];
      server.use(
        http.post('/api/public/trips/:id/rsvp', async ({ request }) => {
          capturedBodies.push(await request.json());
          return rsvpSuccess();
        }),
      );

      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/your name/i), 'Alice');
      await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
      await user.type(screen.getByLabelText(/message/i), 'Looking forward to it!');
      await user.click(screen.getByRole('button', { name: /confirm my spot/i }));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalled();
      });

      expect(capturedBodies[0]).toMatchObject({
        name: 'Alice',
        email: 'alice@example.com',
        message: 'Looking forward to it!',
      });
    });
  });

  describe('FE-COMP-RSVP-015: API error does not navigate', () => {
    it('does not navigate on any API error', async () => {
      server.use(
        http.post('/api/public/trips/:id/rsvp', () =>
          HttpResponse.json({ error: 'generic error' }, { status: 409 }),
        ),
      );

      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/your name/i), 'Alice');
      await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
      await user.click(screen.getByRole('button', { name: /confirm my spot/i }));

      await waitFor(() => {
        expect(screen.getByTestId('rsvp-error')).toBeInTheDocument();
      });

      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });
});
