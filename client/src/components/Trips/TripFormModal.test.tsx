// FE-COMP-TRIPFORM-001 to FE-COMP-TRIPFORM-033 + FEE-001 to FEE-009
import { render, screen, waitFor, fireEvent } from '../../../tests/helpers/render';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useAuthStore } from '../../store/authStore';
import { useTripStore } from '../../store/tripStore';
import { resetAllStores, seedStore } from '../../../tests/helpers/store';
import { buildUser, buildTrip } from '../../../tests/helpers/factories';
import { server } from '../../../tests/helpers/msw/server';
import TripFormModal from './TripFormModal';

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  onSave: vi.fn(),
  trip: null,
  onCoverUpdate: vi.fn(),
};

beforeEach(() => {
  resetAllStores();
  seedStore(useAuthStore, { user: buildUser(), isAuthenticated: true });
  seedStore(useTripStore, { trip: buildTrip({ id: 1 }) });
});

describe('TripFormModal', () => {
  it('FE-COMP-TRIPFORM-001: renders without crashing', () => {
    render(<TripFormModal {...defaultProps} />);
    expect(document.body).toBeInTheDocument();
  });

  it('FE-COMP-TRIPFORM-002: shows Create New Trip title for new trip', () => {
    render(<TripFormModal {...defaultProps} trip={null} />);
    expect(screen.getAllByText('Create New Trip').length).toBeGreaterThan(0);
  });

  it('FE-COMP-TRIPFORM-003: shows Edit Trip title when editing', () => {
    const trip = buildTrip({ id: 1, title: 'Japan 2025' });
    render(<TripFormModal {...defaultProps} trip={trip} />);
    expect(screen.getByText('Edit Trip')).toBeInTheDocument();
  });

  it('FE-COMP-TRIPFORM-004: shows trip title input field', () => {
    render(<TripFormModal {...defaultProps} />);
    expect(screen.getByPlaceholderText(/Summer in Japan/i)).toBeInTheDocument();
  });

  it('FE-COMP-TRIPFORM-005: Cancel button is present', () => {
    render(<TripFormModal {...defaultProps} />);
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
  });

  it('FE-COMP-TRIPFORM-006: clicking Cancel calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TripFormModal {...defaultProps} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('FE-COMP-TRIPFORM-007: Create New Trip submit button is present', () => {
    render(<TripFormModal {...defaultProps} trip={null} />);
    // Submit button text is "Create New Trip" for new trips
    const createBtns = screen.getAllByText('Create New Trip');
    expect(createBtns.length).toBeGreaterThan(0);
  });

  it('FE-COMP-TRIPFORM-008: Update button shown when editing', () => {
    const trip = buildTrip({ id: 1, title: 'Japan 2025' });
    render(<TripFormModal {...defaultProps} trip={trip} />);
    expect(screen.getByRole('button', { name: /Update/i })).toBeInTheDocument();
  });

  it('FE-COMP-TRIPFORM-009: submitting with empty title shows error', async () => {
    const user = userEvent.setup();
    render(<TripFormModal {...defaultProps} />);
    // Click submit without filling title
    const submitBtn = screen.getAllByText('Create New Trip').find(
      el => el.tagName === 'BUTTON' || el.closest('button')
    );
    if (submitBtn) {
      await user.click(submitBtn.closest('button') || submitBtn);
    }
    // Error: "Title is required"
    await screen.findByText('Title is required');
  });

  it('FE-COMP-TRIPFORM-010: typing title and submitting calls onSave', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue({ trip: buildTrip({ id: 99 }) });
    render(<TripFormModal {...defaultProps} onSave={onSave} />);
    await user.type(screen.getByPlaceholderText(/Summer in Japan/i), 'Paris 2026');
    const submitBtns = screen.getAllByText('Create New Trip');
    const submitBtn = submitBtns.find(el => el.closest('button'));
    await user.click(submitBtn!.closest('button')!);
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'Paris 2026' }));
  });

  it('FE-COMP-TRIPFORM-011: pre-fills title when editing trip', () => {
    const trip = buildTrip({ id: 1, title: 'Iceland Adventure' });
    render(<TripFormModal {...defaultProps} trip={trip} />);
    expect(screen.getByDisplayValue('Iceland Adventure')).toBeInTheDocument();
  });

  it('FE-COMP-TRIPFORM-012: shows Title label', () => {
    render(<TripFormModal {...defaultProps} />);
    // dashboard.tripTitle = "Title"
    expect(screen.getByText('Title')).toBeInTheDocument();
  });

  it('FE-COMP-TRIPFORM-013: shows Cover Image section', () => {
    render(<TripFormModal {...defaultProps} />);
    expect(screen.getByText('Cover Image')).toBeInTheDocument();
  });

  it('FE-COMP-TRIPFORM-014: shows start and end date labels', () => {
    render(<TripFormModal {...defaultProps} />);
    // Uses CustomDatePicker with labels "Start Date" and "End Date"
    const startEls = screen.getAllByText('Start Date');
    const endEls = screen.getAllByText('End Date');
    expect(startEls.length).toBeGreaterThan(0);
    expect(endEls.length).toBeGreaterThan(0);
  });

  it('FE-COMP-TRIPFORM-015: renders date picker components for start and end', () => {
    const trip = buildTrip({ id: 1, title: 'Test Trip', start_date: '2026-06-01', end_date: '2026-06-15' });
    render(<TripFormModal {...defaultProps} trip={trip} />);
    // CustomDatePicker shows formatted dates as button text (locale-dependent)
    // Just verify labels and form render without error
    expect(screen.getByText('Start Date')).toBeInTheDocument();
    expect(screen.getByText('End Date')).toBeInTheDocument();
  });

  it('FE-COMP-TRIPFORM-016: end-date validation shows error when end < start', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    // Trip with end_date before start_date; title is set so title validation passes
    const trip = buildTrip({ id: 1, title: 'Test Trip', start_date: '2026-06-15', end_date: '2026-06-01' } as any);
    render(<TripFormModal {...defaultProps} trip={trip} onSave={onSave} />);
    const updateBtn = screen.getByRole('button', { name: /Update/i });
    await user.click(updateBtn);
    await screen.findByText('End date must be after start date');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('FE-COMP-TRIPFORM-017: day count field visible when no dates set', () => {
    render(<TripFormModal {...defaultProps} trip={null} />);
    expect(screen.getByText('Number of Days')).toBeInTheDocument();
  });

  it('FE-COMP-TRIPFORM-018: day count hidden when trip has dates', () => {
    const trip = buildTrip({ id: 1, start_date: '2026-06-01', end_date: '2026-06-10' });
    render(<TripFormModal {...defaultProps} trip={trip} />);
    expect(screen.queryByText('Number of Days')).not.toBeInTheDocument();
  });

  it('FE-COMP-TRIPFORM-019: reminder buttons visible when tripRemindersEnabled=true', async () => {
    seedStore(useAuthStore, { tripRemindersEnabled: true });
    render(<TripFormModal {...defaultProps} trip={null} />);
    expect(screen.getByRole('button', { name: 'None' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 day' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3 days' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '9 days' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Custom' })).toBeInTheDocument();
  });

  it('FE-COMP-TRIPFORM-020: reminder section shows disabled hint when tripRemindersEnabled=false', () => {
    seedStore(useAuthStore, { tripRemindersEnabled: false });
    render(<TripFormModal {...defaultProps} trip={null} />);
    expect(screen.getByText(/Trip reminders are disabled/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'None' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Custom' })).not.toBeInTheDocument();
  });

  it('FE-COMP-TRIPFORM-021: custom reminder input appears and accepts value', async () => {
    const user = userEvent.setup();
    seedStore(useAuthStore, { tripRemindersEnabled: true });
    render(<TripFormModal {...defaultProps} trip={null} />);
    await user.click(screen.getByRole('button', { name: 'Custom' }));
    // custom reminder input has max=30
    const customInput = document.querySelector('input[max="30"]') as HTMLInputElement;
    expect(customInput).toBeInTheDocument();
    // Use fireEvent.change to set the value directly (avoids clamping from char-by-char typing)
    fireEvent.change(customInput, { target: { value: '14' } });
    expect(customInput.value).toBe('14');
  });

  it('FE-COMP-TRIPFORM-022: member selector not visible when editing existing trip', () => {
    const trip = buildTrip({ id: 1 });
    render(<TripFormModal {...defaultProps} trip={trip} />);
    expect(screen.queryByText('Travel buddies')).not.toBeInTheDocument();
  });

  it('FE-COMP-TRIPFORM-023: member selector appears when creating and other users exist', async () => {
    server.use(
      http.get('/api/auth/users', () =>
        HttpResponse.json({ users: [{ id: 100, username: 'alice' }] })
      )
    );
    render(<TripFormModal {...defaultProps} trip={null} />);
    await screen.findByText('Travel buddies');
  });

  it('FE-COMP-TRIPFORM-024: selecting a member adds a chip', async () => {
    const user = userEvent.setup();
    seedStore(useAuthStore, { user: buildUser({ id: 1, username: 'me' }), isAuthenticated: true });
    server.use(
      http.get('/api/auth/users', () =>
        HttpResponse.json({ users: [{ id: 100, username: 'alice' }] })
      )
    );
    render(<TripFormModal {...defaultProps} trip={null} />);
    // Wait for member section to load
    await screen.findByText('Travel buddies');
    // Click the CustomSelect trigger (placeholder "Add member")
    const selectTrigger = screen.getByText('Add member').closest('button')!;
    await user.click(selectTrigger);
    // alice option appears in portal (document.body)
    const aliceOption = await screen.findByRole('button', { name: 'alice' });
    await user.click(aliceOption);
    // alice chip should now be in the member chip list
    expect(screen.getByText('alice')).toBeInTheDocument();
  });

  it('FE-COMP-TRIPFORM-025: removing a member chip deselects them', async () => {
    const user = userEvent.setup();
    seedStore(useAuthStore, { user: buildUser({ id: 1, username: 'me' }), isAuthenticated: true });
    server.use(
      http.get('/api/auth/users', () =>
        HttpResponse.json({ users: [{ id: 100, username: 'alice' }] })
      )
    );
    render(<TripFormModal {...defaultProps} trip={null} />);
    await screen.findByText('Travel buddies');
    // Select alice
    const selectTrigger = screen.getByText('Add member').closest('button')!;
    await user.click(selectTrigger);
    const aliceOption = await screen.findByRole('button', { name: 'alice' });
    await user.click(aliceOption);
    // alice chip is present
    const aliceChip = screen.getByText('alice');
    expect(aliceChip).toBeInTheDocument();
    // Click the chip to remove alice
    await user.click(aliceChip.closest('span')!);
    // alice chip should be gone
    await waitFor(() => expect(screen.queryByText('alice')).not.toBeInTheDocument());
  });

  it('FE-COMP-TRIPFORM-026: cover image paste fires URL.createObjectURL', async () => {
    const mockCreateObjectURL = vi.fn(() => 'blob:mock-paste-url');
    const original = URL.createObjectURL;
    Object.defineProperty(URL, 'createObjectURL', { writable: true, configurable: true, value: mockCreateObjectURL });

    render(<TripFormModal {...defaultProps} trip={null} />);
    const form = document.querySelector('form')!;
    const file = new File(['img'], 'cover.png', { type: 'image/png' });
    fireEvent.paste(form, {
      clipboardData: {
        items: [{ type: 'image/png', getAsFile: () => file }],
      },
    });
    expect(mockCreateObjectURL).toHaveBeenCalledWith(file);

    Object.defineProperty(URL, 'createObjectURL', { writable: true, configurable: true, value: original });
  });

  it('FE-COMP-TRIPFORM-027: onSave error message is displayed', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(new Error('Server error'));
    render(<TripFormModal {...defaultProps} onSave={onSave} trip={null} />);
    await user.type(screen.getByPlaceholderText(/Summer in Japan/i), 'My Trip');
    const submitBtns = screen.getAllByText('Create New Trip');
    const submitBtn = submitBtns.find(el => el.closest('button'))!;
    await user.click(submitBtn.closest('button')!);
    await screen.findByText('Server error');
  });

  it('FE-COMP-TRIPFORM-028: loading spinner shown while submitting', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockImplementation(() => new Promise(() => {}));
    render(<TripFormModal {...defaultProps} onSave={onSave} trip={null} />);
    await user.type(screen.getByPlaceholderText(/Summer in Japan/i), 'My Trip');
    const submitBtns = screen.getAllByText('Create New Trip');
    const submitBtn = submitBtns.find(el => el.closest('button'))!;
    await user.click(submitBtn.closest('button')!);
    await waitFor(() => expect(screen.getByText('Saving...')).toBeInTheDocument());
  });

  // ── Public visibility toggle (FE-COMP-TRIPFORM-029 to FE-COMP-TRIPFORM-033) ──

  it('FE-COMP-TRIPFORM-029: public visibility toggle renders for trip owner in edit mode', () => {
    seedStore(useAuthStore, { user: buildUser({ id: 1 }), isAuthenticated: true });
    const ownerTrip = { ...buildTrip({ id: 1, is_public: false }), user_id: 1 };
    render(<TripFormModal {...defaultProps} trip={ownerTrip as any} />);
    expect(screen.getByText('List this trip on the public page')).toBeInTheDocument();
    expect(screen.getByText('Anyone can view this trip without logging in.')).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: 'List this trip on the public page' });
    expect(toggle).toBeInTheDocument();
  });

  it('FE-COMP-TRIPFORM-030: public visibility toggle is NOT rendered for non-owner', () => {
    // non-owner: user_id = 999, currentUser.id = 1
    const nonOwnerTrip = { ...buildTrip({ id: 1 }), user_id: 999 };
    render(<TripFormModal {...defaultProps} trip={nonOwnerTrip as any} />);
    expect(screen.queryByRole('switch', { name: 'List this trip on the public page' })).not.toBeInTheDocument();
    expect(screen.queryByText('List this trip on the public page')).not.toBeInTheDocument();
  });

  it('FE-COMP-TRIPFORM-031: public visibility toggle is NOT rendered in create mode', () => {
    render(<TripFormModal {...defaultProps} trip={null} />);
    expect(screen.queryByRole('switch', { name: 'List this trip on the public page' })).not.toBeInTheDocument();
  });

  it('FE-COMP-TRIPFORM-032: toggling visibility calls PUT /api/trips/:id with is_public', async () => {
    seedStore(useAuthStore, { user: buildUser({ id: 1 }), isAuthenticated: true });
    const user = userEvent.setup();
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.put('/api/trips/:id', async ({ params, request }) => {
        capturedBody = await request.json() as Record<string, unknown>;
        const trip = buildTrip({ id: Number(params.id), ...capturedBody });
        return HttpResponse.json({ trip });
      })
    );
    const ownerTrip = { ...buildTrip({ id: 5, is_public: false }), user_id: 1 };
    render(<TripFormModal {...defaultProps} trip={ownerTrip as any} />);
    const toggle = screen.getByRole('switch', { name: 'List this trip on the public page' });
    await user.click(toggle);
    await waitFor(() => expect(capturedBody).not.toBeNull());
    expect(capturedBody).toMatchObject({ is_public: true });
  });

  it('FE-COMP-TRIPFORM-033: toggle reflects is_public=true state on load', () => {
    seedStore(useAuthStore, { user: buildUser({ id: 1 }), isAuthenticated: true });
    const ownerTrip = { ...buildTrip({ id: 1, is_public: true }), user_id: 1 };
    render(<TripFormModal {...defaultProps} trip={ownerTrip as any} />);
    const toggle = screen.getByRole('switch', { name: 'List this trip on the public page' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });
});

// ── Registration Fee Section tests ────────────────────────────────────────────

describe('Registration Fee section', () => {
  it('FEE-001: renders fee section with amount input', () => {
    render(<TripFormModal {...defaultProps} />);
    expect(screen.getByTestId('fee-section')).toBeInTheDocument();
    expect(screen.getByTestId('fee-amount-input')).toBeInTheDocument();
  });

  it('FEE-002: fee mode options hidden when fee amount is empty', () => {
    render(<TripFormModal {...defaultProps} />);
    expect(screen.queryByTestId('fee-mode-section')).not.toBeInTheDocument();
  });

  it('FEE-003: fee mode options appear when fee amount > 0', async () => {
    const user = userEvent.setup();
    render(<TripFormModal {...defaultProps} />);
    await user.type(screen.getByTestId('fee-amount-input'), '50');
    expect(screen.getByTestId('fee-mode-section')).toBeInTheDocument();
    expect(screen.getByTestId('fee-mode-deadline')).toBeInTheDocument();
    expect(screen.getByTestId('fee-mode-rsvp')).toBeInTheDocument();
  });

  it('FEE-004: deadline date picker appears only when deadline mode is selected', async () => {
    const user = userEvent.setup();
    render(<TripFormModal {...defaultProps} />);
    await user.type(screen.getByTestId('fee-amount-input'), '30');
    expect(screen.queryByTestId('fee-deadline-section')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('fee-mode-deadline'));
    expect(screen.getByTestId('fee-deadline-section')).toBeInTheDocument();
    expect(screen.getByTestId('fee-deadline-input')).toBeInTheDocument();
  });

  it('FEE-005: deadline date picker hidden when rsvp mode selected', async () => {
    const user = userEvent.setup();
    render(<TripFormModal {...defaultProps} />);
    await user.type(screen.getByTestId('fee-amount-input'), '30');
    await user.click(screen.getByTestId('fee-mode-deadline'));
    await user.click(screen.getByTestId('fee-mode-rsvp'));
    expect(screen.queryByTestId('fee-deadline-section')).not.toBeInTheDocument();
  });

  it('FEE-006: shows validation error when fee > 0 but no fee mode selected', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<TripFormModal {...defaultProps} onSave={onSave} />);
    await user.type(screen.getByPlaceholderText(/Summer in Japan/i), 'Test Trip');
    await user.type(screen.getByTestId('fee-amount-input'), '25');
    const submitBtn = screen.getAllByText('Create New Trip').find(el => el.closest('button'));
    await user.click(submitBtn!.closest('button')!);
    await waitFor(() => expect(screen.getByText(/please select a fee type/i)).toBeInTheDocument());
    expect(onSave).not.toHaveBeenCalled();
  });

  it('FEE-007: includes fee fields in onSave payload', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue({});
    render(<TripFormModal {...defaultProps} onSave={onSave} />);
    await user.type(screen.getByPlaceholderText(/Summer in Japan/i), 'Trip With Fee');
    await user.type(screen.getByTestId('fee-amount-input'), '50');
    await user.click(screen.getByTestId('fee-mode-rsvp'));
    const submitBtn = screen.getAllByText('Create New Trip').find(el => el.closest('button'));
    await user.click(submitBtn!.closest('button')!);
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      registration_fee: 50,
      fee_mode: 'rsvp',
      fee_deadline: null,
    }));
  });

  it('FEE-008: loads existing fee data from trip prop', () => {
    const trip = { ...buildTrip({ id: 5 }), user_id: 1, registration_fee: 99, fee_mode: 'deadline', fee_deadline: '2027-12-31' };
    render(<TripFormModal {...defaultProps} trip={trip as any} />);
    expect((screen.getByTestId('fee-amount-input') as HTMLInputElement).value).toBe('99');
    expect((screen.getByTestId('fee-mode-deadline') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('fee-deadline-input') as HTMLInputElement).value).toBe('2027-12-31');
  });

  it('FEE-009: clears fee mode and deadline when fee amount is cleared', async () => {
    const user = userEvent.setup();
    render(<TripFormModal {...defaultProps} />);
    await user.type(screen.getByTestId('fee-amount-input'), '50');
    await user.click(screen.getByTestId('fee-mode-rsvp'));
    expect(screen.getByTestId('fee-mode-section')).toBeInTheDocument();
    await user.clear(screen.getByTestId('fee-amount-input'));
    expect(screen.queryByTestId('fee-mode-section')).not.toBeInTheDocument();
  });
});
