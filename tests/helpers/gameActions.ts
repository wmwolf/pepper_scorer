// Test helpers that expose a readable, semantic game API on top of the real
// GameManager (which is driven by single-character `addHandPart` calls against a
// compact string encoding). These helpers let integration tests describe games in
// terms of "who bid / what / trump / play-or-fold / tricks" while exercising the
// ACTUAL production encoding and scoring — no phantom methods, no alternate model.
//
// Hand encoding (see gameState.encodeHand):
//   `${dealer}${bidWinner}${bid}${trump}${decision}${tricks}`
//   dealer/bidWinner: 1-4 (bidWinner 0 = throw-in)
//   bid:      '4' '5' '6' 'P'(pepper=4) 'M'(moon) 'D'(double moon)
//   trump:    'C' 'D' 'S' 'H' 'N'(no-trump)
//   decision: 'P'(play) 'F'(fold)
//   tricks:   0-6, the DEFENDING team's trick count (for a fold, the free points
//             negotiated to the defenders)
//
// NOTE ON THE MODEL: the production scoring model has no concept of "free tricks on
// a play" — free points only exist on a fold. Helpers reflect that faithfully.

import { GameManager, getCurrentPhase, isHandComplete } from '@/lib/gameState';

export type Bid = 4 | 5 | 6 | 'P' | 'M' | 'D';
export type Trump = 'C' | 'D' | 'S' | 'H' | 'N';
export type Decision = 'P' | 'F';
export type Phase = 'bidder' | 'bid' | 'trump' | 'decision' | 'tricks';

const DEFAULT_PLAYERS = ['Alice', 'Bob', 'Charlie', 'Dave'];
const DEFAULT_TEAMS = ['Team 1', 'Team 2'];

/** Create a GameManager with sensible defaults. */
export function newGame(
  players: string[] = DEFAULT_PLAYERS,
  teams: string[] = DEFAULT_TEAMS
): GameManager {
  return new GameManager(players, teams);
}

/** Bid value -> encoding character. */
function bidChar(bid: Bid): string {
  return String(bid);
}

/**
 * Ensure the current in-progress hand has its dealer character before a bidder is
 * added. After a completed hand the GameManager auto-seeds the next dealer, so this
 * only fires for the very first hand of a game (seeded to dealer 1).
 */
function ensureDealer(m: GameManager): void {
  const cur = m.getCurrentHand();
  if (!cur || isHandComplete(cur)) {
    m.addHandPart('1');
  }
}

/** Select who won the bid (1-4), or 0 for a throw-in. Starts a new hand if needed. */
export function setBidder(m: GameManager, bidder: number): void {
  ensureDealer(m);
  m.addHandPart(String(bidder));
}

/** Enter the bid value. */
export function setBid(m: GameManager, bid: Bid): void {
  m.addHandPart(bidChar(bid));
}

/** Select the trump suit ('N' for no-trump). */
export function setTrump(m: GameManager, trump: Trump): void {
  m.addHandPart(trump);
}

/**
 * Enter the defending team's play/fold decision.
 * A fold completes the hand immediately; `foldFreeTricks` is the free points the
 * defenders negotiated (encoded as the trailing tricks digit, default 0).
 * A play leaves the hand awaiting `setTricks`.
 */
export function setDecision(m: GameManager, decision: Decision, foldFreeTricks = 0): void {
  m.addHandPart(decision);
  if (decision === 'F') {
    m.addHandPart(String(foldFreeTricks));
  }
}

/** Enter the defending team's trick count (0-6), completing a played hand. */
export function setTricks(m: GameManager, tricks: number): void {
  m.addHandPart(String(tricks));
}

/** Play a whole hand in one call. */
export function playHand(
  m: GameManager,
  opts: { bidder: number; bid?: Bid; trump?: Trump; decision?: Decision; tricks?: number; foldFreeTricks?: number }
): void {
  setBidder(m, opts.bidder);
  if (opts.bidder === 0) return; // throw-in completes at the bidder step
  setBid(m, opts.bid ?? 4);
  setTrump(m, opts.trump ?? 'H');
  const decision = opts.decision ?? 'P';
  setDecision(m, decision, opts.foldFreeTricks ?? 0);
  if (decision === 'P') {
    setTricks(m, opts.tricks ?? 0);
  }
}

// --- Accessors (return null when the value has not been entered yet) ---

/** Current phase of the in-progress hand. */
export function currentPhase(m: GameManager): Phase {
  return getCurrentPhase(m.getCurrentHand());
}

/** Zero-based index of the current (in-progress) hand = number of completed hands. */
export function currentHandIndex(m: GameManager): number {
  return m.state.hands.filter(h => isHandComplete(h)).length;
}

/** Whether there is anything to undo. Mirrors the production undo-button guard. */
export function canUndo(m: GameManager): boolean {
  const cur = m.getCurrentHand();
  return cur.length > 1 || m.state.hands.length > 1;
}

export function getCurrentBidder(m: GameManager): number | null {
  const h = m.getCurrentHand();
  return h[1] !== undefined ? parseInt(h[1]) : null;
}

export function getCurrentBid(m: GameManager): Bid | null {
  const h = m.getCurrentHand();
  if (h[2] === undefined) return null;
  const c = h[2];
  return /[0-9]/.test(c) ? (parseInt(c) as Bid) : (c as Bid);
}

export function getCurrentTrump(m: GameManager): Trump | null {
  const h = m.getCurrentHand();
  return h[3] !== undefined ? (h[3] as Trump) : null;
}

export function getCurrentDecision(m: GameManager): Decision | null {
  const h = m.getCurrentHand();
  return h[4] !== undefined ? (h[4] as Decision) : null;
}
