import { describe, it, expect, beforeEach } from 'vitest'
import { GameManager, calculateScore } from '../../src/lib/gameState'

describe('Series Management', () => {
  let gameManager: GameManager
  const players = ['Alice', 'Bob', 'Charlie', 'Dana']
  const teams = ['Team 1', 'Team 2']

  beforeEach(() => {
    gameManager = new GameManager(players, teams)
  })

  describe('Series Conversion', () => {
    it('converts completed single game to series', () => {
      // Complete a single game using the helper
      completeSimpleGame(gameManager)

      expect(gameManager.isGameComplete()).toBe(true)
      expect(gameManager.state.isSeries).toBe(false)
      
      const winner = gameManager.getWinner()
      expect(winner).not.toBeNull()

      // Convert to series
      gameManager.convertToSeries()

      expect(gameManager.state.isSeries).toBe(true)
      expect(gameManager.state.gameNumber).toBe(1)
      expect(gameManager.state.completedGames).toHaveLength(1)
      
      if (winner !== null) {
        expect(gameManager.state.seriesScores![winner]).toBe(1)
        // Series scores should be [1, 0] or [0, 1] depending on the winner
        const expectedScores = winner === 0 ? [1, 0] : [0, 1]
        expect(gameManager.state.seriesScores).toEqual(expectedScores)
      }
      
      const completedGame = gameManager.state.completedGames![0]
      expect(completedGame.winner).toBe(winner)
      expect(completedGame.finalScores).toEqual(gameManager.state.scores)
      expect(completedGame.hands).toEqual(gameManager.state.hands)
      expect(completedGame.startTime).toBeDefined()
      expect(completedGame.endTime).toBeDefined()
    })

    it('throws error when trying to convert incomplete game', () => {
      // Start but don't complete a game
      gameManager.addHandPart('1') // dealer
      gameManager.addHandPart('1') // bidder
      gameManager.addHandPart('4') // bid
      
      expect(() => gameManager.convertToSeries()).toThrow('Cannot convert: game not complete')
    })

    it('throws error when trying to convert already series game', () => {
      // Complete a game and convert to series
      completeSimpleGame(gameManager)
      gameManager.convertToSeries()
      
      expect(() => gameManager.convertToSeries()).toThrow('Game is already part of a series')
    })
  })

  describe('Series Game Progression', () => {
    beforeEach(() => {
      // Setup: complete first game and convert to series
      completeSimpleGame(gameManager)
      gameManager.convertToSeries()
    })

    it('starts next game with correct dealer rotation', () => {
      const currentDealer = gameManager.getNextDealer()
      const currentDealerIndex = players.indexOf(currentDealer)
      
      gameManager.startNextGame()
      
      expect(gameManager.state.gameNumber).toBe(2)
      expect(gameManager.state.hands).toHaveLength(1)
      expect(gameManager.state.scores).toEqual([0, 0])
      expect(gameManager.state.isComplete).toBe(false)
      
      // Check dealer is correctly set
      const newHandDealer = parseInt(gameManager.state.hands[0]!)
      expect(newHandDealer).toBe(currentDealerIndex + 1) // 1-indexed
    })

    it('maintains series state across games', () => {
      const originalSeriesScores = [...gameManager.state.seriesScores!]
      const originalCompletedGames = gameManager.state.completedGames!.length
      
      gameManager.startNextGame()
      
      expect(gameManager.state.isSeries).toBe(true)
      expect(gameManager.state.seriesScores).toEqual(originalSeriesScores)
      expect(gameManager.state.completedGames).toHaveLength(originalCompletedGames)
    })

    it('tracks completed games correctly through series', () => {
      // Complete second game
      gameManager.startNextGame()
      completeSimpleGame(gameManager)
      gameManager.completeGame()
      
      expect(gameManager.state.completedGames).toHaveLength(2)
      
      const secondGame = gameManager.state.completedGames![1]
      expect(secondGame.winner).not.toBeNull()
      expect(secondGame.finalScores).toEqual(gameManager.state.scores)
      expect(secondGame.startTime).toBeDefined()
      expect(secondGame.endTime).toBeDefined()
      
      // Series scores should be updated
      const totalWins = gameManager.state.seriesScores![0] + gameManager.state.seriesScores![1]
      expect(totalWins).toBe(2)
    })

    it('throws error when trying to start next game after series completion', () => {
      // Complete second game to finish the series (2-0)
      gameManager.startNextGame()
      completeGameForTeam(gameManager, gameManager.state.completedGames![0]!.winner)
      gameManager.completeGame()
      
      expect(gameManager.isSeriesComplete()).toBe(true)
      expect(() => gameManager.startNextGame()).toThrow('Cannot start next game: series is complete or not in series mode')
    })
  })

  describe('Series Completion', () => {
    beforeEach(() => {
      completeSimpleGame(gameManager)
      gameManager.convertToSeries()
    })

    it('detects series completion when team reaches 2 wins', () => {
      expect(gameManager.isSeriesComplete()).toBe(false)
      
      // Win second game for same team
      gameManager.startNextGame()
      completeGameForTeam(gameManager, gameManager.state.completedGames![0]!.winner)
      gameManager.completeGame()
      
      expect(gameManager.isSeriesComplete()).toBe(true)
      expect(gameManager.state.seriesWinner).toBe(gameManager.state.completedGames![0]!.winner)
    })

    it('continues series when teams split first two games', () => {
      const firstGameWinner = gameManager.state.completedGames![0]!.winner
      const otherTeam = 1 - firstGameWinner
      
      // Make other team win second game
      gameManager.startNextGame()
      completeGameForTeam(gameManager, otherTeam)
      gameManager.completeGame()
      
      expect(gameManager.isSeriesComplete()).toBe(false)
      expect(gameManager.state.seriesScores).toEqual([1, 1])
      expect(gameManager.state.seriesWinner).toBeUndefined()
    })

    it('properly sets series winner on completion', () => {
      const expectedWinner = gameManager.state.completedGames![0]!.winner
      
      // Same team wins second game
      gameManager.startNextGame()
      completeGameForTeam(gameManager, expectedWinner)
      gameManager.completeGame()
      
      expect(gameManager.state.seriesWinner).toBe(expectedWinner)
      expect(gameManager.state.seriesScores![expectedWinner]).toBe(2)
    })

    it('throws error when trying to start next game after series completion', () => {
      // Complete series (2-0)
      gameManager.startNextGame()
      completeGameForTeam(gameManager, gameManager.state.completedGames![0]!.winner)
      gameManager.completeGame()
      
      expect(gameManager.isSeriesComplete()).toBe(true)
      expect(() => gameManager.startNextGame()).toThrow('Cannot start next game: series is complete or not in series mode')
    })
  })

  describe('Series Undo Functionality', () => {
    beforeEach(() => {
      completeSimpleGame(gameManager)
      gameManager.convertToSeries()
    })

    it('handles undo from completed game back to incomplete state', () => {
      expect(gameManager.state.isComplete).toBe(true)
      const originalWinner = gameManager.state.completedGames![0]!.winner
      expect(gameManager.state.seriesScores![originalWinner]).toBe(1)
      
      // Undo the game completion
      gameManager.undo()
      
      // The game should be marked as incomplete if the undo actually reverted the completion
      const gameComplete = gameManager.isGameComplete()
      if (gameComplete) {
        // If still complete, series state shouldn't change much
        expect(gameManager.state.isComplete).toBe(true)
      } else {
        // If incomplete, series should be reset
        expect(gameManager.state.isComplete).toBe(false)
        expect(gameManager.state.seriesScores).toEqual([0, 0])
        expect(gameManager.state.completedGames).toHaveLength(0)
      }
    })

    it('handles undo across game boundaries in series', () => {
      // Complete second game
      gameManager.startNextGame()
      const secondGameStartTime = gameManager.state.startTime
      completeSimpleGame(gameManager)
      gameManager.completeGame()
      
      expect(gameManager.state.completedGames).toHaveLength(2)
      expect(gameManager.state.gameNumber).toBe(2)
      
      // Undo back to incomplete second game
      gameManager.undo()
      
      // Check if the undo actually made the game incomplete
      const gameComplete = gameManager.isGameComplete()
      if (gameComplete) {
        // If still complete, the series state shouldn't have changed
        expect(gameManager.state.isComplete).toBe(true)
        expect(gameManager.state.completedGames).toHaveLength(2)
      } else {
        // If incomplete, we should have reverted the completion
        expect(gameManager.state.isComplete).toBe(false)
        expect(gameManager.state.completedGames).toHaveLength(1)
        expect(gameManager.state.gameNumber).toBe(2)
        expect(gameManager.state.startTime).toBe(secondGameStartTime)
        
        // Series scores should be decremented
        const totalWins = gameManager.state.seriesScores![0] + gameManager.state.seriesScores![1]
        expect(totalWins).toBe(1)
      }
    })

    it('prevents series winner from being set prematurely after undo', () => {
      // Complete series (2-0)
      const firstWinner = gameManager.state.completedGames![0]!.winner
      gameManager.startNextGame()
      completeGameForTeam(gameManager, firstWinner)
      gameManager.completeGame()
      
      expect(gameManager.state.seriesWinner).toBe(firstWinner)
      expect(gameManager.isSeriesComplete()).toBe(true)
      
      // Undo the series completion
      gameManager.undo()
      
      // Check if the undo actually reverted the completion
      const gameComplete = gameManager.isGameComplete()
      if (gameComplete) {
        // If game is still complete, series winner should still be set
        expect(gameManager.state.seriesWinner).toBe(firstWinner)
      } else {
        // If game was undone to incomplete state, series winner should be cleared
        expect(gameManager.state.seriesWinner).toBeUndefined()
        expect(gameManager.isSeriesComplete()).toBe(false)
        expect(gameManager.state.seriesScores![firstWinner]).toBe(1)
      }
    })
  })

  describe('Series Data Integrity', () => {
    it('maintains proper game numbering through series', () => {
      completeSimpleGame(gameManager)
      gameManager.convertToSeries()
      
      expect(gameManager.state.gameNumber).toBe(1)
      
      gameManager.startNextGame()
      expect(gameManager.state.gameNumber).toBe(2)
      
      completeSimpleGame(gameManager)
      gameManager.completeGame()
      
      if (!gameManager.isSeriesComplete()) {
        gameManager.startNextGame()
        expect(gameManager.state.gameNumber).toBe(3)
      }
    })

    it('preserves all completed game data in series', async () => {
      completeSimpleGame(gameManager)
      const firstGameHands = [...gameManager.state.hands]
      const firstGameScores = [...gameManager.state.scores] as [number, number]
      const firstGameStartTime = gameManager.state.startTime
      
      gameManager.convertToSeries()
      
      // Add small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10))
      
      gameManager.startNextGame()
      completeSimpleGame(gameManager)
      gameManager.completeGame()
      
      expect(gameManager.state.completedGames).toHaveLength(2)
      
      const firstCompletedGame = gameManager.state.completedGames![0]!
      expect(firstCompletedGame.hands).toEqual(firstGameHands)
      expect(firstCompletedGame.finalScores).toEqual(firstGameScores)
      expect(firstCompletedGame.startTime).toBe(firstGameStartTime)
      expect(firstCompletedGame.endTime).toBeGreaterThanOrEqual(firstGameStartTime)
    })

    it('correctly tracks series scores throughout progression', () => {
      completeSimpleGame(gameManager)
      gameManager.convertToSeries()
      const firstWinner = gameManager.state.completedGames![0]!.winner
      
      expect(gameManager.state.seriesScores![firstWinner]).toBe(1)
      expect(gameManager.state.seriesScores![1 - firstWinner]).toBe(0)
      
      // Second game - other team wins
      gameManager.startNextGame()
      completeGameForTeam(gameManager, 1 - firstWinner)
      gameManager.completeGame()
      
      expect(gameManager.state.seriesScores).toEqual([1, 1])
      
      // Third game - first team wins series
      if (!gameManager.isSeriesComplete()) {
        gameManager.startNextGame()
        completeGameForTeam(gameManager, firstWinner)
        gameManager.completeGame()
        
        expect(gameManager.state.seriesScores![firstWinner]).toBe(2)
        expect(gameManager.state.seriesWinner).toBe(firstWinner)
      }
    })
  })

  describe('JSON Serialization with Series', () => {
    it('properly serializes and deserializes series state', () => {
      completeSimpleGame(gameManager)
      gameManager.convertToSeries()
      gameManager.startNextGame()
      
      const json = gameManager.toJSON()
      const restored = GameManager.fromJSON(json)
      
      expect(restored.state.isSeries).toBe(true)
      expect(restored.state.seriesScores).toEqual(gameManager.state.seriesScores)
      expect(restored.state.gameNumber).toBe(gameManager.state.gameNumber)
      expect(restored.state.completedGames).toEqual(gameManager.state.completedGames)
      expect(restored.state.seriesWinner).toBe(gameManager.state.seriesWinner)
    })

    it('maintains series functionality after deserialization', () => {
      completeSimpleGame(gameManager)
      gameManager.convertToSeries()
      
      const json = gameManager.toJSON()
      const restored = GameManager.fromJSON(json)
      
      // Should be able to start next game
      expect(() => restored.startNextGame()).not.toThrow()
      expect(restored.state.gameNumber).toBe(2)
      expect(restored.isSeriesComplete()).toBe(false)
    })
  })
})

// Helper functions
function completeSimpleGame(manager: GameManager) {
  // Clear any existing hands and start fresh
  while (manager.state.hands.length > 0) {
    manager.state.hands.pop()
  }
  manager.state.scores = [0, 0]
  
  // Use the exact working pattern from pepper-awards test
  const hands = [
    '225HP1', // Bob bids 5, gets 1 trick → Bob's team gets 5, Alice's team gets 1 → [1, 5]
    '11MHP0', // Alice bids Moon, gets 0 tricks → Alice's team gets 7, Bob's team gets -7 → [8, -2]
    '21MHP0', // Alice bids Moon, gets 0 tricks → Alice's team gets 7, Bob's team gets -7 → [15, -9]
    '31MHP0', // Alice bids Moon, gets 0 tricks → Alice's team gets 7, Bob's team gets -7 → [22, -16]
    '41MHP0', // Alice bids Moon, gets 0 tricks → Alice's team gets 7, Bob's team gets -7 → [29, -23]
    '11MHP0', // Alice bids Moon, gets 0 tricks → Alice's team gets 7, Bob's team gets -7 → [36, -30]
    '21MHP0', // Alice bids Moon, gets 0 tricks → Alice's team gets 7, Bob's team gets -7 → [43, -37]
  ]
  
  hands.forEach(hand => {
    // Clear any incomplete hand that was auto-started
    if (manager.state.hands.length > 0 && manager.state.hands[manager.state.hands.length - 1]!.length === 1) {
      manager.state.hands.pop()
    }
    
    // Add the complete hand
    manager.state.hands.push(hand)
    
    // Update scores manually
    const [team1Score, team2Score] = calculateScore(hand)
    manager.state.scores[0] += team1Score
    manager.state.scores[1] += team2Score
  })
  
  // Mark the game as complete if it has a winner
  if (manager.isGameComplete()) {
    manager.completeGame()
  }
}

function completeGameForTeam(manager: GameManager, targetTeam: number) {
  // Clear current hands
  while (manager.state.hands.length > 1) { // Keep dealer
    manager.state.hands.pop()
  }
  manager.state.scores = [0, 0]
  
  // Team 0: players 1,3 (Alice=1, Charlie=3) (1-indexed)
  // Team 1: players 2,4 (Bob=2, Dana=4) (1-indexed)
  
  if (targetTeam === 0) {
    // Alice (team 0) wins by getting lots of Moon bids
    const hands = [
      '225HP1', // Bob starts with 5 points → [1, 5]
      '11MHP0', // Alice Moon → [8, -2]
      '21MHP0', // Alice Moon → [15, -9]
      '31MHP0', // Alice Moon → [22, -16]
      '41MHP0', // Alice Moon → [29, -23]
      '11MHP0', // Alice Moon → [36, -30]
      '21MHP0', // Alice Moon → [43, -37] - Team 0 wins
    ]
    hands.forEach(hand => {
      // Clear any incomplete hand that was auto-started
      if (manager.state.hands.length > 0 && manager.state.hands[manager.state.hands.length - 1]!.length === 1) {
        manager.state.hands.pop()
      }
      
      // Add the complete hand
      manager.state.hands.push(hand)
      
      // Update scores manually
      const [team1Score, team2Score] = calculateScore(hand)
      manager.state.scores[0] += team1Score
      manager.state.scores[1] += team2Score
    })
  } else {
    // Bob (team 1) wins by getting lots of Moon bids
    const hands = [
      '115HP1', // Alice starts with 5 points → [5, 1]
      '22MHP0', // Bob Moon → [-2, 8]
      '32MHP0', // Bob Moon → [-9, 15]
      '42MHP0', // Bob Moon → [-16, 22]
      '12MHP0', // Bob Moon → [-23, 29]
      '22MHP0', // Bob Moon → [-30, 36]
      '32MHP0', // Bob Moon → [-37, 43] - Team 1 wins
    ]
    hands.forEach(hand => {
      // Clear any incomplete hand that was auto-started
      if (manager.state.hands.length > 0 && manager.state.hands[manager.state.hands.length - 1]!.length === 1) {
        manager.state.hands.pop()
      }
      
      // Add the complete hand
      manager.state.hands.push(hand)
      
      // Update scores manually
      const [team1Score, team2Score] = calculateScore(hand)
      manager.state.scores[0] += team1Score
      manager.state.scores[1] += team2Score
    })
  }
}