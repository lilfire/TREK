import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { canAccessTrip, db } from '../../db/database';
import { isDemoUser } from '../../services/authService';
import {
  createBudgetItem, updateBudgetItem, deleteBudgetItem,
  updateMembers as updateBudgetMembers,
  toggleMemberPaid,
  listCategoriesWithCurrency, updateCategoryCurrency,
} from '../../services/budgetService';
import { getTripRaw } from '../../services/tripService';
import {
  safeBroadcast, TOOL_ANNOTATIONS_READONLY, TOOL_ANNOTATIONS_WRITE, TOOL_ANNOTATIONS_DELETE,
  TOOL_ANNOTATIONS_NON_IDEMPOTENT,
  demoDenied, noAccess, noPermission, hasTripPermission, ok,
} from './_shared';
import { canRead, canWrite } from '../scopes';
import { isAddonEnabled } from '../../services/adminService';
import { ADDON_IDS } from '../../addons';

export function registerBudgetTools(server: McpServer, userId: number, scopes: string[] | null): void {
  const R = canRead(scopes, 'budget');
  const W = canWrite(scopes, 'budget');

  if (isAddonEnabled(ADDON_IDS.BUDGET)) {
  // --- BUDGET CATEGORIES ---

  if (R) server.registerTool(
    'list_budget_categories',
    {
      description: "List a trip's budget categories (budget groups) in display order with their currency, item count and subtotal. A null currency means the category inherits the trip's base currency (returned as trip_currency). Subtotals are in the category's own currency — never sum across currencies.",
      inputSchema: {
        tripId: z.number().int().positive(),
      },
      annotations: TOOL_ANNOTATIONS_READONLY,
    },
    async ({ tripId }) => {
      if (!canAccessTrip(tripId, userId)) return noAccess();
      const tripCurrency = getTripRaw(tripId)?.currency ?? null;
      const categories = listCategoriesWithCurrency(tripId).map(c => ({
        ...c,
        effective_currency: c.currency ?? tripCurrency,
      }));
      return ok({ trip_currency: tripCurrency, categories });
    }
  );

  if (W) server.registerTool(
    'set_budget_category_currency',
    {
      description: "Set or change the currency of a budget category (all items in the category share it). Pass null to make the category inherit the trip's base currency. Creates the category entry if it does not exist yet. Amounts are not converted.",
      inputSchema: {
        tripId: z.number().int().positive(),
        category: z.string().min(1).max(100).describe('Category name exactly as stored (case-sensitive)'),
        currency: z.string().regex(/^[A-Z]{3}$/).nullable().describe('Uppercase ISO 4217 code (e.g. EUR, NOK), or null to inherit the trip currency'),
      },
      annotations: TOOL_ANNOTATIONS_WRITE,
    },
    async ({ tripId, category, currency }) => {
      if (isDemoUser(userId)) return demoDenied();
      if (!canAccessTrip(tripId, userId)) return noAccess();
      if (!hasTripPermission('budget_edit', tripId, userId)) return noPermission();
      updateCategoryCurrency(tripId, category, currency);
      safeBroadcast(tripId, 'budget:category-currency-updated', { category, currency });
      return ok({ category, currency });
    }
  );

  // --- BUDGET ---

  if (W) server.registerTool(
    'create_budget_item',
    {
      description: 'Add a budget/expense item to a trip.',
      inputSchema: {
        tripId: z.number().int().positive(),
        name: z.string().min(1).max(200),
        category: z.string().max(100).optional().describe('Budget category (e.g. Accommodation, Food, Transport)'),
        total_price: z.number().nonnegative(),
        currency: z.string().length(3).optional().describe("ISO 4217 currency code for this item. When omitted, inherits the category's currency (or the trip's base currency if the category is new). Once a category's currency is set, all items in that category must use it."),
        note: z.string().max(500).optional(),
      },
      annotations: TOOL_ANNOTATIONS_NON_IDEMPOTENT,
    },
    async ({ tripId, name, category, total_price, currency, note }) => {
      if (isDemoUser(userId)) return demoDenied();
      if (!canAccessTrip(tripId, userId)) return noAccess();
      const item = createBudgetItem(tripId, { category, name, total_price, currency, note });
      safeBroadcast(tripId, 'budget:created', { item });
      return ok({ item });
    }
  );

  if (W) server.registerTool(
    'delete_budget_item',
    {
      description: 'Delete a budget item from a trip.',
      inputSchema: {
        tripId: z.number().int().positive(),
        itemId: z.number().int().positive(),
      },
      annotations: TOOL_ANNOTATIONS_DELETE,
    },
    async ({ tripId, itemId }) => {
      if (isDemoUser(userId)) return demoDenied();
      if (!canAccessTrip(tripId, userId)) return noAccess();
      const deleted = deleteBudgetItem(itemId, tripId);
      if (!deleted) return { content: [{ type: 'text' as const, text: 'Budget item not found.' }], isError: true };
      safeBroadcast(tripId, 'budget:deleted', { itemId });
      return ok({ success: true });
    }
  );

  // --- BUDGET (update) ---

  if (W) server.registerTool(
    'update_budget_item',
    {
      description: 'Update an existing budget/expense item in a trip.',
      inputSchema: {
        tripId: z.number().int().positive(),
        itemId: z.number().int().positive(),
        name: z.string().min(1).max(200).optional(),
        category: z.string().max(100).optional(),
        total_price: z.number().nonnegative().optional(),
        currency: z.string().length(3).optional().describe("ISO 4217 currency code. Changing currency on an item will only succeed if the item is the sole entry in its category, or if the new currency matches the category's established currency."),
        persons: z.number().int().positive().nullable().optional(),
        days: z.number().int().positive().nullable().optional(),
        note: z.string().max(500).nullable().optional(),
      },
      annotations: TOOL_ANNOTATIONS_WRITE,
    },
    async ({ tripId, itemId, name, category, total_price, currency, persons, days, note }) => {
      if (isDemoUser(userId)) return demoDenied();
      if (!canAccessTrip(tripId, userId)) return noAccess();
      const item = updateBudgetItem(itemId, tripId, { name, category, total_price, currency, persons, days, note });
      if (!item) return { content: [{ type: 'text' as const, text: 'Budget item not found.' }], isError: true };
      safeBroadcast(tripId, 'budget:updated', { item });
      return ok({ item });
    }
  );

  // --- BUDGET ADVANCED ---

  if (W) server.registerTool(
    'create_budget_item_with_members',
    {
      description: 'Create a budget/expense item and optionally set the trip members splitting it in one atomic operation. If userIds is omitted or empty, behaves like create_budget_item. Only use when the place does not yet exist — if it already exists, use set_budget_item_members directly.',
      inputSchema: {
        tripId: z.number().int().positive(),
        name: z.string().min(1).max(200),
        category: z.string().max(100).optional().describe('Budget category (e.g. Accommodation, Food, Transport)'),
        total_price: z.number().nonnegative(),
        currency: z.string().length(3).optional().describe("ISO 4217 currency code for this item. When omitted, inherits the category's currency (or the trip's base currency if the category is new). Once a category's currency is set, all items in that category must use it."),
        note: z.string().max(500).optional(),
        userIds: z.array(z.number().int().positive()).optional().describe('User IDs splitting this item; omit or pass empty array to skip member assignment'),
      },
      annotations: TOOL_ANNOTATIONS_NON_IDEMPOTENT,
    },
    async ({ tripId, name, category, total_price, currency, note, userIds }) => {
      if (isDemoUser(userId)) return demoDenied();
      if (!canAccessTrip(tripId, userId)) return noAccess();
      const hasMembers = userIds && userIds.length > 0;
      try {
        const run = db.transaction(() => {
          const item = createBudgetItem(tripId, { category, name, total_price, currency, note });
          if (hasMembers) {
            return updateBudgetMembers(item.id, tripId, userIds!);
          }
          return { item };
        });
        const result = run();
        safeBroadcast(tripId, 'budget:created', { item: (result as any).item ?? result });
        if (hasMembers) safeBroadcast(tripId, 'budget:members-updated', { item: result });
        return ok({ item: result });
      } catch {
        return { content: [{ type: 'text' as const, text: 'Failed to create budget item.' }], isError: true };
      }
    }
  );

  if (W) server.registerTool(
    'set_budget_item_members',
    {
      description: 'Set which trip members are splitting a budget item (replaces current member list).',
      inputSchema: {
        tripId: z.number().int().positive(),
        itemId: z.number().int().positive(),
        userIds: z.array(z.number().int().positive()).describe('User IDs splitting this item; empty array clears all'),
      },
      annotations: TOOL_ANNOTATIONS_WRITE,
    },
    async ({ tripId, itemId, userIds }) => {
      if (isDemoUser(userId)) return demoDenied();
      if (!canAccessTrip(tripId, userId)) return noAccess();
      const item = updateBudgetMembers(itemId, tripId, userIds);
      safeBroadcast(tripId, 'budget:members-updated', { item });
      return ok({ item });
    }
  );

  if (W) server.registerTool(
    'toggle_budget_member_paid',
    {
      description: 'Mark or unmark a member as having paid their share of a budget item.',
      inputSchema: {
        tripId: z.number().int().positive(),
        itemId: z.number().int().positive(),
        memberId: z.number().int().positive().describe('User ID of the member'),
        paid: z.boolean(),
      },
      annotations: TOOL_ANNOTATIONS_WRITE,
    },
    async ({ tripId, itemId, memberId, paid }) => {
      if (isDemoUser(userId)) return demoDenied();
      if (!canAccessTrip(tripId, userId)) return noAccess();
      const member = toggleMemberPaid(itemId, memberId, paid);
      safeBroadcast(tripId, 'budget:member-paid-updated', { itemId, member });
      return ok({ member });
    }
  );
  } // isAddonEnabled(BUDGET)
}
