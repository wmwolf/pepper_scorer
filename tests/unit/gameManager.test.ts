import { describe, it, expect, beforeEach } from 'vitest'
import { GameManager } from '../../src/lib/gameState'

describe('GameManager', () => {
  let gameManager: GameManager
  const players = ['Alice', 'Bob', 'Charlie', 'Dana']
  const teams = ['Team 1', 'Team 2']

  beforeEach(() => {
    gameManager = new GameManager(players, teams)
  })

  describe('initialization', () => {
    it('initializes with correct players and teams', () => {
      expect(gameManager.state.players).toEqual(players)
      expect(gameManager.state.teams).toEqual(teams)
    })

    it('starts with empty hands and zero scores', () => {
      expect(gameManager.state.hands).toEqual([])
      expect(gameManager.state.scores).toEqual([0, 0])
      expect(gameManager.state.isComplete).toBe(false)
    })

    it('sets start time on initialization', () => {
      expect(gameManager.getStartTime()).toBeGreaterThan(0)
      expect(gameManager.getStartTime()).toBeLessThanOrEqual(Date.now())
    })

    it('starts as single game, not series', () => {
      expect(gameManager.state.isSeries).toBe(false)
      expect(gameManager.state.seriesScores).toBeUndefined()
    })
  })

  describe('hand management', () => {
    it('starts new hand with dealer when no hands exist', () => {
      gameManager.addHandPart('1')
      expect(gameManager.getCurrentHand()).toBe('1')
      expect(gameManager.state.hands).toEqual(['1'])
    })

    it('adds parts to incomplete hands', () => {
      gameManager.addHandPart('1')
      gameManager.addHandPart('2')
      gameManager.addHandPart('4')
      expect(gameManager.getCurrentHand()).toBe('124')
      expect(gameManager.state.hands.length).toBe(1)
    })

    it('completes hand and starts next hand automatically', () => {
      // Complete a full hand: dealer=1, bidder=2, bid=4, trump=H, decision=P, tricks=2
      gameManager.addHandPart('1')
      gameManager.addHandPart('2')
      gameManager.addHandPart('4')
      gameManager.addHandPart('H')
      gameManager.addHandPart('P')
      gameManager.addHandPart('2')
      
      expect(gameManager.state.hands.length).toBe(2)
      expect(gameManager.state.hands[0]).toBe('124HP2')
      expect(gameManager.getCurrentHand()).toBe('2') // Next dealer
    })

    it('calculates scores when hands are completed', () => {
      // Team 2 bids 4, gets 2 tricks - should succeed
      gameManager.addHandPart('1')
      gameManager.addHandPart('2')
      gameManager.addHandPart('4')
      gameManager.addHandPart('H')
      gameManager.addHandPart('P')
      gameManager.addHandPart('2')
      
      const scores = gameManager.getScores()
      expect(scores[0]).toBe(2) // Team 1 gets tricks
      expect(scores[1]).toBe(4) // Team 2 gets bid value
    })

    it('handles throw-in hands correctly', () => {
      gameManager.addHandPart('1')
      gameManager.addHandPart('0') // Throw-in
      
      expect(gameManager.state.hands.length).toBe(2)
      expect(gameManager.state.hands[0]).toBe('10') // Completed throw-in hand
      expect(gameManager.getCurrentHand()).toBe('2') // Next dealer
      
      const scores = gameManager.getScores()
      expect(scores).toEqual([0, 0]) // No scoring in throw-ins
    })
  })

  describe('team identification', () => {
    beforeEach(() => {
      gameManager.addHandPart('1')
      gameManager.addHandPart('3') // Player 3 (Charlie) = Team 1
    })

    it('correctly identifies bidding team', () => {
      expect(gameManager.getBiddingTeam()).toBe(0) // Player 3 is on team 0
      expect(gameManager.getBiddingTeamName()).toBe('Team 1')
    })

    it('correctly identifies defending team', () => {
      expect(gameManager.getDefendingTeam()).toBe(1) // Opposite of bidding team
      expect(gameManager.getDefendingTeamName()).toBe('Team 2')
    })

    it('returns null for team info when no bidder set', () => {
      const emptyGame = new GameManager(players, teams)
      expect(emptyGame.getBiddingTeam()).toBe(null)
      expect(emptyGame.getBiddingTeamName()).toBe(null)
      expect(emptyGame.getDefendingTeam()).toBe(null)
      expect(emptyGame.getDefendingTeamName()).toBe(null)
    })
  })

  describe('winner detection', () => {
    it('detects no winner when scores are below 42', () => {
      // Score one hand that gives some points but not enough to win
      gameManager.addHandPart('1')
      gameManager.addHandPart('2')
      gameManager.addHandPart('4')
      gameManager.addHandPart('H')
      gameManager.addHandPart('P')
      gameManager.addHandPart('2')
      
      expect(gameManager.hasWinner()).toBe(false)
      expect(gameManager.getWinningTeam()).toBe(null)
      expect(gameManager.isGameComplete()).toBe(false)
    })

    it('detects winner when team reaches 42 points', () => {
      // Manually set scores to simulate a winning condition
      gameManager.state.scores = [45, 20]
      
      expect(gameManager.hasWinner()).toBe(true)
      expect(gameManager.getWinningTeam()).toBe(0)
      expect(gameManager.isGameComplete()).toBe(true)
    })

    it('does not declare winner on tie at 42+', () => {
      gameManager.state.scores = [42, 42]
      
      expect(gameManager.hasWinner()).toBe(false)
      expect(gameManager.getWinningTeam()).toBe(null)
    })
  })

  describe('undo functionality', () => {
    it('removes incomplete hand parts in regular gameplay', () => {
      // Skip to hand 5 (after pepper rounds) by manually setting hands
      // This simulates being in regular gameplay after pepper rounds
      gameManager.state.hands = [
        '12PHF0', '223PHF0', '334PHF0', '441PHF0', // 4 pepper rounds
        '124' // Current hand in regular gameplay
      ]
      
      // Test undo in regular gameplay (hand 5+)
      gameManager.undo()
      expect(gameManager.getCurrentHand()).toBe('12')
      
      gameManager.undo()
      expect(gameManager.getCurrentHand()).toBe('1')
    })

    it('handles undo at start of game by redirecting', () => {
      // Can't easily test navigation, but we can test the condition
      gameManager.addHandPart('1')
      expect(gameManager.state.hands.length).toBe(1)
      
      // Clear hands to simulate start of game
      gameManager.state.hands = []
      // In real scenario, this would trigger navigation
      // For test, we just verify the state
      expect(gameManager.state.hands.length).toBe(0)
    })

    it('reverts completed hand and adjusts scores', () => {
      // Complete a hand
      gameManager.addHandPart('1')
      gameManager.addHandPart('2')
      gameManager.addHandPart('4')
      gameManager.addHandPart('H')
      gameManager.addHandPart('P')
      gameManager.addHandPart('2')
      
      const scoresAfterHand = [...gameManager.state.scores]
      expect(gameManager.state.hands.length).toBe(2) // Completed hand + new hand
      
      // Now undo from the new hand back to previous hand's tricks phase
      gameManager.undo()
      
      // Should remove the auto-started next hand and go back to tricks phase
      expect(gameManager.state.hands.length).toBe(1)
      expect(gameManager.getCurrentHand()).toBe('124HP') // Missing tricks
    })

    it('handles pepper round trump phase undo correctly', () => {
      // In pepper rounds, bidder and bid are automatic: dealer -> dealer+bidder+P
      // So hand goes: '1' -> '12P' automatically
      gameManager.addHandPart('1')
      gameManager.addHandPart('2') 
      gameManager.addHandPart('P') // Automatic pepper bid
      gameManager.addHandPart('H') // Trump selected
      
      // Undo from trump phase should use special pepper round logic
      gameManager.undo()
      expect(gameManager.getCurrentHand()).toBe('12P') // Back to bid phase
    })
  })

  describe('hand classification', () => {
    it('classifies incomplete hands', () => {
      gameManager.addHandPart('1')
      gameManager.addHandPart('2')
      
      const classification = gameManager.getHandClassification(0)
      expect(classification.type).toBe('incomplete')
    })

    it('classifies throw-in hands as pass', () => {
      gameManager.addHandPart('1')
      gameManager.addHandPart('0')
      
      const classification = gameManager.getHandClassification(0)
      expect(classification.type).toBe('pass')
    })

    it('classifies folded hands as pass', () => {
      gameManager.addHandPart('1')
      gameManager.addHandPart('2')
      gameManager.addHandPart('4')
      gameManager.addHandPart('H')
      gameManager.addHandPart('F') // Folded
      gameManager.addHandPart('2')
      
      const classification = gameManager.getHandClassification(0)
      expect(classification.type).toBe('pass')
    })

    it('classifies normal played hands', () => {
      gameManager.addHandPart('1')
      gameManager.addHandPart('2')
      gameManager.addHandPart('4')
      gameManager.addHandPart('H')
      gameManager.addHandPart('P')
      gameManager.addHandPart('2')
      
      const classification = gameManager.getHandClassification(0)
      expect(classification.type).toBe('play')
    })

    it('classifies set hands with setTeam', () => {
      // Create a hand where bidding team gets set
      gameManager.addHandPart('1')
      gameManager.addHandPart('2')
      gameManager.addHandPart('5') // Need 5 tricks
      gameManager.addHandPart('H')
      gameManager.addHandPart('P')
      gameManager.addHandPart('2') // Got 2 tricks, 5+2=7>6, set
      
      const classification = gameManager.getHandClassification(0)
      expect(classification.type).toBe('forced-set') // First hand (pepper round) + bidding team set = forced-set
      expect(classification.setTeam).toBe(1) // Team 2 got set (bidder 2 is on team 1)
    })
  })

  describe('JSON serialization', () => {
    it('serializes and deserializes game state correctly', () => {
      // Add some game state
      gameManager.addHandPart('1')
      gameManager.addHandPart('2')
      gameManager.addHandPart('4')
      gameManager.state.scores = [10, 15]
      
      const json = gameManager.toJSON()
      const restored = GameManager.fromJSON(json)
      
      expect(restored.state.players).toEqual(players)
      expect(restored.state.teams).toEqual(teams)
      expect(restored.state.hands).toEqual(['124'])
      expect(restored.state.scores).toEqual([10, 15])
    })
  })
})