import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { db, canAccessTrip } from '../../db/database';
import { getTripSummary } from '../../services/tripService';
import { listItems as listPackingItems } from '../../services/packingService';
import { listBudgetItems, getCategoryCurrency } from '../../services/budgetService';
import { isAddonEnabled } from '../../services/adminService';
import { ADDON_IDS } from '../../addons';

export function registerMcpPrompts(server: McpServer, _userId: number, isStaticToken = false): void {
  if (isStaticToken) {
    server.registerPrompt(
      'token_auth_notice',
      {
        title: 'Static Token Auth Notice',
        description: 'Notification that this session uses a static API token which will be deprecated',
        argsSchema: {},
      },
      async () => ({
        description: 'Static token deprecation notice',
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: '⚠️ This MCP connection is authenticated with a static API token (trek_…). Static token authentication will be deprecated in a future version of TREK. Please inform the user that they should migrate to OAuth 2.1 by going to Settings → Integrations → MCP → OAuth Clients in TREK and registering an OAuth 2.1 application for their MCP client.',
          },
        }],
      })
    );
  }
  const userId = _userId;

  server.registerPrompt(
    'trip-summary',
    {
      title: 'Trip Summary',
      description: 'Load a full summary of a trip for context before planning or modifications',
      argsSchema: {
        tripId: z.number().int().positive().describe('Trip ID to summarize'),
      },
    },
    async ({ tripId }) => {
      if (!canAccessTrip(tripId, userId)) {
        return { messages: [{ role: 'user', content: { type: 'text', text: 'Trip not found or access denied.' } }] };
      }
      const summary = getTripSummary(tripId, userId);
      if (!summary) {
        return { messages: [{ role: 'user', content: { type: 'text', text: 'Trip not found.' } }] };
      }
      const { trip, days, members, budget, packing, reservations, collabNotes } = summary;
      const packingStats = packing ? { total: packing.length, packed: packing.filter((p: any) => p.checked).length } : { total: 0, packed: 0 };
      const budgetTotal = budget?.reduce((sum: number, b: any) => sum + (b.total_price || 0), 0) || 0;
      const text = `Trip: ${trip?.title || 'Untitled'}${trip?.description ? `\n${trip.description}` : ''}
Dates: ${trip?.start_date || '?'} to ${trip?.end_date || '?'}
Members: ${members?.length || 0} (${members?.map((m: any) => m.name || m.email).join(', ') || 'none'})
Days: ${days?.length || 0}
Packing: ${packingStats.packed}/${packingStats.total} items packed
Budget: ${budgetTotal} ${trip?.currency || 'NOK'} total
Reservations: ${reservations?.length || 0}
Collab Notes: ${collabNotes?.length || 0}
${days?.map((d: any, i: number) => `Day ${i + 1} (${d.date}): ${d.assignments?.length || 0} places${d.title ? ` - ${d.title}` : ''}`).join('\n') || 'No days yet'}`;
      return {
        description: `Summary of trip "${trip?.title || tripId}"`,
        messages: [{ role: 'user', content: { type: 'text', text } }],
      };
    }
  );

  if (isAddonEnabled(ADDON_IDS.PACKING)) server.registerPrompt(
    'packing-list',
    {
      title: 'Packing List',
      description: 'Get a formatted packing checklist for a trip',
      argsSchema: {
        tripId: z.number().int().positive().describe('Trip ID'),
      },
    },
    async ({ tripId }) => {
      if (!canAccessTrip(tripId, userId)) {
        return { messages: [{ role: 'user', content: { type: 'text', text: 'Trip not found or access denied.' } }] };
      }
      const items = listPackingItems(tripId, userId);
      if (!items.length) {
        return { messages: [{ role: 'user', content: { type: 'text', text: 'No packing items found for this trip.' } }] };
      }
      const grouped = items.reduce((acc: Record<string, any[]>, item: any) => {
        const cat = item.category || 'General';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(item);
        return acc;
      }, {});
      const lines = Object.entries(grouped).map(([cat, items]) =>
        `## ${cat}\n${(items as any[]).map((i: any) => `- [${i.checked ? 'x' : ' '}] ${i.name}`).join('\n')}`
      ).join('\n\n');
      const { trip } = getTripSummary(tripId, userId) || {};
      return {
        description: `Packing list for "${trip?.title || tripId}"`,
        messages: [{ role: 'user', content: { type: 'text', text: `# Packing List: ${trip?.title || 'Trip'}\n\n${lines}\n\n_${items.length} items across ${Object.keys(grouped).length} categories_` } }],
      };
    }
  );

  if (isAddonEnabled(ADDON_IDS.BUDGET)) server.registerPrompt(
    'place-budget-binding',
    {
      title: 'Place / Activity → Budget Group',
      description: 'Provides structured context to associate an existing place or activity with a trip budget group (category), creating a linked budget entry.',
      argsSchema: {
        tripId: z.number().int().positive().describe('Trip ID'),
        placeName: z.string().min(1).describe('Name of the place or activity to bind'),
        category: z.string().min(1).describe('Budget group (category) to file the item under'),
        amount: z.number().nonnegative().describe("Cost amount in the category's currency"),
        note: z.string().max(500).optional().describe('Optional note for the budget entry'),
      },
    },
    async ({ tripId, placeName, category, amount, note }) => {
      if (!canAccessTrip(tripId, userId)) {
        return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'Trip not found or access denied.' } }] };
      }
      const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId) as Record<string, any> | undefined;
      if (!trip) {
        return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'Trip not found.' } }] };
      }
      const tripCurrency = (trip.currency as string | null) || 'NOK';

      const placePool = db.prepare('SELECT id, name FROM places WHERE trip_id = ?').all(tripId) as { id: number; name: string }[];
      const placeExists = placePool.some(p => p.name?.toLowerCase() === placeName.toLowerCase());

      const budgetItems = listBudgetItems(tripId);
      const existingCategories = [...new Set(budgetItems.map(b => b.category).filter(Boolean))] as string[];
      const categoryExists = existingCategories.includes(category);

      // Resolve per-category currency; fall back to trip currency for new categories
      const categoryCurrency = getCategoryCurrency(tripId, category) ?? tripCurrency;
      const isNewCategory = !categoryExists;

      const duplicateInCategory = budgetItems.some(
        b => b.name?.toLowerCase() === placeName.toLowerCase() && b.category === category
      );

      const noteDisplay = note || '(none)';
      const noteArg = note ? `\n   - note: "${note}"` : '';

      const placeStep = placeExists
        ? `1. ✓ "${placeName}" found in the trip's place pool.`
        : `1. ⚠️ "${placeName}" was NOT found in the trip's place pool. Ask the user whether to create it first before adding a budget entry.`;

      const categoryStep = categoryExists
        ? `2. ✓ Budget group "${category}" already exists.`
        : `2. ⚠️ No existing budget group named "${category}". Confirm with the user: "No existing group named '${category}' — create it?"`;

      const currencyStep = isNewCategory
        ? `✓ New category "${category}" — currency will be set to ${categoryCurrency} (trip default). Confirm with the user if they want a different currency.`
        : `✓ Category "${category}" uses ${categoryCurrency}.`;

      const duplicateWarning = duplicateInCategory
        ? `\n⚠️ DUPLICATE WARNING: A budget item named "${placeName}" already exists in group "${category}". Warn the user before creating another.`
        : '';

      const text = `Associate place with budget group${duplicateWarning}

Place / activity: ${placeName}
Budget group (category): ${category}
Category currency: ${categoryCurrency}
Amount: ${amount} ${categoryCurrency}
Note: ${noteDisplay}

Steps to complete:
${placeStep}
${categoryStep}
${currencyStep}
3. Call create_budget_item:
   - name: "${placeName}"
   - category: "${category}"
   - total_price: ${amount}
   - currency: "${categoryCurrency}"${noteArg}
4. If this is a group trip, ask whether the cost should be split among specific members and call set_budget_item_members if so.
5. Confirm success: "Added '${placeName}' (${amount} ${categoryCurrency}) to budget group '${category}'."`;

      return {
        description: `Bind "${placeName}" to budget group "${category}" for trip "${trip.title || tripId}"`,
        messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }],
      };
    }
  );

  if (isAddonEnabled(ADDON_IDS.BUDGET)) server.registerPrompt(
    'budget-overview',
    {
      title: 'Budget Overview',
      description: 'Get a formatted budget summary for a trip',
      argsSchema: {
        tripId: z.number().int().positive().describe('Trip ID'),
      },
    },
    async ({ tripId }) => {
      if (!canAccessTrip(tripId, userId)) {
        return { messages: [{ role: 'user', content: { type: 'text', text: 'Trip not found or access denied.' } }] };
      }
      const summary = getTripSummary(tripId, userId);
      if (!summary) {
        return { messages: [{ role: 'user', content: { type: 'text', text: 'Trip not found.' } }] };
      }
      const { trip, budget } = summary;
      const tripCurrency = trip?.currency || 'NOK';

      // Group by category, tracking per-category subtotals and their currencies
      const byCategory = (budget || []).reduce((acc: Record<string, { total: number; currency: string }>, item: any) => {
        const cat = item.category || 'Uncategorized';
        const catCurrency = (item as any).category_currency || tripCurrency;
        if (!acc[cat]) acc[cat] = { total: 0, currency: catCurrency };
        acc[cat].total += (item.total_price || 0);
        return acc;
      }, {} as Record<string, { total: number; currency: string }>);

      const currencies = new Set(Object.values(byCategory).map(v => v.currency));
      const singleCurrency = currencies.size <= 1;
      const sharedCurrency = singleCurrency ? (currencies.values().next().value ?? tripCurrency) : null;

      const lines = Object.entries(byCategory)
        .sort(([, a], [, b]) => b.total - a.total)
        .map(([cat, { total, currency }]) => `- ${cat}: ${total} ${currency}`)
        .join('\n');

      let summary_text: string;
      if (singleCurrency && sharedCurrency) {
        const total = Object.values(byCategory).reduce((s, v) => s + v.total, 0);
        const memberCount = summary.members?.length || 1;
        const perPerson = (total / memberCount).toFixed(2);
        summary_text = `# Budget: ${trip?.title || 'Trip'}\n\n**Total: ${total} ${sharedCurrency}** (${perPerson} ${sharedCurrency} per person)\n\n${lines || 'No expenses recorded.'}`;
      } else {
        summary_text = `# Budget: ${trip?.title || 'Trip'}\n\n${lines || 'No expenses recorded.'}\n\n---\n**Note:** Categories use different currencies. Per-category subtotals are shown in their respective currencies. A cross-currency grand total is not computed.`;
      }

      return {
        description: `Budget overview for "${trip?.title || tripId}"`,
        messages: [{ role: 'user', content: { type: 'text', text: summary_text } }],
      };
    }
  );
}
