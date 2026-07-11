import { describe, it, expect } from 'vitest';
import { trackAwardData } from '@/lib/statistics-util';
import { evaluateAward, gameAwards } from '@/lib/pepper-awards';

describe('Overreaching Award Bug Fix', () => {
  it('should not award overreaching to player with only 1 failed bid (Susie bug fix)', () => {
    // Reproduce the exact game where Susie incorrectly got the overreaching award
    const players = ['Gina', 'CJ', 'Susie', 'Lisa'];
    const hands = [
      '12PHP2',  // Hand 1
      '23PNP1',  // Hand 2: Susie bids Pepper, 1 defending trick → SUCCESS (Susie gets 5 tricks, needs 4)
      '34PCP2',  // Hand 3
      '41PDF2',  // Hand 4
      '145DF1', // Hand 5
      '224NP2',  // Hand 6
      '32MHFO',  // Hand 7
      '40',      // Hand 8: Throw-in
      '124NP1',  // Hand 9
      '24MHFO',  // Hand 10
      '33MNP2'   // Hand 11: Susie bids Moon, 2 defending tricks → FAILURE (Susie gets 4 tricks, needs 6)
    ];
    
    const teams = ['Team 1', 'Team 2'];
    const finalScores: [number, number] = [0, 0]; // Not important for this test
    const winner = null; // Not important for this test
    const awardData = trackAwardData(hands, players, teams, finalScores, winner);
    
    // Verify Susie's statistics are tracked correctly
    const susieStats = awardData.playerStats.Susie;
    expect(susieStats.bidsWon).toBe(2); // Susie bid in hands 2 and 11
    expect(susieStats.bidsSucceeded).toBe(1); // Only the Pepper bid succeeded
    expect(susieStats.bidsFailed).toBe(1); // Only the Moon bid failed
    expect(susieStats.failedBidValues).toEqual([7]); // Only Moon (7 points) failed
    expect(susieStats.failedBidValues.length).toBe(1); // Should have exactly 1 failed bid
    
    // Deterministically evaluate the overreaching award. Because no player has
    // 2+ failed bids, it must not be earned at all (and certainly not by Susie).
    // Using evaluateAward instead of the now-random selection makes this negative
    // assertion reliable: an absent award under random selection could be chance,
    // which would NOT prove the bug fix.
    const overreachingDef = gameAwards.find(d => d.id === 'overreaching')!;
    const result = evaluateAward(overreachingDef, awardData);

    // Susie should not receive the overreaching award (requires 2+ failed bids)
    // and no one qualifies here, so the award is not earned.
    expect(result).toBeNull();
  });
  
  it('should correctly evaluate Pepper bids as successful when appropriate', () => {
    const players = ['Alice', 'Bob'];
    const hands = [
      '11PHP3', // Alice bids Pepper, defending team gets 3 tricks → Alice gets 3 tricks, needs 4 → FAILURE
      '12PHP1', // Bob bids Pepper, defending team gets 1 trick → Bob gets 5 tricks, needs 4 → SUCCESS
      '21PHP0', // Alice bids Pepper, defending team gets 0 tricks → Alice gets 6 tricks, needs 4 → SUCCESS
    ];
    
    const teams = ['Team 1', 'Team 2'];
    const finalScores: [number, number] = [0, 0]; // Not important for this test
    const winner = null; // Not important for this test
    const awardData = trackAwardData(hands, players, teams, finalScores, winner);
    
    // Alice: 1 success, 1 failure
    expect(awardData.playerStats.Alice.bidsSucceeded).toBe(1);
    expect(awardData.playerStats.Alice.bidsFailed).toBe(1);
    expect(awardData.playerStats.Alice.failedBidValues).toEqual([4]); // Failed Pepper bid
    
    // Bob: 1 success, 0 failures  
    expect(awardData.playerStats.Bob.bidsSucceeded).toBe(1);
    expect(awardData.playerStats.Bob.bidsFailed).toBe(0);
    expect(awardData.playerStats.Bob.failedBidValues).toEqual([]);
  });
  
  it('should correctly evaluate Moon bids requiring all 6 tricks', () => {
    const players = ['Alice', 'Bob'];
    const hands = [
      '11MNP0', // Alice bids Moon, defending team gets 0 tricks → Alice gets 6 tricks, needs 6 → SUCCESS
      '12MNP1', // Bob bids Moon, defending team gets 1 trick → Bob gets 5 tricks, needs 6 → FAILURE
    ];
    
    const teams = ['Team 1', 'Team 2'];
    const finalScores: [number, number] = [0, 0]; // Not important for this test
    const winner = null; // Not important for this test
    const awardData = trackAwardData(hands, players, teams, finalScores, winner);
    
    // Alice: 1 success, 0 failures
    expect(awardData.playerStats.Alice.bidsSucceeded).toBe(1);
    expect(awardData.playerStats.Alice.bidsFailed).toBe(0);
    
    // Bob: 0 successes, 1 failure
    expect(awardData.playerStats.Bob.bidsSucceeded).toBe(0);
    expect(awardData.playerStats.Bob.bidsFailed).toBe(1);
    expect(awardData.playerStats.Bob.failedBidValues).toEqual([7]); // Failed Moon bid
  });
  
  it('should only award overreaching to players with 2+ failed bids', () => {
    const players = ['Alice', 'Bob', 'Charlie'];
    const hands = [
      '11PHP6', // Alice bids Pepper, fails (gets 0 tricks, needs 4)
      '22PHP2', // Bob bids Pepper, succeeds (gets 4 tricks, needs 4)
      '31PHP6', // Alice bids Pepper again, fails (gets 0 tricks, needs 4)  
      '13MNP1', // Charlie bids Moon, fails (gets 5 tricks, needs 6)
    ];
    
    const teams = ['Team 1', 'Team 2'];
    const finalScores: [number, number] = [0, 0]; // Not important for this test
    const winner = null; // Not important for this test
    const awardData = trackAwardData(hands, players, teams, finalScores, winner);
    
    // Alice: 2 failed bids, should qualify for overreaching
    expect(awardData.playerStats.Alice.failedBidValues.length).toBe(2);
    expect(awardData.playerStats.Alice.failedBidValues).toEqual([4, 4]);
    
    // Bob: 0 failed bids, should not qualify
    expect(awardData.playerStats.Bob.failedBidValues.length).toBe(0);
    
    // Charlie: 1 failed bid, should not qualify  
    expect(awardData.playerStats.Charlie.failedBidValues.length).toBe(1);
    
    // Deterministically evaluate: only Alice has 2+ failed bids, so she must be
    // the overreaching winner.
    const overreachingDef = gameAwards.find(d => d.id === 'overreaching')!;
    const result = evaluateAward(overreachingDef, awardData);

    // Only Alice should be eligible for overreaching award
    expect(result).toBeTruthy();
    expect(result!.winner).toBe('Alice');
  });
});