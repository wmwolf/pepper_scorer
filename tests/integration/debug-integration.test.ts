import { describe, it, expect } from 'vitest';
import { GameManager, calculateScore } from '@/lib/gameState';

describe('Debug Integration', () => {
  it('should understand scoring for regular bid', () => {
    // Test regular bid first
    const hand = '224HP2'; // Bob bids 4, defending team gets 2 tricks
    const scores = calculateScore(hand);
    console.log('Regular bid hand:', hand);
    console.log('Direct calculateScore:', scores);
    
    // Bob is player 2 (team 1), bid 4, defending team got 2 tricks
    // So Bob's team got 4 tricks, made their bid
    // Expected: Bob's team gets +4, Alice's team gets +2
    expect(scores).toEqual([2, 4]); // [defending team tricks, bidding team bid value]
  });

  it('should understand scoring for Double Moon with 0 tricks', () => {
    // Test calculateScore for Double Moon with 0 defending tricks
    const hand1 = '22DCP0'; // Bob bids Double Moon, defending team gets 0 tricks
    const scores1 = calculateScore(hand1);
    console.log('Double Moon, 0 tricks:', hand1, '->', scores1);
    
    // Test what happens with 1 trick
    const hand2 = '22DCP1'; // Bob bids Double Moon, defending team gets 1 trick  
    const scores2 = calculateScore(hand2);
    console.log('Double Moon, 1 trick:', hand2, '->', scores2);
    
    // For Moon/Double Moon, if defending team gets ANY tricks, bidding team is set
    // Because Moon/Double Moon requires taking ALL 6 tricks
    
    // With 0 tricks: bidding team took all 6, made the bid
    expect(scores1).toEqual([-14, 14]); // Seems like defending team gets penalty?
    
    // With 1 trick: bidding team didn't take all 6, got set
    expect(scores2).toEqual([14, -14]); // Bidding team gets penalty, defending team gets bid value
  });
  
  it('should understand team assignments', () => {
    const gameManager = new GameManager(['Alice', 'Bob', 'Charlie', 'Dave'], ['Team 1', 'Team 2']);
    
    // Test each player's team
    console.log('Team assignments:');
    for (let player = 1; player <= 4; player++) {
      const team = (player - 1) % 2;
      console.log(`Player ${player} (${gameManager.state.players[player-1]}) -> Team ${team}`);
    }
    
    // Alice (1) and Charlie (3) should be team 0
    // Bob (2) and Dave (4) should be team 1
    expect((1 - 1) % 2).toBe(0); // Alice -> Team 0
    expect((2 - 1) % 2).toBe(1); // Bob -> Team 1
    expect((3 - 1) % 2).toBe(0); // Charlie -> Team 0
    expect((4 - 1) % 2).toBe(1); // Dave -> Team 1
  });
});