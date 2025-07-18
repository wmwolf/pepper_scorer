import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { trackAwardData } from '@/lib/statistics-util';
import { selectGameAwards } from '@/lib/pepper-awards';

describe('Honeypot Award - Big Four Detection', () => {
  beforeEach(() => {
    // Reset Math.random to ensure consistent test results
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // Will always select middle element in ties
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should detect Big Fours correctly - 4-bid with non-clubs trump and zero defending tricks', () => {
    const players = ['Alice', 'Bob', 'Charlie', 'Diana'];
    const hands = [
      '114HP0', // Alice bids 4 Hearts, defending team gets 0 → Big Four!
      '225SP0', // Bob bids 5 Spades, defending team gets 0 → Not a Big Four (bid is 5, not 4)
      '33PHP0', // Charlie bids Pepper Hearts, defending team gets 0 → Big Four!
      '444DP0', // Diana bids 4 Diamonds, defending team gets 0 → Big Four!
    ];
    
    const teams = ['Team 1', 'Team 2'];
    const finalScores: [number, number] = [20, 16];
    const winner = 0;
    const awardData = trackAwardData(hands, players, teams, finalScores, winner);
    
    // Alice: 1 Big Four
    expect(awardData.playerStats.Alice.bigFours).toBe(1);
    
    // Bob: 0 Big Fours (bid was 5, not 4)
    expect(awardData.playerStats.Bob.bigFours).toBe(0);
    
    // Charlie: 1 Big Four (Pepper counts as 4-bid)
    expect(awardData.playerStats.Charlie.bigFours).toBe(1);
    
    // Diana: 1 Big Four
    expect(awardData.playerStats.Diana.bigFours).toBe(1);
  });

  it('should NOT count Big Fours when trump is Clubs (forced stay)', () => {
    const players = ['Alice', 'Bob', 'Charlie', 'Diana'];
    const hands = [
      '114CP0', // Alice bids 4 Clubs, defending team gets 0 → NOT a Big Four (clubs)
      '224HP0', // Bob bids 4 Hearts, defending team gets 0 → Big Four!
      '33PCP0', // Charlie bids Pepper Clubs, defending team gets 0 → NOT a Big Four (clubs)
      '41PHP0', // Alice bids Pepper Hearts, defending team gets 0 → Big Four!
    ];
    
    const teams = ['Team 1', 'Team 2'];
    const finalScores: [number, number] = [16, 8];
    const winner = 0;
    const awardData = trackAwardData(hands, players, teams, finalScores, winner);
    
    // Alice: 1 Big Four (only the Pepper Hearts, not the 4 Clubs)
    expect(awardData.playerStats.Alice.bigFours).toBe(1);
    
    // Bob: 1 Big Four
    expect(awardData.playerStats.Bob.bigFours).toBe(1);
    
    // Charlie: 0 Big Fours (Pepper Clubs doesn't count)
    expect(awardData.playerStats.Charlie.bigFours).toBe(0);
    
    // Diana: 0 Big Fours
    expect(awardData.playerStats.Diana.bigFours).toBe(0);
  });

  it('should NOT count Big Fours when defending team gets tricks', () => {
    const players = ['Alice', 'Bob', 'Charlie', 'Diana'];
    const hands = [
      '114HP1', // Alice bids 4 Hearts, defending team gets 1 → NOT a Big Four (defenders got tricks)
      '224HP0', // Bob bids 4 Hearts, defending team gets 0 → Big Four!
      '33PHP2', // Charlie bids Pepper Hearts, defending team gets 2 → NOT a Big Four (defenders got tricks)
      '41PHP0', // Alice bids Pepper Hearts, defending team gets 0 → Big Four!
    ];
    
    const teams = ['Team 1', 'Team 2'];
    const finalScores: [number, number] = [18, 7];
    const winner = 0;
    const awardData = trackAwardData(hands, players, teams, finalScores, winner);
    
    // Alice: 1 Big Four (only the second Pepper bid where defenders got 0)
    expect(awardData.playerStats.Alice.bigFours).toBe(1);
    
    // Bob: 1 Big Four
    expect(awardData.playerStats.Bob.bigFours).toBe(1);
    
    // Charlie: 0 Big Fours (defenders got 2 tricks)
    expect(awardData.playerStats.Charlie.bigFours).toBe(0);
    
    // Diana: 0 Big Fours
    expect(awardData.playerStats.Diana.bigFours).toBe(0);
  });

  it('should NOT count Big Fours when hand is folded (decision F)', () => {
    const players = ['Alice', 'Bob', 'Charlie', 'Diana'];
    const hands = [
      '114HF2', // Alice bids 4 Hearts, folds with 2 negotiated → NOT a Big Four (folded)
      '224HP0', // Bob bids 4 Hearts, plays and defenders get 0 → Big Four!
      '33PHF0', // Charlie bids Pepper Hearts, folds with 0 negotiated → NOT a Big Four (folded)
      '41PHP0', // Alice bids Pepper Hearts, plays and defenders get 0 → Big Four!
    ];
    
    const teams = ['Team 1', 'Team 2'];
    const finalScores: [number, number] = [14, 6];
    const winner = 0;
    const awardData = trackAwardData(hands, players, teams, finalScores, winner);
    
    // Alice: 1 Big Four (only the played Pepper bid)
    expect(awardData.playerStats.Alice.bigFours).toBe(1);
    
    // Bob: 1 Big Four
    expect(awardData.playerStats.Bob.bigFours).toBe(1);
    
    // Charlie: 0 Big Fours (folded hand doesn't count)
    expect(awardData.playerStats.Charlie.bigFours).toBe(0);
    
    // Diana: 0 Big Fours
    expect(awardData.playerStats.Diana.bigFours).toBe(0);
  });

  it('should award Honeypot to player with most Big Fours (minimum 2)', () => {
    const players = ['Alice', 'Bob', 'Charlie', 'Diana'];
    const hands = [
      '114HP0', // Alice: Big Four #1 (4 Hearts, 0 tricks)
      '225SP1', // Bob: Not a Big Four (5 Spades, defenders got 1 trick)
      '33PHP0', // Charlie: Big Four #1 (Pepper Hearts, 0 tricks)
      '444DP0', // Diana: Big Four #1 (4 Diamonds, 0 tricks)
      '114SP0', // Alice: Big Four #2 (4 Spades, 0 tricks)
      '226NP1', // Bob: Not a Big Four (6 No-trump, defenders got 1 trick)
      '33PHP0', // Charlie: Big Four #2 (Pepper Hearts, 0 tricks)
      '444NP0', // Diana: Big Four #2 (4 No-trump, 0 tricks)
      '225CP1', // Bob: Not a Big Four (5 Clubs, but clubs don't qualify)
      '33PHP0', // Charlie: Big Four #3 (Pepper Hearts, 0 tricks) - Charlie has most!
      '445HP1', // Diana: Not a Big Four (5 Hearts, defenders got 1 trick)
    ];
    
    const teams = ['Team 1', 'Team 2'];
    const finalScores: [number, number] = [48, 36];
    const winner = 0;
    const awardData = trackAwardData(hands, players, teams, finalScores, winner);
    
    // Verify Big Four counts based on actual hands
    expect(awardData.playerStats.Alice.bigFours).toBe(2); // 2 Big Fours
    expect(awardData.playerStats.Bob.bigFours).toBe(0);   // 0 Big Fours
    expect(awardData.playerStats.Charlie.bigFours).toBe(3); // 3 Big Fours
    expect(awardData.playerStats.Diana.bigFours).toBe(2);   // 2 Big Fours
    
    const gameAwards = selectGameAwards(awardData);
    const honeypotAward = gameAwards.find(award => award.id === 'honeypot');
    
    // Should award Honeypot since Charlie has most (3) Big Fours
    expect(honeypotAward).toBeDefined();
    // Charlie should win with most Big Fours
    expect(honeypotAward?.winner).toBe('Charlie');
  });

  it('should NOT award Honeypot if no player has 2+ Big Fours', () => {
    const players = ['Alice', 'Bob', 'Charlie', 'Diana'];
    const hands = [
      '114HP0', // Alice: Big Four #1 (only 1)
      '225SP1', // Bob: Not a Big Four (5-bid and defenders got tricks)
      '33PHP1', // Charlie: Not a Big Four (defenders got tricks)
      '416SP2', // Diana: Not a Big Four (6-bid)
    ];
    
    const teams = ['Team 1', 'Team 2'];
    const finalScores: [number, number] = [11, 8];
    const winner = 0;
    const awardData = trackAwardData(hands, players, teams, finalScores, winner);
    
    // Verify Big Four counts
    expect(awardData.playerStats.Alice.bigFours).toBe(1);
    expect(awardData.playerStats.Bob.bigFours).toBe(0);
    expect(awardData.playerStats.Charlie.bigFours).toBe(0);
    expect(awardData.playerStats.Diana.bigFours).toBe(0);
    
    const gameAwards = selectGameAwards(awardData);
    const honeypotAward = gameAwards.find(award => award.id === 'honeypot');
    
    // Should NOT award Honeypot since no one has 2+ Big Fours
    expect(honeypotAward).toBeUndefined();
  });

  it('should prioritize Honeypot as important award', () => {
    const players = ['Alice', 'Bob', 'Charlie', 'Diana'];
    const hands = [
      '114HP0', // Alice: Big Four #1 (4 Hearts, 0 tricks)
      '225SP1', // Bob: Not a Big Four (5 Spades, 1 trick)
      '33PHP0', // Charlie: Big Four #1 (Pepper Hearts, 0 tricks)
      '444DP0', // Diana: Big Four #1 (4 Diamonds, 0 tricks) 
      '114SP0', // Alice: Big Four #2 (4 Spades, 0 tricks)
      '226NP1', // Bob: Not a Big Four (6 No-trump, 1 trick)
      '337HP1', // Charlie: Not a Big Four (7-bid invalid, treated as default)
      '448NP2', // Diana: Not a Big Four (8-bid invalid, treated as default)
    ];
    
    const teams = ['Team 1', 'Team 2'];
    const finalScores: [number, number] = [28, 18];
    const winner = 0;
    const awardData = trackAwardData(hands, players, teams, finalScores, winner);
    
    // Verify Big Four counts from actual hands
    expect(awardData.playerStats.Alice.bigFours).toBe(2); // 4H and 4S
    expect(awardData.playerStats.Bob.bigFours).toBe(0);   // No 4-bids or Peppers with 0 tricks
    expect(awardData.playerStats.Charlie.bigFours).toBe(1); // 1 Pepper
    expect(awardData.playerStats.Diana.bigFours).toBe(1);   // 1 x 4D
    
    const gameAwards = selectGameAwards(awardData);
    const honeypotAward = gameAwards.find(award => award.id === 'honeypot');
    
    // Should find the Honeypot award
    expect(honeypotAward).toBeDefined();
    expect(honeypotAward?.important).toBe(true);
    
    // Alice should win with 2 Big Fours (only player with 2+)
    expect(honeypotAward?.winner).toBe('Alice');
  });

  it('should handle mixed bid types correctly for Big Four detection', () => {
    const players = ['Alice', 'Bob', 'Charlie', 'Diana'];
    const hands = [
      // Test various bid types and scenarios
      '11PHP0', // Alice: Pepper (P) Hearts, 0 tricks → Big Four
      '224CP0', // Bob: 4 Clubs, 0 tricks → NOT Big Four (clubs)
      '335HP0', // Charlie: 5 Hearts, 0 tricks → NOT Big Four (not 4-bid)
      '416SP0', // Diana: 6 Spades, 0 tricks → NOT Big Four (not 4-bid)
      '124HP0', // Alice: 4 Hearts, 0 tricks → Big Four #2
      '22MHP0', // Bob: Moon Hearts, 0 tricks → NOT Big Four (not 4-bid)
      '33DDP0', // Charlie: Double Moon Diamonds, 0 tricks → NOT Big Four (not 4-bid)
      '41PHP0', // Diana: Pepper Hearts, 0 tricks → Big Four #1
    ];
    
    const teams = ['Team 1', 'Team 2'];
    const finalScores: [number, number] = [35, 21];
    const winner = 0;
    const awardData = trackAwardData(hands, players, teams, finalScores, winner);
    
    // Alice: 2 Big Fours (Pepper + 4-bid, both Hearts with 0 tricks)
    expect(awardData.playerStats.Alice.bigFours).toBe(2);
    
    // Bob: 1 Big Four (hand '124HP0' = Bob bids 4 Hearts with 0 tricks)
    expect(awardData.playerStats.Bob.bigFours).toBe(1);
    
    // Charlie: 0 Big Fours (5-bid and Double Moon don't count)
    expect(awardData.playerStats.Charlie.bigFours).toBe(0);
    
    // Diana: 0 Big Fours (Diana doesn't bid in any hands, or doesn't get Big Fours)
    expect(awardData.playerStats.Diana.bigFours).toBe(0);
    
    const gameAwards = selectGameAwards(awardData);
    const honeypotAward = gameAwards.find(award => award.id === 'honeypot');
    
    // Only Alice qualifies with 2+ Big Fours
    expect(honeypotAward).toBeDefined();
    expect(honeypotAward?.winner).toBe('Alice');
  });
});