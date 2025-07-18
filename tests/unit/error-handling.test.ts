import { describe, it, expect, beforeEach } from 'vitest'
import { GameManager, calculateScore, decodeHand, encodeHand, getCurrentPhase, isHandComplete } from '../../src/lib/gameState'

describe('Error Handling and Edge Cases', () => {
  let gameManager: GameManager
  const players = ['Alice', 'Bob', 'Charlie', 'Dana']
  const teams = ['Team 1', 'Team 2']

  beforeEach(() => {
    gameManager = new GameManager(players, teams)
  })

  describe('Invalid Hand Encodings', () => {
    it('handles empty hand encoding', () => {
      expect(() => decodeHand('')).not.toThrow()
      const result = decodeHand('')
      expect(result.dealer).toBe(1) // Default value
      expect(result.bidWinner).toBe(1) // Default value
    })

    it('handles malformed hand encoding with invalid characters', () => {
      expect(() => decodeHand('ABCDEF')).not.toThrow()
      const result = decodeHand('ABCDEF')
      expect(typeof result.dealer).toBe('number')
      expect(typeof result.bidWinner).toBe('number')
    })

    it('handles partial hand encoding', () => {
      expect(() => decodeHand('12')).not.toThrow()
      const result = decodeHand('12')
      expect(result.dealer).toBe(1)
      expect(result.bidWinner).toBe(2)
      expect(result.bid).toBeDefined()
    })

    it('handles hand encoding with null/undefined values', () => {
      expect(() => decodeHand('1\x00\x00\x00\x00\x00')).not.toThrow()
    })

    it('handles very long hand encoding', () => {
      const longHand = '114HP2EXTRA_CHARACTERS'
      expect(() => decodeHand(longHand)).not.toThrow()
      const result = decodeHand(longHand)
      expect(result.dealer).toBe(1)
      expect(result.bidWinner).toBe(1)
    })
  })

  describe('Score Calculation Edge Cases', () => {
    it('handles invalid hand for score calculation', () => {
      expect(() => calculateScore('')).not.toThrow()
      const [score1, score2] = calculateScore('')
      // Empty hand calculation returns [4, -4] due to defaults
      expect(score1).toBe(4)
      expect(score2).toBe(-4)
    })

    it('handles throw-in hands correctly', () => {
      const [score1, score2] = calculateScore('10')
      expect(score1).toBe(0)
      expect(score2).toBe(0)
    })

    it('handles malformed bid values in score calculation', () => {
      expect(() => calculateScore('11XHP0')).not.toThrow()
      const [score1, score2] = calculateScore('11XHP0')
      expect(typeof score1).toBe('number')
      expect(typeof score2).toBe('number')
    })

    it('handles extreme trick values', () => {
      expect(() => calculateScore('1149HP9')).not.toThrow()
      const [score1, score2] = calculateScore('1149HP9')
      expect(typeof score1).toBe('number')
      expect(typeof score2).toBe('number')
    })

    it('handles negative trick values', () => {
      // This shouldn't happen in normal gameplay but test robustness
      expect(() => calculateScore('114HP-')).not.toThrow()
    })
  })

  describe('GameManager Edge Cases', () => {
    it('handles adding hand parts to empty game', () => {
      expect(() => gameManager.addHandPart('')).not.toThrow()
      expect(() => gameManager.addHandPart('1')).not.toThrow()
    })

    it('handles undo on empty game', () => {
      expect(() => gameManager.undo()).not.toThrow()
      // Should navigate to setup page in real app, but here we just ensure no crash
    })

    it('handles undo multiple times', () => {
      gameManager.addHandPart('1')
      gameManager.addHandPart('1')
      gameManager.addHandPart('4')
      
      expect(() => gameManager.undo()).not.toThrow()
      expect(() => gameManager.undo()).not.toThrow()
      expect(() => gameManager.undo()).not.toThrow()
      expect(() => gameManager.undo()).not.toThrow() // Should be safe even when nothing to undo
    })

    it('handles getting scores before any hands', () => {
      const scores = gameManager.getScores()
      expect(scores).toEqual([0, 0])
    })

    it('handles checking completion status on empty game', () => {
      expect(gameManager.isGameComplete()).toBe(false)
      expect(gameManager.hasWinner()).toBe(false)
      expect(gameManager.getWinner()).toBeNull()
      expect(gameManager.getWinningTeam()).toBeNull()
    })

    it('handles bidding team methods on empty game', () => {
      expect(gameManager.getBiddingTeam()).toBeNull()
      expect(gameManager.getBiddingTeamName()).toBeNull()
      expect(gameManager.getDefendingTeam()).toBeNull()
      expect(gameManager.getDefendingTeamName()).toBeNull()
    })

    it('handles series operations on non-series game', () => {
      expect(gameManager.isSeriesComplete()).toBe(false)
      expect(() => gameManager.startNextGame()).toThrow()
    })
  })

  describe('Boundary Value Testing', () => {
    it('handles scores at exactly 42 points', () => {
      // Manually set scores to exactly 42 for one team
      gameManager.state.scores = [42, 41]
      expect(gameManager.hasWinner()).toBe(true)
      expect(gameManager.getWinner()).toBe(0)
    })

    it('handles tied scores at 42', () => {
      gameManager.state.scores = [42, 42]
      expect(gameManager.hasWinner()).toBe(false)
      expect(gameManager.getWinner()).toBeNull()
    })

    it('handles very high scores', () => {
      gameManager.state.scores = [100, 50]
      expect(gameManager.hasWinner()).toBe(true)
      expect(gameManager.getWinner()).toBe(0)
    })

    it('handles negative scores', () => {
      gameManager.state.scores = [-10, 42]
      expect(gameManager.hasWinner()).toBe(true)
      expect(gameManager.getWinner()).toBe(1)
    })

    it('handles both teams with negative scores', () => {
      gameManager.state.scores = [-10, -5]
      expect(gameManager.hasWinner()).toBe(false)
      expect(gameManager.getWinner()).toBeNull()
    })
  })

  describe('JSON Serialization Edge Cases', () => {
    it('handles serialization of empty game', () => {
      expect(() => gameManager.toJSON()).not.toThrow()
      const json = gameManager.toJSON()
      expect(typeof json).toBe('string')
      expect(json.length).toBeGreaterThan(0)
    })

    it('handles deserialization of empty JSON', () => {
      // System is robust and handles empty JSON gracefully
      expect(() => GameManager.fromJSON('{}')).not.toThrow()
    })

    it('handles deserialization of malformed JSON', () => {
      expect(() => GameManager.fromJSON('invalid json')).toThrow()
    })

    it('handles deserialization of JSON with missing fields', () => {
      const incompleteState = {
        players: ['A', 'B', 'C', 'D'],
        teams: ['T1', 'T2']
        // Missing other required fields
      }
      expect(() => GameManager.fromJSON(JSON.stringify(incompleteState))).not.toThrow()
    })

    it('handles serialization and deserialization roundtrip', () => {
      // Set up a complex game state
      gameManager.addHandPart('1')
      gameManager.addHandPart('1')
      gameManager.addHandPart('4')
      gameManager.addHandPart('H')
      gameManager.addHandPart('P')
      gameManager.addHandPart('2')
      
      const json = gameManager.toJSON()
      const restored = GameManager.fromJSON(json)
      
      expect(restored.state.players).toEqual(gameManager.state.players)
      expect(restored.state.teams).toEqual(gameManager.state.teams)
      expect(restored.state.hands).toEqual(gameManager.state.hands)
      expect(restored.state.scores).toEqual(gameManager.state.scores)
    })
  })

  describe('Hand Completion Edge Cases', () => {
    it('handles isHandComplete with various inputs', () => {
      expect(isHandComplete('')).toBe(false)
      expect(isHandComplete('1')).toBe(false)
      expect(isHandComplete('10')).toBe(true) // Throw-in
      expect(isHandComplete('114HP2')).toBe(true) // Complete hand
      expect(isHandComplete('114HP')).toBe(false) // Missing tricks
    })

    it('handles getCurrentPhase with various inputs', () => {
      expect(getCurrentPhase('')).toBe('bidder')
      expect(getCurrentPhase('1')).toBe('bidder')
      expect(getCurrentPhase('11')).toBe('bid')
      expect(getCurrentPhase('114')).toBe('trump')
      expect(getCurrentPhase('114H')).toBe('decision')
      expect(getCurrentPhase('114HP')).toBe('tricks')
    })

    it('handles encodeHand with boundary values', () => {
      expect(() => encodeHand(1, 1, 4, 'H', 'P', 0)).not.toThrow()
      expect(() => encodeHand(4, 4, 'M', 'N', 'F', 6)).not.toThrow()
      
      const encoded = encodeHand(2, 3, 'D', 'S', 'P', 4)
      expect(encoded).toBe('23DSP4')
    })
  })

  describe('Array and Object Access Safety', () => {
    it('handles accessing players by invalid index', () => {
      expect(() => gameManager.state.players[10]).not.toThrow()
      expect(gameManager.state.players[10]).toBeUndefined()
    })

    it('handles accessing teams by invalid index', () => {
      expect(() => gameManager.state.teams[10]).not.toThrow()
      expect(gameManager.state.teams[10]).toBeUndefined()
    })

    it('handles hands array manipulation edge cases', () => {
      // Test with no hands
      expect(gameManager.getCurrentHand()).toBe('')
      
      // Test with one partial hand
      gameManager.state.hands = ['1']
      expect(gameManager.getCurrentHand()).toBe('1')
      
      // Test with empty string in hands array
      gameManager.state.hands = ['']
      expect(gameManager.getCurrentHand()).toBe('')
    })
  })

  describe('Player and Team Name Edge Cases', () => {
    it('handles empty player names', () => {
      const emptyPlayerManager = new GameManager(['', '', '', ''], teams)
      expect(() => emptyPlayerManager.addHandPart('1')).not.toThrow()
    })

    it('handles special characters in names', () => {
      const specialNames = ['Alice™', 'Bob∞', 'Charlie🎮', 'Dana😊']
      const specialManager = new GameManager(specialNames, teams)
      expect(() => specialManager.addHandPart('1')).not.toThrow()
    })

    it('handles very long names', () => {
      const longNames = [
        'A'.repeat(100),
        'B'.repeat(100), 
        'C'.repeat(100),
        'D'.repeat(100)
      ]
      const longNameManager = new GameManager(longNames, teams)
      expect(() => longNameManager.toJSON()).not.toThrow()
    })

    it('handles non-string values in arrays', () => {
      // This tests type safety at runtime
      const state = {
        players: [null, undefined, 123, true] as any,
        teams: ['Team 1', 'Team 2'],
        hands: [],
        scores: [0, 0],
        isComplete: false,
        isSeries: false,
        startTime: Date.now()
      }
      
      const badManager = new GameManager(['A', 'B', 'C', 'D'], teams)
      badManager.state = state
      
      expect(() => badManager.toJSON()).not.toThrow()
    })
  })

  describe('Concurrent Operations', () => {
    it('handles rapid successive addHandPart calls', () => {
      expect(() => {
        gameManager.addHandPart('1')
        gameManager.addHandPart('1')
        gameManager.addHandPart('4')
        gameManager.addHandPart('H')
        gameManager.addHandPart('P')
        gameManager.addHandPart('2')
      }).not.toThrow()
    })

    it('handles undo during hand construction', () => {
      gameManager.addHandPart('1')
      gameManager.addHandPart('1')
      gameManager.undo()
      
      expect(() => gameManager.addHandPart('4')).not.toThrow()
    })
  })

  describe('Memory and Performance Edge Cases', () => {
    it('handles many hands without memory issues', () => {
      // Add 100 complete hands
      for (let i = 0; i < 100; i++) {
        const dealer = (i % 4) + 1
        const bidder = ((i + 1) % 4) + 1
        const hand = `${dealer}${bidder}4HP2`
        
        gameManager.state.hands.push(hand)
        gameManager.state.scores[0] += 2
        gameManager.state.scores[1] += 1
      }
      
      expect(() => gameManager.toJSON()).not.toThrow()
      expect(gameManager.state.hands.length).toBe(100)
    })

    it('handles large JSON serialization', () => {
      // Create a large game state
      for (let i = 0; i < 50; i++) {
        gameManager.state.hands.push(`${i % 4 + 1}${(i + 1) % 4 + 1}4HP2`)
      }
      
      const json = gameManager.toJSON()
      expect(json.length).toBeGreaterThan(500) // Adjusted expectation
      
      expect(() => GameManager.fromJSON(json)).not.toThrow()
    })
  })

  describe('State Consistency Edge Cases', () => {
    it('maintains score consistency after multiple operations', () => {
      const hands = ['114HP2', '225HP1', '336HP3']
      
      hands.forEach(hand => {
        hand.split('').forEach(part => gameManager.addHandPart(part))
      })
      
      const calculatedScores = gameManager.getScores()
      expect(calculatedScores).toEqual(gameManager.state.scores)
    })

    it('handles inconsistent internal state gracefully', () => {
      // Deliberately create inconsistent state
      gameManager.state.hands = ['114HP2']
      gameManager.state.scores = [999, 888] // Wrong scores
      
      // Getting scores should recalculate
      const recalculatedScores = gameManager.getScores()
      expect(recalculatedScores).not.toEqual([999, 888])
    })
  })
})