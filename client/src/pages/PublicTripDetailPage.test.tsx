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

    it('files render as metadata-only rows — no img thumbnails or download anchors', async () => {
      server.use(
        http.get('/api/public/trips/:id', () => HttpResponse.json(tripWithFiles)),
      );

      renderPublicTrip('42');
      await waitFor(() => expect(screen.getByText('Eiffel Tower')).toBeInTheDocument());
      fireEvent.click(screen.getAllByText('Eiffel Tower')[0]);
      await waitFor(() => expect(screen.getByTestId('activity-modal')).toBeInTheDocument());

      const modal = screen.getByTestId('activity-modal');

      // No <img> rendered for file entries
      expect(modal.querySelector('img[alt="tower-photo.jpg"]')).toBeNull();
      expect(modal.querySelector('img[alt="entry-info.pdf"]')).toBeNull();

      // No <a> elements pointing at file download paths
      expect(modal.querySelectorAll('a[href*="/files/"]')).toHaveLength(0);

      // Filenames appear as plain text
      expect(screen.getByText('tower-photo.jpg')).toBeInTheDocument();
      expect(screen.getByText('entry-info.pdf')).toBeInTheDocument();
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
