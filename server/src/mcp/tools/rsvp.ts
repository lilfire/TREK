import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { canAccessTrip, isOwner } from '../../db/database';
import { listRsvpsWithPaymentsForTrip } from '../../services/rsvpService';
import { TOOL_ANNOTATIONS_READONLY, noAccess, noPermission, ok } from './_shared';
import { canReadTrips } from '../scopes';

export function registerRsvpTools(server: McpServer, userId: number, scopes: string[] | null): void {
  const R = canReadTrips(scopes);

  // --- RSVP ---

  if (R) server.registerTool(
    'list_trip_rsvps',
    {
      description: 'List RSVP registrations submitted via the public trip page, including the latest registration-fee payment status (pending/completed/failed) when a fee applies. Only the trip owner can view RSVPs because they contain participant names and emails.',
      inputSchema: {
        tripId: z.number().int().positive(),
      },
      annotations: TOOL_ANNOTATIONS_READONLY,
    },
    async ({ tripId }) => {
      if (!canAccessTrip(tripId, userId)) return noAccess();
      if (!isOwner(tripId, userId)) return noPermission('Only the trip owner can view RSVPs.');
      const rsvps = listRsvpsWithPaymentsForTrip(tripId);
      return ok({ rsvps, count: rsvps.length });
    }
  );
}
