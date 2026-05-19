import { http, HttpResponse } from 'msw';

const publicTrip = {
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
    { id: 102, trip_id: 42, day_number: 2, date: '2026-07-02', title: 'Sightseeing' },
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
          description: 'Iconic landmark',
          lat: 48.8584,
          lng: 2.2945,
          address: 'Champ de Mars, Paris',
          category_id: null,
          place_time: '10:00',
          end_time: '12:00',
          image_url: null,
          transport_mode: null,
          category: null,
          tags: [],
        },
      },
    ],
    '102': [],
  },
  dayNotes: {
    '101': [],
    '102': [{ id: 401, day_id: 102, text: 'Pack light', time: null, sort_order: 0 }],
  },
  places: [],
  categories: [],
  reservations: [],
  accommodations: [],
};

export const publicTripsHandlers = [
  http.get('/api/public/trips/:id', ({ params }) => {
    const { id } = params;

    if (id === '999' || id === 'not-found') {
      return new HttpResponse(null, { status: 404 });
    }

    return HttpResponse.json(publicTrip);
  }),
];
