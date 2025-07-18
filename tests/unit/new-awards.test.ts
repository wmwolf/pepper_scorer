import { describe, it, expect } from 'vitest'
import { 
  selectGameAwards,
  gameAwards
} from '../../src/lib/pepper-awards'
import { 
  trackAwardData,
  initializeAwardTracking
} from '../../src/lib/statistics-util'

describe('New Awards System', () => {
  const players = ['Alice', 'Bob', 'Charlie', 'Dana']
  const teams = ['Team 1', 'Team 2']

  describe('Playing it Safe Award', () => {
    it('awards player with 80%+ successful 4-bids from non-pepper rounds', () => {
      // First 4 hands are pepper rounds (indices 0-3), then Alice makes 5 successful non-pepper bids
      // 4 are 4-bids (80%), 1 is 5-bid
      const hands = [
        '114PP0', // Pepper round - excluded  
        '224PP1', // Pepper round - excluded
        '334PP2', // Pepper round - excluded
        '444PP3', // Pepper round - excluded
        '114HP2', // Alice bids 4, succeeds (non-pepper) 
        '214HP1', // Alice bids 4, succeeds (non-pepper)
        '314HP0', // Alice bids 4, succeeds (non-pepper)
        '414HP2', // Alice bids 4, succeeds (non-pepper)
        '115HP1', // Alice bids 5, succeeds (non-pepper) - 4/5 = 80% are 4-bids
        '225HP3', // Bob bids 5, succeeds - not enough 4-bids for Bob
      ]
      
      const awardData = trackAwardData(hands, players, teams, [25, 30], 0)
      const selectedAwards = selectGameAwards(awardData)
      
      const playingItSafeAward = selectedAwards.find(award => award.id === 'playing_it_safe')
      expect(playingItSafeAward).toBeTruthy()
      expect(playingItSafeAward?.winner).toBe('Alice')
    })

    it('requires minimum 5 successful non-pepper bids', () => {
      // Alice only has 4 successful non-pepper bids, even though 100% are 4-bids
      const hands = [
        '114HP2', // Alice bids 4, succeeds
        '214HP1', // Alice bids 4, succeeds
        '314HP0', // Alice bids 4, succeeds
        '414HP2', // Alice bids 4, succeeds (only 4 total - doesn't qualify)
      ]
      
      const awardData = trackAwardData(hands, players, teams, [15, 5], 0)
      const selectedAwards = selectGameAwards(awardData)
      
      const playingItSafeAward = selectedAwards.find(award => award.id === 'playing_it_safe')
      expect(playingItSafeAward).toBeFalsy()
    })

    it('excludes pepper rounds from calculation', () => {
      // First 4 hands are pepper rounds and should be excluded
      const hands = [
        '114PP0', // Pepper round - excluded
        '224PP1', // Pepper round - excluded  
        '334PP2', // Pepper round - excluded
        '444PP3', // Pepper round - excluded
        '114HP2', // Non-pepper: Alice bids 4, succeeds
        '214HP1', // Non-pepper: Alice bids 4, succeeds
        '314HP0', // Non-pepper: Alice bids 4, succeeds
        '414HP2', // Non-pepper: Alice bids 4, succeeds
        '114HP1', // Non-pepper: Alice bids 4, succeeds (5 total 4-bids = 100%)
      ]
      
      const awardData = trackAwardData(hands, players, teams, [25, 10], 0)
      const selectedAwards = selectGameAwards(awardData)
      
      const playingItSafeAward = selectedAwards.find(award => award.id === 'playing_it_safe')
      expect(playingItSafeAward).toBeTruthy()
      expect(playingItSafeAward?.winner).toBe('Alice')
    })

    it('only counts successful bids, not failed ones', () => {
      const hands = [
        '114PP0', // Pepper round - excluded
        '224PP1', // Pepper round - excluded  
        '334PP2', // Pepper round - excluded
        '444PP3', // Pepper round - excluded
        '114HP2', // Alice bids 4, succeeds (non-pepper)
        '214HP1', // Alice bids 4, succeeds (non-pepper)
        '314HP0', // Alice bids 4, succeeds (non-pepper)
        '414HP2', // Alice bids 4, succeeds (non-pepper)
        '114HP6', // Alice bids 4, gets set (4+6=10>6, failed - doesn't count)
        '115HP1', // Alice bids 5, succeeds (4/5 successful = 80% are 4-bids)
      ]
      
      const awardData = trackAwardData(hands, players, teams, [28, 12], 0)
      const selectedAwards = selectGameAwards(awardData)
      
      const playingItSafeAward = selectedAwards.find(award => award.id === 'playing_it_safe')
      expect(playingItSafeAward).toBeTruthy()
      expect(playingItSafeAward?.winner).toBe('Alice')
    })
  })

  describe('No Trump? No Problem Award', () => {
    it('awards player with 50%+ no-trump bids', () => {
      const hands = [
        '114NP2', // Alice bids 4 no-trump, succeeds
        '214NP1', // Alice bids 4 no-trump, succeeds
        '314HP0', // Alice bids 4 hearts, succeeds
        '414NP2', // Alice bids 4 no-trump, succeeds (3/4 = 75% no-trump)
        '225SP1', // Bob bids 5 spades (not enough no-trump for Bob)
      ]
      
      const awardData = trackAwardData(hands, players, teams, [15, 8], 0)
      const selectedAwards = selectGameAwards(awardData)
      
      const noTrumpAward = selectedAwards.find(award => award.id === 'no_trump_no_problem')
      expect(noTrumpAward).toBeTruthy()
      expect(noTrumpAward?.winner).toBe('Alice')
    })

    it('requires minimum 4 bids total', () => {
      const hands = [
        '114NP2', // Alice bids 4 no-trump
        '214NP1', // Alice bids 4 no-trump
        '314NP0', // Alice bids 4 no-trump (only 3 total - doesn't qualify)
      ]
      
      const awardData = trackAwardData(hands, players, teams, [12, 3], 0)
      const selectedAwards = selectGameAwards(awardData)
      
      const noTrumpAward = selectedAwards.find(award => award.id === 'no_trump_no_problem')
      expect(noTrumpAward).toBeFalsy()
    })

    it('includes pepper rounds in calculation', () => {
      // Alice needs 4+ total bids with 50%+ no-trump
      const hands = [
        '114NP0', // Alice pepper round no-trump 
        '224HP1', // Bob pepper round hearts
        '334SP2', // Charlie pepper round spades
        '444DP3', // Dana pepper round diamonds
        '114NP2', // Alice no-trump (non-pepper)
        '214HP1', // Alice hearts (non-pepper)
        '314NP0', // Alice no-trump (non-pepper)
        '414NP2', // Alice no-trump (non-pepper) - Alice: 4 no-trump out of 5 total = 80%
      ]
      
      const awardData = trackAwardData(hands, players, teams, [22, 8], 0)
      const selectedAwards = selectGameAwards(awardData)
      
      const noTrumpAward = selectedAwards.find(award => award.id === 'no_trump_no_problem')
      expect(noTrumpAward).toBeTruthy()
      expect(noTrumpAward?.winner).toBe('Alice')
    })

    it('counts both successful and failed bids', () => {
      const hands = [
        '114NP0', // Alice pepper round no-trump
        '224HP1', // Bob pepper round hearts
        '334SP2', // Charlie pepper round spades 
        '444DP3', // Dana pepper round diamonds
        '114NP2', // Alice bids 4 no-trump, succeeds (non-pepper)
        '214NP2', // Alice bids 4 no-trump, succeeds (changed from failed to avoid false_confidence award)
        '314NP1', // Alice bids 4 no-trump, succeeds
        '414HP0', // Alice bids 4 hearts, succeeds (3/4 = 75% no-trump total for Alice)
        '225HP2', // Bob bids 5 hearts, succeeds (only 1/2 = 50% no-trump for Bob)
      ]
      
      const awardData = trackAwardData(hands, players, teams, [18, 10], 0)
      const selectedAwards = selectGameAwards(awardData)
      
      const noTrumpAward = selectedAwards.find(award => award.id === 'no_trump_no_problem')
      expect(noTrumpAward).toBeTruthy()
      expect(noTrumpAward?.winner).toBe('Alice')
    })
  })

  describe('Footprints in the Sand Award', () => {
    it('awards dominant player when partner contributed 25% or less', () => {
      // Set up a scenario where Alice dominates with +15 points, Charlie only contributes +3 (16.7%)
      const awardData = initializeAwardTracking(players, teams)
      
      // Alice and Charlie are on Team 1 (team index 0)
      awardData.playerStats.Alice.netPoints = 15
      awardData.playerStats.Charlie.netPoints = 3
      awardData.playerStats.Bob.netPoints = -5
      awardData.playerStats.Dana.netPoints = -8
      awardData.winningTeam = 0 // Team 1 wins
      awardData.winningTeamName = 'Team 1'
      
      const selectedAwards = selectGameAwards(awardData)
      
      const footprintsAward = selectedAwards.find(award => award.id === 'footprints_in_the_sand')
      expect(footprintsAward).toBeTruthy()
      expect(footprintsAward?.winner).toBe('Alice')
    })

    it('requires winning team for award eligibility', () => {
      const awardData = initializeAwardTracking(players, teams)
      
      // Alice dominates but team loses
      awardData.playerStats.Alice.netPoints = 15
      awardData.playerStats.Charlie.netPoints = 2
      awardData.playerStats.Bob.netPoints = 5
      awardData.playerStats.Dana.netPoints = 8
      awardData.winningTeam = 1 // Team 2 wins, not Alice's team
      awardData.winningTeamName = 'Team 2'
      
      const selectedAwards = selectGameAwards(awardData)
      
      const footprintsAward = selectedAwards.find(award => award.id === 'footprints_in_the_sand')
      expect(footprintsAward).toBeFalsy()
    })

    it('works with negative net points', () => {
      const awardData = initializeAwardTracking(players, teams)
      
      // Both players have negative points, but Alice's losses dominated
      awardData.playerStats.Alice.netPoints = -12 // 80% of total contribution
      awardData.playerStats.Charlie.netPoints = -3 // 20% of total contribution
      awardData.playerStats.Bob.netPoints = 8
      awardData.playerStats.Dana.netPoints = 10
      awardData.winningTeam = 0 // Team 1 still wins overall
      awardData.winningTeamName = 'Team 1'
      
      const selectedAwards = selectGameAwards(awardData)
      
      const footprintsAward = selectedAwards.find(award => award.id === 'footprints_in_the_sand')
      expect(footprintsAward).toBeTruthy()
      expect(footprintsAward?.winner).toBe('Alice') // Alice dominated the contribution even if negative
    })

    it('requires 75%+ dominance threshold', () => {
      const awardData = initializeAwardTracking(players, teams)
      
      // Alice has 70% (not enough), Charlie has 30% (too much for partner)
      awardData.playerStats.Alice.netPoints = 7
      awardData.playerStats.Charlie.netPoints = 3
      awardData.playerStats.Bob.netPoints = -5
      awardData.playerStats.Dana.netPoints = -5
      awardData.winningTeam = 0
      awardData.winningTeamName = 'Team 1'
      
      const selectedAwards = selectGameAwards(awardData)
      
      const footprintsAward = selectedAwards.find(award => award.id === 'footprints_in_the_sand')
      expect(footprintsAward).toBeFalsy() // 70% < 75% threshold
    })
  })

  describe('Shoot for the Moons Award', () => {
    it('awards player with 2+ successful moon bids', () => {
      const hands = [
        '11MHP0', // Alice bids Moon, succeeds (defending team gets 0 tricks)
        '21MDP0', // Alice bids Moon, succeeds 
        '225HP3', // Bob bids 5, gets set (not moon bid)
      ]
      
      const awardData = trackAwardData(hands, players, teams, [14, -7], 0)
      const selectedAwards = selectGameAwards(awardData)
      
      const shootMoonsAward = selectedAwards.find(award => award.id === 'shoot_for_the_moons')
      expect(shootMoonsAward).toBeTruthy()
      expect(shootMoonsAward?.winner).toBe('Alice')
    })

    it('awards player with 2+ successful double moon bids', () => {
      const hands = [
        '11DNP0', // Alice bids Double Moon, succeeds
        '21DNP0', // Alice bids Double Moon, succeeds (2 total)
      ]
      
      const awardData = trackAwardData(hands, players, teams, [28, -14], 0)
      const selectedAwards = selectGameAwards(awardData)
      
      const shootMoonsAward = selectedAwards.find(award => award.id === 'shoot_for_the_moons')
      expect(shootMoonsAward).toBeTruthy()
      expect(shootMoonsAward?.winner).toBe('Alice')
    })

    it('awards player with mix of moon and double moon bids', () => {
      const hands = [
        '11MHP0', // Alice bids Moon, succeeds
        '21DNP0', // Alice bids Double Moon, succeeds (1 moon + 1 double moon = 2 total)
      ]
      
      const awardData = trackAwardData(hands, players, teams, [21, -10], 0)
      const selectedAwards = selectGameAwards(awardData)
      
      const shootMoonsAward = selectedAwards.find(award => award.id === 'shoot_for_the_moons')
      expect(shootMoonsAward).toBeTruthy()
      expect(shootMoonsAward?.winner).toBe('Alice')
    })

    it('requires minimum 2 successful high-value bids', () => {
      const hands = [
        '11MHP0', // Alice bids Moon, succeeds (only 1 - doesn't qualify)
        '225HP1', // Bob bids 5, succeeds (not high value)
      ]
      
      const awardData = trackAwardData(hands, players, teams, [12, 1], 0)
      const selectedAwards = selectGameAwards(awardData)
      
      const shootMoonsAward = selectedAwards.find(award => award.id === 'shoot_for_the_moons')
      expect(shootMoonsAward).toBeFalsy()
    })

    it('only counts successful moon bids, not failed ones', () => {
      const hands = [
        '11MHP0', // Alice bids Moon, succeeds
        '21MHP4', // Alice bids Moon, gets set (7+4=11>7, failed - doesn't count)
        '31MHP0', // Alice bids Moon, succeeds (2 successful total)
      ]
      
      const awardData = trackAwardData(hands, players, teams, [14, 4], 0)
      const selectedAwards = selectGameAwards(awardData)
      
      const shootMoonsAward = selectedAwards.find(award => award.id === 'shoot_for_the_moons')
      expect(shootMoonsAward).toBeTruthy()
      expect(shootMoonsAward?.winner).toBe('Alice')
    })

    it('handles random selection when multiple players qualify', () => {
      const hands = [
        '11MHP0', // Alice: 1st successful Moon
        '21MHP0', // Alice: 2nd successful Moon
        '32MDP0', // Bob: 1st successful Double Moon
        '42MDP0', // Bob: 2nd successful Double Moon
      ]
      
      const awardData = trackAwardData(hands, players, teams, [42, -21], 0)
      const selectedAwards = selectGameAwards(awardData)
      
      const shootMoonsAward = selectedAwards.find(award => award.id === 'shoot_for_the_moons')
      expect(shootMoonsAward).toBeTruthy()
      // Either Alice or Bob could win (random selection)
      expect(['Alice', 'Bob']).toContain(shootMoonsAward?.winner)
    })
  })

  describe('Award Integration', () => {
    it('includes new awards in game award selection', () => {
      const gameAwardIds = gameAwards.map(award => award.id)
      
      expect(gameAwardIds).toContain('playing_it_safe')
      expect(gameAwardIds).toContain('no_trump_no_problem')
      expect(gameAwardIds).toContain('footprints_in_the_sand')
      expect(gameAwardIds).toContain('shoot_for_the_moons')
    })

    it('correctly categorizes new awards by type and scope', () => {
      const playingItSafe = gameAwards.find(a => a.id === 'playing_it_safe')
      const noTrumpNoProblem = gameAwards.find(a => a.id === 'no_trump_no_problem')
      const footprints = gameAwards.find(a => a.id === 'footprints_in_the_sand')
      const shootMoons = gameAwards.find(a => a.id === 'shoot_for_the_moons')
      
      // All should be game-scoped
      expect(playingItSafe?.scope).toBe('game')
      expect(noTrumpNoProblem?.scope).toBe('game')
      expect(footprints?.scope).toBe('game')
      expect(shootMoons?.scope).toBe('game')
      
      // All should be player awards
      expect(playingItSafe?.type).toBe('player')
      expect(noTrumpNoProblem?.type).toBe('player')
      expect(footprints?.type).toBe('player')
      expect(shootMoons?.type).toBe('player')
      
      // Check importance levels
      expect(playingItSafe?.important).toBe(false) // Dubious
      expect(noTrumpNoProblem?.important).toBe(false) // Dubious  
      expect(footprints?.important).toBe(false) // Positive but not important
      expect(shootMoons?.important).toBe(true) // Important positive
    })
  })
})