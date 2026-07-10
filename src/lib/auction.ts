// src/lib/auction.ts
//
// Pure state machine for the Phase 8b mobile bidding auction (concurrent-entry redesign).
//
// Model (see development-plan.md "8b redesign spec"): after the deal, *all four* players may
// enter a bid at any time, in any order — there is NO turn-gating on entry. A bid is only
// *revealed* to the table once every player ahead of it in dealer order has also entered
// (reveal the maximal dealer-order prefix). Bidding order is dealer's-left first, clockwise,
// dealer last. A bid stays *editable* until the player who bids after them (their successor in
// dealer order) is revealed; the dealer (last) locks on auction completion. Trump is decoupled
// from the bid value and has its own, longer editability window (until the seat is revealed as
// the winner or as outbid). Everything here is deterministic and free of Firebase/DOM so it can
// back a transaction and be unit-tested exhaustively.
//
// Nothing about reveal / lock / resolution is stored: `entries` records only the raw bid a seat
// has entered, and every derived fact is computed from `entries` + `order`.

export type BidValue = '4' | '5' | '6' | 'M' | 'D';
export type TrumpSuit = 'C' | 'D' | 'H' | 'S' | 'N';
export type ActionValue = BidValue | 'PASS';

// A single seat's entered bid. Present in `entries` iff the seat has entered. `suit` is only
// meaningful (and only stored) for a non-pass bid, and may be absent until the player picks it.
export interface AuctionEntry {
  value: ActionValue;
  suit?: TrumpSuit;
}

export interface AuctionState {
  handIndex: number;                     // which hand this auction belongs to (staleness guard)
  order: number[];                       // four 1-based seats in dealer order (left of dealer first)
  entries: Record<number, AuctionEntry>; // keyed by 1-based seat; presence === "has entered"
}

export interface AuctionResult {
  complete: boolean;
  thrownIn: boolean;              // true when every seat passed
  winnerSeat: number | null;     // 1-based winning seat, or null when thrown in
  winningBid: BidValue | null;
  winningSuit: TrumpSuit | null; // null while a winner still owes a trump pick
}

const RANK: Record<ActionValue, number> = { PASS: 0, '4': 4, '5': 5, '6': 6, M: 7, D: 14 };

export function bidRank(value: ActionValue): number {
  return RANK[value] ?? 0;
}

// Bidding order for a 1-based dealer seat: the player to the dealer's left bids first, then
// clockwise, dealer last. e.g. dealer 1 -> [2, 3, 4, 1].
export function biddingOrder(dealerSeat: number): number[] {
  return [0, 1, 2, 3].map(i => ((dealerSeat + i) % 4) + 1);
}

export function createAuction(dealerSeat: number, handIndex: number): AuctionState {
  return { handIndex, order: biddingOrder(dealerSeat), entries: {} };
}

// Build an entry, omitting the suit key entirely for a pass or when no trump is set (rather
// than storing `suit: undefined`, which the Firebase RTDB rejects).
function mkEntry(value: ActionValue, suit: TrumpSuit | undefined): AuctionEntry {
  const base: AuctionEntry = { value };
  if (value !== 'PASS' && suit) base.suit = suit;
  return base;
}

// Has this seat entered a bid yet?
export function hasEntered(state: AuctionState, seat: number): boolean {
  return Boolean(state.entries[seat]);
}

// Length of the maximal leading prefix of `order` whose seats have all entered — i.e. how many
// seats are revealed. Entering the first still-missing seat can cascade-reveal several already-
// entered later seats at once.
export function revealedCount(state: AuctionState): number {
  let count = 0;
  for (const seat of state.order) {
    if (state.entries[seat]) count++;
    else break;
  }
  return count;
}

// Is this seat's bid revealed to the table?
export function isRevealed(state: AuctionState, seat: number): boolean {
  const idx = state.order.indexOf(seat);
  return idx >= 0 && idx < revealedCount(state);
}

// The auction is complete once all four seats have entered (every seat revealed).
export function isComplete(state: AuctionState): boolean {
  return state.order.length > 0 && revealedCount(state) === state.order.length;
}

// A bid locks when its *successor* in dealer order is revealed (you may fix an audible misspeak
// until the next player's bid is on the table). The dealer (last seat) has no successor and locks
// on auction completion. NOTE: this intentionally leaves a revealed-but-still-editable window —
// the last-revealed seat is revealed yet not locked until the next seat reveals.
export function isBidLocked(state: AuctionState, seat: number): boolean {
  const idx = state.order.indexOf(seat);
  if (idx < 0) return false;
  const last = state.order.length - 1;
  if (idx === last) return isComplete(state);
  return idx + 1 < revealedCount(state); // successor revealed
}

// Resolve the current high among *revealed* entries, walking dealer order: a non-pass with rank
// strictly greater than the running high becomes the new high; equal or lower is treated as a
// pass. Ties therefore go to the earlier seat (only `>` replaces). Unrevealed entries are ignored.
export function resolve(state: AuctionState): { highSeat: number | null; highRank: number } {
  const rc = revealedCount(state);
  let highSeat: number | null = null;
  let highRank = 0;
  for (let i = 0; i < rc; i++) {
    const seat = state.order[i]!;
    const e = state.entries[seat];
    if (!e || e.value === 'PASS') continue;
    const r = bidRank(e.value);
    if (r > highRank) {
      highRank = r;
      highSeat = seat;
    }
  }
  return { highSeat, highRank };
}

// A revealed non-pass bid that is not (or no longer) the high — its trump is discarded.
export function isOutbid(state: AuctionState, seat: number): boolean {
  if (!isRevealed(state, seat)) return false;
  const e = state.entries[seat];
  if (!e || e.value === 'PASS') return false;
  return resolve(state).highSeat !== seat;
}

// May this seat set (pick or change) its trump right now? Trump has a longer window than the bid:
// it stays open until the seat is revealed as the winner or as outbid, whichever first. Before
// completion the current high seat may keep changing it; at completion only the winner may still
// pick — and only if they never did (a picked trump is locked once they are revealed as winner).
export function canSetTrump(state: AuctionState, seat: number): boolean {
  const e = state.entries[seat];
  if (!e || e.value === 'PASS') return false;
  if (isComplete(state)) {
    const { highSeat } = resolve(state);
    return seat === highSeat && !e.suit; // winner may still pick a missing trump; else locked
  }
  return !isOutbid(state, seat);
}

// Enter (or re-enter / edit) a seat's bid. Non-pass may carry an optional pre-picked trump; a
// pass drops any suit. Throws if the seat isn't in this auction or its bid is already locked.
export function enterBid(
  state: AuctionState,
  seat: number,
  value: ActionValue,
  suit?: TrumpSuit
): AuctionState {
  if (state.order.indexOf(seat) === -1) throw new Error(`Seat ${seat} is not in this auction`);
  if (isBidLocked(state, seat)) throw new Error(`Seat ${seat}'s bid is locked`);
  return { ...state, entries: { ...state.entries, [seat]: mkEntry(value, suit) } };
}

// Set or change a seat's trump on an existing non-pass bid. Throws if the seat hasn't entered,
// passed, or its trump is locked (see canSetTrump).
export function setTrump(state: AuctionState, seat: number, suit: TrumpSuit): AuctionState {
  const e = state.entries[seat];
  if (!e) throw new Error(`Seat ${seat} has not entered a bid`);
  if (e.value === 'PASS') throw new Error(`Seat ${seat} passed; no trump to set`);
  if (!canSetTrump(state, seat)) throw new Error(`Seat ${seat}'s trump is locked`);
  return { ...state, entries: { ...state.entries, [seat]: { value: e.value, suit } } };
}

// Final outcome once the auction is complete (null while still in progress). `winningSuit` is
// null when the winner has not yet picked a trump — the hand must wait for their pick.
export function auctionResult(state: AuctionState): AuctionResult | null {
  if (!isComplete(state)) return null;
  const { highSeat } = resolve(state);
  if (highSeat === null) {
    return { complete: true, thrownIn: true, winnerSeat: null, winningBid: null, winningSuit: null };
  }
  const e = state.entries[highSeat]!;
  return {
    complete: true,
    thrownIn: false,
    winnerSeat: highSeat,
    winningBid: e.value as BidValue,
    winningSuit: e.suit ?? null,
  };
}
