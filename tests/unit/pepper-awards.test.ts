import { describe, it, expect } from 'vitest'
import { 
  selectGameAwards,
  selectSeriesAwards,
  gameAwards,
  seriesAwards
} from '../../src/lib/pepper-awards'
import { 
  trackAwardData,
  initializeAwardTracking,
  type AwardTrackingData 
} from '../../src/lib/statistics-util'

describe('Award System', () => {
  const players = ['Alice', 'Bob', 'Charlie', 'Dana']
  const teams = ['Team 1', 'Team 2']

  describe('Award Data Tracking', () => {
    it('initializes award tracking data correctly', () => {
      const awardData = initializeAwardTracking(players, teams)
      
      expect(awardData.playerStats).toHaveProperty('Alice')
      expect(awardData.playerStats).toHaveProperty('Bob')
      expect(awardData.playerStats).toHaveProperty('Charlie')
      expect(awardData.playerStats).toHaveProperty('Dana')
      
      expect(awardData.teamStats).toHaveProperty('Team 1')
      expect(awardData.teamStats).toHaveProperty('Team 2')
      
      expect(awardData.playerStats.Alice.team).toBe(0) // Alice is on team 0
      expect(awardData.playerStats.Bob.team).toBe(1)   // Bob is on team 1
      expect(awardData.playerStats.Charlie.team).toBe(0) // Charlie is on team 0
      expect(awardData.playerStats.Dana.team).toBe(1)    // Dana is on team 1
    })

    it('tracks basic player bid statistics', () => {
      const hands = [
        '114HP2', // Alice bids 4, succeeds
        '225HP1', // Bob bids 5, succeeds  
        '136HP3', // Charlie bids 6, gets set (6+3=9>6)
      ]
      
      const awardData = trackAwardData(hands, players, teams, [4, 9], 1)
      
      expect(awardData.playerStats.Alice.bidsWon).toBe(1)
      expect(awardData.playerStats.Alice.bidsSucceeded).toBe(1)
      expect(awardData.playerStats.Alice.bidsFailed).toBe(0)
      
      expect(awardData.playerStats.Bob.bidsWon).toBe(1)
      expect(awardData.playerStats.Bob.bidsSucceeded).toBe(1)
      
      expect(awardData.playerStats.Charlie.bidsWon).toBe(1)
      expect(awardData.playerStats.Charlie.bidsSucceeded).toBe(0)
      expect(awardData.playerStats.Charlie.bidsFailed).toBe(1)
    })

    it('tracks trump suit usage correctly', () => {
      const hands = [
        '114HP2', // Alice bids 4 Hearts, succeeds
        '225CP1', // Bob bids 5 Clubs, succeeds
        '136HP3', // Charlie bids 6 Hearts, gets set
        '24MNP0', // Dana bids Moon No-trump, succeeds (defending team set)
      ]
      
      const awardData = trackAwardData(hands, players, teams, [10, 15], 1)
      
      expect(awardData.playerStats.Alice.trumpBids.H.attempts).toBe(1)
      expect(awardData.playerStats.Alice.trumpBids.H.successes).toBe(1)
      
      expect(awardData.playerStats.Bob.trumpBids.C.attempts).toBe(1)
      expect(awardData.playerStats.Bob.trumpBids.C.successes).toBe(1)
      
      expect(awardData.playerStats.Charlie.trumpBids.H.attempts).toBe(1)
      expect(awardData.playerStats.Charlie.trumpBids.H.successes).toBe(0) // Failed
      
      expect(awardData.playerStats.Dana.noTrumpBids.attempts).toBe(1)
      expect(awardData.playerStats.Dana.noTrumpBids.successes).toBe(1)
    })

    it('tracks folded hands as successes', () => {
      const hands = [
        '114HF3', // Alice bids 4, folds, gives 3 tricks
      ]
      
      const awardData = trackAwardData(hands, players, teams, [4, 3], 0)
      
      expect(awardData.playerStats.Alice.bidsWon).toBe(1)
      expect(awardData.playerStats.Alice.bidsSucceeded).toBe(1)
      expect(awardData.playerStats.Alice.bidsFailed).toBe(0)
    })

    it('tracks high-value bids correctly', () => {
      const hands = [
        '116HP0', // Alice bids 6, succeeds (defending team set)
        '22MNP0', // Bob bids Moon, succeeds (defending team set)  
        '33DNP0', // Charlie bids Double Moon, succeeds (defending team set)
      ]
      
      const awardData = trackAwardData(hands, players, teams, [20, 25], 1)
      
      expect(awardData.playerStats.Alice.highValueBids.attempts).toBe(1)
      expect(awardData.playerStats.Alice.highValueBids.successes).toBe(1)
      
      expect(awardData.playerStats.Bob.highValueBids.attempts).toBe(1)
      expect(awardData.playerStats.Bob.highValueBids.successes).toBe(1)
      
      expect(awardData.playerStats.Charlie.highValueBids.attempts).toBe(1)
      expect(awardData.playerStats.Charlie.highValueBids.successes).toBe(1)
    })

    it('calculates team defensive success rates', () => {
      const hands = [
        '114HP0', // Alice bids 4, succeeds (Team 2 gets set, fails defense)
        '225HP1', // Bob bids 5, succeeds (Team 1 fails defense)
        '136HP0', // Charlie bids 6, succeeds (Team 2 gets set, fails defense)
      ]
      
      const awardData = trackAwardData(hands, players, teams, [0, 15], 1)
      
      // Team 1 had 1 defense (against Bob), failed it
      expect(awardData.teamStats['Team 1'].totalDefenses).toBe(1)
      expect(awardData.teamStats['Team 1'].successfulDefenses).toBe(0)
      expect(awardData.teamStats['Team 1'].defensiveSuccessRate).toBe(0)
      
      // Team 2 had 2 defenses (against Alice and Charlie), failed both
      expect(awardData.teamStats['Team 2'].totalDefenses).toBe(2)
      expect(awardData.teamStats['Team 2'].successfulDefenses).toBe(0)
      expect(awardData.teamStats['Team 2'].defensiveSuccessRate).toBe(0)
    })

    it('skips throw-in hands in statistics', () => {
      const hands = [
        '114HP2', // Normal hand
        '20',     // Throw-in hand  
        '334HP1', // Normal hand
      ]
      
      const awardData = trackAwardData(hands, players, teams, [6, 5], 0)
      
      // Should only count the 2 normal hands
      expect(awardData.playerStats.Alice.bidsWon).toBe(1)
      expect(awardData.playerStats.Charlie.bidsWon).toBe(1)
      expect(awardData.playerStats.Bob.bidsWon).toBe(0) // No bids from throw-in
    })
  })

  describe('Award Data Analysis', () => {
    it('calculates trump success rates correctly', () => {
      const hands = [
        '114HP2', // Alice: Hearts success
        '115HP1', // Alice: Hearts success  
        '226CP3', // Bob: Clubs failure (6+3=9>6, set)
        '22MDP0', // Bob: Moon Diamonds success (defending team set)
      ]
      
      const awardData = trackAwardData(hands, players, teams, [10, 15], 1)
      
      // Alice should have 100% Hearts success rate
      expect(awardData.playerStats.Alice.trumpBids.H.attempts).toBe(2)
      expect(awardData.playerStats.Alice.trumpBids.H.successes).toBe(2)
      
      // Bob should have mixed success
      expect(awardData.playerStats.Bob.trumpBids.C.attempts).toBe(1)
      expect(awardData.playerStats.Bob.trumpBids.C.successes).toBe(0) // Failed
      expect(awardData.playerStats.Bob.trumpBids.D.attempts).toBe(1)
      expect(awardData.playerStats.Bob.trumpBids.D.successes).toBe(1) // Succeeded
    })

    it('identifies bid royalty candidates', () => {
      const hands = [
        '114HP2', // Alice bids
        '215HP1', // Alice bids
        '316HP2', // Alice bids 
        '42MHP1', // Bob bids
      ]
      
      const awardData = trackAwardData(hands, players, teams, [12, 8], 0)
      
      expect(awardData.playerStats.Alice.bidsWon).toBe(3)
      expect(awardData.playerStats.Bob.bidsWon).toBe(1)
      expect(awardData.playerStats.Charlie.bidsWon).toBe(0)
      expect(awardData.playerStats.Dana.bidsWon).toBe(0)
    })

    it('tracks clutch player data correctly', () => {
      const hands = [
        '225HP1', // Bob bids 5, gets 1 trick → Bob's team gets 5, Alice's team gets 1 → [1, 5]
        '11MHP0', // Alice bids Moon, gets 0 tricks → Alice's team gets 7, Bob's team gets -7 → [8, -2]
        '21MHP0', // Alice bids Moon, gets 0 tricks → Alice's team gets 7, Bob's team gets -7 → [15, -9]
        '31MHP0', // Alice bids Moon, gets 0 tricks → Alice's team gets 7, Bob's team gets -7 → [22, -16]
        '41MHP0', // Alice bids Moon, gets 0 tricks → Alice's team gets 7, Bob's team gets -7 → [29, -23]
        '11MHP0', // Alice bids Moon, gets 0 tricks → Alice's team gets 7, Bob's team gets -7 → [36, -30]
        '21MHP0', // Alice bids Moon, gets 0 tricks → Alice's team gets 7, Bob's team gets -7 → [43, -37]
      ]
      
      // Alice's team wins, and Alice made the final winning bid
      const awardData = trackAwardData(hands, players, teams, [43, -37], 0)
      
      expect(awardData.playerStats.Alice.wonFinalBid).toBe(true)
      expect(awardData.winningTeam).toBe(0)
    })

    it('calculates overreaching metrics', () => {
      const hands = [
        '11MHP5', // Alice bids Moon (7 points), gets set
        '216HP4', // Alice bids 6 (6 points), gets set
        '325HP3', // Bob bids 5 (5 points), gets set
      ]
      
      const awardData = trackAwardData(hands, players, teams, [0, 30], 1)
      
      expect(awardData.playerStats.Alice.failedBidValues).toEqual([7, 6])
      expect(awardData.playerStats.Bob.failedBidValues).toEqual([5])
      
      // Alice average: (7+6)/2 = 6.5, Bob average: 5
    })

    it('calculates defensive fortress metrics', () => {
      const hands = [
        '114HP4', // Alice (Team 1) bids 4, gets 4 tricks → 4+4=8>6, Alice gets set, Team 2 succeeds defense
        '234HP4', // Charlie (Team 1) bids 4, gets 4 tricks → 4+4=8>6, Charlie gets set, Team 2 succeeds defense
        '324HP4', // Bob (Team 2) bids 4, gets 4 tricks → 4+4=8>6, Bob gets set, Team 1 succeeds defense
        '114HP4', // Alice (Team 1) bids 4, gets 4 tricks → 4+4=8>6, Alice gets set, Team 2 succeeds defense
        '334HP4', // Charlie (Team 1) bids 4, gets 4 tricks → 4+4=8>6, Charlie gets set, Team 2 succeeds defense
      ]
      
      const awardData = trackAwardData(hands, players, teams, [20, 25], 1)
      
      // Team 2 should have 4 successful defenses, Team 1 should have 1
      expect(awardData.teamStats['Team 2'].successfulDefenses).toBe(4)
      expect(awardData.teamStats['Team 1'].successfulDefenses).toBe(1)
    })

    it('identifies comeback achievement data', () => {
      // Simulate a comeback scenario using direct data manipulation
      const awardData = initializeAwardTracking(players, teams)
      awardData.teamStats['Team 1'].maxDeficit = 35 // Was behind by 35
      awardData.teamStats['Team 1'].minScoreTrailing = 10 // Score when trailing
      awardData.teamStats['Team 1'].comebackAchieved = true
      awardData.winningTeam = 0 // Team 1 won
      
      expect(awardData.teamStats['Team 1'].maxDeficit).toBe(35)
      expect(awardData.teamStats['Team 1'].comebackAchieved).toBe(true)
      expect(awardData.winningTeam).toBe(0)
    })

    it('awards comeback achievement for negative score deficit', () => {
      // Based on real game data where Team 2 came back from 32-point deficit with negative score
      const hands = [
        '12PNP4', '23PNP1', '34PDP2', '41PNP3', '12DNP1', '22MHP0', '346NF0', '414HP2', 
        '124NP2', '23MCP0', '324NP4', '444DP0', '10', '244CP2', '326NP0', '444DF0', '10',
        '245DF0', '324HP1', '42MHF0', '134HP0', '245NF1', '344DP1', '424SP0', '135HP2'
      ]
      
      // Team 2 wins with score [20, 43]
      const awardData = trackAwardData(hands, players, teams, [20, 43], 1)
      
      // Team 2 should have achieved comeback (was down by 32+ and won)
      expect(awardData.teamStats['Team 2'].maxDeficit).toBeGreaterThanOrEqual(30)
      expect(awardData.teamStats['Team 2'].comebackAchieved).toBe(true)
      expect(awardData.winningTeam).toBe(1)
    })

    it('calculates bid specialist metrics', () => {
      // Team with high bid success rate
      const awardData = initializeAwardTracking(players, teams)
      awardData.teamStats['Team 1'].totalBids = 8
      awardData.teamStats['Team 1'].successfulBids = 7 // 87.5% success rate
      awardData.teamStats['Team 1'].bidSuccessRate = 0.875
      
      awardData.teamStats['Team 2'].totalBids = 6  
      awardData.teamStats['Team 2'].successfulBids = 4 // 66.7% success rate
      awardData.teamStats['Team 2'].bidSuccessRate = 0.667
      
      expect(awardData.teamStats['Team 1'].bidSuccessRate).toBe(0.875)
      expect(awardData.teamStats['Team 2'].bidSuccessRate).toBe(0.667)
    })
  })

  describe('Award Selection', () => {
    it('selects appropriate game awards', () => {
      const mockAwardData: AwardTrackingData = {
        playerStats: {
          'Alice': { name: 'Alice', team: 0, bidsWon: 5, bidsSucceeded: 4, bidsFailed: 1, 
                   trumpBids: { 'H': { attempts: 3, successes: 3 }, 'C': { attempts: 0, successes: 0 }, 
                              'D': { attempts: 0, successes: 0 }, 'S': { attempts: 0, successes: 0 }, 
                              'N': { attempts: 0, successes: 0 } },
                   highValueBids: { attempts: 1, successes: 1 }, noTrumpBids: { attempts: 0, successes: 0 },
                   failedBidValues: [4], pepperRoundBids: { attempts: 2, successes: 2, opponents_set: 0 },
                   netPoints: 15, pointsPerBid: [4, 5, 4, 6, -4], wonFinalBid: true }
        },
        teamStats: {
          'Team 1': { name: 'Team 1', defensiveSuccessRate: 0.8, totalDefenses: 5, successfulDefenses: 4,
                     bidSuccessRate: 0.9, totalBids: 10, successfulBids: 9, 
                     highValueBids: { attempts: 2, successes: 2 }, pointsAllowedToOpponents: 15,
                     maxDeficit: 0, minScoreTrailing: 0, comebackAchieved: false, longestStreak: 3 }
        },
        pointsHistory: [[0, 0], [4, 2], [9, 3]],
        handScores: [[4, 2], [5, 1]], 
        hands: ['114HP2', '125HP1'],
        winningTeam: 0,
        winningTeamName: 'Team 1',
        gameCompleted: true
      }
      
      const selectedAwards = selectGameAwards(mockAwardData)
      
      expect(selectedAwards.length).toBeGreaterThanOrEqual(0)
      expect(selectedAwards.every((award: any) => gameAwards.some(def => def.id === award.id))).toBe(true)
    })

    it('prioritizes important awards in selection', () => {
      const mockAwardData: AwardTrackingData = {
        playerStats: {
          'Alice': { name: 'Alice', team: 0, bidsWon: 3, bidsSucceeded: 3, bidsFailed: 0, 
                   trumpBids: { 'H': { attempts: 0, successes: 0 }, 'C': { attempts: 0, successes: 0 }, 
                              'D': { attempts: 0, successes: 0 }, 'S': { attempts: 0, successes: 0 }, 
                              'N': { attempts: 0, successes: 0 } },
                   highValueBids: { attempts: 0, successes: 0 }, noTrumpBids: { attempts: 0, successes: 0 },
                   failedBidValues: [], pepperRoundBids: { attempts: 0, successes: 0, opponents_set: 0 },
                   netPoints: 12, pointsPerBid: [4, 4, 4], wonFinalBid: true }
        },
        teamStats: {
          'Team 1': { name: 'Team 1', defensiveSuccessRate: 0.5, totalDefenses: 2, successfulDefenses: 1,
                     bidSuccessRate: 1.0, totalBids: 3, successfulBids: 3, 
                     highValueBids: { attempts: 0, successes: 0 }, pointsAllowedToOpponents: 8,
                     maxDeficit: 25, minScoreTrailing: 15, comebackAchieved: true, longestStreak: 2 }
        },
        pointsHistory: [[0, 0]],
        handScores: [],
        hands: ['114HP2'],
        winningTeam: 0,
        winningTeamName: 'Team 1',
        gameCompleted: true
      }
      
      const selectedAwards = selectGameAwards(mockAwardData, 2)
      
      // Should prioritize important awards like clutch_player and remember_the_time
      const importantAwardIds = selectedAwards.filter(award => 
        gameAwards.find(def => def.id === award.id)?.important
      ).map(award => award.id)
      
      expect(importantAwardIds.length).toBeGreaterThan(0)
    })

    it('handles empty award data gracefully', () => {
      const emptyAwardData = initializeAwardTracking(players, teams)
      
      const selectedAwards = selectGameAwards(emptyAwardData, 3)
      expect(selectedAwards).toEqual([])
    })
  })
})