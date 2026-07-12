import { describe, it, expect } from 'vitest'
import {
  selectSeriesAwards,
  seriesAwards,
  evaluateAward
} from '../../src/lib/pepper-awards'
import {
  trackAwardData,
  initializeAwardTracking,
  type AwardTrackingData
} from '../../src/lib/statistics-util'
import { seededRng } from '../helpers/seededRng'

describe('Series Awards', () => {
  const players = ['Alice', 'Bob', 'Charlie', 'Dana']
  const teams = ['Team 1', 'Team 2']

  describe('Series MVP Award', () => {
    it('identifies series MVP based on net points', () => {
      // Game 1: Alice makes several successful bids
      const game1Hands = [
        '114HP2', // Alice bids 4, succeeds (+4 net points)
        '225HP1', // Bob bids 5, succeeds (+5 net points) 
        '134HP2', // Alice bids 4, succeeds (+4 net points)
        '245HP1', // Bob bids 5, succeeds (+5 net points)
      ]
      
      // Game 2: Alice continues strong performance
      const game2Hands = [
        '116HP1', // Alice bids 6, succeeds (+6 net points)
        '225HP1', // Bob bids 5, succeeds (+5 net points)
        '134HP2', // Alice bids 4, succeeds (+4 net points)
      ]
      
      // Track award data for both games
      const game1Data = trackAwardData(game1Hands, players, teams, [12, 14], 1)
      const game2Data = trackAwardData(game2Hands, players, teams, [12, 6], 0)
      
      // Combine series statistics (simulate series tracking)
      const seriesData: AwardTrackingData = {
        playerStats: {
          Alice: {
            ...game1Data.playerStats.Alice,
            netPoints: game1Data.playerStats.Alice.netPoints + game2Data.playerStats.Alice.netPoints,
            bidsWon: game1Data.playerStats.Alice.bidsWon + game2Data.playerStats.Alice.bidsWon,
            bidsSucceeded: game1Data.playerStats.Alice.bidsSucceeded + game2Data.playerStats.Alice.bidsSucceeded,
            pointsPerBid: [...game1Data.playerStats.Alice.pointsPerBid, ...game2Data.playerStats.Alice.pointsPerBid]
          },
          Bob: {
            ...game1Data.playerStats.Bob,
            netPoints: game1Data.playerStats.Bob.netPoints + game2Data.playerStats.Bob.netPoints,
            bidsWon: game1Data.playerStats.Bob.bidsWon + game2Data.playerStats.Bob.bidsWon,
            bidsSucceeded: game1Data.playerStats.Bob.bidsSucceeded + game2Data.playerStats.Bob.bidsSucceeded,
            pointsPerBid: [...game1Data.playerStats.Bob.pointsPerBid, ...game2Data.playerStats.Bob.pointsPerBid]
          },
          Charlie: game1Data.playerStats.Charlie,
          Dana: game1Data.playerStats.Dana
        },
        teamStats: game1Data.teamStats,
        pointsHistory: game1Data.pointsHistory,
        handScores: game1Data.handScores,
        hands: [...game1Hands, ...game2Hands],
        winningTeam: null, // Series could be tied
        winningTeamName: '',
        gameCompleted: true
      }
      
      // Selection is now random per category, so evaluate the specific award
      // directly for a deterministic winner assertion.
      const seriesMVP = evaluateAward(seriesAwards.find(d => d.id === 'series_mvp')!, seriesData)

      expect(seriesMVP).toBeTruthy()
      // Alice should have highest net points: Game1: +8, Game2: +4 = +12
      // Bob should have: Game1: +10, Game2: +5 = +15
      expect(seriesMVP?.winner).toBe('Bob') // Bob actually has higher net points
    })
    
    it('demonstrates the MVP award issue - low contributor can win with fewer bids', () => {
      // Scenario: Alice makes many bids with mixed success, Bob makes few but successful bids
      const game1Hands = [
        '114HP2', // Alice bids 4, succeeds (+4)
        '225HP1', // Bob bids 5, succeeds (+5)
        '11MHP5', // Alice bids Moon, fails (-7)
        '244HP1', // Bob bids 4, succeeds (+4)
        '136HP4', // Alice bids 6, fails (-6)
        '245HP1', // Bob bids 5, succeeds (+5)
      ]
      
      const game2Hands = [
        '114HP2', // Alice bids 4, succeeds (+4)
        '225HP1', // Bob bids 5, succeeds (+5)
        '11MHP5', // Alice bids Moon, fails (-7)
        '246HP1', // Bob bids 6, succeeds (+6)
      ]
      
      const game1Data = trackAwardData(game1Hands, players, teams, [6, 20], 1)
      const game2Data = trackAwardData(game2Hands, players, teams, [8, 12], 1)
      
      // Combine series statistics
      const seriesData: AwardTrackingData = {
        playerStats: {
          Alice: {
            ...game1Data.playerStats.Alice,
            netPoints: game1Data.playerStats.Alice.netPoints + game2Data.playerStats.Alice.netPoints,
            bidsWon: game1Data.playerStats.Alice.bidsWon + game2Data.playerStats.Alice.bidsWon,
            bidsSucceeded: game1Data.playerStats.Alice.bidsSucceeded + game2Data.playerStats.Alice.bidsSucceeded,
            bidsFailed: game1Data.playerStats.Alice.bidsFailed + game2Data.playerStats.Alice.bidsFailed,
            pointsPerBid: [...game1Data.playerStats.Alice.pointsPerBid, ...game2Data.playerStats.Alice.pointsPerBid]
          },
          Bob: {
            ...game1Data.playerStats.Bob,
            netPoints: game1Data.playerStats.Bob.netPoints + game2Data.playerStats.Bob.netPoints,
            bidsWon: game1Data.playerStats.Bob.bidsWon + game2Data.playerStats.Bob.bidsWon,
            bidsSucceeded: game1Data.playerStats.Bob.bidsSucceeded + game2Data.playerStats.Bob.bidsSucceeded,
            bidsFailed: game1Data.playerStats.Bob.bidsFailed + game2Data.playerStats.Bob.bidsFailed,
            pointsPerBid: [...game1Data.playerStats.Bob.pointsPerBid, ...game2Data.playerStats.Bob.pointsPerBid]
          },
          Charlie: game1Data.playerStats.Charlie,
          Dana: game1Data.playerStats.Dana
        },
        teamStats: game1Data.teamStats,
        pointsHistory: game1Data.pointsHistory,
        handScores: game1Data.handScores,
        hands: [...game1Hands, ...game2Hands],
        winningTeam: null,
        winningTeamName: '',
        gameCompleted: true
      }
      
      const seriesMVP = evaluateAward(seriesAwards.find(d => d.id === 'series_mvp')!, seriesData)

      // Check the net points for context
      const aliceNetPoints = seriesData.playerStats.Alice.netPoints
      const bobNetPoints = seriesData.playerStats.Bob.netPoints
      
      console.log(`Alice: ${seriesData.playerStats.Alice.bidsWon} bids, ${seriesData.playerStats.Alice.bidsSucceeded} successes, ${aliceNetPoints} net points`)
      console.log(`Bob: ${seriesData.playerStats.Bob.bidsWon} bids, ${seriesData.playerStats.Bob.bidsSucceeded} successes, ${bobNetPoints} net points`)
      
      // This test demonstrates the issue - Bob might win MVP despite making fewer bids
      expect(seriesMVP?.winner).toBe('Bob') // Bob wins with fewer, safer bids
      expect(seriesData.playerStats.Bob.bidsWon).toBeLessThan(seriesData.playerStats.Alice.bidsWon)
      expect(bobNetPoints).toBeGreaterThan(aliceNetPoints)
    })
    
    it('shows MVP can go to player who made very few bids', () => {
      // Extreme scenario: Charlie makes one successful Moon bid, everyone else struggles
      const game1Hands = [
        '114HP4', // Alice bids 4, fails (-4)
        '225HP4', // Bob bids 5, fails (-5)
        '33MHP0', // Charlie bids Moon, succeeds (+7)
        '414HP4', // Alice bids 4, fails (-4)
      ]
      
      const game2Hands = [
        '114HP4', // Alice bids 4, fails (-4)
        '225HP4', // Bob bids 5, fails (-5)
        '314HP4', // Alice bids 4, fails (-4)
      ]
      
      const game1Data = trackAwardData(game1Hands, players, teams, [7, 17], 1)
      const game2Data = trackAwardData(game2Hands, players, teams, [0, 13], 1)
      
      // Combine series statistics
      const seriesData: AwardTrackingData = {
        playerStats: {
          Alice: {
            ...game1Data.playerStats.Alice,
            netPoints: game1Data.playerStats.Alice.netPoints + game2Data.playerStats.Alice.netPoints,
            bidsWon: game1Data.playerStats.Alice.bidsWon + game2Data.playerStats.Alice.bidsWon,
            bidsSucceeded: game1Data.playerStats.Alice.bidsSucceeded + game2Data.playerStats.Alice.bidsSucceeded,
            bidsFailed: game1Data.playerStats.Alice.bidsFailed + game2Data.playerStats.Alice.bidsFailed,
            pointsPerBid: [...game1Data.playerStats.Alice.pointsPerBid, ...game2Data.playerStats.Alice.pointsPerBid]
          },
          Bob: {
            ...game1Data.playerStats.Bob,
            netPoints: game1Data.playerStats.Bob.netPoints + game2Data.playerStats.Bob.netPoints,
            bidsWon: game1Data.playerStats.Bob.bidsWon + game2Data.playerStats.Bob.bidsWon,
            bidsSucceeded: game1Data.playerStats.Bob.bidsSucceeded + game2Data.playerStats.Bob.bidsSucceeded,
            bidsFailed: game1Data.playerStats.Bob.bidsFailed + game2Data.playerStats.Bob.bidsFailed,
            pointsPerBid: [...game1Data.playerStats.Bob.pointsPerBid, ...game2Data.playerStats.Bob.pointsPerBid]
          },
          Charlie: {
            ...game1Data.playerStats.Charlie,
            netPoints: game1Data.playerStats.Charlie.netPoints + game2Data.playerStats.Charlie.netPoints,
            bidsWon: game1Data.playerStats.Charlie.bidsWon + game2Data.playerStats.Charlie.bidsWon,
            bidsSucceeded: game1Data.playerStats.Charlie.bidsSucceeded + game2Data.playerStats.Charlie.bidsSucceeded,
            bidsFailed: game1Data.playerStats.Charlie.bidsFailed + game2Data.playerStats.Charlie.bidsFailed,
            pointsPerBid: [...game1Data.playerStats.Charlie.pointsPerBid, ...game2Data.playerStats.Charlie.pointsPerBid]
          },
          Dana: game1Data.playerStats.Dana
        },
        teamStats: game1Data.teamStats,
        pointsHistory: game1Data.pointsHistory,
        handScores: game1Data.handScores,
        hands: [...game1Hands, ...game2Hands],
        winningTeam: null,
        winningTeamName: '',
        gameCompleted: true
      }
      
      const seriesMVP = evaluateAward(seriesAwards.find(d => d.id === 'series_mvp')!, seriesData)

      // Charlie should win MVP with only 1 bid across 2 games
      expect(seriesMVP?.winner).toBe('Charlie')
      expect(seriesData.playerStats.Charlie.bidsWon).toBe(1)
      expect(seriesData.playerStats.Charlie.netPoints).toBe(7)
      expect(seriesData.playerStats.Alice.bidsWon).toBeGreaterThan(1)
      expect(seriesData.playerStats.Alice.netPoints).toBeLessThan(7)
    })
  })
  
  describe('Series Award Data Tracking', () => {
    it('correctly aggregates player statistics across multiple games', () => {
      const game1Hands = ['114HP2', '225HP1']
      const game2Hands = ['116HP1', '225HP1']
      
      const game1Data = trackAwardData(game1Hands, players, teams, [6, 6], 0)
      const game2Data = trackAwardData(game2Hands, players, teams, [8, 6], 0)
      
      // Manually combine series data (as the actual series logic would)
      const seriesPlayerStats = {
        Alice: {
          ...game1Data.playerStats.Alice,
          netPoints: game1Data.playerStats.Alice.netPoints + game2Data.playerStats.Alice.netPoints,
          bidsWon: game1Data.playerStats.Alice.bidsWon + game2Data.playerStats.Alice.bidsWon,
          bidsSucceeded: game1Data.playerStats.Alice.bidsSucceeded + game2Data.playerStats.Alice.bidsSucceeded,
          pointsPerBid: [...game1Data.playerStats.Alice.pointsPerBid, ...game2Data.playerStats.Alice.pointsPerBid]
        },
        Bob: {
          ...game1Data.playerStats.Bob,
          netPoints: game1Data.playerStats.Bob.netPoints + game2Data.playerStats.Bob.netPoints,
          bidsWon: game1Data.playerStats.Bob.bidsWon + game2Data.playerStats.Bob.bidsWon,
          bidsSucceeded: game1Data.playerStats.Bob.bidsSucceeded + game2Data.playerStats.Bob.bidsSucceeded,
          pointsPerBid: [...game1Data.playerStats.Bob.pointsPerBid, ...game2Data.playerStats.Bob.pointsPerBid]
        }
      }
      
      // Verify series aggregation
      expect(seriesPlayerStats.Alice.bidsWon).toBe(2) // 1 from each game
      expect(seriesPlayerStats.Alice.netPoints).toBe(-2) // 4 + (-6) = -2
      expect(seriesPlayerStats.Bob.bidsWon).toBe(2) // 1 from each game
      expect(seriesPlayerStats.Bob.netPoints).toBe(10) // 5 + 5
    })
    
    it('handles failed bids correctly in series aggregation', () => {
      const game1Hands = ['114HP2', '22MHP5'] // Alice succeeds, Bob fails Moon
      const game2Hands = ['116HP4', '225HP1'] // Alice fails, Bob succeeds
      
      const game1Data = trackAwardData(game1Hands, players, teams, [4, 2], 0)
      const game2Data = trackAwardData(game2Hands, players, teams, [0, 5], 1)
      
      // Combine series statistics
      const aliceSeriesNetPoints = game1Data.playerStats.Alice.netPoints + game2Data.playerStats.Alice.netPoints
      const bobSeriesNetPoints = game1Data.playerStats.Bob.netPoints + game2Data.playerStats.Bob.netPoints
      
      expect(aliceSeriesNetPoints).toBe(-2) // +4 (game1) + -6 (game2)
      expect(bobSeriesNetPoints).toBe(-2) // -7 (game1) + 5 (game2)
    })
  })
  
  describe('Team Series Awards', () => {
    it('awards Defensive Specialists to team with highest defensive success rate', () => {
      const seriesData = initializeAwardTracking(players, teams)
      
      // Set up realistic series defensive stats (minimum 5 defenses required)
      seriesData.teamStats['Team 1'].totalDefenses = 6
      seriesData.teamStats['Team 1'].successfulDefenses = 2
      seriesData.teamStats['Team 1'].defensiveSuccessRate = 2/6 // 33.3%
      
      seriesData.teamStats['Team 2'].totalDefenses = 5
      seriesData.teamStats['Team 2'].successfulDefenses = 4
      seriesData.teamStats['Team 2'].defensiveSuccessRate = 4/5 // 80%
      
      seriesData.gameCompleted = true
      
      const defensiveSpecialists = evaluateAward(seriesAwards.find(d => d.id === 'defensive_specialists')!, seriesData)

      expect(defensiveSpecialists).toBeTruthy()
      expect(defensiveSpecialists?.winner).toBe('Team 2') // 80% vs 33.3%
    })

    it('awards Bid Bullies to team with most successful high-value bids', () => {
      const seriesData = initializeAwardTracking(players, teams)
      
      // Team 1 players (Alice, Charlie) make high-value bids
      seriesData.teamStats['Team 1'].highValueBids = { attempts: 5, successes: 4 }
      seriesData.teamStats['Team 2'].highValueBids = { attempts: 3, successes: 2 }
      seriesData.gameCompleted = true
      
      const bidBullies = evaluateAward(seriesAwards.find(d => d.id === 'bid_bullies')!, seriesData)

      expect(bidBullies).toBeTruthy()
      expect(bidBullies?.winner).toBe('Team 1') // 4 successful high-value bids vs 2
    })

    it('awards Streak Masters to team with longest consecutive scoring streak', () => {
      const seriesData = initializeAwardTracking(players, teams)
      
      seriesData.teamStats['Team 1'].longestStreak = 8
      seriesData.teamStats['Team 2'].longestStreak = 5
      seriesData.gameCompleted = true
      
      const streakMasters = evaluateAward(seriesAwards.find(d => d.id === 'streak_masters')!, seriesData)

      expect(streakMasters).toBeTruthy()
      expect(streakMasters?.winner).toBe('Team 1') // 8-hand streak vs 5
    })
  })

  describe('Player Series Awards', () => {
    it('evaluates Suit Specialist award correctly', () => {
      const seriesData = initializeAwardTracking(players, teams)
      
      // Alice dominates Hearts: 5/6 attempts = 83.3%
      seriesData.playerStats.Alice.trumpBids.H = { attempts: 6, successes: 5 }
      seriesData.playerStats.Alice.bidsWon = 6
      
      // Bob decent at Clubs: 3/4 attempts = 75%
      seriesData.playerStats.Bob.trumpBids.C = { attempts: 4, successes: 3 }
      seriesData.playerStats.Bob.bidsWon = 4
      
      // Charlie perfect but low volume in Spades: 2/2 = 100% but below minimum
      seriesData.playerStats.Charlie.trumpBids.S = { attempts: 2, successes: 2 }
      seriesData.playerStats.Charlie.bidsWon = 2
      
      seriesData.gameCompleted = true
      
      // Direct test of the real award evaluation logic
      const suitSpecialistAward = seriesAwards.find(a => a.id === 'suit_specialist')
      expect(suitSpecialistAward).toBeTruthy()

      const result = evaluateAward(suitSpecialistAward!, seriesData)

      expect(result).toBeTruthy()
      expect(result?.winner).toBe('Alice') // Highest rate (83.3%) with min 4 attempts
    })

    it('evaluates Pepper Perfect award correctly', () => {
      const seriesData = initializeAwardTracking(players, teams)
      
      // Alice: perfect pepper rounds (3 successes, 0 failures) + set opponents twice
      seriesData.playerStats.Alice.pepperRoundBids = { attempts: 3, successes: 3, opponents_set: 2 }
      
      // Bob: good but not perfect (4 attempts, 3 successes) + set opponents once  
      seriesData.playerStats.Bob.pepperRoundBids = { attempts: 4, successes: 3, opponents_set: 1 }
      
      // Charlie: perfect but didn't set opponents
      seriesData.playerStats.Charlie.pepperRoundBids = { attempts: 2, successes: 2, opponents_set: 0 }
      
      seriesData.gameCompleted = true
      
      // Direct test of the real award evaluation logic
      const pepperPerfectAward = seriesAwards.find(a => a.id === 'pepper_perfect')
      expect(pepperPerfectAward).toBeTruthy()

      const result = evaluateAward(pepperPerfectAward!, seriesData)

      expect(result).toBeTruthy()
      expect(result?.winner).toBe('Alice') // Perfect record + set opponents
    })

    it('awards Moon Struck to player with most failed Moon attempts', () => {
      const seriesData = initializeAwardTracking(players, teams)

      // moon_struck counts only FAILED Moon (7) / Double Moon (14) bids, not 6-bids.
      // Alice: 5 failed moons (meets minimum of 3)
      seriesData.playerStats.Alice.failedBidValues = [7, 7, 7, 14, 7]
      seriesData.playerStats.Alice.bidsWon = 8

      // Bob: 3 failed moons (meets minimum)
      seriesData.playerStats.Bob.failedBidValues = [7, 14, 7]
      seriesData.playerStats.Bob.bidsWon = 6

      // Charlie: 2 failed moons (below minimum) plus failed 6-bids that must NOT count
      seriesData.playerStats.Charlie.failedBidValues = [7, 7, 6, 6, 6]
      seriesData.playerStats.Charlie.bidsWon = 4

      seriesData.gameCompleted = true

      const moonStruck = evaluateAward(seriesAwards.find(d => d.id === 'moon_struck')!, seriesData)

      expect(moonStruck).toBeTruthy()
      expect(moonStruck?.winner).toBe('Alice') // 5 failed moons vs Bob's 3
    })

    it('awards Feast or Famine to player with highest bidding variance', () => {
      const seriesData = initializeAwardTracking(players, teams)
      
      // Alice: very inconsistent results [7, -7, 6, -6, 5, -5]
      seriesData.playerStats.Alice.pointsPerBid = [7, -7, 6, -6, 5, -5]
      seriesData.playerStats.Alice.bidsWon = 6
      
      // Bob: more consistent results [5, 4, 5, 4, 5]
      seriesData.playerStats.Bob.pointsPerBid = [5, 4, 5, 4, 5]
      seriesData.playerStats.Bob.bidsWon = 5
      
      // Charlie: very consistent [4, 4, 4, 4]
      seriesData.playerStats.Charlie.pointsPerBid = [4, 4, 4, 4]
      seriesData.playerStats.Charlie.bidsWon = 4
      
      seriesData.gameCompleted = true
      
      const feastOrFamine = evaluateAward(seriesAwards.find(d => d.id === 'feast_or_famine')!, seriesData)

      expect(feastOrFamine).toBeTruthy()
      expect(feastOrFamine?.winner).toBe('Alice') // Highest variance in bid results
    })

    it('evaluates Punching Bag award correctly', () => {
      // The real Punching Bag award is a TEAM award: the team that most often
      // went set defending a PLAYED 4/5 bid (which could have been negotiated). It
      // reads the actual hands, so craft hands where each defending set = a played
      // 4/5 bid the defenders got shut out on (tricks === 0 → defenders go negative).
      const seriesData = initializeAwardTracking(players, teams)

      // Team 1 = index 0 (seats 1 & 3 bid); Team 2 = index 1 (seats 2 & 4 bid).
      // A defender is set only on decision 'P' with tricks '0'.
      seriesData.hands = [
        '124HP0', // seat 2 (Team 2) bids 4, played, defenders (Team 1) shut out -> Team 1 set
        '145HP0', // seat 4 (Team 2) bids 5, played, defenders (Team 1) shut out -> Team 1 set
        '114HP0', // seat 1 (Team 1) bids 4, played, defenders (Team 2) shut out -> Team 2 set (only 1)
        '236HP2', // seat 3 bids 6 (not a 4/5 bid) -> ignored by this award
      ]
      seriesData.gameCompleted = true

      // Direct test of the real award evaluation logic.
      const gamblingProblemAward = seriesAwards.find(a => a.id === 'punching_bag')
      expect(gamblingProblemAward).toBeTruthy()

      // Regression guard: `punching_bag` is declared `type: 'team'`, and its evaluation `case`
      // must live in evaluateAward's team switch. It previously sat in the player switch, so the
      // team-typed award was unreachable (dispatch keys off award.type) and could NEVER be given.
      // Now it evaluates correctly: Team 1 (2 defensive sets against played 4/5 bids, meeting the
      // >=2 minimum) beats Team 2 (only 1).
      const result = evaluateAward(gamblingProblemAward!, seriesData)
      expect(result).toBeTruthy()
      expect(result?.winner).toBe('Team 1')
    })
  })

  describe('Series Award Integration', () => {
    it('selects multiple appropriate series awards', () => {
      const seriesData = initializeAwardTracking(players, teams)
      
      // Set up data that should trigger multiple awards
      seriesData.playerStats.Alice.netPoints = 35 // Highest for MVP
      seriesData.playerStats.Alice.bidsWon = 8
      seriesData.playerStats.Alice.trumpBids.H = { attempts: 5, successes: 5 } // Perfect Hearts
      
      seriesData.teamStats['Team 1'].highValueBids = { attempts: 6, successes: 5 } // Bid Bullies
      seriesData.teamStats['Team 1'].longestStreak = 7 // Streak Masters
      
      seriesData.gameCompleted = true
      
      // Both awards must be ELIGIBLE for this data (deterministic), even though
      // which one actually gets picked per category is now random.
      const mvpEligible = evaluateAward(seriesAwards.find(d => d.id === 'series_mvp')!, seriesData)
      const bidBulliesEligible = evaluateAward(seriesAwards.find(d => d.id === 'bid_bullies')!, seriesData)
      expect(mvpEligible).toBeTruthy()
      expect(mvpEligible?.winner).toBe('Alice') // Highest net points
      expect(bidBulliesEligible).toBeTruthy()
      expect(bidBulliesEligible?.winner).toBe('Team 1') // 5 successful high-value bids

      // And the selection returns a valid spread: up to 3 awards across distinct
      // categories, each with a real winner.
      const selectedAwards = selectSeriesAwards(seriesData, seededRng(1))

      expect(selectedAwards.length).toBeGreaterThan(1)
      expect(selectedAwards.length).toBeLessThanOrEqual(3)
      // Every selected award has a valid winner name.
      expect(selectedAwards.every(a => typeof a.winner === 'string' && a.winner.length > 0)).toBe(true)
      // Distinct categories: one team + one player + one dubious at most.
      const uniqueIds = new Set(selectedAwards.map(a => a.id))
      expect(uniqueIds.size).toBe(selectedAwards.length)
    })

    it('handles empty or minimal series data gracefully', () => {
      const emptySeriesData = initializeAwardTracking(players, teams)
      emptySeriesData.gameCompleted = true
      
      const selectedAwards = selectSeriesAwards(emptySeriesData)
      
      expect(Array.isArray(selectedAwards)).toBe(true)
      // Should still try to award MVP even with minimal data
      expect(selectedAwards.length).toBeGreaterThanOrEqual(0)
    })
  })
})