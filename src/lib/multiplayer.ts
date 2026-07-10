// src/lib/multiplayer.ts
//
// Pure helpers for the Phase 8 mobile multiplayer layer: resolving which seat the
// signed-in user occupies, and describing where another seat sits *relative to the
// viewer* around the table. Kept free of Firebase/DOM so it can be unit-tested and
// reused by both the game manager and the UI.
//
// Seating model: the players array is in clockwise seating order starting with the
// first dealer (see index.astro setup). Bidding proceeds clockwise = "to the left".
// So from any seat, the next index clockwise is on your LEFT, the index two away is
// ACROSS (your partner), and the previous index is on your RIGHT.

export interface SeatPlayer {
  userId?: string;
  position: number; // 0-based seat index
  displayName?: string;
  isAuthenticated?: boolean;
}

export type SeatDirection = 'self' | 'left' | 'across' | 'right';

// Resolve the 0-based seat of the given user id among the game's players.
// Returns null when the user is not seated (a spectator) or uid is unknown.
export function resolveSeat(players: SeatPlayer[] | null | undefined, uid: string | null | undefined): number | null {
  if (!players || !uid) return null;
  const seated = players.find(p => p.userId === uid);
  return seated ? seated.position : null;
}

// Where does `targetSeat` sit relative to `mySeat`, looking around a 4-player table?
// Returns null when the viewer has no seat (spectator) — there is no relative frame.
export function relativeDirection(mySeat: number | null | undefined, targetSeat: number): SeatDirection | null {
  if (mySeat === null || mySeat === undefined) return null;
  const offset = ((targetSeat - mySeat) % 4 + 4) % 4;
  switch (offset) {
    case 0: return 'self';
    case 1: return 'left';   // next clockwise
    case 2: return 'across'; // partner
    case 3: return 'right';  // previous clockwise
    default: return null;
  }
}

// A glyph pointing toward the seat (from the viewer's perspective). "across" points
// away from the viewer; "self" has no arrow.
export function directionArrow(dir: SeatDirection | null): string {
  switch (dir) {
    case 'left': return '←';
    case 'right': return '→';
    case 'across': return '↑';
    case 'self': return '';
    default: return '';
  }
}

// Human-readable label for a relative direction, e.g. "on your left".
export function directionLabel(dir: SeatDirection | null): string {
  switch (dir) {
    case 'left': return 'on your left';
    case 'right': return 'on your right';
    case 'across': return 'across from you';
    case 'self': return 'you';
    default: return '';
  }
}

// The 0-based team index for a seat: seats 0 & 2 are team 0, seats 1 & 3 are team 1.
// Matches the hand-encoding rule biddingTeam = (bidWinner - 1) % 2 for 1-based seats.
export function teamOfSeat(seat: number): 0 | 1 {
  return (seat % 2) as 0 | 1;
}
