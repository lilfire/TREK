import { render, screen } from '../../../tests/helpers/render'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import UnplannedActivitiesSection from '../UnplannedActivitiesSection'

const tMock = (key: string) => {
  const map: Record<string, string> = {
    'publicTrip.unplanned.heading': 'Ideas & Unplanned',
    'publicTrip.unplanned.subheading': 'Places added to this trip but not yet scheduled.',
  }
  return map[key] ?? key
}

const makePlaces = (overrides: Partial<{
  id: string
  name: string
  category_name: string | null
  category_color: string | null
  address: string | null
  description: string | null
  image_url: string | null
}>[]) =>
  overrides.map((o, i) => ({
    id: o.id ?? `place-${i}`,
    name: o.name ?? `Place ${i}`,
    category_name: o.category_name ?? null,
    category_color: o.category_color ?? null,
    address: o.address ?? null,
    description: o.description ?? null,
    image_url: o.image_url ?? null,
  }))

describe('UnplannedActivitiesSection', () => {
  it('FE-COMP-UAS-001: renders section with one item when one unplanned place is provided', () => {
    const places = makePlaces([{ id: 'p1', name: 'Eiffel Tower', category_name: 'Attractions' }])
    const onSelect = vi.fn()

    render(
      <UnplannedActivitiesSection
        unplannedPlaces={places}
        onSelect={onSelect}
        t={tMock}
        locale="en"
      />
    )

    expect(screen.getByTestId('unplanned-activities')).toBeTruthy()
    expect(screen.getByTestId('unplanned-activity-p1')).toBeTruthy()
    expect(screen.getByText('Eiffel Tower')).toBeTruthy()
  })

  it('FE-COMP-UAS-002: renders nothing when unplannedPlaces is empty (section hidden by parent)', () => {
    const onSelect = vi.fn()

    const { container } = render(
      <UnplannedActivitiesSection
        unplannedPlaces={[]}
        onSelect={onSelect}
        t={tMock}
        locale="en"
      />
    )

    // Section element still mounts but the parent conditionally renders it;
    // confirm no activity rows are present
    expect(container.querySelectorAll('[data-testid^="unplanned-activity-"]')).toHaveLength(0)
  })

  it('FE-COMP-UAS-003: clicking a row calls onSelect with the correct place wrapped in { place }', async () => {
    const user = userEvent.setup()
    const place = makePlaces([{ id: 'p42', name: 'Louvre Museum', category_name: 'Museums' }])[0]
    const onSelect = vi.fn()

    render(
      <UnplannedActivitiesSection
        unplannedPlaces={[place]}
        onSelect={onSelect}
        t={tMock}
        locale="en"
      />
    )

    await user.click(screen.getByTestId('unplanned-activity-p42'))

    expect(onSelect).toHaveBeenCalledOnce()
    expect(onSelect).toHaveBeenCalledWith({ place })
  })

  it('FE-COMP-UAS-004: renders items in the order received (sorted alpha by category, nulls last)', () => {
    const sorted = makePlaces([
      { id: 'pa', name: 'Art Museum',   category_name: 'Arts' },
      { id: 'pb', name: 'City Zoo',     category_name: 'Zoos' },
      { id: 'pc', name: 'Night Market', category_name: null },
    ])
    const onSelect = vi.fn()

    render(
      <UnplannedActivitiesSection
        unplannedPlaces={sorted}
        onSelect={onSelect}
        t={tMock}
        locale="en"
      />
    )

    const rows = screen.getAllByRole('button', { name: (n) => n.trim() !== '' })
    const names = rows.map(r => r.textContent ?? '')

    // Arts → Zoos → null (last)
    const artsIdx  = names.findIndex(n => n.includes('Art Museum'))
    const zoosIdx  = names.findIndex(n => n.includes('City Zoo'))
    const nightIdx = names.findIndex(n => n.includes('Night Market'))

    expect(artsIdx).toBeGreaterThanOrEqual(0)
    expect(zoosIdx).toBeGreaterThan(artsIdx)
    expect(nightIdx).toBeGreaterThan(zoosIdx)
  })

  it('FE-COMP-UAS-005: rows do not display any time text', () => {
    const places = makePlaces([
      { id: 'p1', name: 'Café du Marché', category_name: 'Food' },
      { id: 'p2', name: 'Park des Arts',  category_name: 'Parks' },
    ])
    const onSelect = vi.fn()

    render(
      <UnplannedActivitiesSection
        unplannedPlaces={places}
        onSelect={onSelect}
        t={tMock}
        locale="en"
      />
    )

    const section = screen.getByTestId('unplanned-activities')
    // No time-formatted strings (HH:MM pattern) should appear anywhere in the section
    expect(section.textContent).not.toMatch(/\d{1,2}:\d{2}/)
    // No Clock SVG title or aria-label for time
    expect(section.querySelector('[aria-label*="time"], [aria-label*="clock"]')).toBeNull()
  })
})
