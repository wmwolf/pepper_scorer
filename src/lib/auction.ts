// src/lib/auction.ts
//
// Pure state machine for the Phase 8 mobile bidding auction. Pepper bidding is a single
// clockwise pass: starting left of the dealer, each of the four players in turn either
// bids strictly higher than the current high or passes; the highest bid wins (all pass =>
// thrown in). On top of that we layer optimistic out-of-turn *pre-commits* (see
// development-plan.md Phase 8). Everything here is deterministic and free of Firebase/DOM
// so it can back a transaction and be unit-tested exhaustively.
//
// Resolution rule (applies to both an in-turn submit and a pre-commit reached by the
// pointer): a non-pass whose rank is <= the current high becomes a PASS; otherwise it
// stands as the new high. Equal bids therefore go to the *earlier* seat — which resolves
// "matched bids" without an explicit re-prompt.

export type BidValue = '4' | '5' | '6' | 'M' | 'D';
export type TrumpSuit = 'C' | 'D' | 'H' | 'S' | 'N';
export type ActionValue = BidValue | 'PASS';

export interface AuctionAction {
  value: ActionValue;
  suit?: TrumpSuit;   // optional pre-picked trump; only meaningful when value !== 'PASS'
  committed: boolean; // true once resolved in sequence (locked & revealed); false = editable pre-commit
}

export interface AuctionState {
  handIndex: number;                      // which hand this auction belongs to (staleness guard)
  order: number[];                        // four 1-based seats in bidding order (left of dealer first)
  pointer: number;                        // index into order of the seat to act; === order.length when complete
  actions: Record<number, AuctionAction>; // keyed by 1-based seat
}

export interface AuctionResult {
  complete: boolean;
  thrownIn: boolean;                 // true when every seat passed
  winnerSeat: number | null;         // 1-based winning seat, or null when thrown in
  winningBid: BidValue | null;
  winningSuit: TrumpSuit | null;     // the winner's pre-picked trump, if any
}

const RANK: Record<ActionValue, number> = { PASS: 0, '4': 4, '5': 5, '6': 6, M: 7, D: 14 };
const BID_ORDER: BidValue[] = ['4', '5', '6', 'M', 'D'];

export function bidRank(value: ActionValue): number {
  return RANK[value] ?? 0;
}

// Bidding order for a 1-based dealer seat: the player to the dealer's left bids first,
// then clockwise. e.g. dealer 1 -> [2, 3, 4, 1].
export function biddingOrder(dealerSeat: number): number[] {
  return [0, 1, 2, 3].map(i => ((dealerSeat + i) % 4) + 1);
}

export function createAuction(dealerSeat: number, handIndex: number): AuctionState {
  return { handIndex, order: biddingOrder(dealerSeat), pointer: 0, actions: {} };
}

export function isComplete(state: AuctionState): boolean {
  return state.pointer >= state.order.length;
}

// The seat whose turn it currently is (1-based), or null if the auction is complete.
export function currentBidderSeat(state: AuctionState): number | null {
  return isComplete(state) ? null : state.order[state.pointer]!;
}

// Highest rank among *committed* (revealed) bids so far; 0 if no one has bid.
export function highRank(state: AuctionState): number {
  let max = 0;
  for (const seat of state.order) {
    const a = state.actions[seat];
    if (a && a.committed && a.value !== 'PASS') max = Math.max(max, bidRank(a.value));
  }
  return max;
}

// The seat currently holding the high bid (1-based), or null if none.
export function highSeat(state: AuctionState): number | null {
  let bestSeat: number | null = null;
  let bestRank = 0;
  for (const seat of state.order) {
    const a = state.actions[seat];
    if (a && a.committed && a.value !== 'PASS' && bidRank(a.value) > bestRank) {
      bestRank = bidRank(a.value);
      bestSeat = seat;
    }
  }
  return bestSeat;
}

// The bid values a fresh in-turn bidder may legally choose (strictly above the high).
export function legalBids(state: AuctionState): BidValue[] {
  const high = highRank(state);
  return BID_ORDER.filter(b => bidRank(b) > high);
}

// Apply the resolution rule to a raw intent given the current high rank.
function resolve(value: ActionValue, suit: TrumpSuit | undefined, high: number): AuctionAction {
  if (value === 'PASS' || bidRank(value) <= high) {
    return { value: 'PASS', committed: true };
  }
  return { value, suit, committed: true };
}

// After the pointer advances, resolve any consecutive future seats that already hold a
// pre-commit (committed === false), applying the resolution rule with the running high.
// Stops at the first seat with no action yet (we wait for them) or when complete.
function cascade(state: AuctionState): AuctionState {
  const actions = { ...state.actions };
  let pointer = state.pointer;
  const order = state.order;

  const currentHigh = () => {
    let max = 0;
    for (const seat of order) {
      const a = actions[seat];
      if (a && a.committed && a.value !== 'PASS') max = Math.max(max, bidRank(a.value));
    }
    return max;
  };

  while (pointer < order.length) {
    const seat = order[pointer]!;
    const pending = actions[seat];
    if (!pending) break;                 // seat hasn't acted or pre-committed — wait for them
    if (pending.committed) { pointer++; continue; } // already resolved (shouldn't normally happen)
    actions[seat] = resolve(pending.value, pending.suit, currentHigh());
    pointer++;
  }

  return { ...state, actions, pointer };
}

// Submit the current in-turn bidder's action (bid or pass), optionally with a pre-picked
// trump. Applies the resolution rule (a raced bid that is no longer high becomes a pass),
// advances the pointer, and cascades through any already-pre-committed following seats.
// Throws if it is not `seat`'s turn.
export function submitInTurn(
  state: AuctionState,
  seat: number,
  value: ActionValue,
  suit?: TrumpSuit
): AuctionState {
  if (currentBidderSeat(state) !== seat) {
    throw new Error(`Not seat ${seat}'s turn to bid`);
  }
  const resolved = resolve(value, suit, highRank(state));
  const advanced: AuctionState = {
    ...state,
    actions: { ...state.actions, [seat]: resolved },
    pointer: state.pointer + 1,
  };
  return cascade(advanced);
}

// Record (or replace) an out-of-turn pre-commit for a seat that has not yet been reached.
// The value/suit stay hidden and editable until the pointer resolves them. Throws if the
// seat isn't a future seat in this auction.
export function preCommit(
  state: AuctionState,
  seat: number,
  value: ActionValue,
  suit?: TrumpSuit
): AuctionState {
  const idx = state.order.indexOf(seat);
  if (idx === -1) throw new Error(`Seat ${seat} is not in this auction`);
  if (idx <= state.pointer - 1) throw new Error(`Seat ${seat} has already acted`);
  if (idx === state.pointer) {
    // It's actually this seat's turn — treat as a normal in-turn submit.
    return submitInTurn(state, seat, value, suit);
  }
  const action: AuctionAction = { value, suit: value === 'PASS' ? undefined : suit, committed: false };
  return { ...state, actions: { ...state.actions, [seat]: action } };
}

// Remove a not-yet-resolved pre-commit for a seat.
export function cancelPreCommit(state: AuctionState, seat: number): AuctionState {
  const existing = state.actions[seat];
  if (!existing || existing.committed) return state;
  const actions = { ...state.actions };
  delete actions[seat];
  return { ...state, actions };
}

// Does this seat have an editable (not-yet-resolved) pre-commit?
export function hasPendingPreCommit(state: AuctionState, seat: number): boolean {
  const a = state.actions[seat];
  return !!a && !a.committed;
}

// Final outcome once the auction is complete (null while still in progress).
export function auctionResult(state: AuctionState): AuctionResult | null {
  if (!isComplete(state)) return null;
  const seat = highSeat(state);
  if (seat === null) {
    return { complete: true, thrownIn: true, winnerSeat: null, winningBid: null, winningSuit: null };
  }
  const action = state.actions[seat]!;
  return {
    complete: true,
    thrownIn: false,
    winnerSeat: seat,
    winningBid: action.value as BidValue,
    winningSuit: action.suit ?? null,
  };
}
