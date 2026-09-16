import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { db, canAccessTrip } from '../../db/database';
import { isDemoUser } from '../../services/authService';
import {
  listTrips, createTrip, updateTrip, deleteTrip, getTripSummary,
  isOwner, verifyTripAccess, getTripRaw,
  listMembers as listTripMembers, getTripOwner, addMember as addTripMember,
  removeMember as removeTripMember,
  copyTripById, exportICS, NotFoundError, ValidationError,
} from '../../services/tripService';
import {
  createOrUpdateShareLink, getShareLink, deleteShareLink,
} from '../../services/shareService';
import { isAddonEnabled, getCollabFeatures } from '../../services/adminService';
import { ADDON_IDS } from '../../addons';
import { countMessages, listPolls } from '../../services/collabService';
import {
  listItems as listTodoItems,
} from '../../services/todoService';
import {
  safeBroadcast, MAX_MCP_TRIP_DAYS,
  TOOL_ANNOTATIONS_READONLY, TOOL_ANNOTATIONS_WRITE,
  TOOL_ANNOTATIONS_DELETE, TOOL_ANNOTATIONS_NON_IDEMPOTENT,
  demoDenied, noAccess, noPermission, hasTripPermission, ok,
} from './_shared';
import { canRead, canReadTrips, canWrite, canDeleteTrips, canShareTrips } from '../scopes';
import { getPublicTripsList } from '../../services/publicTripService';
import { getAppUrl } from '../../services/notifications';
import { setTripCoverFromUrl } from '../../services/tripCoverService';
import { SsrfBlockedError } from '../../utils/ssrfGuard';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Fork-specific trip fields shared by create_trip and update_trip. */
const TRIP_EXTRA_FIELDS = {
  country: z.string().max(100).nullable().optional().describe('Destination country (free text or ISO code, e.g. "BE"). Null clears it.'),
  reminder_days: z.number().int().min(0).max(30).optional().describe('Days before the trip to send a reminder (0 = no reminder)'),
  is_public: z.boolean().optional().describe('List the trip on the public landing page (/public/trips/:id) with RSVP. Owner only.'),
  registration_fee: z.number().nonnegative().nullable().optional().describe('Registration fee per participant. 0 or null removes the fee.'),
  fee_mode: z.enum(['deadline', 'rsvp']).nullable().optional().describe('"rsvp" = pay when registering, "deadline" = pay before fee_deadline'),
  fee_deadline: isoDate.nullable().optional().describe('Payment deadline (YYYY-MM-DD); only used when fee_mode is "deadline"'),
  fee_currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional().describe('ISO 4217 currency (uppercase) for the registration fee; may differ from the trip currency'),
  rsvp_deadline: isoDate.nullable().optional().describe('Last day to RSVP (YYYY-MM-DD). Null clears it.'),
};

function pickDefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function registerTripTools(server: McpServer, userId: number, scopes: string[] | null, getDeprecationNotice: () => string | null = () => null): void {
  const R = canReadTrips(scopes);
  const W = canWrite(scopes, 'trips');
  const D = canDeleteTrips(scopes);
  const S = canShareTrips(scopes);

  // --- TRIPS ---

  if (W) server.registerTool(
    'create_trip',
    {
      description: 'Create a new trip. Returns the created trip with its generated days. Optionally set country, visibility, registration fee and RSVP deadline in the same call (see update_trip for the fee rules).',
      inputSchema: {
        title: z.string().min(1).max(200).describe('Trip title'),
        description: z.string().max(2000).optional().describe('Trip description'),
        start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Start date (YYYY-MM-DD)'),
        end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('End date (YYYY-MM-DD)'),
        currency: z.string().length(3).optional().describe('Currency code (e.g. EUR, USD)'),
        ...TRIP_EXTRA_FIELDS,
      },
      annotations: TOOL_ANNOTATIONS_NON_IDEMPOTENT,
    },
    async ({ title, description, start_date, end_date, currency, ...extras }) => {
      if (isDemoUser(userId)) return demoDenied();
      if (start_date) {
        const d = new Date(start_date + 'T00:00:00Z');
        if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== start_date)
          return { content: [{ type: 'text' as const, text: 'start_date is not a valid calendar date.' }], isError: true };
      }
      if (end_date) {
        const d = new Date(end_date + 'T00:00:00Z');
        if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== end_date)
          return { content: [{ type: 'text' as const, text: 'end_date is not a valid calendar date.' }], isError: true };
      }
      if (start_date && end_date && new Date(end_date) < new Date(start_date)) {
        return { content: [{ type: 'text' as const, text: 'End date must be after start date.' }], isError: true };
      }
      const extraData = pickDefined(extras);
      try {
        // One transaction so a rejected fee/deadline value does not leave a half-configured trip behind.
        const trip = db.transaction(() => {
          const created = createTrip(userId, { title, description, start_date, end_date, currency }, MAX_MCP_TRIP_DAYS);
          if (Object.keys(extraData).length === 0) return created.trip;
          return updateTrip(created.tripId, userId, extraData, 'user').updatedTrip;
        })();
        return ok({ trip });
      } catch (err) {
        if (err instanceof ValidationError) return { content: [{ type: 'text' as const, text: err.message }], isError: true };
        throw err;
      }
    }
  );

  if (W) server.registerTool(
    'update_trip',
    {
      description: 'Update an existing trip\'s details. Only provided fields change. Registration fee rules: setting registration_fee to 0 or null clears fee_mode, fee_deadline and fee_currency; fee_deadline is only kept when fee_mode is "deadline". Only the trip owner can change is_public.',
      inputSchema: {
        tripId: z.number().int().positive(),
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).optional(),
        start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        currency: z.string().length(3).optional(),
        ...TRIP_EXTRA_FIELDS,
      },
      annotations: TOOL_ANNOTATIONS_WRITE,
    },
    async ({ tripId, title, description, start_date, end_date, currency, ...extras }) => {
      if (isDemoUser(userId)) return demoDenied();
      if (!canAccessTrip(tripId, userId)) return noAccess();
      if (extras.is_public !== undefined && !isOwner(tripId, userId))
        return { content: [{ type: 'text' as const, text: 'Only the trip owner can change trip visibility.' }], isError: true };
      if (start_date) {
        const d = new Date(start_date + 'T00:00:00Z');
        if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== start_date)
          return { content: [{ type: 'text' as const, text: 'start_date is not a valid calendar date.' }], isError: true };
      }
      if (end_date) {
        const d = new Date(end_date + 'T00:00:00Z');
        if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== end_date)
          return { content: [{ type: 'text' as const, text: 'end_date is not a valid calendar date.' }], isError: true };
      }
      try {
        // updateTrip distinguishes "field omitted" from "field set to null" via `in`, so never pass undefined keys.
        const data = pickDefined({ title, description, start_date, end_date, currency, ...extras });
        const { updatedTrip } = updateTrip(tripId, userId, data, 'user');
        safeBroadcast(tripId, 'trip:updated', { trip: updatedTrip });
        return ok({ trip: updatedTrip });
      } catch (err) {
        if (err instanceof ValidationError || err instanceof NotFoundError)
          return { content: [{ type: 'text' as const, text: err.message }], isError: true };
        throw err;
      }
    }
  );

  if (W) server.registerTool(
    'set_trip_cover',
    {
      description: 'Set a trip\'s cover image by downloading it from a public http(s) image URL (jpg, png, gif or webp, max 20 MB). Replaces the current cover. Only use images the user has chosen or that are licensed for reuse. Requires the trip_cover_upload permission (trip owner by default).',
      inputSchema: {
        tripId: z.number().int().positive(),
        image_url: z.string().url().max(2000).describe('Direct URL to the image file'),
      },
      annotations: { ...TOOL_ANNOTATIONS_WRITE, idempotentHint: false, openWorldHint: true },
    },
    async ({ tripId, image_url }) => {
      if (isDemoUser(userId)) return demoDenied();
      if (!canAccessTrip(tripId, userId)) return noAccess();
      if (!hasTripPermission('trip_cover_upload', tripId, userId))
        return noPermission('No permission to change the cover image.');
      try {
        const cover_image = await setTripCoverFromUrl(tripId, image_url);
        const trip = getTripRaw(tripId);
        safeBroadcast(tripId, 'trip:updated', { trip });
        return ok({ cover_image, trip });
      } catch (err) {
        if (err instanceof ValidationError || err instanceof NotFoundError || err instanceof SsrfBlockedError)
          return { content: [{ type: 'text' as const, text: err.message }], isError: true };
        return { content: [{ type: 'text' as const, text: 'Failed to set cover image.' }], isError: true };
      }
    }
  );

  if (D) server.registerTool(
    'delete_trip',
    {
      description: 'Delete a trip. Only the trip owner can delete it.',
      inputSchema: {
        tripId: z.number().int().positive(),
      },
      annotations: TOOL_ANNOTATIONS_DELETE,
    },
    async ({ tripId }) => {
      if (isDemoUser(userId)) return demoDenied();
      if (!isOwner(tripId, userId)) return noAccess();
      deleteTrip(tripId, userId, 'user');
      return ok({ success: true, tripId });
    }
  );

  // list_trips and get_trip_summary are always registered regardless of OAuth scopes —
  // they are navigation tools that any MCP client needs to discover trip IDs.
  server.registerTool(
    'list_trips',
    {
      description: 'List all trips the current user owns or is a member of. Use this for trip discovery before calling get_trip_summary.',
      inputSchema: {
        include_archived: z.boolean().optional().describe('Include archived trips (default false)'),
      },
      annotations: TOOL_ANNOTATIONS_READONLY,
    },
    async ({ include_archived }) => {
      const notice = getDeprecationNotice();
      const trips = listTrips(userId, include_archived ? null : 0);
      if (notice) return {
        isError: true as const,
        content: [
          { type: 'text' as const, text: notice },
          { type: 'text' as const, text: JSON.stringify({ trips }, null, 2) },
        ],
      };
      return ok({ trips });
    }
  );

  if (R) server.registerTool(
    'list_public_trips',
    {
      description: 'List all trips published on the public landing page (is_public = true), across all owners, with the public page URL where visitors can view the itinerary and RSVP.',
      inputSchema: {},
      annotations: TOOL_ANNOTATIONS_READONLY,
    },
    async () => {
      const appUrl = getAppUrl();
      const trips = getPublicTripsList().map(t => ({ ...t, public_url: `${appUrl}/public/trips/${t.id}` }));
      return ok({ trips });
    }
  );

  // --- TRIP SUMMARY ---

  server.registerTool(
    'get_trip_summary',
    {
      description: 'Get a full denormalized summary of a trip in a single call: metadata, members, days with assignments and notes, accommodations, budget line items (when enabled), packing list (when enabled), reservations, collab notes and poll/message counts (when enabled), and to-do items (when enabled). Use this as a context loader before planning or modifying a trip.',
      inputSchema: {
        tripId: z.number().int().positive(),
      },
      annotations: TOOL_ANNOTATIONS_READONLY,
    },
    async ({ tripId }) => {
      if (!canAccessTrip(tripId, userId)) return noAccess();
      const summary = getTripSummary(tripId, userId);
      if (!summary) return noAccess();
      // Addon availability gates
      const packingEnabled = isAddonEnabled(ADDON_IDS.PACKING);
      const budgetEnabled  = isAddonEnabled(ADDON_IDS.BUDGET);
      const collabEnabled  = isAddonEnabled(ADDON_IDS.COLLAB);
      const collabFeatures = collabEnabled ? getCollabFeatures() : null;
      // Scope gates — sections not covered by the client's OAuth scopes are omitted.
      // Core trip data (metadata, days, members, accommodations) is always included
      // because this tool is always registered and needed for navigation.
      const canReadBudget  = budgetEnabled  && canRead(scopes, 'budget');
      const canReadPacking = packingEnabled && canRead(scopes, 'packing');
      const canReadCollab  = collabEnabled  && canRead(scopes, 'collab');
      const canReadTodos   = packingEnabled && canRead(scopes, 'todos');
      const canReadRes     = canRead(scopes, 'reservations');
      const todos = canReadTodos ? listTodoItems(tripId, userId) : [];
      let pollCount = 0;
      let messageCount = 0;
      if (canReadCollab) {
        if (collabFeatures?.polls) pollCount    = listPolls(tripId).length;
        if (collabFeatures?.chat)  messageCount = countMessages(tripId);
      }
      const notice = getDeprecationNotice();
      const summaryData = {
        ...summary,
        reservations:  canReadRes                                    ? summary.reservations : undefined,
        packing:       canReadPacking                                ? summary.packing      : undefined,
        budget:        canReadBudget                                 ? summary.budget       : undefined,
        collab_notes:  canReadCollab && collabFeatures?.notes        ? summary.collab_notes : [],
        todos,
        pollCount,
        messageCount,
      };
      if (notice) return {
        isError: true as const,
        content: [
          { type: 'text' as const, text: notice },
          { type: 'text' as const, text: JSON.stringify(summaryData, null, 2) },
        ],
      };
      return ok(summaryData);
    }
  );

  // --- TRIP MEMBERS, COPY, ICS, SHARE ---

  if (R) server.registerTool(
    'list_trip_members',
    {
      description: 'List all members of a trip (owner + collaborators).',
      inputSchema: {
        tripId: z.number().int().positive(),
      },
      annotations: TOOL_ANNOTATIONS_READONLY,
    },
    async ({ tripId }) => {
      if (!canAccessTrip(tripId, userId)) return noAccess();
      const ownerRow = getTripOwner(tripId);
      if (!ownerRow) return noAccess();
      const { owner, members } = listTripMembers(tripId, ownerRow.user_id);
      return ok({ owner, members });
    }
  );

  if (W) server.registerTool(
    'add_trip_member',
    {
      description: 'Add a user to a trip by their username or email address. Only the trip owner can do this.',
      inputSchema: {
        tripId: z.number().int().positive(),
        identifier: z.string().min(1).describe('Username or email of the user to add'),
      },
      annotations: TOOL_ANNOTATIONS_NON_IDEMPOTENT,
    },
    async ({ tripId, identifier }) => {
      if (isDemoUser(userId)) return demoDenied();
      if (!canAccessTrip(tripId, userId)) return noAccess();
      const ownerRow = getTripOwner(tripId);
      if (!ownerRow || ownerRow.user_id !== userId)
        return { content: [{ type: 'text' as const, text: 'Only the trip owner can add members.' }], isError: true };
      try {
        const result = addTripMember(tripId, identifier, ownerRow.user_id, userId);
        safeBroadcast(tripId, 'member:added', { member: result.member });
        return ok({ member: result.member });
      } catch (err) {
        const msg = err instanceof ValidationError || err instanceof NotFoundError ? err.message : 'Failed to add member.';
        return { content: [{ type: 'text' as const, text: msg }], isError: true };
      }
    }
  );

  if (W) server.registerTool(
    'remove_trip_member',
    {
      description: 'Remove a member from a trip. Only the trip owner can do this.',
      inputSchema: {
        tripId: z.number().int().positive(),
        memberId: z.number().int().positive().describe('User ID of the member to remove'),
      },
      annotations: TOOL_ANNOTATIONS_DELETE,
    },
    async ({ tripId, memberId }) => {
      if (isDemoUser(userId)) return demoDenied();
      if (!canAccessTrip(tripId, userId)) return noAccess();
      const ownerRow = getTripOwner(tripId);
      if (!ownerRow || ownerRow.user_id !== userId)
        return { content: [{ type: 'text' as const, text: 'Only the trip owner can remove members.' }], isError: true };
      removeTripMember(tripId, memberId);
      safeBroadcast(tripId, 'member:removed', { userId: memberId });
      return ok({ success: true });
    }
  );

  if (W) server.registerTool(
    'copy_trip',
    {
      description: 'Duplicate a trip (all days, places, itinerary, packing, budget, reservations, day notes). Packing items are reset to unchecked. Returns the new trip.',
      inputSchema: {
        tripId: z.number().int().positive().describe('Source trip ID to duplicate'),
        title: z.string().min(1).max(200).optional().describe('Title for the new trip (defaults to source title)'),
      },
      annotations: TOOL_ANNOTATIONS_NON_IDEMPOTENT,
    },
    async ({ tripId, title }) => {
      if (isDemoUser(userId)) return demoDenied();
      if (!canAccessTrip(tripId, userId)) return noAccess();
      try {
        const newTripId = copyTripById(tripId, userId, title);
        const newTrip = canAccessTrip(newTripId, userId);
        return ok({ trip: { id: newTripId, ...newTrip } });
      } catch {
        return { content: [{ type: 'text' as const, text: 'Failed to copy trip.' }], isError: true };
      }
    }
  );

  if (R) server.registerTool(
    'export_trip_ics',
    {
      description: 'Export a trip\'s itinerary and reservations as iCalendar (.ics) format text. Useful for importing into calendar apps.',
      inputSchema: {
        tripId: z.number().int().positive(),
      },
      annotations: TOOL_ANNOTATIONS_READONLY,
    },
    async ({ tripId }) => {
      if (!canAccessTrip(tripId, userId)) return noAccess();
      try {
        const { ics, filename } = exportICS(tripId);
        return ok({ ics, filename });
      } catch {
        return { content: [{ type: 'text' as const, text: 'Trip not found.' }], isError: true };
      }
    }
  );

  if (S) server.registerTool(
    'get_share_link',
    {
      description: 'Get the current public share link for a trip, including its permission flags. Returns null if no share link exists.',
      inputSchema: {
        tripId: z.number().int().positive(),
      },
      annotations: TOOL_ANNOTATIONS_READONLY,
    },
    async ({ tripId }) => {
      if (!canAccessTrip(tripId, userId)) return noAccess();
      const link = getShareLink(String(tripId));
      return ok({ link });
    }
  );

  if (S) server.registerTool(
    'create_share_link',
    {
      description: 'Create or update the public share link for a trip. Set permission flags to control what is visible to guests.',
      inputSchema: {
        tripId: z.number().int().positive(),
        share_map: z.boolean().optional().default(true).describe('Share the map and places'),
        share_bookings: z.boolean().optional().default(true).describe('Share reservations'),
        share_packing: z.boolean().optional().default(false).describe('Share packing list'),
        share_budget: z.boolean().optional().default(false).describe('Share budget'),
        share_collab: z.boolean().optional().default(false).describe('Share collab messages'),
      },
      annotations: TOOL_ANNOTATIONS_WRITE,
    },
    async ({ tripId, share_map, share_bookings, share_packing, share_budget, share_collab }) => {
      if (isDemoUser(userId)) return demoDenied();
      if (!canAccessTrip(tripId, userId)) return noAccess();
      const { token, created } = createOrUpdateShareLink(String(tripId), userId, {
        share_map: share_map ?? true,
        share_bookings: share_bookings ?? true,
        share_packing: share_packing ?? false,
        share_budget: share_budget ?? false,
        share_collab: share_collab ?? false,
      });
      return ok({ token, created });
    }
  );

  if (S) server.registerTool(
    'delete_share_link',
    {
      description: 'Revoke the public share link for a trip. Guests will no longer be able to access the shared view.',
      inputSchema: {
        tripId: z.number().int().positive(),
      },
      annotations: TOOL_ANNOTATIONS_DELETE,
    },
    async ({ tripId }) => {
      if (isDemoUser(userId)) return demoDenied();
      if (!canAccessTrip(tripId, userId)) return noAccess();
      deleteShareLink(String(tripId));
      return ok({ success: true });
    }
  );
}
