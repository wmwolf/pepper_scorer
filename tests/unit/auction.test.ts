import { describe, it, expect } from 'vitest'
import {
  createAuction,
  biddingOrder,
  bidRank,
  hasEntered,
  revealedCount,
  isRevealed,
  isComplete,
  isBidLocked,
  resolve,
  isOutbid,
  canSetTrump,
  enterBid,
  setTrump,
  auctionResult,
} from '../../src/lib/auction'

describe('biddingOrder', () => {
  it('starts left of the dealer and goes clockwise, dealer last', () => {
    expect(biddingOrder(1)).toEqual([2, 3, 4, 1])
    expect(biddingOrder(2)).toEqual([3, 4, 1, 2])
    expect(biddingOrder(4)).toEqual([1, 2, 3, 4])
  })
})

describe('bidRank', () => {
  it('orders bids 4 < 5 < 6 < M < D and PASS lowest', () => {
    expect(bidRank('PASS')).toBe(0)
    expect(bidRank('4')).toBeLessThan(bidRank('5'))
    expect(bidRank('6')).toBeLessThan(bidRank('M'))
    expect(bidRank('M')).toBeLessThan(bidRank('D'))
  })
})

describe('createAuction', () => {
  it('opens empty with the full dealer-order and nothing revealed', () => {
    const s = createAuction(1, 4) // dealer seat 1 -> order [2,3,4,1]
    expect(s.order).toEqual([2, 3, 4, 1])
    expect(s.handIndex).toBe(4)
    expect(s.entries).toEqual({})
    expect(revealedCount(s)).toBe(0)
    expect(isComplete(s)).toBe(false)
  })
})

describe('concurrent entry + dealer-prefix reveal', () => {
  it('does not reveal an entered bid until everyone ahead has entered', () => {
    // order [2,3,4,1]. Seat 4 (3rd) enters first; nothing is revealed (2 and 3 missing).
    let s = createAuction(1, 4)
    s = enterBid(s, 4, '5', 'H')
    expect(hasEntered(s, 4)).toBe(true)
    expect(revealedCount(s)).toBe(0)
    expect(isRevealed(s, 4)).toBe(false)
  })

  it('cascade-reveals several already-entered later seats when the gap fills', () => {
    // Seats 3, 4, 1 (order positions 1,2,3) enter first, hidden. Seat 2 (position 0) entering
    // last reveals the whole prefix at once.
    let s = createAuction(1, 4) // order [2,3,4,1]
    s = enterBid(s, 3, '4')
    s = enterBid(s, 4, '5')
    s = enterBid(s, 1, '6')
    expect(revealedCount(s)).toBe(0) // seat 2 (first in order) still missing
    s = enterBid(s, 2, 'PASS')
    expect(revealedCount(s)).toBe(4)
    expect(isComplete(s)).toBe(true)
  })

  it('reveals a growing prefix as the front seats fill in order', () => {
    let s = createAuction(1, 4) // order [2,3,4,1]
    s = enterBid(s, 2, '4')
    expect(revealedCount(s)).toBe(1)
    s = enterBid(s, 3, '5')
    expect(revealedCount(s)).toBe(2)
    expect(isRevealed(s, 2)).toBe(true)
    expect(isRevealed(s, 3)).toBe(true)
    expect(isRevealed(s, 4)).toBe(false)
  })
})

describe('resolution (high bid)', () => {
  it('resolves a normal ascending auction to the highest bidder', () => {
    // order [2,3,4,1]: 2->4, 3->5, 4 passes, 1->6.
    let s = createAuction(1, 4)
    s = enterBid(s, 2, '4')
    s = enterBid(s, 3, '5')
    s = enterBid(s, 4, 'PASS')
    s = enterBid(s, 1, '6', 'S')
    const r = auctionResult(s)!
    expect(r.thrownIn).toBe(false)
    expect(r.winnerSeat).toBe(1)
    expect(r.winningBid).toBe('6')
    expect(r.winningSuit).toBe('S')
  })

  it('throws in the hand when everyone passes', () => {
    let s = createAuction(3, 5) // order [4,1,2,3]
    for (const seat of [4, 1, 2, 3]) s = enterBid(s, seat, 'PASS')
    const r = auctionResult(s)!
    expect(r.thrownIn).toBe(true)
    expect(r.winnerSeat).toBeNull()
    expect(r.winningBid).toBeNull()
  })

  it('treats a revealed bid at or below the high as a pass (auto-pass)', () => {
    // order [2,3,4,1]: 2 bids 6, 3 bids 5 (<=6 -> loses), 4 & 1 pass. Winner is seat 2.
    let s = createAuction(1, 4)
    s = enterBid(s, 2, '6')
    s = enterBid(s, 3, '5')
    s = enterBid(s, 4, 'PASS')
    s = enterBid(s, 1, 'PASS')
    expect(resolve(s).highSeat).toBe(2)
    expect(isOutbid(s, 3)).toBe(true)
    expect(auctionResult(s)!.winnerSeat).toBe(2)
  })

  it('gives a tie (equal bids) to the earlier seat in dealer order', () => {
    // order [2,3,4,1]: 2 and 3 both bid 5; 4 and 1 pass. Earlier seat (2) wins.
    let s = createAuction(1, 4)
    s = enterBid(s, 2, '5')
    s = enterBid(s, 3, '5')
    s = enterBid(s, 4, 'PASS')
    s = enterBid(s, 1, 'PASS')
    expect(auctionResult(s)!.winnerSeat).toBe(2)
    expect(isOutbid(s, 3)).toBe(true)
  })
})

describe('bid lock (edit window)', () => {
  it('keeps a bid editable until its successor is revealed, then locks it', () => {
    // order [2,3,4,1]. Seat 2 enters; still editable (successor 3 not revealed).
    let s = createAuction(1, 4)
    s = enterBid(s, 2, '4')
    expect(isRevealed(s, 2)).toBe(true)
    expect(isBidLocked(s, 2)).toBe(false) // successor (seat 3) not revealed yet
    s = enterBid(s, 2, '5') // audible correction: still allowed
    expect(s.entries[2]!.value).toBe('5')
    // Successor reveals -> seat 2 locks.
    s = enterBid(s, 3, 'PASS')
    expect(isRevealed(s, 3)).toBe(true)
    expect(isBidLocked(s, 2)).toBe(true)
    expect(() => enterBid(s, 2, '6')).toThrow()
  })

  it('lets the dealer (last seat) edit until auction completion', () => {
    // order [2,3,4,1]: seat 1 is dealer/last. It can edit while others are outstanding.
    let s = createAuction(1, 4)
    s = enterBid(s, 1, '4')      // entered but hidden (not first in order)
    expect(isBidLocked(s, 1)).toBe(false)
    s = enterBid(s, 1, '5')      // still editable
    expect(s.entries[1]!.value).toBe('5')
    // Fill the rest so the auction completes; now the dealer locks.
    s = enterBid(s, 2, 'PASS')
    s = enterBid(s, 3, 'PASS')
    s = enterBid(s, 4, 'PASS')
    expect(isComplete(s)).toBe(true)
    expect(isBidLocked(s, 1)).toBe(true)
    expect(() => enterBid(s, 1, '6')).toThrow()
  })
})

describe('trump decoupled from bid', () => {
  it('lets a bidder enter a bid and set trump separately', () => {
    let s = createAuction(1, 4)
    s = enterBid(s, 2, '5')            // no trump yet
    expect(s.entries[2]!.suit).toBeUndefined()
    s = setTrump(s, 2, 'D')
    expect(s.entries[2]!.suit).toBe('D')
    s = setTrump(s, 2, 'H')           // change it while still editable
    expect(s.entries[2]!.suit).toBe('H')
  })

  it('completes with winningSuit null until the winner picks trump, then resolves', () => {
    // order [2,3,4,1]: 2 bids 6 (no trump), everyone else passes. Auction fills but no trump yet.
    let s = createAuction(1, 4)
    s = enterBid(s, 2, '6')
    s = enterBid(s, 3, 'PASS')
    s = enterBid(s, 4, 'PASS')
    s = enterBid(s, 1, 'PASS')
    expect(isComplete(s)).toBe(true)
    expect(auctionResult(s)!.winningSuit).toBeNull()
    // Winner may still pick a trump post-completion.
    expect(canSetTrump(s, 2)).toBe(true)
    s = setTrump(s, 2, 'C')
    expect(auctionResult(s)!.winningSuit).toBe('C')
  })

  it('locks the winner trump once picked and the auction is complete', () => {
    let s = createAuction(1, 4)
    s = enterBid(s, 2, '6', 'C')
    s = enterBid(s, 3, 'PASS')
    s = enterBid(s, 4, 'PASS')
    s = enterBid(s, 1, 'PASS')
    expect(canSetTrump(s, 2)).toBe(false) // revealed as winner with a trump -> locked
    expect(() => setTrump(s, 2, 'H')).toThrow()
  })

  it('discards trump for an outbid seat and disallows setting it', () => {
    let s = createAuction(1, 4)
    s = enterBid(s, 2, '6', 'C') // will be the high
    s = enterBid(s, 3, '5', 'H') // revealed and outbid
    expect(isOutbid(s, 3)).toBe(true)
    expect(canSetTrump(s, 3)).toBe(false)
    expect(() => setTrump(s, 3, 'S')).toThrow()
  })
})

describe('mutator guards', () => {
  it('rejects entering a bid for a seat not in the auction', () => {
    const s = createAuction(1, 4)
    expect(() => enterBid(s, 9, '4')).toThrow()
  })

  it('rejects setting trump for a seat that has not entered', () => {
    const s = createAuction(1, 4)
    expect(() => setTrump(s, 2, 'C')).toThrow()
  })

  it('rejects setting trump on a pass', () => {
    let s = createAuction(1, 4)
    s = enterBid(s, 2, 'PASS')
    expect(() => setTrump(s, 2, 'C')).toThrow()
  })
})
