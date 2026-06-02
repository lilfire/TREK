import { render, screen, within } from '../../../tests/helpers/render'
import { vi } from 'vitest'
import PublicActivityModal from '../PublicActivityModal'

function makeAssignment(overrides: Partial<{ name: string; budget_category: string | null }> = {}) {
  return {
    id: 'a1',
    place: {
      id: 'p1',
      name: overrides.name ?? 'Hotel Paris',
      budget_category: overrides.budget_category ?? null,
      category: { name: 'Lodging', color: '#000' },
      address: null,
      description: null,
      notes: null,
      files: [],
    },
  }
}

function makeBudgetItem(overrides: Partial<{
  id: number
  category: string
  title: string
  amount: number
  category_currency: string | null | undefined
}> = {}) {
  return {
    id: overrides.id ?? 1,
    category: overrides.category ?? 'Hotel Paris',
    title: overrides.title ?? 'Room rate',
    amount: overrides.amount ?? 1200,
    category_currency: overrides.category_currency,
  }
}

// Text inside the amount span is split across React text nodes ("1,200", " ", "USD"),
// so use the parent's collapsed textContent for the assertion.
function amountText(row: HTMLElement): string {
  return (row.textContent ?? '').replace(/\s+/g, ' ').trim()
}

describe('PublicActivityModal — per-category currency display (LSO-1604)', () => {
  it('FE-COMP-PAM-CUR-001: renders item with category_currency when set', () => {
    const assignment = makeAssignment({ name: 'Hotel Paris' })
    const items = [makeBudgetItem({ id: 1, category: 'Hotel Paris', title: 'Room', amount: 1200, category_currency: 'USD' })]
    render(
      <PublicActivityModal
        assignment={assignment}
        tripCurrency="NOK"
        budgetItems={items}
        onClose={vi.fn()}
      />
    )

    const rows = screen.getAllByTestId('modal-budget-item')
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(within(row).getByText('Room')).toBeTruthy()
    expect(amountText(row)).toContain('1,200 USD')
    expect(amountText(row)).not.toContain('NOK')
  })

  it('FE-COMP-PAM-CUR-002: falls back to tripCurrency when category_currency is undefined', () => {
    const assignment = makeAssignment({ name: 'Hotel Paris' })
    const items = [makeBudgetItem({ id: 1, category: 'Hotel Paris', title: 'Room', amount: 500, category_currency: undefined })]
    render(
      <PublicActivityModal
        assignment={assignment}
        tripCurrency="NOK"
        budgetItems={items}
        onClose={vi.fn()}
      />
    )

    const row = screen.getByTestId('modal-budget-item')
    expect(amountText(row)).toContain('500 NOK')
  })

  it('FE-COMP-PAM-CUR-003: falls back to tripCurrency when category_currency is null', () => {
    const assignment = makeAssignment({ name: 'Hotel Paris' })
    const items = [makeBudgetItem({ id: 1, category: 'Hotel Paris', title: 'Room', amount: 750, category_currency: null })]
    render(
      <PublicActivityModal
        assignment={assignment}
        tripCurrency="EUR"
        budgetItems={items}
        onClose={vi.fn()}
      />
    )

    const row = screen.getByTestId('modal-budget-item')
    expect(amountText(row)).toContain('750 EUR')
  })

  it('FE-COMP-PAM-CUR-004: renders mixed items each with its own resolved currency', () => {
    const assignment = makeAssignment({ name: 'Hotel Paris' })
    const items = [
      makeBudgetItem({ id: 1, category: 'Hotel Paris', title: 'Room', amount: 1200, category_currency: 'USD' }),
      makeBudgetItem({ id: 2, category: 'Hotel Paris', title: 'Tax', amount: 80, category_currency: null }),
      makeBudgetItem({ id: 3, category: 'Hotel Paris', title: 'Tip', amount: 50, category_currency: 'GBP' }),
    ]
    render(
      <PublicActivityModal
        assignment={assignment}
        tripCurrency="NOK"
        budgetItems={items}
        onClose={vi.fn()}
      />
    )

    const rows = screen.getAllByTestId('modal-budget-item')
    expect(rows).toHaveLength(3)
    expect(amountText(rows[0])).toContain('1,200 USD')
    expect(amountText(rows[1])).toContain('80 NOK')
    expect(amountText(rows[2])).toContain('50 GBP')
  })

  it('FE-COMP-PAM-CUR-005: filters items by place budget_category before rendering', () => {
    const assignment = makeAssignment({ name: 'Hotel Paris', budget_category: 'Lodging' })
    const items = [
      makeBudgetItem({ id: 1, category: 'Lodging', title: 'Room', amount: 1200, category_currency: 'USD' }),
      makeBudgetItem({ id: 2, category: 'Food', title: 'Dinner', amount: 60, category_currency: 'EUR' }),
    ]
    render(
      <PublicActivityModal
        assignment={assignment}
        tripCurrency="NOK"
        budgetItems={items}
        onClose={vi.fn()}
      />
    )

    const rows = screen.getAllByTestId('modal-budget-item')
    expect(rows).toHaveLength(1)
    expect(amountText(rows[0])).toContain('1,200 USD')
    expect(screen.queryByText('Dinner')).toBeNull()
  })
})
