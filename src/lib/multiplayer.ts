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
