import { describe, it, expect } from 'vitest'
import { 
  calculateLongestStreak,
  calculateGameStats 
} from '../../src/lib/statistics-util'

describe('calculateLongestStreak', () => {
  it('calculates streak for successful bidding team', () => {
    // Team mapping: bidder 1,3 = team 0; bidder 2,4 = team 1
    const simpleHands = [
      '114HP2', // Bidder 1 (team 0) bids 4, gets 2 tricks (4+2=6, success) - team 0 streak = 1
      '135HP1', // Bidder 3 (team 0) bids 5, gets 1 trick (5+1=6, success) - team 0 streak = 2  
      '246HP3', // Bidder 4 (team 1) bids 6, gets 3 tricks (6+3=9>6, set) - team 0 gains, streak = 3
    ]
    
    const team0Streak = calculateLongestStreak(simpleHands, 0)
    expect(team0Streak).toBe(3)
  })

  it('resets streak when team fails bid', () => {
    const hands = [
      '114HP2', // Team 1 bids 4, gets 2 tricks, succeeds - streak = 1
      '115HP3', // Team 1 bids 5, gets 3 tricks (5+3=8>6, set) - streak resets
      '126HP1', // Team 1 bids 6, gets 1 trick, succeeds - streak = 1
    ]
    
    const team1Streak = calculateLongestStreak(hands, 0)
    expect(team1Streak).toBe(1) // Maximum streak was 1, not 2
  })

  it('handles throw-in hands by resetting streak', () => {
    const hands = [
      '114HP2', // Team 1 succeeds - streak = 1
      '20',     // Throw-in hand - resets streak  
      '325HP1', // Team 1 succeeds - streak = 1
    ]
    
    const team1Streak = calculateLongestStreak(hands, 0)
    expect(team1Streak).toBe(1)
  })

  it('handles folded hands as successes', () => {
    const hands = [
      '114HP2', // Bidder 1 (team 0) bids 4, succeeds - streak = 1
      '135HF3', // Bidder 3 (team 0) bids 5, folds (always success) - streak = 2
      '146HP1', // Bidder 1 (team 0) bids 6, succeeds - streak = 3
    ]
    
    const team0Streak = calculateLongestStreak(hands, 0)
    expect(team0Streak).toBe(3)
  })

  it('calculates streak when opponents get set', () => {
    const hands = [
      '224HP3', // Bidder 2 (team 1) bids 4, gets 3 tricks (4+3=7>6, set) - team 0 gains, streak = 1
      '245HP2', // Bidder 4 (team 1) bids 5, gets 2 tricks (5+2=7>6, set) - team 0 gains, streak = 2
      '136HP1', // Bidder 3 (team 0) bids 6, gets 1 trick (6+1=7>6, set) - team 0 streak breaks, but we had max 2
    ]
    
    const team0Streak = calculateLongestStreak(hands, 0)
    expect(team0Streak).toBe(2)
  })

  it('handles incomplete hands by skipping them', () => {
    const hands = [
      '114HP2', // Complete - team 1 succeeds, streak = 1
      '125H',   // Incomplete - skip
      '126HP1', // Complete - team 1 succeeds, streak = 2
    ]
    
    const team1Streak = calculateLongestStreak(hands, 0)
    expect(team1Streak).toBe(2)
  })

  it('returns 0 for empty hand list', () => {
    const team1Streak = calculateLongestStreak([], 0)
    expect(team1Streak).toBe(0)
  })

  it('calculates correct streak for team 1', () => {
    const hands = [
      '224HP2', // Bidder 2 (team 1) bids 4, succeeds - team 1 streak = 1
      '245HP1', // Bidder 4 (team 1) bids 5, succeeds - team 1 streak = 2  
      '136HP4', // Bidder 3 (team 0) bids 6, gets 4 tricks (6+4=10>6, set) - team 1 gains, streak = 3
    ]
    
    const team1Streak = calculateLongestStreak(hands, 1)
    expect(team1Streak).toBe(3)
  })
})

describe('calculateGameStats', () => {
  it('counts completed hands correctly', () => {
    const hands = [
      '114HP2', // Complete
      '125H',   // Incomplete  
      '20',     // Throw-in (complete)
      '336NF1', // Complete
    ]
    const players = ['Alice', 'Bob', 'Charlie', 'Dana']
    
    const stats = calculateGameStats(hands, players)
    expect(stats.totalHands).toBe(3) // 2 regular + 1 throw-in, skip incomplete
  })

  it('finds highest bid correctly', () => {
    const hands = [
      '114HP2', // 4 bid by Alice
      '225HP1', // 5 bid by Bob  
      '13MNP4', // Moon bid by Charlie
      '146HP2', // 6 bid by Alice
    ]
    const players = ['Alice', 'Bob', 'Charlie', 'Dana']
    
    const stats = calculateGameStats(hands, players)
    expect(stats.highestBid.value).toBe('M')
    expect(stats.highestBid.player).toBe('Charlie')
    expect(stats.highestBid.points).toBe(7)
  })

  it('counts trump usage correctly', () => {
    const hands = [
      '114HP2', // Hearts
      '225HP1', // Hearts
      '136CP2', // Clubs
      '24MNP1', // No trump
    ]
    const players = ['Alice', 'Bob', 'Charlie', 'Dana']
    
    const stats = calculateGameStats(hands, players)
    expect(stats.trumpCounts.H).toBe(2)
    expect(stats.trumpCounts.C).toBe(1)  
    expect(stats.trumpCounts.N).toBe(1)
    expect(stats.trumpCounts.S).toBe(0)
    expect(stats.trumpCounts.D).toBe(0)
  })

  it('identifies most common trump', () => {
    const hands = [
      '114HP2', // Hearts
      '225HP1', // Hearts
      '136HP2', // Hearts
      '247CP1', // Clubs
    ]
    const players = ['Alice', 'Bob', 'Charlie', 'Dana']
    
    const stats = calculateGameStats(hands, players)
    expect(stats.mostCommonTrump.suit).toBe('H')
    expect(stats.mostCommonTrump.count).toBe(3)
  })

  it('counts defensive wins (when bidding team gets 0 tricks)', () => {
    const hands = [
      '114HP0', // Team 1 bids, gets 0 tricks - defensive win
      '225HP2', // Team 2 bids, gets 2 tricks - normal
      '136HP0', // Team 1 bids, gets 0 tricks - defensive win
    ]
    const players = ['Alice', 'Bob', 'Charlie', 'Dana']
    
    const stats = calculateGameStats(hands, players)
    expect(stats.defensiveWins).toBe(2)
  })

  it('skips throw-in hands in calculations', () => {
    const hands = [
      '114HP2', // Normal hand
      '20',     // Throw-in - should be skipped
      '325HP1', // Normal hand
    ]
    const players = ['Alice', 'Bob', 'Charlie', 'Dana']
    
    const stats = calculateGameStats(hands, players)
    expect(stats.totalHands).toBe(3) // Includes throw-in in count
    // But trump counts should only reflect the 2 normal hands
    expect(stats.trumpCounts.H).toBe(2)
  })
})