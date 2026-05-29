// Barrel re-export — tripService public API is now split across focused modules.
// All consumers that import from './tripService' continue to work unchanged.

export {
  MS_PER_DAY,
  MAX_TRIP_DAYS,
  TRIP_SELECT,
  verifyTripAccess,
  isOwner,
  generateDays,
  listTrips,
  createTrip,
  getTrip,
  updateTrip,
  deleteTrip,
  deleteOldCover,
  updateCoverImage,
  getTripRaw,
  getTripOwner,
} from './tripCrudService';

export type {
  UpdateTripResult,
  DeleteTripInfo,
} from './tripCrudService';

export {
  listMembers,
  addMember,
  removeMember,
} from './tripMemberService';

export type { AddMemberResult } from './tripMemberService';

export { exportICS } from './tripExportService';

export { copyTripById, getTripSummary } from './tripCopyService';

export { NotFoundError, ValidationError } from './tripErrors';
