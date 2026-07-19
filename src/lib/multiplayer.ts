// src/lib/multiplayer.ts
//
// Pure helpers for the Phase 8 multiplayer layer: resolving which seat the signed-in user
// occupies, and which team a seat belongs to. Kept free of Firebase/DOM so it can be
// unit-tested and reused by both the game manager and the UI.
//
// Seating model: the players array is in clockwise seating order starting with the first
// dealer (see index.astro setup). Seats 0 & 2 are team 0; seats 1 & 3 are team 1.

export interface SeatPlayer {
  userId?: string;
  position: number; // 0-based seat index
  displayName?: string;
  isAuthenticated?: boolean;
}

// Resolve the 0-based seat of the given user id among the game's players.
// Returns null when the user is not seated (a spectator) or uid is unknown.
export function resolveSeat(players: SeatPlayer[] | null | undefined, uid: string | null | undefined): number | null {
  if (!players || !uid) return null;
  const seated = players.find(p => p.userId === uid);
  return seated ? seated.position : null;
}

// The 0-based team index for a seat: seats 0 & 2 are team 0, seats 1 & 3 are team 1.
// Matches the hand-encoding rule biddingTeam = (bidWinner - 1) % 2 for 1-based seats.
export function teamOfSeat(seat: number): 0 | 1 {
  return (seat % 2) as 0 | 1;
}

// Phase 12 roles. A device picks its own role; `host` additionally requires winning the shared
// metadata/currentHost claim. The global "mode" of a game is DERIVED from these plus the claim,
// never stored — see development-plan.md, Phase 12.
export type DeviceRole = 'player' | 'spectator' | 'host';

function isDeviceRole(value: unknown): value is DeviceRole {
  return value === 'player' || value === 'spectator' || value === 'host';
}

// Parse the raw games/{id}/presence node into uid -> roles of that user's connected devices.
//
// Two shapes are accepted. The Phase 12 shape is `presence/$uid/$deviceId -> { mode, ts }`. The
// Phase 8 shape was `presence/$uid -> true`, keyed by uid alone; a client still running the old
// build writes that, so it has to keep working through a rollout. A legacy entry is reported as
// one device in `player` mode — the old build only wrote presence for devices that could act.
export function parsePresence(raw: Record<string, unknown> | null | undefined): Map<string, DeviceRole[]> {
  const out = new Map<string, DeviceRole[]>();
  if (!raw) return out;

  for (const [uid, value] of Object.entries(raw)) {
    if (value === true) {                       // legacy uid-keyed entry
      out.set(uid, ['player']);
      continue;
    }
    if (!value || typeof value !== 'object') continue;

    const roles: DeviceRole[] = [];
    for (const device of Object.values(value as Record<string, unknown>)) {
      if (device === true) {                    // legacy-ish/degenerate child
        roles.push('player');
      } else if (device && typeof device === 'object') {
        const mode = (device as { mode?: unknown }).mode;
        roles.push(isDeviceRole(mode) ? mode : 'player');
      }
    }
    // A uid with no parseable devices is not present at all — don't record an empty entry, or
    // isSeatPresent() would report a seat as online with nothing behind it.
    if (roles.length > 0) out.set(uid, roles);
  }
  return out;
}
