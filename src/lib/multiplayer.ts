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

// Which seats may act during a given phase, plus a human verb for the waiting message.
export interface TurnGate {
  seats: number[]; // 0-based seats permitted to act
  verb: string;    // e.g. "pick trump"
}

// Turn responsibility for the current phase, derived from the in-progress hand string
// (`${dealer}${bidWinner}${bid}${trump}${decision}${tricks}`, 1-based seat digits).
//
// Returns null for phases that are NOT turn-gated in the 8a foundation — the `bidder`
// and `bid` phases stay open to every seated participant until the 8b auction replaces
// them. For the phases that map cleanly onto a real player it returns the responsible
// seat(s):
//   - trump   -> the bid winner picks trump
//   - decision-> the defending team decides play/fold
//   - tricks  -> the bid winner records the defenders' trick count (scorekeeper)
export function turnGateFor(currentHand: string, phase: string): TurnGate | null {
  const bidWinner = parseInt(currentHand[1] || '0'); // 1-based seat, 0 = throw-in
  if (!bidWinner) return null; // no bid winner yet / thrown in — nothing seat-specific
  const bidWinnerSeat = bidWinner - 1;

  switch (phase) {
    case 'trump':
      return { seats: [bidWinnerSeat], verb: 'pick trump' };
    case 'decision': {
      const biddingTeam = (bidWinner - 1) % 2;
      const defendingTeam = 1 - biddingTeam;
      const seats = [0, 1, 2, 3].filter(i => teamOfSeat(i) === defendingTeam);
      return { seats, verb: 'decide to play or fold' };
    }
    case 'tricks':
      return { seats: [bidWinnerSeat], verb: 'enter the tricks won' };
    default:
      return null; // bidder, bid — open to all participants in 8a
  }
}
