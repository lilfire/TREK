import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { canAccessTrip } from '../../db/database';
import { isDemoUser } from '../../services/authService';
import {
  createTier, updateTier, deleteTier, getTierStatus,
} from '../../services/accommodationTierService';
import { NotFoundError, ValidationError } from '../../services/tripErrors';
import {
  TOOL_ANNOTATIONS_READONLY, TOOL_ANNOTATIONS_WRITE, TOOL_ANNOTATIONS_DELETE, TOOL_ANNOTATIONS_NON_IDEMPOTENT,
  demoDenied, noAccess, noPermission, hasTripPermission, ok,
} from './_shared';
import { canReadTrips, canWrite } from '../scopes';

function errorResult(err: unknown) {
  if (err instanceof ValidationError || err instanceof NotFoundError)
    return { content: [{ type: 'text' as const, text: err.message }], isError: true };
  throw err;
}

export function registerAccommodationTierTools(server: McpServer, userId: number, scopes: string[] | null): void {
  const R = canReadTrips(scopes);
  const W = canWrite(scopes, 'trips');

  // --- ACCOMMODATION TIERS ---

  if (R) server.registerTool(
    'list_accommodation_tiers',
    {
      description: 'List the accommodation tiers of a trip together with the current confirmed participant count, the active tier and how many participants are needed for the next tier. Confirmed participants = trip owner + RSVPs (only RSVPs with a completed payment when the trip has a registration fee). Tiers are shown on the public trip page.',
      inputSchema: {
        tripId: z.number().int().positive(),
      },
      annotations: TOOL_ANNOTATIONS_READONLY,
    },
    async ({ tripId }) => {
      if (!canAccessTrip(tripId, userId)) return noAccess();
      return ok(getTierStatus(tripId));
    }
  );

  if (W) server.registerTool(
    'create_accommodation_tier',
    {
      description: 'Create an accommodation tier: the accommodation that applies once the trip reaches min_participants confirmed participants. A tier runs until the next tier\'s min_participants − 1; the highest tier is open-ended. Each min_participants must be unique per trip. Informational only — does not change the itinerary or budget.',
      inputSchema: {
        tripId: z.number().int().positive(),
        name: z.string().min(1).max(200).describe('Tier / accommodation name, e.g. "Cabin Fjellro"'),
        min_participants: z.number().int().min(1).describe('Tier applies from this many confirmed participants'),
        place_id: z.number().int().positive().optional().describe('Optional place in this trip representing the accommodation'),
        price_per_person: z.number().min(0).optional().describe('Optional price per person, in the trip fee currency (or trip currency)'),
        description: z.string().max(2000).optional(),
      },
      annotations: TOOL_ANNOTATIONS_NON_IDEMPOTENT,
    },
    async ({ tripId, ...input }) => {
      if (isDemoUser(userId)) return demoDenied();
      if (!canAccessTrip(tripId, userId)) return noAccess();
      if (!hasTripPermission('trip_edit', tripId, userId)) return noPermission();
      try {
        const tier = createTier(tripId, input);
        return ok({ tier, status: getTierStatus(tripId) });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  if (W) server.registerTool(
    'update_accommodation_tier',
    {
      description: 'Update an accommodation tier. Only provided fields change; pass null to clear place_id, price_per_person or description.',
      inputSchema: {
        tripId: z.number().int().positive(),
        tierId: z.number().int().positive(),
        name: z.string().min(1).max(200).optional(),
        min_participants: z.number().int().min(1).optional(),
        place_id: z.number().int().positive().nullable().optional(),
        price_per_person: z.number().min(0).nullable().optional(),
        description: z.string().max(2000).nullable().optional(),
      },
      annotations: TOOL_ANNOTATIONS_WRITE,
    },
    async ({ tripId, tierId, ...input }) => {
      if (isDemoUser(userId)) return demoDenied();
      if (!canAccessTrip(tripId, userId)) return noAccess();
      if (!hasTripPermission('trip_edit', tripId, userId)) return noPermission();
      try {
        const tier = updateTier(tripId, tierId, input);
        return ok({ tier, status: getTierStatus(tripId) });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  if (W) server.registerTool(
    'delete_accommodation_tier',
    {
      description: 'Delete an accommodation tier.',
      inputSchema: {
        tripId: z.number().int().positive(),
        tierId: z.number().int().positive(),
      },
      annotations: TOOL_ANNOTATIONS_DELETE,
    },
    async ({ tripId, tierId }) => {
      if (isDemoUser(userId)) return demoDenied();
      if (!canAccessTrip(tripId, userId)) return noAccess();
      if (!hasTripPermission('trip_edit', tripId, userId)) return noPermission();
      if (!deleteTier(tripId, tierId))
        return { content: [{ type: 'text' as const, text: 'Accommodation tier not found.' }], isError: true };
      return ok({ success: true, status: getTierStatus(tripId) });
    }
  );
}
