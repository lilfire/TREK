import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '../../tests/helpers/render';
import { Routes, Route } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../../tests/helpers/msw/server';
import { resetAllStores } from '../../tests/helpers/store';
import PublicTripDetailPage from './PublicTripDetailPage';

function renderPublicTrip(id: string) {
  return render(
    <Routes>
      <Route path="/public/trips/:id" element={<PublicTripDetailPage />} />
    </Routes>,
    { initialEntries: [`/public/trips/${id}`] },
  );
}

beforeEach(() => {
  resetAllStores();
  vi.clearAllMocks();
});

describe('PublicTripDetailPage', () => {
  describe('FE-PUB-TRIP-001: Shows loading state initially', () => {
    it('renders a loading spinner before data arrives', async () => {
      server.use(
        http.get('/api/public/trips/:id', async () => {
          await new Promise(resolve => setTimeout(resolve, 300));
          return HttpResponse.json({});
        }),
      );

      renderPublicTrip('42');

      // Spinner should be present before the data resolves
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });
  });

  describe('FE-PUB-TRIP-002: Renders trip name and itinerary', () => {
    it('displays the trip title after data loads', async () => {
      renderPublicTrip('42');

      await waitFor(() => {
        expect(screen.getByTestId('trip-title')).toHaveTextContent('Public Paris Trip');
      });
    });

    it('renders the itinerary section with day cards', async () => {
      renderPublicTrip('42');

      await waitFor(() => {
        expect(screen.getByTestId('itinerary')).toBeInTheDocument();
      });

      // Both days appear
      expect(screen.getByText('Arrival Day')).toBeInTheDocument();
      expect(screen.getByText('Sightseeing')).toBeInTheDocument();
    });

    it('shows places within an expanded day', async () => {
      renderPublicTrip('42');

      await waitFor(() => {
        expect(screen.getByText('Arrival Day')).toBeInTheDocument();
      });

      // Days are expanded by default — Eiffel Tower should be visible
      expect(screen.getByText('Eiffel Tower')).toBeInTheDocument();
    });

    it('shows day notes within an expanded day', async () => {
      renderPublicTrip('42');

      await waitFor(() => {
        expect(screen.getByText('Sightseeing')).toBeInTheDocument();
      });

      expect(screen.getByText('Pack light')).toBeInTheDocument();
    });
  });

  describe('FE-PUB-TRIP-003: Day cards are collapsible', () => {
    it('collapses a day when clicked and hides its places', async () => {
      renderPublicTrip('42');

      await waitFor(() => {
        expect(screen.getByText('Eiffel Tower')).toBeInTheDocument();
      });

      // Click Arrival Day header to collapse it
      fireEvent.click(screen.getByText('Arrival Day'));

      // Eiffel Tower should no longer be visible
      await waitFor(() => {
        expect(screen.queryByText('Eiffel Tower')).not.toBeInTheDocument();
      });
    });

    it('expands a day again when clicked after collapse', async () => {
      renderPublicTrip('42');

      await waitFor(() => {
        expect(screen.getByText('Eiffel Tower')).toBeInTheDocument();
      });

      const dayButton = screen.getByText('Arrival Day');

      // Collapse
      fireEvent.click(dayButton);
      await waitFor(() => {
        expect(screen.queryByText('Eiffel Tower')).not.toBeInTheDocument();
      });

      // Expand again
      fireEvent.click(dayButton);
      await waitFor(() => {
        expect(screen.getByText('Eiffel Tower')).toBeInTheDocument();
      });
    });
  });

  describe('FE-PUB-TRIP-004: Renders error state for missing trip', () => {
    it('shows 404 state when trip is not found', async () => {
      renderPublicTrip('999');

      await waitFor(() => {
        expect(screen.getByTestId('not-found')).toBeInTheDocument();
      });

      expect(screen.getByText(/trip not found/i)).toBeInTheDocument();
      expect(screen.getByText(/not publicly available/i)).toBeInTheDocument();
    });

    it('shows 404 state for a non-public trip', async () => {
      server.use(
        http.get('/api/public/trips/:id', () => new HttpResponse(null, { status: 404 })),
      );

      renderPublicTrip('123');

      await waitFor(() => {
        expect(screen.getByTestId('not-found')).toBeInTheDocument();
      });
    });
  });

  describe('FE-PUB-TRIP-005: RSVP form is present', () => {
    it('renders the RSVP section at the bottom of the page', async () => {
      renderPublicTrip('42');

      await waitFor(() => {
        expect(screen.getByTestId('rsvp-section')).toBeInTheDocument();
      });

      expect(screen.getByTestId('rsvp-form')).toBeInTheDocument();
    });

    it('renders name and email fields in the RSVP form', async () => {
      renderPublicTrip('42');

      await waitFor(() => {
        expect(screen.getByTestId('rsvp-form')).toBeInTheDocument();
      });

      expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /rsvp/i })).toBeInTheDocument();
    });
  });

  describe('FE-PUB-TRIP-006: No edit controls present', () => {
    it('does not render any edit or delete buttons', async () => {
      renderPublicTrip('42');

      await waitFor(() => {
        expect(screen.getByTestId('trip-title')).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /add/i })).not.toBeInTheDocument();
    });

    it('shows a read-only indicator', async () => {
      renderPublicTrip('42');

      await waitFor(() => {
        expect(screen.getByText(/read-only/i)).toBeInTheDocument();
      });
    });
  });

  describe('FE-PUB-TRIP-007: Renders trip dates', () => {
    it('displays formatted trip start and end dates', async () => {
      renderPublicTrip('42');

      await waitFor(() => {
        expect(screen.getByTestId('trip-title')).toBeInTheDocument();
      });

      // Dates derived from 2026-07-01 and 2026-07-03 should appear somewhere on the page
      expect(document.body.textContent).toMatch(/Jul/i);
    });
  });

  describe('FE-PUB-TRIP-008: Handles trip with no days gracefully', () => {
    it('shows a "no days" message when the itinerary is empty', async () => {
      server.use(
        http.get('/api/public/trips/:id', () =>
          HttpResponse.json({
            trip: { id: 1, title: 'Empty Trip', start_date: null, end_date: null, cover_image: null, currency: 'EUR' },
            days: [],
            assignments: {},
            dayNotes: {},
            places: [],
            categories: [],
            reservations: [],
            accommodations: [],
          }),
        ),
      );

      renderPublicTrip('1');

      await waitFor(() => {
        expect(screen.getByText('Empty Trip')).toBeInTheDocument();
      });

      expect(screen.getByText(/no days planned/i)).toBeInTheDocument();
    });
  });
});
