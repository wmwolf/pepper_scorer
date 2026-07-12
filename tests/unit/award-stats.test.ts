import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { trackAwardData } from '@/lib/statistics-util';
import { selectGameAwards, evaluateAward, gameAwards } from '@/lib/pepper-awards';

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
    
    const selectedAwards = selectGameAwards(awardData);

    // Should have awards with statDetails
    expect(selectedAwards.length).toBeGreaterThan(0);

    // Honeypot is earned by this game; source it deterministically via evaluateAward
    // rather than the now-randomized selection list.
    const honeypotAward = evaluateAward(gameAwards.find(def => def.id === 'honeypot')!, awardData);
    expect(honeypotAward).not.toBeNull();
    expect(honeypotAward?.winner).toBe('Charlie');
    expect(honeypotAward?.statDetails).toBe('Charlie had 3 Big Fours');

    // Find other awards and verify they have statDetails
    const otherAwards = selectedAwards.filter(award => award.id !== 'honeypot');
    otherAwards.forEach(award => {
      expect(award.statDetails).toBeDefined();
      expect(award.statDetails).toContain(award.winner);
    });
  });

  it('counts a negotiated fold as a successful defense, a zero-trick fold as a concession', () => {
    const players = ['Alice', 'Bob', 'Charlie', 'Diana'];
    const teams = ['Team 1', 'Team 2'];
    // The award defines a successful defense as "sets the bidders OR negotiates for tricks".
    // Hand 1: Charlie (seat 3, Team 1) bids 5H; the defenders (Team 2) FOLD but negotiate 3 free
    //   tricks -> a SUCCESSFUL (negotiated) defense.
    // Hand 2: Diana (seat 4, Team 2) bids 5H; the defenders (Team 1) FOLD for ZERO tricks -> a full
    //   concession -> UNSUCCESSFUL.
    const hands = ['135HF3', '245HF0'];
    const awardData = trackAwardData(hands, players, teams, [10, 0], null);

    const team1 = awardData.teamStats['Team 1'];
    const team2 = awardData.teamStats['Team 2'];

    // A fold still makes the bid for the bidding team.
    expect(team1.successfulBids).toBe(1); // Charlie's bid (hand 1)
    expect(team2.successfulBids).toBe(1); // Diana's bid (hand 2)

    // Team 2 defended hand 1 and negotiated 3 tricks -> successful defense.
    expect(team2.totalDefenses).toBe(1);
    expect(team2.successfulDefenses).toBe(1);
    // Team 1 defended hand 2 and conceded for 0 tricks -> unsuccessful.
    expect(team1.totalDefenses).toBe(1);
    expect(team1.successfulDefenses).toBe(0);
    expect(team1.defensiveSuccessRate).toBe(0);
  });

  it('keeps the running score history in sync when a hand has an unknown bidder', () => {
    const players = ['Alice', 'Bob', 'Charlie', 'Diana'];
    const teams = ['Team 1', 'Team 2'];
    // Middle hand has an out-of-range bidder (seat 5 -> no such player). The score
    // history and deficit tracking must still account for it rather than skipping it.
    const hands = [
      '114HP2', // seat 1 (team 0) bids 4, played, defenders take 2 -> [4, 2]
      '154HP0', // seat 5 (UNKNOWN player, team 0) bids 4, defenders shut out -> [4, -4]
      '134HP1', // seat 3 (team 0) bids 4, played, defenders take 1 -> [4, 1]
    ];
    const finalScores: [number, number] = [12, -1];

    const awardData = trackAwardData(hands, players, teams, finalScores, 0);

    // One handScores entry per completed hand, including the unknown-bidder hand.
    expect(awardData.handScores).toHaveLength(3);
    // pointsHistory is the initial [0,0] plus one cumulative entry per completed hand.
    expect(awardData.pointsHistory).toHaveLength(4);
    // Cumulative totals reflect all three hands (the unknown-bidder hand is not dropped).
    expect(awardData.pointsHistory[awardData.pointsHistory.length - 1]).toEqual([12, -1]);
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
    
    // Overreaching is earned by this game; source it deterministically via evaluateAward
    // rather than the now-randomized selection list.
    const overreachingAward = evaluateAward(gameAwards.find(def => def.id === 'overreaching')!, awardData);
    expect(overreachingAward).not.toBeNull();

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
    
    const selectedAwards = selectGameAwards(awardData);

    // Verify that all awards have statDetails
    expect(selectedAwards.length).toBeGreaterThan(0);

    selectedAwards.forEach(award => {
      expect(award.statDetails).toBeDefined();
      expect(award.statDetails).toContain(award.winner);
      
      console.log(`Award: ${award.name}, Winner: ${award.winner}, Stats: ${award.statDetails}`);
    });
  });
});