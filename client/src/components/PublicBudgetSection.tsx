interface BudgetItem {
  id: string
  title: string
  category: string
  amount: number
  note: string
  persons: number
  days: number
}

interface BudgetSummary {
  totalBudget: number
  currency: string
}

interface Props {
  budgetItems?: BudgetItem[]
  budgetSummary?: BudgetSummary
}

function formatAmount(n: number): string {
  return n.toLocaleString('en', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

export default function PublicBudgetSection({ budgetItems, budgetSummary }: Props) {
  if (!budgetItems || budgetItems.length === 0) return null

  const currency = budgetSummary?.currency ?? ''

  return (
    <section data-testid="budget-section" aria-label="Budget" className="mb-6">
      <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">Budget</h2>

      {budgetSummary && (
        <div
          data-testid="budget-total"
          className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 mb-3 flex items-center justify-between"
        >
          <span className="text-sm text-zinc-500 dark:text-zinc-400">Total</span>
          <span className="text-base font-semibold text-zinc-900 dark:text-white">
            {formatAmount(budgetSummary.totalBudget)} {currency}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {budgetItems.map(item => (
          <div
            key={item.id}
            data-testid="budget-item"
            className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 flex items-center gap-3"
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-zinc-900 dark:text-white truncate">
                {item.title}
              </div>
              {item.category && (
                <span className="inline-block mt-0.5 text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                  {item.category}
                </span>
              )}
            </div>
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300 flex-shrink-0">
              {formatAmount(item.amount)} {currency}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
