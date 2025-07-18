import { describe, it, expect } from 'vitest'
import { 
  calculateScore, 
  isHandComplete, 
  encodeHand, 
  decodeHand,
  isPepperRound,
  getNextDealer,
  getCurrentPhase 
} from '../../src/lib/gameState'

describe('calculateScore', () => {
  it('calculates basic bidding team success', () => {
    // Player 1 bids 4 hearts, plays, gets 2 tricks (needs 4, gets 2 = 6 total, exactly right)
    const hand = '114HP2' // dealer=1, bidder=1, bid=4, trump=Hearts, played, 2 tricks
    const [team1Score, team2Score] = calculateScore(hand)
    expect(team1Score).toBe(4) // Bidding team gets their bid
    expect(team2Score).toBe(2) // Defending team gets remaining tricks
  })

  it('calculates bidding team set', () => {
    // Player 1 bids 5, gets only 2 tricks (needs 5, gets 2 = 7 total, over 6)
    const hand = '115HP2' // dealer=1, bidder=1, bid=5, trump=Hearts, played, 2 tricks
    const [team1Score, team2Score] = calculateScore(hand)
    expect(team1Score).toBe(-5) // Bidding team set, loses bid value
    expect(team2Score).toBe(2)  // Defending team gets tricks they won
  })

  it('calculates defending team set (tricks=0)', () => {
    // Player 1 bids 4, defending team gets 0 tricks
    const hand = '114HP0' // dealer=1, bidder=1, bid=4, trump=Hearts, played, 0 tricks
    const [team1Score, team2Score] = calculateScore(hand)
    expect(team1Score).toBe(4)  // Bidding team gets bid value
    expect(team2Score).toBe(-4) // Defending team set
  })

  it('calculates folded hand', () => {
    // Player 1 bids 5, folds, gives 2 tricks to opponents
    const hand = '115HF2' // dealer=1, bidder=1, bid=5, trump=Hearts, folded, 2 tricks given
    const [team1Score, team2Score] = calculateScore(hand)
    expect(team1Score).toBe(5) // Bidding team gets bid value
    expect(team2Score).toBe(2) // Defending team gets negotiated tricks
  })

  it('calculates moon bid success', () => {
    // Player 2 bids moon, gets 4 tricks (needs 6, gets 4 = 10 total, over 6 = set)
    const hand = '12MHP4' // dealer=1, bidder=2, bid=Moon, trump=Hearts, played, 4 tricks
    const [team1Score, team2Score] = calculateScore(hand)
    expect(team1Score).toBe(7) // Moon bid = 7 points, but bidder was set
    expect(team2Score).toBe(-7) // Team 2 (bidding team) was set
  })

  it('calculates throw-in hand', () => {
    // Throw-in hand (bidder=0)
    const hand = '10' // dealer=1, throw-in
    const [team1Score, team2Score] = calculateScore(hand)
    expect(team1Score).toBe(0)
    expect(team2Score).toBe(0)
  })
})

describe('isHandComplete', () => {
  it('recognizes complete 6-character hands', () => {
    expect(isHandComplete('114HP4')).toBe(true)
    expect(isHandComplete('125NF3')).toBe(true)
  })

  it('recognizes throw-in hands as complete', () => {
    expect(isHandComplete('10')).toBe(true)
    expect(isHandComplete('20')).toBe(true)
  })

  it('recognizes incomplete hands', () => {
    expect(isHandComplete('1')).toBe(false)
    expect(isHandComplete('11')).toBe(false)
    expect(isHandComplete('114')).toBe(false)
    expect(isHandComplete('114H')).toBe(false)
    expect(isHandComplete('114HP')).toBe(false)
  })

  it('handles empty string', () => {
    expect(isHandComplete('')).toBe(false)
  })
})

describe('encodeHand and decodeHand', () => {
  it('encodes and decodes a basic hand correctly', () => {
    const encoded = encodeHand(1, 2, 5, 'H', 'P', 3)
    expect(encoded).toBe('125HP3')
    
    const decoded = decodeHand(encoded)
    expect(decoded.dealer).toBe(1)
    expect(decoded.bidWinner).toBe(2)
    expect(decoded.bid).toBe('5')
    expect(decoded.trump).toBe('H')
    expect(decoded.decision).toBe('P')
    expect(decoded.tricks).toBe(3)
  })

  it('encodes and decodes moon bids', () => {
    const encoded = encodeHand(3, 4, 'M', 'N', 'F', 1)
    expect(encoded).toBe('34MNF1')
    
    const decoded = decodeHand(encoded)
    expect(decoded.dealer).toBe(3)
    expect(decoded.bidWinner).toBe(4)
    expect(decoded.bid).toBe('M')
    expect(decoded.trump).toBe('N')
    expect(decoded.decision).toBe('F')
    expect(decoded.tricks).toBe(1)
  })

  it('handles pepper bids', () => {
    const encoded = encodeHand(2, 3, 'P', 'C', 'P', 2)
    expect(encoded).toBe('23PCP2')
    
    const decoded = decodeHand(encoded)
    expect(decoded.bid).toBe('P')
  })
})

describe('isPepperRound', () => {
  it('identifies first 4 hands as pepper rounds', () => {
    expect(isPepperRound(0)).toBe(true)
    expect(isPepperRound(1)).toBe(true)
    expect(isPepperRound(2)).toBe(true)
    expect(isPepperRound(3)).toBe(true)
  })

  it('identifies later hands as not pepper rounds', () => {
    expect(isPepperRound(4)).toBe(false)
    expect(isPepperRound(5)).toBe(false)
    expect(isPepperRound(10)).toBe(false)
  })
})

describe('getNextDealer', () => {
  it('cycles through dealers 1-4', () => {
    expect(getNextDealer(1)).toBe(2)
    expect(getNextDealer(2)).toBe(3)
    expect(getNextDealer(3)).toBe(4)
    expect(getNextDealer(4)).toBe(1)
  })
})

describe('getCurrentPhase', () => {
  it('identifies phases correctly', () => {
    expect(getCurrentPhase('')).toBe('bidder')
    expect(getCurrentPhase('1')).toBe('bidder')
    expect(getCurrentPhase('12')).toBe('bid')
    expect(getCurrentPhase('125')).toBe('trump')
    expect(getCurrentPhase('125H')).toBe('decision')
    expect(getCurrentPhase('125HP')).toBe('tricks')
    expect(getCurrentPhase('125HP4')).toBe('tricks')
  })
})