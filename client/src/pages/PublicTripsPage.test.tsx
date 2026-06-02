import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '../../tests/helpers/render';
import { Routes, Route } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../../tests/helpers/msw/server';
import { resetAllStores } from '../../tests/helpers/store';
import PublicTripsPage from './PublicTripsPage';

function renderPage() {
  return render(
    <Routes>
      <Route path="/" element={<PublicTripsPage />} />
      <Route path="/public/trips/:id" element={<div data-testid="trip-detail-page" />} />
    </Routes>,
    { initialEntries: ['/'] },
  );
}

beforeEach(() => {
  resetAllStores();
  vi.clearAllMocks();
});

describe('PublicTripsPage', () => {
  describe('FE-PUB-LIST-001: Renders trip cards', () => {
    it('shows trip names after data loads', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Public Paris Trip')).toBeInTheDocument();
      });

      expect(screen.getByText('Barcelona Weekend')).toBeInTheDocument();
    });

    it('renders a card for each returned trip', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getAllByTestId('trip-card')).toHaveLength(2);
      });
    });

    it('displays place counts on each card', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('3 places')).toBeInTheDocument();
        expect(screen.getByText('5 places')).toBeInTheDocument();
      });
    });

    it('displays date ranges on cards that have dates', async () => {
      renderPage();

      await waitFor(() => {
        const dates = screen.getAllByTestId('trip-dates');
        expect(dates.length).toBeGreaterThan(0);
      });

      expect(document.body.textContent).toMatch(/Jul/i);
    });
  });

  describe('FE-PUB-LIST-002: Empty state', () => {
    it('renders empty state when no public trips exist', async () => {
      server.use(
        http.get('/api/public/trips', () => HttpResponse.json([])),
      );

      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      });

      expect(screen.getByText(/no public trips/i)).toBeInTheDocument();
    });

    it('does not render the trip grid when empty', async () => {
      server.use(
        http.get('/api/public/trips', () => HttpResponse.json([])),
      );

      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('trips-grid')).not.toBeInTheDocument();
    });
  });

  describe('FE-PUB-LIST-003: Login and Register links visible', () => {
    it('shows a login link in the header', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('login-link')).toBeInTheDocument();
      });

      expect(screen.getByTestId('login-link')).toHaveAttribute('href', '/login');
    });

    it('shows a register link in the header', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('register-link')).toBeInTheDocument();
      });

      expect(screen.getByTestId('register-link')).toHaveAttribute('href', '/register');
    });
  });

  describe('FE-PUB-LIST-004: Loading state', () => {
    it('renders a loading spinner while fetching', async () => {
      server.use(
        http.get('/api/public/trips', async () => {
          await new Promise(resolve => setTimeout(resolve, 300));
          return HttpResponse.json([]);
        }),
      );

      renderPage();

      // Spinner is visible immediately while the delayed request is in flight
      expect(document.querySelector('.animate-spin')).toBeInTheDocument();

      // Wait for the request to resolve so the in-flight XHR is fully drained
      // before the test environment tears down (prevents ProgressEvent ReferenceError).
      await waitFor(() => {
        expect(document.querySelector('.animate-spin')).not.toBeInTheDocument();
      }, { timeout: 1000 });
    });
  });

  describe('FE-PUB-LIST-006: Cover image URL construction', () => {
    it('uses an absolute path cover image as-is (no double prefix)', async () => {
      server.use(
        http.get('/api/public/trips', () =>
          HttpResponse.json([
            { id: 1, name: 'Cover Trip', start_date: null, end_date: null, cover_image_url: '/uploads/covers/abc.jpg', description: null, place_count: 0 },
          ]),
        ),
      );

      renderPage();

      await waitFor(() => {
        expect(screen.getByAltText('')).toBeInTheDocument();
      });

      const img = screen.getByAltText('') as HTMLImageElement;
      expect(img.src).toMatch(/\/uploads\/covers\/abc\.jpg$/);
    });

    it('uses an external http URL as-is', async () => {
      server.use(
        http.get('/api/public/trips', () =>
          HttpResponse.json([
            { id: 1, name: 'Cover Trip', start_date: null, end_date: null, cover_image_url: 'https://example.com/photo.jpg', description: null, place_count: 0 },
          ]),
        ),
      );

      renderPage();

      await waitFor(() => {
        expect(screen.getByAltText('')).toBeInTheDocument();
      });

      const img = screen.getByAltText('') as HTMLImageElement;
      expect(img.src).toBe('https://example.com/photo.jpg');
    });

    it('prepends /uploads/ for a relative path without leading slash', async () => {
      server.use(
        http.get('/api/public/trips', () =>
          HttpResponse.json([
            { id: 1, name: 'Cover Trip', start_date: null, end_date: null, cover_image_url: 'covers/abc.jpg', description: null, place_count: 0 },
          ]),
        ),
      );

      renderPage();

      await waitFor(() => {
        expect(screen.getByAltText('')).toBeInTheDocument();
      });

      const img = screen.getByAltText('') as HTMLImageElement;
      expect(img.src).toMatch(/\/uploads\/covers\/abc\.jpg$/);
    });
  });

  describe('FE-PUB-LIST-005: Graceful error handling', () => {
    it('shows empty state when the API fails', async () => {
      server.use(
        http.get('/api/public/trips', () => new HttpResponse(null, { status: 500 })),
      );

      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      });
    });
  });
});
