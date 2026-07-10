import { describe, it, expect } from 'vitest'
import {
  createAuction,
  biddingOrder,
  currentBidderSeat,
  legalBids,
  highSeat,
  highRank,
  submitInTurn,
  preCommit,
  cancelPreCommit,
  hasPendingPreCommit,
  auctionResult,
  isComplete,
  bidRank,
  type AuctionState,
} from '../../src/lib/auction'

// Drive the whole auction in dealer order via in-turn submits.
function playInOrder(state: AuctionState, actions: Array<[string, string?]>): AuctionState {
  let s = state
  for (const [value, suit] of actions) {
    const seat = currentBidderSeat(s)!
    s = submitInTurn(s, seat, value as any, suit as any)
  }
  return s
}

describe('biddingOrder', () => {
  it('starts left of the dealer and goes clockwise', () => {
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

describe('createAuction / current bidder', () => {
  it('opens with the player left of the dealer', () => {
    const s = createAuction(1, 4) // dealer seat 1
    expect(s.pointer).toBe(0)
    expect(currentBidderSeat(s)).toBe(2)
    expect(isComplete(s)).toBe(false)
    expect(legalBids(s)).toEqual(['4', '5', '6', 'M', 'D'])
  })
})

describe('in-turn auction', () => {
  it('resolves a normal ascending auction to the highest bidder', () => {
    // dealer 1 -> order [2,3,4,1]. 2 bids 4, 3 bids 5, 4 passes, 1 bids 6.
    let s = createAuction(1, 4)
    s = playInOrder(s, [['4'], ['5'], ['PASS'], ['6']])
    expect(isComplete(s)).toBe(true)
    const r = auctionResult(s)!
    expect(r.thrownIn).toBe(false)
    expect(r.winnerSeat).toBe(1)
    expect(r.winningBid).toBe('6')
    expect(r.winningSuit).toBeNull()
  })

  it('throws in the hand when everyone passes', () => {
    let s = createAuction(3, 5)
    s = playInOrder(s, [['PASS'], ['PASS'], ['PASS'], ['PASS']])
    const r = auctionResult(s)!
    expect(r.thrownIn).toBe(true)
    expect(r.winnerSeat).toBeNull()
    expect(r.winningBid).toBeNull()
  })

  it('only offers legal (strictly higher) bids to later bidders', () => {
    let s = createAuction(1, 4)
    s = submitInTurn(s, 2, '5')       // seat 2 bids 5
    expect(currentBidderSeat(s)).toBe(3)
    expect(legalBids(s)).toEqual(['6', 'M', 'D']) // must beat 5
    expect(highSeat(s)).toBe(2)
    expect(highRank(s)).toBe(5)
  })

  it('coerces a raced in-turn bid at or below the high to a pass', () => {
    // A UI wouldn't offer it, but a race might submit a stale bid; it must not stand.
    let s = createAuction(1, 4)
    s = submitInTurn(s, 2, '6')       // high is now 6
    s = submitInTurn(s, 3, '5')       // stale 5 <= 6 -> becomes PASS
    expect(s.actions[3]!.value).toBe('PASS')
    expect(highSeat(s)).toBe(2)
  })

  it('records a pre-picked trump on the winning in-turn bid', () => {
    let s = createAuction(1, 4)
    s = submitInTurn(s, 2, '5', 'H')
    s = playInOrder(s, [['PASS'], ['PASS'], ['PASS']])
    const r = auctionResult(s)!
    expect(r.winnerSeat).toBe(2)
    expect(r.winningSuit).toBe('H')
  })
})

describe('pre-commit layer', () => {
  it('holds an out-of-turn pre-commit hidden and editable until reached', () => {
    let s = createAuction(1, 4) // order [2,3,4,1], pointer at seat 2
    s = preCommit(s, 1, 'PASS') // seat 1 (last) pre-commits a pass
    expect(hasPendingPreCommit(s, 1)).toBe(true)
    expect(s.actions[1]!.committed).toBe(false)
    // Editing before resolution replaces it.
    s = preCommit(s, 1, '6', 'S')
    expect(s.actions[1]!.value).toBe('6')
    expect(s.actions[1]!.suit).toBe('S')
    // Cancelling removes it.
    s = cancelPreCommit(s, 1)
    expect(hasPendingPreCommit(s, 1)).toBe(false)
  })

  it('auto-passes a pre-commit that is <= the high when the pointer reaches it', () => {
    // seat 4 pre-commits 5; then 2 bids 6, 3 passes -> when pointer hits 4, 5 <= 6 -> PASS.
    let s = createAuction(1, 4) // order [2,3,4,1]
    s = preCommit(s, 4, '5')
    s = submitInTurn(s, 2, '6')   // pointer -> 3
    s = submitInTurn(s, 3, 'PASS') // pointer -> 4 which is seat 4, cascade resolves the pre-commit
    expect(s.actions[4]!.committed).toBe(true)
    expect(s.actions[4]!.value).toBe('PASS') // 5 <= 6
    // seat 1 still to act
    expect(currentBidderSeat(s)).toBe(1)
  })

  it('enters a pre-commit that is still high when reached', () => {
    let s = createAuction(1, 4) // order [2,3,4,1]
    s = preCommit(s, 4, '6', 'C') // seat 4 pre-commits 6 with clubs
    s = submitInTurn(s, 2, '4')   // pointer -> 3
    s = submitInTurn(s, 3, '5')   // pointer -> 4, cascade: 6 > 5 -> stands
    expect(s.actions[4]!.value).toBe('6')
    expect(s.actions[4]!.suit).toBe('C')
    expect(highSeat(s)).toBe(4)
  })

  it('cascades through several consecutive pre-commits at once', () => {
    // Everyone but seat 2 pre-commits a pass; seat 2 bids and the rest auto-resolve.
    let s = createAuction(1, 4) // order [2,3,4,1]
    s = preCommit(s, 3, 'PASS')
    s = preCommit(s, 4, 'PASS')
    s = preCommit(s, 1, 'PASS')
    s = submitInTurn(s, 2, '4') // seat 2 bids 4, cascade resolves 3,4,1 as passes
    expect(isComplete(s)).toBe(true)
    const r = auctionResult(s)!
    expect(r.winnerSeat).toBe(2)
    expect(r.winningBid).toBe('4')
  })

  it('gives a tie (equal pre-bids) to the earlier seat', () => {
    // seats 3 and 4 both pre-commit 5; seat 2 passes. 3 enters 5 (beats 0), 4's 5 <= 5 -> PASS.
    let s = createAuction(1, 4) // order [2,3,4,1]
    s = preCommit(s, 3, '5')
    s = preCommit(s, 4, '5')
    s = submitInTurn(s, 2, 'PASS') // pointer -> 3, cascade resolves 3 then 4
    // seat 1 still to act; kill it with a pass to finish
    s = submitInTurn(s, 1, 'PASS')
    const r = auctionResult(s)!
    expect(r.winnerSeat).toBe(3)   // earlier seat wins the tie
    expect(s.actions[4]!.value).toBe('PASS')
  })

  it('treats a pre-commit for the seat whose turn it already is as an in-turn submit', () => {
    let s = createAuction(1, 4) // pointer at seat 2
    s = preCommit(s, 2, '4')    // seat 2 is current -> commits immediately
    expect(s.actions[2]!.committed).toBe(true)
    expect(currentBidderSeat(s)).toBe(3)
  })

  it('rejects pre-committing for a seat not in the auction', () => {
    const s = createAuction(1, 4)
    expect(() => preCommit(s, 9, '4')).toThrow()
  })

  it('rejects submitting out of turn', () => {
    const s = createAuction(1, 4) // seat 2's turn
    expect(() => submitInTurn(s, 3, '4')).toThrow()
  })
})
