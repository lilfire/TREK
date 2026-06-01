import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '../../tests/helpers/render';
import { Routes, Route } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../../tests/helpers/msw/server';
import { resetAllStores } from '../../tests/helpers/store';
import { useSettingsStore } from '../store/settingsStore';
import PublicTripDetailPage, { formatDuration, truncateText } from './PublicTripDetailPage';

vi.mock('@paypal/react-paypal-js', () => ({
  PayPalScriptProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PayPalButtons: () => <div data-testid="paypal-buttons" />,
}));

const mapMock = {
  fitBounds: vi.fn(),
  panTo: vi.fn(),
  setView: vi.fn(),
  getZoom: vi.fn().mockReturnValue(10),
  on: vi.fn(),
  off: vi.fn(),
};

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => <div data-testid="map-container">{children}</div>,
  TileLayer: ({ url }: any) => <div data-testid="tile-layer" data-url={url} />,
  Marker: ({ children, position }: any) => (
    <div data-testid="map-marker" data-lat={position[0]} data-lng={position[1]}>
      {children}
    </div>
  ),
  Tooltip: ({ children }: any) => <span data-testid="map-tooltip">{children}</span>,
  useMap: () => mapMock,
}));

vi.mock('leaflet', () => ({
  default: {
    divIcon: vi.fn(() => ({})),
    latLngBounds: vi.fn(() => ({ extend: vi.fn() })),
  },
}));

vi.mock('react-dom/server', () => ({
  renderToStaticMarkup: vi.fn(() => '<svg></svg>'),
}));

vi.mock('leaflet/dist/leaflet.css', () => ({}));

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
      expect(screen.getByRole('button', { name: /confirm my spot/i })).toBeInTheDocument();
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

  describe('FE-PUB-TRIP-009: Cover image URL construction', () => {
    it('uses an absolute path cover image as-is (no double prefix)', async () => {
      server.use(
        http.get('/api/public/trips/:id', () =>
          HttpResponse.json({
            trip: { id: 1, title: 'Cover Test', start_date: null, end_date: null, cover_image: '/uploads/covers/abc.jpg', currency: 'EUR' },
            days: [], assignments: {}, dayNotes: {}, places: [], categories: [], reservations: [], accommodations: [],
          }),
        ),
      );

      renderPublicTrip('1');

      await waitFor(() => {
        expect(screen.getByTestId('trip-title')).toBeInTheDocument();
      });

      const heroDiv = document.querySelector('[style*="background-image"]') as HTMLElement;
      expect(heroDiv).not.toBeNull();
      // JSDOM wraps URL values in quotes; use toContain to avoid quoting differences
      expect(heroDiv.style.backgroundImage).toContain('/uploads/covers/abc.jpg');
      expect(heroDiv.style.backgroundImage).not.toContain('//uploads');
    });

    it('uses an external http URL as-is', async () => {
      server.use(
        http.get('/api/public/trips/:id', () =>
          HttpResponse.json({
            trip: { id: 1, title: 'Cover Test', start_date: null, end_date: null, cover_image: 'https://example.com/photo.jpg', currency: 'EUR' },
            days: [], assignments: {}, dayNotes: {}, places: [], categories: [], reservations: [], accommodations: [],
          }),
        ),
      );

      renderPublicTrip('1');

      await waitFor(() => {
        expect(screen.getByTestId('trip-title')).toBeInTheDocument();
      });

      const heroDiv = document.querySelector('[style*="background-image"]') as HTMLElement;
      expect(heroDiv).not.toBeNull();
      expect(heroDiv.style.backgroundImage).toContain('https://example.com/photo.jpg');
    });

    it('prepends /uploads/ for a relative path without leading slash', async () => {
      server.use(
        http.get('/api/public/trips/:id', () =>
          HttpResponse.json({
            trip: { id: 1, title: 'Cover Test', start_date: null, end_date: null, cover_image: 'covers/abc.jpg', currency: 'EUR' },
            days: [], assignments: {}, dayNotes: {}, places: [], categories: [], reservations: [], accommodations: [],
          }),
        ),
      );

      renderPublicTrip('1');

      await waitFor(() => {
        expect(screen.getByTestId('trip-title')).toBeInTheDocument();
      });

      const heroDiv = document.querySelector('[style*="background-image"]') as HTMLElement;
      expect(heroDiv).not.toBeNull();
      expect(heroDiv.style.backgroundImage).toContain('/uploads/covers/abc.jpg');
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

  describe('FE-PUB-TRIP-009: Cover image is visibly displayed', () => {
    it('renders the cover image with opacity >= 0.4 when cover_image is set', async () => {
      server.use(
        http.get('/api/public/trips/:id', () =>
          HttpResponse.json({
            trip: {
              id: 42,
              title: 'Public Paris Trip',
              description: 'A beautiful trip to Paris',
              start_date: '2026-07-01',
              end_date: '2026-07-03',
              cover_image: 'paris.jpg',
              currency: 'EUR',
            },
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

      renderPublicTrip('42');

      await waitFor(() => {
        expect(screen.getByTestId('trip-title')).toBeInTheDocument();
      });

      const coverImageEl = screen.getByTestId('cover-image');
      expect(coverImageEl).toBeInTheDocument();
      const opacity = parseFloat((coverImageEl as HTMLElement).style.opacity);
      expect(opacity).toBeGreaterThanOrEqual(0.4);
    });

    it('does not render cover image element when cover_image is null', async () => {
      renderPublicTrip('42');

      await waitFor(() => {
        expect(screen.getByTestId('trip-title')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('cover-image')).not.toBeInTheDocument();
    });
  });

  describe('FE-PUB-TRIP-010: Language picker in hero header', () => {
    it('renders a language picker button showing the current language label', async () => {
      renderPublicTrip('42');

      await waitFor(() => {
        expect(screen.getByTestId('trip-title')).toBeInTheDocument();
      });

      const langBtn = screen.getByTestId('lang-picker-btn');
      expect(langBtn).toBeInTheDocument();
      expect(langBtn).toHaveTextContent('English');
    });

    it('opens the language dropdown when the button is clicked', async () => {
      renderPublicTrip('42');

      await waitFor(() => {
        expect(screen.getByTestId('trip-title')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('lang-picker-btn'));

      expect(screen.getByTestId('lang-picker-dropdown')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Deutsch' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Español' })).toBeInTheDocument();
    });

    it('closes the dropdown after a language option is selected', async () => {
      renderPublicTrip('42');

      await waitFor(() => {
        expect(screen.getByTestId('trip-title')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('lang-picker-btn'));
      expect(screen.getByTestId('lang-picker-dropdown')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Deutsch' }));

      expect(screen.queryByTestId('lang-picker-dropdown')).not.toBeInTheDocument();
    });

    it('updates the settings store language when a language option is selected', async () => {
      renderPublicTrip('42');

      await waitFor(() => {
        expect(screen.getByTestId('trip-title')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('lang-picker-btn'));
      fireEvent.click(screen.getByRole('button', { name: 'Français' }));

      expect(useSettingsStore.getState().settings.language).toBe('fr');
    });

    it('shows all supported languages in the dropdown', async () => {
      renderPublicTrip('42');

      await waitFor(() => {
        expect(screen.getByTestId('trip-title')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('lang-picker-btn'));

      const dropdown = screen.getByTestId('lang-picker-dropdown');
      const langButtons = dropdown.querySelectorAll('button');
      expect(langButtons.length).toBe(15);
    });

    it('closes dropdown on second click of the picker button', async () => {
      renderPublicTrip('42');

      await waitFor(() => {
        expect(screen.getByTestId('trip-title')).toBeInTheDocument();
      });

      const langBtn = screen.getByTestId('lang-picker-btn');
      fireEvent.click(langBtn);
      expect(screen.getByTestId('lang-picker-dropdown')).toBeInTheDocument();

      fireEvent.click(langBtn);
      expect(screen.queryByTestId('lang-picker-dropdown')).not.toBeInTheDocument();
    });
  });

  describe('FE-PUB-TRIP-011: RSVP fee props forwarded from trip data', () => {
    it('renders PayPal fee notice when fee_mode=rsvp and paypalClientId is set', async () => {
      server.use(
        http.get('/api/public/trips/:id', () =>
          HttpResponse.json({
            trip: {
              id: 1,
              title: 'Fee Trip',
              start_date: null,
              end_date: null,
              cover_image: null,
              currency: 'NOK',
              registration_fee: 500,
              fee_mode: 'rsvp',
              fee_deadline: null,
              rsvp_deadline: null,
              paypalClientId: 'test-client-id',
            },
            days: [], assignments: {}, dayNotes: {}, places: [], categories: [], reservations: [], accommodations: [],
          }),
        ),
      );

      renderPublicTrip('1');

      await waitFor(() => {
        expect(screen.getByTestId('trip-title')).toBeInTheDocument();
      });

      expect(screen.getByTestId('paypal-fee-notice')).toBeInTheDocument();
      expect(screen.getByTestId('paypal-fee-notice')).toHaveTextContent('500');
    });

    it('renders fee-deadline notice when fee_mode=deadline', async () => {
      server.use(
        http.get('/api/public/trips/:id', () =>
          HttpResponse.json({
            trip: {
              id: 1,
              title: 'Deadline Fee Trip',
              start_date: null,
              end_date: null,
              cover_image: null,
              currency: 'EUR',
              registration_fee: 100,
              fee_mode: 'deadline',
              fee_deadline: '2027-12-01',
              rsvp_deadline: null,
            },
            days: [], assignments: {}, dayNotes: {}, places: [], categories: [], reservations: [], accommodations: [],
          }),
        ),
      );

      renderPublicTrip('1');

      await waitFor(() => {
        expect(screen.getByTestId('trip-title')).toBeInTheDocument();
      });

      expect(screen.getByTestId('fee-deadline-notice')).toBeInTheDocument();
      expect(screen.getByTestId('fee-deadline-notice')).toHaveTextContent('100 EUR');
    });

    it('renders payment unavailable when fee_mode=rsvp but paypalClientId is absent', async () => {
      server.use(
        http.get('/api/public/trips/:id', () =>
          HttpResponse.json({
            trip: {
              id: 1,
              title: 'No PayPal Trip',
              start_date: null,
              end_date: null,
              cover_image: null,
              currency: 'NOK',
              registration_fee: 300,
              fee_mode: 'rsvp',
              fee_deadline: null,
              rsvp_deadline: null,
              paypalClientId: null,
            },
            days: [], assignments: {}, dayNotes: {}, places: [], categories: [], reservations: [], accommodations: [],
          }),
        ),
      );

      renderPublicTrip('1');

      await waitFor(() => {
        expect(screen.getByTestId('trip-title')).toBeInTheDocument();
      });

      expect(screen.getByTestId('rsvp-payment-unavailable')).toBeInTheDocument();
      expect(screen.queryByTestId('paypal-fee-notice')).not.toBeInTheDocument();
    });
  });

  describe('FE-PUB-TRIP-012: Activity detail modal', () => {
    const tripWithFiles = {
      trip: {
        id: 42,
        title: 'Public Paris Trip',
        description: 'A beautiful trip to Paris',
        start_date: '2026-07-01',
        end_date: '2026-07-03',
        cover_image: null,
        currency: 'EUR',
      },
      days: [
        { id: 101, trip_id: 42, day_number: 1, date: '2026-07-01', title: 'Arrival Day' },
      ],
      assignments: {
        '101': [
          {
            id: 201,
            day_id: 101,
            order_index: 0,
            notes: null,
            place: {
              id: 301,
              name: 'Eiffel Tower',
              description: 'Iconic Parisian landmark',
              lat: 48.8584,
              lng: 2.2945,
              address: 'Champ de Mars, Paris',
              category_id: null,
              price: 25,
              currency: 'EUR',
              website: 'https://www.toureiffel.paris',
              phone: '+33 892 70 12 39',
              notes: 'Book tickets in advance',
              place_time: '10:00',
              end_time: '12:00',
              image_url: null,
              transport_mode: null,
              category: { id: 1, name: 'Attraction', color: '#f59e0b' },
              tags: [],
              files: [
                {
                  id: 1,
                  original_name: 'tower-photo.jpg',
                  mime_type: 'image/jpeg',
                  file_size: 102400,
                  url: '/api/public/trips/42/files/1',
                },
                {
                  id: 2,
                  original_name: 'entry-info.pdf',
                  mime_type: 'application/pdf',
                  file_size: 204800,
                  url: '/api/public/trips/42/files/2',
                },
              ],
            },
          },
        ],
      },
      dayNotes: { '101': [] },
      places: [],
      categories: [],
      reservations: [],
      accommodations: [],
      budgetItems: [
        { id: 'b1', title: 'Flights', category: 'Transport', amount: 250, note: '', persons: 1, days: 1 },
        { id: 'b2', title: 'Hotel', category: 'Accommodation', amount: 300, note: '', persons: 1, days: 3 },
      ],
      budgetSummary: { totalBudget: 550, currency: 'EUR' },
    };

    it('modal is absent when no activity is selected', async () => {
      renderPublicTrip('42');

      await waitFor(() => {
        expect(screen.getByTestId('trip-title')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('activity-modal')).not.toBeInTheDocument();
    });

    it('clicking an activity row opens the modal with the place name', async () => {
      server.use(
        http.get('/api/public/trips/:id', () => HttpResponse.json(tripWithFiles)),
      );

      renderPublicTrip('42');

      await waitFor(() => {
        expect(screen.getByText('Eiffel Tower')).toBeInTheDocument();
      });

      fireEvent.click(screen.getAllByText('Eiffel Tower')[0]);

      await waitFor(() => {
        expect(screen.getByTestId('activity-modal')).toBeInTheDocument();
      });

      // Modal header shows the place name
      const modal = screen.getByTestId('activity-modal');
      expect(modal).toHaveTextContent('Eiffel Tower');
    });

    it('close button dismisses the modal', async () => {
      server.use(
        http.get('/api/public/trips/:id', () => HttpResponse.json(tripWithFiles)),
      );

      renderPublicTrip('42');

      await waitFor(() => {
        expect(screen.getByText('Eiffel Tower')).toBeInTheDocument();
      });

      fireEvent.click(screen.getAllByText('Eiffel Tower')[0]);

      await waitFor(() => {
        expect(screen.getByTestId('activity-modal')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /close/i }));

      await waitFor(() => {
        expect(screen.queryByTestId('activity-modal')).not.toBeInTheDocument();
      });
    });

    it('image files with url render as thumbnail links; non-image files with url render as download links', async () => {
      server.use(
        http.get('/api/public/trips/:id', () => HttpResponse.json(tripWithFiles)),
      );

      renderPublicTrip('42');
      await waitFor(() => expect(screen.getByText('Eiffel Tower')).toBeInTheDocument());
      fireEvent.click(screen.getAllByText('Eiffel Tower')[0]);
      await waitFor(() => expect(screen.getByTestId('activity-modal')).toBeInTheDocument());

      const modal = screen.getByTestId('activity-modal');

      // image/jpeg with url → renders <img> thumbnail inside an <a>
      const imgThumb = modal.querySelector('img[alt="tower-photo.jpg"]');
      expect(imgThumb).not.toBeNull();

      // Both files render as anchors pointing to the file URL
      const fileLinks = modal.querySelectorAll('a[href*="/files/"]');
      expect(fileLinks).toHaveLength(2);

      // PDF file does NOT get an img thumbnail
      expect(modal.querySelector('img[alt="entry-info.pdf"]')).toBeNull();

      // Filenames still visible as link text
      expect(screen.getByText('tower-photo.jpg')).toBeInTheDocument();
      expect(screen.getByText('entry-info.pdf')).toBeInTheDocument();
    });

    it('files without url render as plain text rows — no anchor or thumbnail', async () => {
      server.use(
        http.get('/api/public/trips/:id', () =>
          HttpResponse.json({
            ...tripWithFiles,
            assignments: {
              '101': [
                {
                  ...tripWithFiles.assignments['101'][0],
                  place: {
                    ...tripWithFiles.assignments['101'][0].place,
                    files: [
                      { id: 3, original_name: 'no-url.pdf', mime_type: 'application/pdf', file_size: 1024 },
                    ],
                  },
                },
              ],
            },
          }),
        ),
      );

      renderPublicTrip('42');
      await waitFor(() => expect(screen.getByText('Eiffel Tower')).toBeInTheDocument());
      fireEvent.click(screen.getAllByText('Eiffel Tower')[0]);
      await waitFor(() => expect(screen.getByTestId('activity-modal')).toBeInTheDocument());

      const modal = screen.getByTestId('activity-modal');
      expect(modal.querySelectorAll('a[href*="/files/"]')).toHaveLength(0);
      expect(screen.getByText('no-url.pdf')).toBeInTheDocument();
    });

    it('file section header shows the file count', async () => {
      server.use(
        http.get('/api/public/trips/:id', () => HttpResponse.json(tripWithFiles)),
      );

      renderPublicTrip('42');
      await waitFor(() => expect(screen.getByText('Eiffel Tower')).toBeInTheDocument());
      fireEvent.click(screen.getAllByText('Eiffel Tower')[0]);
      await waitFor(() => expect(screen.getByTestId('activity-modal')).toBeInTheDocument());

      expect(screen.getByText('Files (2)')).toBeInTheDocument();
    });

    it('shows MIME abbreviations for file rows', async () => {
      server.use(
        http.get('/api/public/trips/:id', () => HttpResponse.json(tripWithFiles)),
      );

      renderPublicTrip('42');
      await waitFor(() => expect(screen.getByText('Eiffel Tower')).toBeInTheDocument());
      fireEvent.click(screen.getAllByText('Eiffel Tower')[0]);
      await waitFor(() => expect(screen.getByTestId('activity-modal')).toBeInTheDocument());

      const modal = screen.getByTestId('activity-modal');
      // image/jpeg → JPEG, application/pdf → PDF
      expect(modal).toHaveTextContent('JPEG');
      expect(modal).toHaveTextContent('PDF');
    });

    it('formats file sizes as KB and MB', async () => {
      server.use(
        http.get('/api/public/trips/:id', () =>
          HttpResponse.json({
            ...tripWithFiles,
            assignments: {
              '101': [
                {
                  ...tripWithFiles.assignments['101'][0],
                  place: {
                    ...tripWithFiles.assignments['101'][0].place,
                    files: [
                      { id: 10, original_name: 'small.txt', mime_type: 'text/plain', file_size: 512 },
                      { id: 11, original_name: 'medium.pdf', mime_type: 'application/pdf', file_size: 126976 },
                      { id: 12, original_name: 'large.mp4', mime_type: 'video/mp4', file_size: 2621440 },
                      { id: 13, original_name: 'unknown.bin', mime_type: 'application/octet-stream', file_size: null },
                    ],
                  },
                },
              ],
            },
          }),
        ),
      );

      renderPublicTrip('42');
      await waitFor(() => expect(screen.getByText('Eiffel Tower')).toBeInTheDocument());
      fireEvent.click(screen.getAllByText('Eiffel Tower')[0]);
      await waitFor(() => expect(screen.getByTestId('activity-modal')).toBeInTheDocument());

      const modal = screen.getByTestId('activity-modal');
      expect(modal).toHaveTextContent('< 1 KB');   // 512 bytes
      expect(modal).toHaveTextContent('124 KB');   // 126976 / 1024 = 124
      expect(modal).toHaveTextContent('2.5 MB');   // 2621440 / 1048576 = 2.5
      // null file_size → no size string at all for that row
      expect(modal).not.toHaveTextContent('null');
    });

    it('file section is hidden when place.files is empty', async () => {
      server.use(
        http.get('/api/public/trips/:id', () =>
          HttpResponse.json({
            ...tripWithFiles,
            assignments: {
              '101': [
                {
                  ...tripWithFiles.assignments['101'][0],
                  place: { ...tripWithFiles.assignments['101'][0].place, files: [] },
                },
              ],
            },
          }),
        ),
      );

      renderPublicTrip('42');
      await waitFor(() => expect(screen.getByText('Eiffel Tower')).toBeInTheDocument());
      fireEvent.click(screen.getAllByText('Eiffel Tower')[0]);
      await waitFor(() => expect(screen.getByTestId('activity-modal')).toBeInTheDocument());

      expect(screen.queryByText(/^Files \(/)).not.toBeInTheDocument();
    });

    it('file section is hidden when place.files is absent', async () => {
      server.use(
        http.get('/api/public/trips/:id', () =>
          HttpResponse.json({
            ...tripWithFiles,
            assignments: {
              '101': [
                {
                  ...tripWithFiles.assignments['101'][0],
                  place: { ...tripWithFiles.assignments['101'][0].place, files: undefined },
                },
              ],
            },
          }),
        ),
      );

      renderPublicTrip('42');
      await waitFor(() => expect(screen.getByText('Eiffel Tower')).toBeInTheDocument());
      fireEvent.click(screen.getAllByText('Eiffel Tower')[0]);
      await waitFor(() => expect(screen.getByTestId('activity-modal')).toBeInTheDocument());

      expect(screen.queryByText(/^Files \(/)).not.toBeInTheDocument();
    });

    it('unknown MIME type falls back to uppercased subtype or FILE', async () => {
      server.use(
        http.get('/api/public/trips/:id', () =>
          HttpResponse.json({
            ...tripWithFiles,
            assignments: {
              '101': [
                {
                  ...tripWithFiles.assignments['101'][0],
                  place: {
                    ...tripWithFiles.assignments['101'][0].place,
                    files: [
                      { id: 20, original_name: 'data.csv', mime_type: 'text/csv', file_size: 2048 },
                      { id: 21, original_name: 'mystery', mime_type: '', file_size: null },
                    ],
                  },
                },
              ],
            },
          }),
        ),
      );

      renderPublicTrip('42');
      await waitFor(() => expect(screen.getByText('Eiffel Tower')).toBeInTheDocument());
      fireEvent.click(screen.getAllByText('Eiffel Tower')[0]);
      await waitFor(() => expect(screen.getByTestId('activity-modal')).toBeInTheDocument());

      const modal = screen.getByTestId('activity-modal');
      expect(modal).toHaveTextContent('CSV');   // text/csv → CSV (4-char slice)
      expect(modal).toHaveTextContent('FILE');  // empty mime → FILE fallback
    });
  });
});

// ---------------------------------------------------------------------------
// Helper builders for popup-specific tests
// ---------------------------------------------------------------------------

function buildTripWithPlace(placeOverrides: Record<string, unknown>) {
  return {
    trip: {
      id: 42,
      title: 'Test Trip',
      start_date: '2026-07-01',
      end_date: '2026-07-03',
      cover_image: null,
      currency: 'EUR',
    },
    days: [{ id: 101, trip_id: 42, day_number: 1, date: '2026-07-01', title: 'Day 1' }],
    assignments: {
      '101': [
        {
          id: 201,
          day_id: 101,
          order_index: 0,
          notes: null,
          place: {
            id: 301,
            name: 'Test Place',
            description: null,
            notes: null,
            lat: 48.8584,
            lng: 2.2945,
            address: null,
            category_id: null,
            place_time: null,
            end_time: null,
            duration_minutes: null,
            price: null,
            currency: null,
            website: null,
            phone: null,
            image_url: null,
            transport_mode: null,
            category: null,
            tags: [],
            files: [],
            ...placeOverrides,
          },
        },
      ],
    },
    dayNotes: { '101': [] },
    places: [],
    categories: [],
    reservations: [],
    accommodations: [],
  };
}

async function openModal() {
  renderPublicTrip('42');
  await waitFor(() => expect(screen.getByText('Test Place')).toBeInTheDocument());
  fireEvent.click(screen.getAllByText('Test Place')[0]);
  await waitFor(() => expect(screen.getByTestId('activity-modal')).toBeInTheDocument());
}

// ---------------------------------------------------------------------------
// Unit tests for pure helpers
// ---------------------------------------------------------------------------

describe('formatDuration', () => {
  it('formats whole hours without a minutes suffix', () => {
    expect(formatDuration(120)).toBe('2hr');
  });

  it('formats minutes-only without an hours prefix', () => {
    expect(formatDuration(45)).toBe('45min');
  });

  it('formats mixed hours and minutes', () => {
    expect(formatDuration(90)).toBe('1hr 30min');
  });

  it('does not produce a 0hr prefix for sub-60-minute durations', () => {
    expect(formatDuration(30)).not.toContain('0hr');
  });

  it('handles exactly 60 minutes as 1hr', () => {
    expect(formatDuration(60)).toBe('1hr');
  });
});

describe('truncateText', () => {
  it('returns text unchanged when it is within the limit', () => {
    const short = 'short text';
    expect(truncateText(short)).toBe(short);
  });

  it('returns text unchanged when it is exactly at the limit', () => {
    const exact = 'a'.repeat(120);
    expect(truncateText(exact)).toBe(exact);
  });

  it('truncates at a word boundary and appends ellipsis', () => {
    const text = ('word ').repeat(25); // 125 chars
    const result = truncateText(text);
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(121);
    // Should not cut mid-word
    expect(result.slice(0, -1).trim().split(' ').every(w => w === 'word')).toBe(true);
  });

  it('truncates mid-character when there are no spaces before the limit', () => {
    const noSpaces = 'x'.repeat(130);
    expect(truncateText(noSpaces)).toBe('x'.repeat(120) + '…');
  });

  it('respects a custom maxLen argument', () => {
    expect(truncateText('hello world', 5)).toBe('hello…');
  });
});

// ---------------------------------------------------------------------------
// FE-PUB-TRIP-013: Time row variants
// ---------------------------------------------------------------------------

describe('FE-PUB-TRIP-013: Time row duration_minutes rendering', () => {
  it('shows start–end range when both place_time and end_time are set', async () => {
    server.use(
      http.get('/api/public/trips/:id', () =>
        HttpResponse.json(buildTripWithPlace({ place_time: '10:00', end_time: '12:00' })),
      ),
    );

    await openModal();

    expect(screen.getByTestId('activity-modal')).toHaveTextContent('10:00 – 12:00');
  });

  it('shows start (duration) when place_time set and duration_minutes set but no end_time', async () => {
    server.use(
      http.get('/api/public/trips/:id', () =>
        HttpResponse.json(buildTripWithPlace({ place_time: '14:00', duration_minutes: 90 })),
      ),
    );

    await openModal();

    expect(screen.getByTestId('activity-modal')).toHaveTextContent('14:00 (1hr 30min)');
  });

  it('shows start (whole-hour duration) correctly', async () => {
    server.use(
      http.get('/api/public/trips/:id', () =>
        HttpResponse.json(buildTripWithPlace({ place_time: '09:00', duration_minutes: 120 })),
      ),
    );

    await openModal();

    expect(screen.getByTestId('activity-modal')).toHaveTextContent('09:00 (2hr)');
  });

  it('shows start (minutes-only duration) correctly', async () => {
    server.use(
      http.get('/api/public/trips/:id', () =>
        HttpResponse.json(buildTripWithPlace({ place_time: '08:30', duration_minutes: 45 })),
      ),
    );

    await openModal();

    expect(screen.getByTestId('activity-modal')).toHaveTextContent('08:30 (45min)');
  });

  it('shows only place_time when no end_time and no duration_minutes', async () => {
    server.use(
      http.get('/api/public/trips/:id', () =>
        HttpResponse.json(buildTripWithPlace({ place_time: '11:00' })),
      ),
    );

    await openModal();

    const modal = screen.getByTestId('activity-modal');
    expect(modal).toHaveTextContent('11:00');
    expect(modal.textContent).not.toContain('–');
    expect(modal.textContent).not.toContain('(');
  });

  it('omits the time row entirely when no time data is present', async () => {
    server.use(
      http.get('/api/public/trips/:id', () =>
        HttpResponse.json(buildTripWithPlace({})),
      ),
    );

    await openModal();

    const modal = screen.getByTestId('activity-modal');
    expect(modal.querySelector('svg')).toBeDefined();
    expect(modal.textContent).not.toMatch(/\d{2}:\d{2}/);
  });
});

// ---------------------------------------------------------------------------
// FE-PUB-TRIP-014: Description and notes truncation
// ---------------------------------------------------------------------------

describe('FE-PUB-TRIP-014: Description and notes truncation in popup', () => {
  it('renders short description without ellipsis', async () => {
    server.use(
      http.get('/api/public/trips/:id', () =>
        HttpResponse.json(buildTripWithPlace({ description: 'A short description.' })),
      ),
    );

    await openModal();

    const modal = screen.getByTestId('activity-modal');
    expect(modal).toHaveTextContent('A short description.');
    expect(modal.textContent).not.toContain('…');
  });

  it('truncates description longer than 120 chars with ellipsis', async () => {
    const long = 'This is a long word sentence that repeats itself several times to go over the limit of one hundred and twenty characters total.';
    server.use(
      http.get('/api/public/trips/:id', () =>
        HttpResponse.json(buildTripWithPlace({ description: long })),
      ),
    );

    await openModal();

    const modal = screen.getByTestId('activity-modal');
    expect(modal.textContent).toContain('…');
    expect(modal.textContent).not.toContain(long);
  });

  it('renders short notes without ellipsis', async () => {
    server.use(
      http.get('/api/public/trips/:id', () =>
        HttpResponse.json(buildTripWithPlace({ notes: 'Short note.' })),
      ),
    );

    await openModal();

    expect(screen.getByTestId('activity-modal')).toHaveTextContent('Short note.');
  });

  it('truncates notes longer than 120 chars with ellipsis', async () => {
    const long = 'Note text that is deliberately written to be longer than one hundred and twenty characters so that truncation will kick in here.';
    server.use(
      http.get('/api/public/trips/:id', () =>
        HttpResponse.json(buildTripWithPlace({ notes: long })),
      ),
    );

    await openModal();

    const modal = screen.getByTestId('activity-modal');
    expect(modal.textContent).toContain('…');
    expect(modal.textContent).not.toContain(long);
  });

  it('omits description section entirely when description is absent', async () => {
    server.use(
      http.get('/api/public/trips/:id', () =>
        HttpResponse.json(buildTripWithPlace({ notes: 'Only notes here.' })),
      ),
    );

    await openModal();

    const modal = screen.getByTestId('activity-modal');
    expect(modal).toHaveTextContent('Only notes here.');
  });
});

// ---------------------------------------------------------------------------
// FE-PUB-TRIP-015: fee_currency passthrough to RsvpForm
// ---------------------------------------------------------------------------

describe('FE-PUB-TRIP-015: fee_currency passed to RsvpForm', () => {
  it('prefers fee_currency over currency when both are set', async () => {
    server.use(
      http.get('/api/public/trips/:id', () =>
        HttpResponse.json({
          trip: {
            id: 1,
            title: 'Fee Currency Trip',
            start_date: null,
            end_date: null,
            cover_image: null,
            currency: 'NOK',
            fee_currency: 'USD',
            registration_fee: 200,
            fee_mode: 'deadline',
            fee_deadline: '2027-06-01',
            rsvp_deadline: null,
          },
          days: [], assignments: {}, dayNotes: {}, places: [], categories: [], reservations: [], accommodations: [],
        }),
      ),
    );

    renderPublicTrip('1');

    await waitFor(() => {
      expect(screen.getByTestId('trip-title')).toBeInTheDocument();
    });

    // The fee-deadline-notice should show the fee amount with USD (fee_currency), not NOK
    expect(screen.getByTestId('fee-deadline-notice')).toHaveTextContent('200 USD');
    expect(screen.getByTestId('fee-deadline-notice')).not.toHaveTextContent('NOK');
  });

  it('falls back to currency when fee_currency is absent', async () => {
    server.use(
      http.get('/api/public/trips/:id', () =>
        HttpResponse.json({
          trip: {
            id: 1,
            title: 'No Fee Currency Trip',
            start_date: null,
            end_date: null,
            cover_image: null,
            currency: 'EUR',
            fee_currency: null,
            registration_fee: 100,
            fee_mode: 'deadline',
            fee_deadline: '2027-06-01',
            rsvp_deadline: null,
          },
          days: [], assignments: {}, dayNotes: {}, places: [], categories: [], reservations: [], accommodations: [],
        }),
      ),
    );

    renderPublicTrip('1');

    await waitFor(() => {
      expect(screen.getByTestId('trip-title')).toBeInTheDocument();
    });

    expect(screen.getByTestId('fee-deadline-notice')).toHaveTextContent('100 EUR');
  });
});

// ---------------------------------------------------------------------------
// FE-PUB-TRIP-016: Budget section removed from public page
// ---------------------------------------------------------------------------

describe('FE-PUB-TRIP-016: Budget section not rendered on public trip page', () => {
  it('does not render budget-section even when budgetItems are present in the response', async () => {
    server.use(
      http.get('/api/public/trips/:id', () =>
        HttpResponse.json({
          trip: { id: 1, title: 'Budget Trip', start_date: null, end_date: null, cover_image: null, currency: 'EUR' },
          days: [], assignments: {}, dayNotes: {}, places: [], categories: [], reservations: [], accommodations: [],
          budgetItems: [
            { id: '1', title: 'Flights', category: 'Transport', amount: 400, note: '', persons: 1, days: 1 },
            { id: '2', title: 'Hotel', category: 'Accommodation', amount: 600, note: '', persons: 1, days: 3 },
          ],
          budgetSummary: { totalBudget: 1000, currency: 'USD' },
        }),
      ),
    );

    renderPublicTrip('1');

    await waitFor(() => {
      expect(screen.getByTestId('trip-title')).toBeInTheDocument();
    });

    // PublicBudgetSection has been removed from the page; budget-section must not appear
    expect(screen.queryByTestId('budget-section')).not.toBeInTheDocument();
    expect(screen.queryByTestId('budget-total')).not.toBeInTheDocument();
    expect(screen.queryByTestId('budget-item')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// FE-PUB-TRIP-020: Leaflet map on public trip page
// ---------------------------------------------------------------------------

describe('FE-PUB-TRIP-020: Leaflet map renders for places with coordinates', () => {
  const tripWithPlaces = {
    trip: {
      id: 42,
      title: 'Map Test Trip',
      description: null,
      start_date: '2026-07-01',
      end_date: '2026-07-03',
      cover_image: null,
      currency: 'EUR',
    },
    days: [{ id: 101, trip_id: 42, day_number: 1, date: '2026-07-01', title: 'Day 1' }],
    assignments: { '101': [] },
    dayNotes: { '101': [] },
    places: [
      {
        id: 1,
        name: 'Eiffel Tower',
        lat: 48.8584,
        lng: 2.2945,
        category_name: 'Attraction',
        category_color: '#f59e0b',
        category_icon: 'landmark',
      },
      {
        id: 2,
        name: 'Louvre Museum',
        lat: 48.8606,
        lng: 2.3376,
        category_name: 'Museum',
        category_color: '#6366f1',
        category_icon: 'building',
      },
    ],
    categories: [],
    reservations: [],
    accommodations: [],
  };

  it('renders the map container when places with coordinates exist', async () => {
    server.use(
      http.get('/api/public/trips/:id', () => HttpResponse.json(tripWithPlaces)),
    );

    renderPublicTrip('42');

    await waitFor(() => {
      expect(screen.getByTestId('trip-map')).toBeInTheDocument();
    });

    expect(screen.getByTestId('map-container')).toBeInTheDocument();
  });

  it('renders a marker for each place with coordinates', async () => {
    server.use(
      http.get('/api/public/trips/:id', () => HttpResponse.json(tripWithPlaces)),
    );

    renderPublicTrip('42');

    await waitFor(() => {
      expect(screen.getByTestId('trip-map')).toBeInTheDocument();
    });

    const markers = screen.getAllByTestId('map-marker');
    expect(markers).toHaveLength(2);
  });

  it('renders marker tooltips with place names', async () => {
    server.use(
      http.get('/api/public/trips/:id', () => HttpResponse.json(tripWithPlaces)),
    );

    renderPublicTrip('42');

    await waitFor(() => {
      expect(screen.getByTestId('trip-map')).toBeInTheDocument();
    });

    const tooltips = screen.getAllByTestId('map-tooltip');
    const names = tooltips.map(t => t.textContent);
    expect(names).toContain('Eiffel Tower');
    expect(names).toContain('Louvre Museum');
  });

  it('hides the map when no places have coordinates', async () => {
    server.use(
      http.get('/api/public/trips/:id', () =>
        HttpResponse.json({
          ...tripWithPlaces,
          places: [
            { id: 1, name: 'No Coords Place', lat: null, lng: null },
          ],
        }),
      ),
    );

    renderPublicTrip('42');

    await waitFor(() => {
      expect(screen.getByTestId('trip-title')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('trip-map')).not.toBeInTheDocument();
  });

  it('hides the map when places array is empty', async () => {
    server.use(
      http.get('/api/public/trips/:id', () =>
        HttpResponse.json({ ...tripWithPlaces, places: [] }),
      ),
    );

    renderPublicTrip('42');

    await waitFor(() => {
      expect(screen.getByTestId('trip-title')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('trip-map')).not.toBeInTheDocument();
  });

  it('normalizes flat category fields into a nested category object for each marker', async () => {
    server.use(
      http.get('/api/public/trips/:id', () =>
        HttpResponse.json({
          ...tripWithPlaces,
          places: [
            {
              id: 1,
              name: 'Eiffel Tower',
              lat: 48.8584,
              lng: 2.2945,
              category_name: 'Attraction',
              category_color: '#f59e0b',
              category_icon: 'landmark',
            },
          ],
        }),
      ),
    );

    renderPublicTrip('42');

    await waitFor(() => {
      expect(screen.getByTestId('trip-map')).toBeInTheDocument();
    });

    // Marker should be rendered with the correct lat/lng
    const marker = screen.getByTestId('map-marker');
    expect(marker).toHaveAttribute('data-lat', '48.8584');
    expect(marker).toHaveAttribute('data-lng', '2.2945');
  });

  it('places only places without coordinates are excluded from the map', async () => {
    server.use(
      http.get('/api/public/trips/:id', () =>
        HttpResponse.json({
          ...tripWithPlaces,
          places: [
            { id: 1, name: 'Has Coords', lat: 48.8584, lng: 2.2945, category_name: null, category_color: null, category_icon: null },
            { id: 2, name: 'No Lat', lat: null, lng: 2.2945, category_name: null, category_color: null, category_icon: null },
            { id: 3, name: 'No Lng', lat: 48.8584, lng: null, category_name: null, category_color: null, category_icon: null },
          ],
        }),
      ),
    );

    renderPublicTrip('42');

    await waitFor(() => {
      expect(screen.getByTestId('trip-map')).toBeInTheDocument();
    });

    const markers = screen.getAllByTestId('map-marker');
    expect(markers).toHaveLength(1);
    expect(screen.getByTestId('map-tooltip')).toHaveTextContent('Has Coords');
  });

  it('FE-PUB-TRIP-021: uses light tile URL when dark mode is off', async () => {
    document.documentElement.classList.remove('dark');
    server.use(
      http.get('/api/public/trips/:id', () => HttpResponse.json(tripWithPlaces)),
    );

    renderPublicTrip('42');

    await waitFor(() => {
      expect(screen.getByTestId('trip-map')).toBeInTheDocument();
    });

    const tileLayer = screen.getByTestId('tile-layer');
    expect(tileLayer.getAttribute('data-url')).toContain('light_all');
  });

  it('FE-PUB-TRIP-022: switches to dark tile URL when dark mode class is applied', async () => {
    document.documentElement.classList.remove('dark');
    server.use(
      http.get('/api/public/trips/:id', () => HttpResponse.json(tripWithPlaces)),
    );

    renderPublicTrip('42');

    await waitFor(() => {
      expect(screen.getByTestId('trip-map')).toBeInTheDocument();
    });

    document.documentElement.classList.add('dark');

    await waitFor(() => {
      expect(screen.getByTestId('tile-layer').getAttribute('data-url')).toContain('dark_all');
    });

    document.documentElement.classList.remove('dark');
  });
});

// ---------------------------------------------------------------------------
// FE-PUB-TRIP-017: Budget section hidden when budgetItems is empty or absent
// ---------------------------------------------------------------------------

describe('FE-PUB-TRIP-017: Budget section hidden when budgetItems is empty or absent', () => {
  it('hides budget section when budgetItems is an empty array', async () => {
    server.use(
      http.get('/api/public/trips/:id', () =>
        HttpResponse.json({
          trip: { id: 1, title: 'Empty Budget Trip', start_date: null, end_date: null, cover_image: null, currency: 'EUR' },
          days: [], assignments: {}, dayNotes: {}, places: [], categories: [], reservations: [], accommodations: [],
          budgetItems: [],
          budgetSummary: { totalBudget: 0, currency: 'EUR' },
        }),
      ),
    );

    renderPublicTrip('1');

    await waitFor(() => {
      expect(screen.getByTestId('trip-title')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('budget-section')).not.toBeInTheDocument();
  });

  it('hides budget section when budgetItems is absent from the response', async () => {
    server.use(
      http.get('/api/public/trips/:id', () =>
        HttpResponse.json({
          trip: { id: 1, title: 'No Budget Trip', start_date: null, end_date: null, cover_image: null, currency: 'EUR' },
          days: [], assignments: {}, dayNotes: {}, places: [], categories: [], reservations: [], accommodations: [],
        }),
      ),
    );

    renderPublicTrip('1');

    await waitFor(() => {
      expect(screen.getByTestId('trip-title')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('budget-section')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// FE-PUB-TRIP-018: File count badge on place cards
// ---------------------------------------------------------------------------

describe('FE-PUB-TRIP-018: File count badge on place cards', () => {
  it('shows a file count badge on the card when place.files is non-empty', async () => {
    server.use(
      http.get('/api/public/trips/:id', () =>
        HttpResponse.json(
          buildTripWithPlace({
            files: [
              { id: 1, original_name: 'doc.pdf', mime_type: 'application/pdf', file_size: 1024 },
              { id: 2, original_name: 'photo.jpg', mime_type: 'image/jpeg', file_size: 2048 },
            ],
          }),
        ),
      ),
    );

    renderPublicTrip('42');

    await waitFor(() => expect(screen.getByText('Test Place')).toBeInTheDocument());

    const badge = screen.getByTestId('file-count-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('2');
  });

  it('does not render a file count badge when place.files is an empty array', async () => {
    server.use(
      http.get('/api/public/trips/:id', () =>
        HttpResponse.json(buildTripWithPlace({ files: [] })),
      ),
    );

    renderPublicTrip('42');

    await waitFor(() => expect(screen.getByText('Test Place')).toBeInTheDocument());

    expect(screen.queryByTestId('file-count-badge')).not.toBeInTheDocument();
  });

  it('does not render a file count badge when place.files is absent', async () => {
    server.use(
      http.get('/api/public/trips/:id', () =>
        HttpResponse.json(buildTripWithPlace({ files: undefined })),
      ),
    );

    renderPublicTrip('42');

    await waitFor(() => expect(screen.getByText('Test Place')).toBeInTheDocument());

    expect(screen.queryByTestId('file-count-badge')).not.toBeInTheDocument();
  });

  it('shows count of 1 correctly for a single file', async () => {
    server.use(
      http.get('/api/public/trips/:id', () =>
        HttpResponse.json(
          buildTripWithPlace({
            files: [{ id: 5, original_name: 'ticket.pdf', mime_type: 'application/pdf', file_size: 512 }],
          }),
        ),
      ),
    );

    renderPublicTrip('42');

    await waitFor(() => expect(screen.getByText('Test Place')).toBeInTheDocument());

    const badge = screen.getByTestId('file-count-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('1');
  });
});

// ---------------------------------------------------------------------------
// FE-PUB-TRIP-019: Per-place budget section in activity modal
// ---------------------------------------------------------------------------

describe('FE-PUB-TRIP-019: Per-place budget section in activity modal', () => {
  const tripWithPlaceBudget = {
    trip: { id: 42, title: 'Budget Modal Trip', start_date: null, end_date: null, cover_image: null, currency: 'EUR' },
    days: [{ id: 101, trip_id: 42, day_number: 1, date: '2026-07-01', title: 'Day 1' }],
    assignments: {
      '101': [
        {
          id: 201,
          day_id: 101,
          order_index: 0,
          notes: null,
          place: {
            id: 301,
            name: 'Eiffel Tower',
            description: null,
            lat: 48.8584,
            lng: 2.2945,
            address: null,
            category_id: null,
            place_time: null,
            end_time: null,
            duration_minutes: null,
            price: null,
            currency: null,
            website: null,
            phone: null,
            image_url: null,
            transport_mode: null,
            category: null,
            tags: [],
            files: [],
          },
        },
      ],
    },
    dayNotes: { '101': [] },
    places: [],
    categories: [],
    reservations: [],
    accommodations: [],
    budgetItems: [
      { id: 'b1', title: 'Entry ticket', category: 'Eiffel Tower', amount: 25, note: '', persons: 2, days: 1 },
      { id: 'b2', title: 'Audio guide', category: 'Eiffel Tower', amount: 5, note: '', persons: 2, days: 1 },
      { id: 'b3', title: 'Hotel', category: 'Accommodation', amount: 300, note: '', persons: 1, days: 3 },
    ],
    budgetSummary: { totalBudget: 330, currency: 'EUR' },
  };

  async function openBudgetModal() {
    renderPublicTrip('42');
    await waitFor(() => expect(screen.getAllByText('Eiffel Tower').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('Eiffel Tower')[0]);
    await waitFor(() => expect(screen.getByTestId('activity-modal')).toBeInTheDocument());
  }

  it('shows budget items matching the place name in the modal', async () => {
    server.use(
      http.get('/api/public/trips/:id', () => HttpResponse.json(tripWithPlaceBudget)),
    );

    await openBudgetModal();

    const modal = screen.getByTestId('activity-modal');
    expect(modal).toHaveTextContent('Budget');
    const items = modal.querySelectorAll('[data-testid="modal-budget-item"]');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Entry ticket');
    expect(items[0]).toHaveTextContent('25');
    expect(items[1]).toHaveTextContent('Audio guide');
    expect(items[1]).toHaveTextContent('5');
  });

  it('does not show budget items from other categories', async () => {
    server.use(
      http.get('/api/public/trips/:id', () => HttpResponse.json(tripWithPlaceBudget)),
    );

    await openBudgetModal();

    const modal = screen.getByTestId('activity-modal');
    expect(modal).not.toHaveTextContent('Hotel');
  });

  it('hides the budget section when no budget items match the place name', async () => {
    server.use(
      http.get('/api/public/trips/:id', () =>
        HttpResponse.json({
          ...tripWithPlaceBudget,
          budgetItems: [
            { id: 'b3', title: 'Hotel', category: 'Accommodation', amount: 300, note: '', persons: 1, days: 3 },
          ],
        }),
      ),
    );

    await openBudgetModal();

    const modal = screen.getByTestId('activity-modal');
    expect(modal.querySelectorAll('[data-testid="modal-budget-item"]')).toHaveLength(0);
    expect(modal).not.toHaveTextContent('Budget');
  });

  it('hides the budget section when budgetItems is absent from the response', async () => {
    server.use(
      http.get('/api/public/trips/:id', () =>
        HttpResponse.json({
          ...tripWithPlaceBudget,
          budgetItems: undefined,
          budgetSummary: undefined,
        }),
      ),
    );

    await openBudgetModal();

    const modal = screen.getByTestId('activity-modal');
    expect(modal.querySelectorAll('[data-testid="modal-budget-item"]')).toHaveLength(0);
  });

  it('renders budget amounts with the trip currency', async () => {
    server.use(
      http.get('/api/public/trips/:id', () => HttpResponse.json(tripWithPlaceBudget)),
    );

    await openBudgetModal();

    const modal = screen.getByTestId('activity-modal');
    const items = modal.querySelectorAll('[data-testid="modal-budget-item"]');
    expect(items[0]).toHaveTextContent('EUR');
    expect(items[1]).toHaveTextContent('EUR');
  });
});
