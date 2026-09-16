// FE-COMP-TIER-EDITOR-001 to 006
import { render, screen, waitFor, fireEvent } from '../../../tests/helpers/render';
import { http, HttpResponse } from 'msw';
import { resetAllStores, seedStore } from '../../../tests/helpers/store';
import { buildUser } from '../../../tests/helpers/factories';
import { useAuthStore } from '../../store/authStore';
import { server } from '../../../tests/helpers/msw/server';
import AccommodationTierEditor from './AccommodationTierEditor';

const tierBase = {
  trip_id: 7, place_id: null, price_per_person: null, description: null,
  place_name: null, place_address: null, place_lat: null, place_lng: null, place_image_url: null, place_website: null,
};

function statusWith(tiers: any[], count = 3) {
  return { participant_count: count, active_tier_id: tiers.find(t => t.is_active)?.id ?? null, next_tier: null, tiers };
}

beforeEach(() => {
  resetAllStores();
  seedStore(useAuthStore, { user: buildUser(), isAuthenticated: true });
  server.use(
    http.get('/api/trips/:id/places', () => HttpResponse.json({ places: [{ id: 301, name: 'Fjellro' }] })),
  );
});

describe('AccommodationTierEditor', () => {
  it('FE-COMP-TIER-EDITOR-001: lists existing tiers with range, place, price and status', async () => {
    server.use(http.get('/api/trips/:id/accommodation-tiers', () => HttpResponse.json(statusWith([
      { ...tierBase, id: 1, name: 'Cabin', min_participants: 1, max_participants: 9, is_active: true, is_reached: true, place_id: 301, place_name: 'Fjellro', price_per_person: 900 },
      { ...tierBase, id: 2, name: 'Hotel', min_participants: 10, max_participants: null, is_active: false, is_reached: false },
    ]))));

    render(<AccommodationTierEditor tripId={7} currency="NOK" />);

    await waitFor(() => expect(screen.getByTestId('tier-row-1')).toBeInTheDocument());
    expect(screen.getByTestId('tier-row-1')).toHaveTextContent('1–9');
    expect(screen.getByTestId('tier-row-1')).toHaveTextContent('Fjellro · 900 NOK');
    expect(screen.getByTestId('tier-row-2')).toHaveTextContent('10+');
    expect(screen.getByTestId('tier-editor-status')).toHaveTextContent('3 confirmed · current: Cabin');
  });

  it('FE-COMP-TIER-EDITOR-002: adding a tier posts the payload and renders the returned status', async () => {
    let body: any = null;
    server.use(
      http.get('/api/trips/:id/accommodation-tiers', () => HttpResponse.json(statusWith([]))),
      http.post('/api/trips/:id/accommodation-tiers', async ({ request }) => {
        body = await request.json();
        const tier = { ...tierBase, id: 5, name: body.name, min_participants: body.min_participants, price_per_person: body.price_per_person };
        return HttpResponse.json({ tier, status: statusWith([{ ...tier, max_participants: null, is_active: true, is_reached: true }]) }, { status: 201 });
      }),
    );

    render(<AccommodationTierEditor tripId={7} currency="NOK" />);

    fireEvent.click(await screen.findByTestId('tier-add'));
    expect(screen.getByTestId('tier-min-input')).toHaveValue(1);
    fireEvent.change(screen.getByTestId('tier-name-input'), { target: { value: 'Cabin' } });
    fireEvent.change(screen.getByTestId('tier-min-input'), { target: { value: '4' } });
    fireEvent.change(screen.getByTestId('tier-price-input'), { target: { value: '750' } });
    fireEvent.click(screen.getByTestId('tier-save'));

    await waitFor(() => expect(screen.getByTestId('tier-row-5')).toBeInTheDocument());
    expect(body).toEqual({ name: 'Cabin', min_participants: 4, place_id: null, price_per_person: 750, description: null });
    expect(screen.queryByTestId('tier-form')).not.toBeInTheDocument();
  });

  it('FE-COMP-TIER-EDITOR-003: validates name and min participants client-side', async () => {
    const post = vi.fn();
    server.use(
      http.get('/api/trips/:id/accommodation-tiers', () => HttpResponse.json(statusWith([]))),
      http.post('/api/trips/:id/accommodation-tiers', () => { post(); return HttpResponse.json({}); }),
    );

    render(<AccommodationTierEditor tripId={7} currency="NOK" />);
    fireEvent.click(await screen.findByTestId('tier-add'));
    fireEvent.click(screen.getByTestId('tier-save'));
    expect(screen.getByText('Name is required')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('tier-name-input'), { target: { value: 'Cabin' } });
    fireEvent.change(screen.getByTestId('tier-min-input'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('tier-save'));
    expect(screen.getByText('Participants must be a whole number of at least 1')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('FE-COMP-TIER-EDITOR-004: shows the server error (e.g. duplicate threshold)', async () => {
    server.use(
      http.get('/api/trips/:id/accommodation-tiers', () => HttpResponse.json(statusWith([]))),
      http.post('/api/trips/:id/accommodation-tiers', () =>
        HttpResponse.json({ error: 'Another tier already starts at this min_participants' }, { status: 400 })),
    );

    render(<AccommodationTierEditor tripId={7} currency="NOK" />);
    fireEvent.click(await screen.findByTestId('tier-add'));
    fireEvent.change(screen.getByTestId('tier-name-input'), { target: { value: 'Cabin' } });
    fireEvent.click(screen.getByTestId('tier-save'));

    expect(await screen.findByText('Another tier already starts at this min_participants')).toBeInTheDocument();
    expect(screen.getByTestId('tier-form')).toBeInTheDocument();
  });

  it('FE-COMP-TIER-EDITOR-005: editing prefills the form and sends PUT', async () => {
    let body: any = null;
    const tier = { ...tierBase, id: 1, name: 'Cabin', min_participants: 2, max_participants: null, is_active: true, is_reached: true, price_per_person: 500 };
    server.use(
      http.get('/api/trips/:id/accommodation-tiers', () => HttpResponse.json(statusWith([tier]))),
      http.put('/api/trips/:id/accommodation-tiers/:tierId', async ({ request }) => {
        body = await request.json();
        const updated = { ...tier, ...body };
        return HttpResponse.json({ tier: updated, status: statusWith([updated]) });
      }),
    );

    render(<AccommodationTierEditor tripId={7} currency="NOK" />);
    await waitFor(() => expect(screen.getByTestId('tier-row-1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.getByTestId('tier-name-input')).toHaveValue('Cabin');
    expect(screen.getByTestId('tier-price-input')).toHaveValue(500);
    fireEvent.change(screen.getByTestId('tier-name-input'), { target: { value: 'Big cabin' } });
    fireEvent.click(screen.getByTestId('tier-save'));

    await waitFor(() => expect(screen.getByTestId('tier-row-1')).toHaveTextContent('Big cabin'));
    expect(body).toMatchObject({ name: 'Big cabin', min_participants: 2, price_per_person: 500 });
  });

  it('FE-COMP-TIER-EDITOR-006: deleting asks for confirmation and removes the row', async () => {
    const tier = { ...tierBase, id: 1, name: 'Cabin', min_participants: 1, max_participants: null, is_active: true, is_reached: true };
    server.use(
      http.get('/api/trips/:id/accommodation-tiers', () => HttpResponse.json(statusWith([tier]))),
      http.delete('/api/trips/:id/accommodation-tiers/:tierId', () => HttpResponse.json({ success: true, status: statusWith([]) })),
    );
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<AccommodationTierEditor tripId={7} currency="NOK" />);
    await waitFor(() => expect(screen.getByTestId('tier-row-1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(confirmSpy).toHaveBeenCalledWith('Delete tier "Cabin"?');
    await waitFor(() => expect(screen.queryByTestId('tier-row-1')).not.toBeInTheDocument());
    confirmSpy.mockRestore();
  });
});
