import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { trackAwardData } from '@/lib/statistics-util';
import { selectGameAwards } from '@/lib/pepper-awards';

describe('Award Statistics Display', () => {
  beforeEach(() => {
    // Reset Math.random to ensure consistent test results
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should include statDetails in award results', () => {
    const players = ['Alice', 'Bob', 'Charlie', 'Diana'];
    const hands = [
      '114HP0', // Alice: Big Four #1 (4 Hearts, 0 tricks)
      '225SP1', // Bob: Not a Big Four (5 Spades, 1 trick)
      '33PHP0', // Charlie: Big Four #1 (Pepper Hearts, 0 tricks)
      '444DP0', // Diana: Big Four #1 (4 Diamonds, 0 tricks)
      '114SP0', // Alice: Big Four #2 (4 Spades, 0 tricks)
      '226NP1', // Bob: Not a Big Four (6 No-trump, 1 trick)
      '33PHP0', // Charlie: Big Four #2 (Pepper Hearts, 0 tricks)
      '444NP0', // Diana: Big Four #2 (4 No-trump, 0 tricks)
      '225CP1', // Bob: Not a Big Four (5 Clubs, clubs don't qualify)
      '33PHP0', // Charlie: Big Four #3 (Pepper Hearts, 0 tricks) - Charlie has most!
      '445HP1', // Diana: Not a Big Four (5 Hearts, 1 trick)
    ];
    
    const teams = ['Team 1', 'Team 2'];
    const finalScores: [number, number] = [48, 36];
    const winner = 0;
    const awardData = trackAwardData(hands, players, teams, finalScores, winner);
    
    const gameAwards = selectGameAwards(awardData);
    
    // Should have awards with statDetails
    expect(gameAwards.length).toBeGreaterThan(0);
    
    // Find Honeypot award
    const honeypotAward = gameAwards.find(award => award.id === 'honeypot');
    expect(honeypotAward).toBeDefined();
    expect(honeypotAward?.winner).toBe('Charlie');
    expect(honeypotAward?.statDetails).toBe('Charlie had 3 Big Fours');
    
    // Find other awards and verify they have statDetails
    const otherAwards = gameAwards.filter(award => award.id !== 'honeypot');
    otherAwards.forEach(award => {
      expect(award.statDetails).toBeDefined();
      expect(award.statDetails).toContain(award.winner);
    });
  });

  it('should generate correct stat details for overreaching award', () => {
    const players = ['Alice', 'Bob'];
    const hands = [
      '11PHP6', // Alice bids Pepper, fails (gets 0 tricks, needs 4)
      '22MNP1', // Bob bids Moon, fails (gets 5 tricks, needs 6)
      '11PHP6', // Alice bids Pepper again, fails (gets 0 tricks, needs 4)
      '22DNP1', // Bob bids Double Moon, fails (gets 5 tricks, needs 6)
    ];
    
    const teams = ['Team 1', 'Team 2'];
    const finalScores: [number, number] = [0, 0];
    const winner = null;
    const awardData = trackAwardData(hands, players, teams, finalScores, winner);
    
    const gameAwards = selectGameAwards(awardData);
    
    // Find overreaching award
    const overreachingAward = gameAwards.find(award => award.id === 'overreaching');
    expect(overreachingAward).toBeDefined();
    
    // Bob should win with average of 10.5 points (7 + 14) / 2
    expect(overreachingAward?.winner).toBe('Bob');
    expect(overreachingAward?.statDetails).toBe('Bob averaged 10.5 points on failed bids');
  });

  it('should generate correct stat details for any available award', () => {
    const players = ['Alice', 'Bob'];
    const hands = [
      '11PHP2', // Alice bids Pepper
      '12PHP2', // Bob bids Pepper
      '21PHP2', // Alice bids Pepper again
      '22PHP2', // Bob bids Pepper again
      '11PHP2', // Alice bids Pepper third time
    ];
    
    const teams = ['Team 1', 'Team 2'];
    const finalScores: [number, number] = [15, 10];
    const winner = 0;
    const awardData = trackAwardData(hands, players, teams, finalScores, winner);
    
    const gameAwards = selectGameAwards(awardData);
    
    // Verify that all awards have statDetails
    expect(gameAwards.length).toBeGreaterThan(0);
    
    gameAwards.forEach(award => {
      expect(award.statDetails).toBeDefined();
      expect(award.statDetails).toContain(award.winner);
      
      console.log(`Award: ${award.name}, Winner: ${award.winner}, Stats: ${award.statDetails}`);
    });
  });
});