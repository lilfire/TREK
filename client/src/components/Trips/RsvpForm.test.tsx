// FE-COMP-RSVP-001 to FE-COMP-RSVP-009
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
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

beforeEach(() => {
  resetAllStores();
  vi.clearAllMocks();
});

function renderForm(tripId = '42') {
  return render(<RsvpForm tripId={tripId} />);
}

describe('RsvpForm', () => {
  describe('FE-COMP-RSVP-001: Renders form with required fields', () => {
    it('shows name, email, message inputs and RSVP submit button', () => {
      renderForm();

      expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/message/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /rsvp/i })).toBeInTheDocument();
    });

    it('has data-testid="rsvp-form"', () => {
      renderForm();
      expect(screen.getByTestId('rsvp-form')).toBeInTheDocument();
    });
  });

  describe('FE-COMP-RSVP-002: Required field validation — name', () => {
    it('shows an error when name is empty and form is submitted', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/email/i), 'test@example.com');
      await user.click(screen.getByRole('button', { name: /rsvp/i }));

      await waitFor(() => {
        expect(screen.getByTestId('rsvp-error')).toHaveTextContent(/name is required/i);
      });
    });

    it('does not call the API when name is missing', async () => {
      const postSpy = vi.fn(() => HttpResponse.json({ user: buildUser(), token: 'x' }, { status: 201 }));
      server.use(http.post('/api/public/trips/:id/rsvp', postSpy));

      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/email/i), 'test@example.com');
      await user.click(screen.getByRole('button', { name: /rsvp/i }));

      expect(postSpy).not.toHaveBeenCalled();
    });
  });

  describe('FE-COMP-RSVP-003: Required field validation — email', () => {
    it('shows an error when email is empty and form is submitted', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/^name/i), 'Alice');
      await user.click(screen.getByRole('button', { name: /rsvp/i }));

      await waitFor(() => {
        expect(screen.getByTestId('rsvp-error')).toHaveTextContent(/email is required/i);
      });
    });
  });

  describe('FE-COMP-RSVP-004: Loading state during submission', () => {
    it('disables the submit button while the request is in flight', async () => {
      let resolveRsvp!: (v: unknown) => void;
      server.use(
        http.post('/api/public/trips/:id/rsvp', () =>
          new Promise(resolve => { resolveRsvp = resolve; }),
        ),
      );

      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/^name/i), 'Alice');
      await user.type(screen.getByLabelText(/email/i), 'alice@example.com');

      const submitBtn = screen.getByRole('button', { name: /rsvp/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /sending/i })).toBeDisabled();
      });

      resolveRsvp(HttpResponse.json({ user: buildUser(), token: 'x' }, { status: 201 }));
    });
  });

  describe('FE-COMP-RSVP-005: Successful RSVP redirects to /dashboard', () => {
    it('navigates to /dashboard after a successful submission', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/^name/i), 'Alice');
      await user.type(screen.getByLabelText(/email/i), 'alice@example.com');
      await user.click(screen.getByRole('button', { name: /rsvp/i }));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
      });
    });

    it('updates auth store with the returned user on success', async () => {
      const rsvpUser = buildUser({ email: 'alice@example.com' });
      server.use(
        http.post('/api/public/trips/:id/rsvp', () =>
          HttpResponse.json({ user: rsvpUser, token: 'tok' }, { status: 201 }),
        ),
      );

      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/^name/i), 'Alice');
      await user.type(screen.getByLabelText(/email/i), 'alice@example.com');
      await user.click(screen.getByRole('button', { name: /rsvp/i }));

      await waitFor(() => {
        expect(useAuthStore.getState().isAuthenticated).toBe(true);
        expect(useAuthStore.getState().user?.email).toBe('alice@example.com');
      });
    });
  });

  describe('FE-COMP-RSVP-006: API error displays inline message', () => {
    it('shows the error message returned by the API', async () => {
      server.use(
        http.post('/api/public/trips/:id/rsvp', () =>
          HttpResponse.json({ error: 'Email already registered.' }, { status: 409 }),
        ),
      );

      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/^name/i), 'Alice');
      await user.type(screen.getByLabelText(/email/i), 'alice@example.com');
      await user.click(screen.getByRole('button', { name: /rsvp/i }));

      await waitFor(() => {
        expect(screen.getByTestId('rsvp-error')).toBeInTheDocument();
      });

      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('re-enables the submit button after an API error', async () => {
      server.use(
        http.post('/api/public/trips/:id/rsvp', () =>
          HttpResponse.json({ error: 'Server error' }, { status: 500 }),
        ),
      );

      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/^name/i), 'Alice');
      await user.type(screen.getByLabelText(/email/i), 'alice@example.com');
      await user.click(screen.getByRole('button', { name: /rsvp/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /rsvp/i })).not.toBeDisabled();
      });
    });
  });

  describe('FE-COMP-RSVP-007: Message field is optional', () => {
    it('submits successfully without a message', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/^name/i), 'Alice');
      await user.type(screen.getByLabelText(/email/i), 'alice@example.com');
      // message intentionally left blank
      await user.click(screen.getByRole('button', { name: /rsvp/i }));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
      });
    });
  });

  describe('FE-COMP-RSVP-008: Authenticated user sees "already on the list"', () => {
    it('hides the form and shows an already-registered message when authenticated', () => {
      seedStore(useAuthStore, { user: buildUser(), isAuthenticated: true });

      renderForm();

      expect(screen.queryByTestId('rsvp-form')).not.toBeInTheDocument();
      expect(screen.getByTestId('rsvp-already-registered')).toBeInTheDocument();
      expect(screen.getByTestId('rsvp-already-registered')).toHaveTextContent(/already on the list/i);
    });
  });

  describe('FE-COMP-RSVP-009: Message field is submitted when provided', () => {
    it('includes the message in the API payload', async () => {
      const capturedBodies: unknown[] = [];
      server.use(
        http.post('/api/public/trips/:id/rsvp', async ({ request }) => {
          capturedBodies.push(await request.json());
          return HttpResponse.json({ user: buildUser(), token: 'tok' }, { status: 201 });
        }),
      );

      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/^name/i), 'Alice');
      await user.type(screen.getByLabelText(/email/i), 'alice@example.com');
      await user.type(screen.getByLabelText(/message/i), 'Looking forward to it!');
      await user.click(screen.getByRole('button', { name: /rsvp/i }));

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
});
