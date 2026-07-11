// pepper-awards.ts - Award definitions for Pepper Scorer
// These types are used for typing functions internally in this module
// eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
import type { AwardTrackingData, PlayerStats, TeamStats } from './statistics-util';
import { decodeHand, calculateScore, isPepperRound, isHandComplete } from './gameState';

export interface AwardDefinition {
  id: string;               // Unique identifier
  name: string;             // Display name
  description: string;      // User-friendly description for display
  technicalDefinition: string; // Detailed criteria for implementation
  type: 'team' | 'player';  // Whether award is for a team or player
  scope: 'game' | 'series'; // Whether award applies to a single game or series
  important: boolean;       // If true, will be prioritized for display
  icon: string;             // Icon name for displaying with award
}

export interface AwardWithWinner extends AwardDefinition {
  winner: string;           // Name of player or team who won the award
  statDetails?: string;     // Specific statistics for this award (e.g., "Player X had 3 Big Fours")
}

// ==============================
// Stat Calculation Functions
// ==============================

/**
 * Calculate specific statistics for each award type
 */
function calculateAwardStats(awardId: string, winnerName: string, data: AwardTrackingData): string {
  const playerStats = data.playerStats[winnerName];
  const teamStats = data.teamStats[winnerName];
  
  switch (awardId) {
    // Team Awards
    case 'defensive_fortress': {
      const sets = teamStats?.setsAgainstOpponents || 0;
      return `${winnerName} set opponents ${sets} times`;
    }
    
    case 'bid_specialists': {
      if (!teamStats) return `${winnerName} had excellent bid success rate`;
      
      // Calculate non-pepper bid success rate
      let nonPepperBids = 0;
      let nonPepperSets = 0;
      
      data.hands.forEach((hand, handIndex) => {
        if (isPepperRound(handIndex) || !isHandComplete(hand)) return;
        
        try {
          const { bidWinner } = decodeHand(hand);
          const bidderTeamIndex = (bidWinner - 1) % 2;
          const teamIndex = Object.values(data.teamStats).indexOf(teamStats);
          
          if (bidderTeamIndex === teamIndex) {
            nonPepperBids++;
            const [score1, score2] = calculateScore(hand);
            const teamScore = teamIndex === 0 ? score1 : score2;
            if (teamScore < 0) {
              nonPepperSets++;
            }
          }
        } catch {
          // Skip invalid hands
        }
      });
      
      const successRate = nonPepperBids > 0 ? Math.round((1 - (nonPepperSets / nonPepperBids)) * 100) : 0;
      return `${winnerName} had ${successRate}% bid success rate (${nonPepperBids - nonPepperSets}/${nonPepperBids} bids)`;
    }
    
    case 'remember_the_time': {
      const deficit = teamStats?.maxDeficit || 0;
      return `${winnerName} overcame a ${deficit}-point deficit`;
    }
    
    case 'helping_hand': {
      let pointsGiven = 0;
      const teamIndex = Object.values(data.teamStats).indexOf(teamStats!);
      
      data.hands.forEach(hand => {
        if (!isHandComplete(hand)) return;
        
        try {
          const { bidWinner, decision, tricks } = decodeHand(hand);
          const bidderTeamIndex = (bidWinner - 1) % 2;
          
          if (bidderTeamIndex === teamIndex && decision === 'F' && tricks > 0) {
            pointsGiven += tricks;
          }
        } catch {
          // Skip invalid hands
        }
      });
      
      return `${winnerName} gave away ${pointsGiven} points in negotiations`;
    }
    
    case 'bid_bullies': {
      const successes = teamStats?.highValueBids.successes || 0;
      return `${winnerName} made ${successes} successful high-value bids`;
    }
    
    case 'streak_masters': {
      const streak = teamStats?.longestStreak || 0;
      return `${winnerName} had a ${streak}-hand scoring streak`;
    }
    
    case 'defensive_specialists': {
      const rate = Math.round((teamStats?.defensiveSuccessRate || 0) * 100);
      const successful = teamStats?.successfulDefenses || 0;
      const total = teamStats?.totalDefenses || 0;
      return `${winnerName} had ${rate}% defensive success rate (${successful}/${total} defenses)`;
    }
    
    // Player Awards
    case 'trump_master': {
      if (!playerStats) return `${winnerName} mastered trump suits`;
      
      const suitedAttempts = Object.entries(playerStats.trumpBids)
        .filter(([suit]) => suit !== 'N')
        .reduce((sum, [, data]) => sum + data.attempts, 0);
      
      const suitedSuccesses = Object.entries(playerStats.trumpBids)
        .filter(([suit]) => suit !== 'N')
        .reduce((sum, [, data]) => sum + data.successes, 0);
      
      const rate = Math.round((suitedSuccesses / suitedAttempts) * 100);
      return `${winnerName} had ${rate}% success rate with trump suits (${suitedSuccesses}/${suitedAttempts} bids)`;
    }
    
    case 'bid_royalty': {
      const bids = playerStats?.bidsWon || 0;
      return `${winnerName} won ${bids} bids`;
    }
    
    case 'clutch_player': {
      return `${winnerName} made the winning bid`;
    }
    
    case 'honeypot': {
      const bigFours = playerStats?.bigFours || 0;
      return `${winnerName} had ${bigFours} Big Fours`;
    }
    
    case 'series_mvp': {
      const netPoints = playerStats?.netPoints || 0;
      const sign = netPoints >= 0 ? '+' : '';
      return `${winnerName} had ${sign}${netPoints} net points`;
    }
    
    case 'suit_specialist': {
      if (!playerStats) return `${winnerName} specialized in one suit`;
      
      let bestSuit = '';
      let bestRate = 0;
      let bestAttempts = 0;
      let bestSuccesses = 0;
      
      Object.entries(playerStats.trumpBids).forEach(([suit, data]) => {
        if (data.attempts >= 4) {
          const rate = data.successes / data.attempts;
          if (rate > bestRate) {
            bestRate = rate;
            bestSuit = suit;
            bestAttempts = data.attempts;
            bestSuccesses = data.successes;
          }
        }
      });
      
      const suitNames = { 'C': 'Clubs', 'D': 'Diamonds', 'H': 'Hearts', 'S': 'Spades', 'N': 'No-trump' };
      const suitName = suitNames[bestSuit as keyof typeof suitNames] || bestSuit;
      const percentage = Math.round(bestRate * 100);
      
      return `${winnerName} had ${percentage}% ${suitName} success rate (${bestSuccesses}/${bestAttempts} bids)`;
    }
    
    case 'pepper_perfect': {
      const opponentsSets = playerStats?.pepperRoundBids.opponents_set || 0;
      return `${winnerName} never failed a pepper bid and set opponents ${opponentsSets} times`;
    }
    
    // Dubious Awards
    case 'overreaching': {
      if (!playerStats || playerStats.failedBidValues.length === 0) {
        return `${winnerName} had ambitious failed bids`;
      }
      
      const avgValue = playerStats.failedBidValues.reduce((sum, val) => sum + val, 0) / playerStats.failedBidValues.length;
      return `${winnerName} averaged ${avgValue.toFixed(1)} points on failed bids`;
    }
    
    case 'false_confidence': {
      if (!playerStats) return `${winnerName} struggled with no-trump bids`;
      
      const failedNoTrumps = playerStats.trumpBids['N'] 
        ? playerStats.trumpBids['N'].attempts - playerStats.trumpBids['N'].successes 
        : 0;
      
      return `${winnerName} failed ${failedNoTrumps} no-trump bids`;
    }
    
    case 'moon_struck': {
      if (!playerStats) return `${winnerName} reached for the moon too often`;

      // We need to analyze the actual failed bids to separate Moon vs Double Moon
      let moonFailed = 0;
      let doubleMoonFailed = 0;

      // Count from failedBidValues (7 = Moon, 14 = Double Moon)
      playerStats.failedBidValues.forEach(value => {
        if (value === 7) moonFailed++;
        else if (value === 14) doubleMoonFailed++;
      });

      const totalMoonFailed = moonFailed + doubleMoonFailed;

      if (doubleMoonFailed > 0 && moonFailed > 0) {
        return `${winnerName} failed ${moonFailed} Moon bids and ${doubleMoonFailed} Double Moon bid${doubleMoonFailed > 1 ? 's' : ''}`;
      } else if (doubleMoonFailed > 0) {
        return `${winnerName} failed ${doubleMoonFailed} Double Moon bid${doubleMoonFailed > 1 ? 's' : ''}`;
      } else if (moonFailed > 0) {
        return `${winnerName} failed ${moonFailed} Moon bid${moonFailed > 1 ? 's' : ''}`;
      } else {
        return `${winnerName} failed ${totalMoonFailed} Moon/Double Moon bids`;
      }
    }
    
    case 'gambling_problem': {
      // Count team's sets when defending against 4/5 bids
      let defensiveSets = 0;
      const teamIndex = Object.values(data.teamStats).indexOf(teamStats!);
      
      data.hands.forEach(hand => {
        if (!isHandComplete(hand)) return;
        
        try {
          const { bidWinner, bid, decision } = decodeHand(hand);
          const bidderTeamIndex = (bidWinner - 1) % 2;
          const defendingTeamIndex = 1 - bidderTeamIndex;
          
          // Check if this team was defending against a 4 or 5 bid that was played (not negotiated)
          if (defendingTeamIndex === teamIndex && 
              (bid === 4 || bid === 5 || bid === 'P') && 
              decision === 'P') {
            
            const [score1, score2] = calculateScore(hand);
            const defendingTeamScore = teamIndex === 0 ? score1 : score2;
            
            // If defending team score is negative, they went set
            if (defendingTeamScore < 0) {
              defensiveSets++;
            }
          }
        } catch {
          // Skip invalid hands
        }
      });
      
      return `${winnerName} went set ${defensiveSets} times defending 4/5 bids`;
    }
    
    case 'feast_or_famine': {
      if (!playerStats || playerStats.pointsPerBid.length === 0) {
        return `${winnerName} was spectacularly inconsistent`;
      }
      
      const mean = playerStats.pointsPerBid.reduce((sum, val) => sum + val, 0) / playerStats.pointsPerBid.length;
      const squaredDiffs = playerStats.pointsPerBid.map(val => Math.pow(val - mean, 2));
      const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / playerStats.pointsPerBid.length;
      const stdDev = Math.sqrt(variance);
      
      return `${winnerName} had ${stdDev.toFixed(1)}-point swing variance per bid`;
    }
    
    case 'playing_it_safe': {
      if (!playerStats) return `${winnerName} played it safe with 4-bids`;
      
      // Count successful non-pepper 4-bids vs total successful non-pepper bids
      let successfulNonPepper4Bids = 0;
      let totalSuccessfulNonPepperBids = 0;
      
      data.hands.forEach((hand, handIndex) => {
        if (isPepperRound(handIndex) || !isHandComplete(hand)) return;
        
        try {
          const { bidWinner, bid } = decodeHand(hand);
          const playerNames = Object.keys(data.playerStats);
          if (bidWinner === playerNames.indexOf(winnerName) + 1) {
            const [score1, score2] = calculateScore(hand);
            const bidderTeamIndex = (bidWinner - 1) % 2;
            const bidderScore = bidderTeamIndex === 0 ? score1 : score2;
            
            // If bid was successful (not set)
            if (bidderScore >= 0) {
              totalSuccessfulNonPepperBids++;
              if (bid === 4) {
                successfulNonPepper4Bids++;
              }
            }
          }
        } catch {
          // Skip invalid hands
        }
      });
      
      const percentage = totalSuccessfulNonPepperBids > 0 ? Math.round((successfulNonPepper4Bids / totalSuccessfulNonPepperBids) * 100) : 0;
      return `${winnerName} played it safe with ${percentage}% 4-bids (${successfulNonPepper4Bids}/${totalSuccessfulNonPepperBids} successful bids)`;
    }
    
    case 'no_trump_no_problem': {
      if (!playerStats) return `${winnerName} relied heavily on no-trump bids`;
      
      // Count all no-trump bids vs total bids (including pepper rounds)
      let noTrumpBids = 0;
      let totalBids = 0;
      
      data.hands.forEach(hand => {
        if (!isHandComplete(hand)) return;
        
        try {
          const { bidWinner, trump } = decodeHand(hand);
          const playerNames = Object.keys(data.playerStats);
          if (bidWinner === playerNames.indexOf(winnerName) + 1) {
            totalBids++;
            if (trump === 'N') {
              noTrumpBids++;
            }
          }
        } catch {
          // Skip invalid hands
        }
      });
      
      const percentage = totalBids > 0 ? Math.round((noTrumpBids / totalBids) * 100) : 0;
      return `${winnerName} went no-trump ${percentage}% of the time (${noTrumpBids}/${totalBids} bids)`;
    }
    
    case 'footprints_in_the_sand': {
      if (!playerStats) return `${winnerName} carried their team to victory`;
      
      // Find partner's net points
      const playerTeam = playerStats.team;
      const partnerStats = Object.values(data.playerStats).find(p => p.team === playerTeam && p.name !== winnerName);
      const partnerNetPoints = partnerStats?.netPoints || 0;
      const playerNetPoints = playerStats.netPoints;
      
      // Use signed net points to match the (fixed) award evaluation, which only fires
      // when the team's combined net contribution is positive.
      const totalNetPoints = playerNetPoints + partnerNetPoints;
      const partnerPercentage = totalNetPoints > 0 ?
        Math.round((partnerNetPoints / totalNetPoints) * 100) : 0;
      
      return `${winnerName} dominated while partner contributed ${partnerPercentage}% (${partnerNetPoints > 0 ? '+' : ''}${partnerNetPoints} vs ${playerNetPoints > 0 ? '+' : ''}${playerNetPoints} net points)`;
    }
    
    case 'shoot_for_the_moons': {
      if (!playerStats) return `${winnerName} successfully bid multiple moons`;
      
      // Count successful Moon and Double Moon bids
      let successfulMoons = 0;
      let successfulDoubleMoons = 0;
      
      data.hands.forEach(hand => {
        if (!isHandComplete(hand)) return;
        
        try {
          const { bidWinner, bid } = decodeHand(hand);
          const playerNames = Object.keys(data.playerStats);
          if (bidWinner === playerNames.indexOf(winnerName) + 1) {
            const [score1, score2] = calculateScore(hand);
            const bidderTeamIndex = (bidWinner - 1) % 2;
            const bidderScore = bidderTeamIndex === 0 ? score1 : score2;
            
            // If bid was successful (not set)
            if (bidderScore >= 0) {
              if (bid === 'M') successfulMoons++;
              else if (bid === 'D') successfulDoubleMoons++;
            }
          }
        } catch {
          // Skip invalid hands
        }
      });
      
      const totalMoonBids = successfulMoons + successfulDoubleMoons;
      if (successfulDoubleMoons > 0 && successfulMoons > 0) {
        return `${winnerName} successfully bid ${successfulMoons} Moon${successfulMoons > 1 ? 's' : ''} and ${successfulDoubleMoons} Double Moon${successfulDoubleMoons > 1 ? 's' : ''}`;
      } else if (successfulDoubleMoons > 0) {
        return `${winnerName} successfully bid ${successfulDoubleMoons} Double Moon${successfulDoubleMoons > 1 ? 's' : ''}`;
      } else if (successfulMoons > 0) {
        return `${winnerName} successfully bid ${successfulMoons} Moon${successfulMoons > 1 ? 's' : ''}`;
      } else {
        return `${winnerName} successfully bid ${totalMoonBids} high-value bids`;
      }
    }
    
    case 'dynamic_duo': {
      const teamIndex = Object.keys(data.teamStats).indexOf(winnerName);
      const mates = Object.values(data.playerStats).filter(p => p.team === teamIndex);
      const pts = mates.map(p => `${p.name} ${p.netPoints >= 0 ? '+' : ''}${p.netPoints}`).join(', ');
      return `A balanced attack — ${pts} net offensive points`;
    }

    case 'great_minds': {
      const teamIndex = Object.keys(data.teamStats).indexOf(winnerName);
      const mates = Object.values(data.playerStats).filter(p => p.team === teamIndex);
      const modal = (p: { trumpBids: Record<string, { attempts: number }> }) =>
        Object.entries(p.trumpBids).reduce(
          (best, [s, r]) => (r.attempts > best.count ? { suit: s, count: r.attempts } : best),
          { suit: '', count: 0 }
        );
      const suitNames: Record<string, string> = { C: 'Clubs', D: 'Diamonds', S: 'Spades', H: 'Hearts', N: 'No-trump' };
      const suit = mates[0] ? modal(mates[0]).suit : '';
      return `Both partners leaned on ${suitNames[suit] ?? suit}`;
    }

    case 'misery_loves_company':
      return `Both partners on ${winnerName} went set at least twice on offense`;

    case 'brick_wall':
      return `${winnerName} took all six tricks on defense — a total shutout`;

    default:
      return `${winnerName} earned this award`;
  }
}

// ==============================
// Individual Game Awards
// ==============================

export const gameAwards: AwardDefinition[] = [
  // Team Awards
  {
    id: 'defensive_fortress',
    name: 'Defensive Fortress',
    description: 'Masters of stopping opponents in their tracks',
    technicalDefinition: 'Team that set the bidding team the most times when the opponents bid. Minimum 4 successful sets required.',
    type: 'team',
    scope: 'game',
    important: false,
    icon: 'shield'
  },
  {
    id: 'bid_specialists',
    name: 'Bid Specialists',
    description: 'Masters of calculated risk, rarely overreaching',
    technicalDefinition: 'Team that made at least 4 bids (excluding pepper round) with a success rate above 87.5% - at most 1 set per 8 bids. The ultimate demonstration of knowing when to bid and when to pass.',
    type: 'team',
    scope: 'game',
    important: false,
    icon: 'check-circle'
  },
  {
    id: 'remember_the_time',
    name: 'Remember the Time...',
    description: 'Overcame a massive deficit to claim victory',
    technicalDefinition: 'Team that won after trailing by at least 30 points at some point during the game. If no team qualifies, award is not given.',
    type: 'team',
    scope: 'game',
    important: true,
    icon: 'clock-rewind'
  },
  {
    id: 'dynamic_duo',
    name: 'Dynamic Duo',
    description: 'A genuinely balanced two-player attack',
    technicalDefinition: 'Team whose BOTH players each scored at least 10 net offensive points (net points on the hands they bid). The opposite of one partner carrying the other.',
    type: 'team',
    scope: 'game',
    important: false,
    icon: 'medal'
  },
  {
    id: 'great_minds',
    name: 'Great Minds Think Alike',
    description: 'Partners who independently leaned on the very same trump',
    technicalDefinition: 'Both teammates called the same suit (or no-trump) as their most-frequent trump choice, with at least 3 bids each in that choice.',
    type: 'team',
    scope: 'game',
    important: false,
    icon: 'scale'
  },
  {
    id: 'misery_loves_company',
    name: 'Misery Loves Company',
    description: 'Both partners crashed and burned on offense',
    technicalDefinition: 'Team whose BOTH players each went set on at least 2 unforced (non-pepper-round) bids.',
    type: 'team',
    scope: 'game',
    important: false,
    icon: 'thumbs-down'
  },
  {
    id: 'brick_wall',
    name: 'Brick Wall',
    description: 'Defenders who swept every trick to bury a bid',
    technicalDefinition: 'The defending team took ALL SIX tricks on a played hand, setting the bidders completely. Exceedingly rare.',
    type: 'team',
    scope: 'game',
    important: true,
    icon: 'shield-check'
  },

  // Player Awards
  {
    id: 'trump_master',
    name: 'Trump Master',
    description: 'Unmatched skill with trump suits',
    technicalDefinition: 'Player with highest percentage of successful bids where a trump suit was called (explicitly excluding no-trump bids). Minimum 3 suited bids required.',
    type: 'player',
    scope: 'game',
    important: false,
    icon: 'crown'
  },
  {
    id: 'bid_royalty',
    name: 'Bid Royalty',
    description: 'Dominated the bidding all game long',
    technicalDefinition: 'Player who won the most bids in a game, regardless of outcome.',
    type: 'player',
    scope: 'game',
    important: false,
    icon: 'sceptre'
  },
  {
    id: 'clutch_player',
    name: 'Clutch Player',
    description: 'Delivered when it mattered most',
    technicalDefinition: 'Player who made the successful bid that pushed their team over 42 points to win.',
    type: 'player',
    scope: 'game',
    important: true,
    icon: 'zap'
  },
  {
    id: 'honeypot',
    name: 'Honeypot',
    description: 'Master of the dangerous Big Four',
    technicalDefinition: 'Player with the most "Big Four" hands - 4-bids (including Pepper) where opponents chose to play and got zero tricks, excluding clubs bids. Minimum 2 Big Fours required.',
    type: 'player',
    scope: 'game',
    important: true,
    icon: 'honey-pot'
  },
  {
    id: 'shoot_for_the_moons',
    name: 'Shoot for the Moons',
    description: 'Successfully bid multiple moons in one game',
    technicalDefinition: 'Player who successfully bid at least two Moon or Double Moon bids in a single game.',
    type: 'player',
    scope: 'game',
    important: true,
    icon: 'target'
  },
  {
    id: 'footprints_in_the_sand',
    name: 'Footprints in the Sand',
    description: 'Carried their team while partner contributed little',
    technicalDefinition: 'Player whose team won but their partner contributed 25% or less of the combined net points.',
    type: 'player',
    scope: 'game',
    important: false,
    icon: 'footprints'
  },
  
  // Dubious Awards
  {
    id: 'overreaching',
    name: 'Overreaching',
    description: 'Eyes bigger than their hand',
    technicalDefinition: 'Player with highest average bid value in failed bids. Minimum 2 failed bids required.',
    type: 'player',
    scope: 'game',
    important: false,
    icon: 'hand-grabbing'
  },
  {
    id: 'false_confidence',
    name: 'False Confidence',
    description: 'No trump? No problem! (Or so they thought)',
    technicalDefinition: 'Player with most failed no-trump bids in a single game.',
    type: 'player',
    scope: 'game',
    important: false,
    icon: 'thumbs-down'
  },
  {
    id: 'helping_hand',
    name: 'Helping Hand',
    description: 'Extraordinarily generous at the negotiating table',
    technicalDefinition: 'Team that gave away the most points in negotiations (minimum 5 points). These diplomats believe in keeping opponents happy - one free trick at a time.',
    type: 'team',
    scope: 'game',
    important: false,
    icon: 'hand'
  },
  {
    id: 'playing_it_safe',
    name: 'Playing it Safe',
    description: 'Overwhelmingly conservative with 4-bids',
    technicalDefinition: 'Player who made 80% or more of their successful non-pepper bids as 4-bids. Minimum 5 successful non-pepper bids required.',
    type: 'player',
    scope: 'game',
    important: false,
    icon: 'shield-check'
  },
  {
    id: 'no_trump_no_problem',
    name: 'No Trump? No Problem!',
    description: 'Excessive reliance on no-trump bids',
    technicalDefinition: 'Player who bid no-trump for 50% or more of their bids (including pepper rounds). Minimum 4 bids required.',
    type: 'player',
    scope: 'game',
    important: false,
    icon: 'ban'
  }
];

// ==============================
// Series Awards
// ==============================

export const seriesAwards: AwardDefinition[] = [
  // Team Awards
  {
    id: 'defensive_specialists',
    name: 'Defensive Specialists',
    description: 'The team you didn\'t want to bid against',
    technicalDefinition: 'Team with highest percentage of successful defenses across all games in the series. A successful defense is when a team either sets the bidders or negotiates for tricks.',
    type: 'team',
    scope: 'series',
    important: false,
    icon: 'shield-check'
  },
  {
    id: 'bid_bullies',
    name: 'Bid Bullies',
    description: 'Go big or go home was their motto',
    technicalDefinition: 'Team with most successful bids of 6, Moon, or Double Moon across the series.',
    type: 'team',
    scope: 'series', 
    important: true,
    icon: 'trophy'
  },
  {
    id: 'streak_masters',
    name: 'Streak Masters',
    description: 'Unstoppable momentum',
    technicalDefinition: 'Team with longest consecutive streak of scoring hands across the series (either bidding or defending).',
    type: 'team',
    scope: 'series',
    important: false,
    icon: 'flame'
  },
  
  // Player Awards
  {
    id: 'series_mvp',
    name: 'Series MVP',
    description: 'The backbone of their team\'s success',
    technicalDefinition: 'Player with highest net points from successful bids minus points lost from failed bids across the series.',
    type: 'player',
    scope: 'series',
    important: true,
    icon: 'medal'
  },
  {
    id: 'suit_specialist',
    name: 'Suit Specialist',
    description: 'Mastered their favorite suit',
    technicalDefinition: 'Player with highest success rate in any one suit across the series (min. 4 bids in that suit).',
    type: 'player',
    scope: 'series',
    important: false,
    icon: 'spade'
  },
  {
    id: 'pepper_perfect',
    name: 'Pepper Perfect',
    description: 'Unbeatable during the pepper round',
    technicalDefinition: 'Player who never went set on their pepper round bids AND made the opposing team go set on at least one of their pepper round bids across the series.',
    type: 'player',
    scope: 'series',
    important: true,
    icon: 'chili-hot'
  },
  
  // Dubious Awards
  {
    id: 'moon_struck',
    name: 'Moon Struck',
    description: 'Reached for the moon but fell short... repeatedly',
    technicalDefinition: 'Player with most failed moon/double moon attempts in the series, minimum of three failures required.',
    type: 'player',
    scope: 'series',
    important: true,
    icon: 'moon'
  },
  {
    id: 'gambling_problem',
    name: 'Gambling Problem',
    description: 'Should have folded but couldn\'t resist playing',
    technicalDefinition: 'Team that most frequently went set when defending against bids of 4 or 5 (which could have been negotiated).',
    type: 'team',
    scope: 'series',
    important: false,
    icon: 'dice-5'
  },
  {
    id: 'feast_or_famine',
    name: 'Feast or Famine',
    description: 'Spectacularly inconsistent',
    technicalDefinition: 'Player with highest standard deviation in points earned/lost per bid across the series.',
    type: 'player',
    scope: 'series',
    important: false,
    icon: 'scale'
  }
];

/**
 * Returns all award definitions (both game and series)
 */
export function getAllAwards(): AwardDefinition[] {
  return [...gameAwards, ...seriesAwards];
}

/**
 * Returns all awards matching the specified criteria
 */
export function getAwards(options: {
  scope?: 'game' | 'series',
  type?: 'team' | 'player',
  important?: boolean
}): AwardDefinition[] {
  const allAwards = getAllAwards();
  
  return allAwards.filter(award => {
    if (options.scope && award.scope !== options.scope) return false;
    if (options.type && award.type !== options.type) return false;
    if (options.important !== undefined && award.important !== options.important) return false;
    return true;
  });
}

/**
 * Evaluates a specific award with the tracked data to determine if it was achieved
 * and who achieved it. Returns the award with the winner or null if no one qualifies.
 * Exported so tests can verify each award's eligibility logic directly (separate from the
 * selection algorithm, which only surfaces a capped, prioritized subset).
 */
export function evaluateAward(award: AwardDefinition, data: AwardTrackingData): AwardWithWinner | null {
  const { id, type } = award;
  
  // Team-specific awards
  if (type === 'team') {
    const teamStats = Object.values(data.teamStats);
    if (teamStats.length === 0) return null;
    
    switch (id) {
      case 'defensive_fortress': {
        // Count how many times each team set the bidding team
        // A team gets credit for setting opponents when they successfully defend
        
        const teamArray = Object.values(data.teamStats);
        if (teamArray.length < 2) return null;
        
        // Calculate sets against opponents by analyzing actual hands
        teamArray.forEach((team, teamIndex) => {
          let setsAgainstOpponents = 0;
          
          // Look through each hand to count when this team set the bidders
          data.hands.forEach(hand => {
            if (!isHandComplete(hand)) {
              return; // Skip incomplete hands
            }
            
            // Skip throw-in hands
            if (hand.length >= 2 && hand[1] === '0') {
              return;
            }
            
            try {
              const { bidWinner } = decodeHand(hand);
              const bidderTeam = (bidWinner - 1) % 2;
              const defendingTeam = 1 - bidderTeam;
              
              // Check if this team was defending and set the bidders
              if (defendingTeam === teamIndex) {
                const [score1, score2] = calculateScore(hand);
                const bidderScore = bidderTeam === 0 ? score1 : score2;
                
                // If bidder score is negative, they were set by defenders
                if (bidderScore < 0) {
                  setsAgainstOpponents++;
                }
              }
            } catch (e) {
              console.error('Error processing hand for defensive fortress:', hand, e);
            }
          });
          
          team.setsAgainstOpponents = setsAgainstOpponents;
        });
        
        // Find teams that meet the threshold (4+ sets)
        const qualifyingTeams = teamArray.filter(team => (team.setsAgainstOpponents || 0) >= 4);
        if (qualifyingTeams.length === 0) return null;
        
        // Find the team with the most sets
        const winner = qualifyingTeams.reduce((best, current) => 
          (current.setsAgainstOpponents || 0) > (best.setsAgainstOpponents || 0) ? current : best, qualifyingTeams[0]
        );
        
        // Check for a tie
        const secondBest = qualifyingTeams.find(team => 
          team !== winner && (team.setsAgainstOpponents || 0) === (winner.setsAgainstOpponents || 0)
        );
        
        // If there's a tie, return null (no award)
        if (secondBest) return null;
        
        return { 
          ...award, 
          winner: winner.name,
          statDetails: calculateAwardStats(award.id, winner.name, data)
        };
      }
      
      case 'bid_specialists': {
        // Team with highest bid success rate (min 4 non-pepper bids, success rate > 87.5%)
        const teamsWithRatios = teamStats.map((team, teamIndex) => {
          // Count non-pepper bids and sets
          let nonPepperBids = 0;
          let nonPepperSets = 0;
          
          // We need to analyze hand by hand to exclude pepper rounds
          data.hands.forEach((hand, handIndex) => {
            // Skip pepper rounds (first four hands)
            if (isPepperRound(handIndex) || !isHandComplete(hand)) return;
            
            try {
              const { bidWinner } = decodeHand(hand);
              const bidderTeamIndex = (bidWinner - 1) % 2;
              
              // Only count bids made by this team
              if (bidderTeamIndex === teamIndex) {
                nonPepperBids++;
                
                // Check if bid was successful (not set)
                const [score1, score2] = calculateScore(hand);
                const teamScore = teamIndex === 0 ? score1 : score2;
                if (teamScore < 0) {
                  nonPepperSets++;
                }
              }
            } catch (e) {
              console.error('Error processing hand for bid specialists:', hand, e);
            }
          });
          
          const successRatio = nonPepperBids > 0 ? 1 - (nonPepperSets / nonPepperBids) : 0;
          return { team, nonPepperBids, successRatio };
        });
        
        // Filter to only teams meeting the criteria
        const qualifyingTeams = teamsWithRatios.filter(item => 
          item.nonPepperBids >= 4 && item.successRatio > 0.875
        );
        
        if (qualifyingTeams.length === 0) return null;
        
        // Sort by success ratio (highest first)
        qualifyingTeams.sort((a, b) => b.successRatio - a.successRatio);
        
        // Return the team with the highest success ratio
        return { 
          ...award, 
          winner: qualifyingTeams[0].team.name,
          statDetails: calculateAwardStats(award.id, qualifyingTeams[0].team.name, data)
        };
      }
      
      case 'remember_the_time': {
        // Team that overcame a 30+ point deficit
        const comebackTeam = teamStats.find(team => team.comebackAchieved);
        return comebackTeam ? {
          ...award,
          winner: comebackTeam.name,
          statDetails: calculateAwardStats(award.id, comebackTeam.name, data)
        } : null;
      }

      case 'dynamic_duo': {
        // Both teammates each scored >=10 net offensive points (net points on hands they bid).
        // The opposite of footprints_in_the_sand (one partner carrying the other).
        const players = Object.values(data.playerStats);
        for (let teamIndex = 0; teamIndex < teamStats.length; teamIndex++) {
          const teammates = players.filter(p => p.team === teamIndex);
          if (teammates.length !== 2) continue;
          if (teammates.every(p => p.netPoints >= 10)) {
            return {
              ...award,
              winner: teamStats[teamIndex].name,
              statDetails: calculateAwardStats(award.id, teamStats[teamIndex].name, data)
            };
          }
        }
        return null;
      }

      case 'great_minds': {
        // Both teammates share a most-called trump (incl. no-trump), each with >=3 bids in it.
        const modalTrump = (p: { trumpBids: Record<string, { attempts: number }> }) => {
          let suit = '';
          let count = 0;
          for (const [s, rec] of Object.entries(p.trumpBids)) {
            if (rec.attempts > count) { count = rec.attempts; suit = s; }
          }
          return { suit, count };
        };
        const players = Object.values(data.playerStats);
        for (let teamIndex = 0; teamIndex < teamStats.length; teamIndex++) {
          const teammates = players.filter(p => p.team === teamIndex);
          if (teammates.length !== 2) continue;
          const a = modalTrump(teammates[0]);
          const b = modalTrump(teammates[1]);
          if (a.suit && a.suit === b.suit && a.count >= 3 && b.count >= 3) {
            return {
              ...award,
              winner: teamStats[teamIndex].name,
              statDetails: calculateAwardStats(award.id, teamStats[teamIndex].name, data)
            };
          }
        }
        return null;
      }

      case 'misery_loves_company': {
        // Both teammates each went set on >=2 unforced (non-pepper-round) offensive bids.
        const playerNames = Object.keys(data.playerStats);
        const setsByName: Record<string, number> = {};
        data.hands.forEach((hand, handIndex) => {
          if (isPepperRound(handIndex) || !isHandComplete(hand)) return;
          if (hand.length >= 2 && hand[1] === '0') return; // throw-in — nobody bid
          try {
            const { bidWinner } = decodeHand(hand);
            const bidderTeamIndex = (bidWinner - 1) % 2;
            const [score1, score2] = calculateScore(hand);
            const bidderScore = bidderTeamIndex === 0 ? score1 : score2;
            if (bidderScore < 0) { // the bidder's team went set (a fold would be non-negative)
              const name = playerNames[bidWinner - 1];
              setsByName[name] = (setsByName[name] ?? 0) + 1;
            }
          } catch { /* skip malformed hands */ }
        });
        const players = Object.values(data.playerStats);
        for (let teamIndex = 0; teamIndex < teamStats.length; teamIndex++) {
          const teammates = players.filter(p => p.team === teamIndex);
          if (teammates.length !== 2) continue;
          if (teammates.every(p => (setsByName[p.name] ?? 0) >= 2)) {
            return {
              ...award,
              winner: teamStats[teamIndex].name,
              statDetails: calculateAwardStats(award.id, teamStats[teamIndex].name, data)
            };
          }
        }
        return null;
      }

      case 'brick_wall': {
        // Defending team took ALL 6 tricks on a played hand (blanked the bidders). Very rare.
        const walls = [0, 0];
        data.hands.forEach(hand => {
          if (!isHandComplete(hand)) return;
          if (hand.length >= 2 && hand[1] === '0') return; // throw-in
          try {
            const { bidWinner, decision, tricks } = decodeHand(hand);
            if (decision !== 'P' || tricks !== 6) return; // must be played, defenders take all 6
            const bidderTeamIndex = (bidWinner - 1) % 2;
            walls[1 - bidderTeamIndex]++;
          } catch { /* skip malformed hands */ }
        });
        if (walls[0] === 0 && walls[1] === 0) return null;
        const best = walls[0] >= walls[1] ? 0 : 1;
        return {
          ...award,
          winner: teamStats[best].name,
          statDetails: calculateAwardStats(award.id, teamStats[best].name, data)
        };
      }

      case 'helping_hand': {
        // Team that gave away the most points in negotiations
        const teamsWithNegotiations = teamStats.map(team => {
          let pointsGivenInNegotiations = 0;
          
          // Analyze hands to count points given in negotiations
          data.hands.forEach(hand => {
            if (!isHandComplete(hand)) return;
            
            try {
              const { bidWinner, decision, tricks } = decodeHand(hand);
              // Only count hands where this team was bidding and negotiated
              const bidderTeamIndex = (bidWinner - 1) % 2;
              const teamIndex = Object.values(data.teamStats).indexOf(team);
              
              if (bidderTeamIndex === teamIndex && decision === 'F' && tricks > 0) {
                // This was a negotiation where the team gave away tricks
                pointsGivenInNegotiations += tricks;
              }
            } catch (e) {
              console.error('Error processing hand for helping hand:', hand, e);
            }
          });
          
          return { team, pointsGivenInNegotiations };
        });
        
        // Filter to teams meeting minimum threshold
        const qualifyingTeams = teamsWithNegotiations.filter(item => 
          item.pointsGivenInNegotiations >= 5
        );
        
        if (qualifyingTeams.length === 0) return null;
        
        // Find team that gave away the most points
        const winner = qualifyingTeams.reduce((most, current) => 
          current.pointsGivenInNegotiations > most.pointsGivenInNegotiations ? current : most, 
          qualifyingTeams[0]
        );
        
        return { 
          ...award, 
          winner: winner.team.name,
          statDetails: calculateAwardStats(award.id, winner.team.name, data)
        };
      }
      
      case 'bid_bullies': {
        // Team with the most successful high-value bids (6, Moon, Double Moon). Require a real habit
        // of it (3+ across the series) and a clear untied lead — not just "made one more than you".
        const qualifyingTeams = teamStats.filter(team => team.highValueBids.successes >= 3);
        if (qualifyingTeams.length === 0) return null;

        const winner = qualifyingTeams.reduce((most, current) =>
          current.highValueBids.successes > most.highValueBids.successes ? current : most
        );
        const tiedForLead = qualifyingTeams.some(
          t => t !== winner && t.highValueBids.successes === winner.highValueBids.successes
        );
        if (tiedForLead) return null;

        return {
          ...award, 
          winner: winner.name,
          statDetails: calculateAwardStats(award.id, winner.name, data)
        };
      }
      
      case 'streak_masters': {
        // Team with the longest scoring streak — require a genuine run (4+), not a lucky pair.
        const winner = teamStats.reduce((longest, current) =>
          current.longestStreak > longest.longestStreak ? current : longest
        );

        if (winner.longestStreak < 4) return null;
        const tiedForLead = teamStats.some(t => t !== winner && t.longestStreak === winner.longestStreak);
        if (tiedForLead) return null;

        return {
          ...award, 
          winner: winner.name,
          statDetails: calculateAwardStats(award.id, winner.name, data)
        };
      }
      
      case 'defensive_specialists': {
        // Team with highest defensive success rate (series)
        const qualifyingTeams = teamStats.filter(team => team.totalDefenses >= 5); // Higher minimum for series
        if (qualifyingTeams.length === 0) return null;

        const winner = qualifyingTeams.reduce((best, current) =>
          current.defensiveSuccessRate > best.defensiveSuccessRate ? current : best
        );

        // A "specialist" must defend better than a coin flip — not merely be the highest of two poor
        // rates. Without a floor this fires every series.
        if (winner.defensiveSuccessRate < 0.5) return null;

        return {
          ...award,
          winner: winner.name,
          statDetails: calculateAwardStats(award.id, winner.name, data)
        };
      }

      case 'gambling_problem': {
        // Team that most frequently went set when defending against 4/5 bids
        // (series dubious award). NOTE: this is declared `type: 'team'`, so its case MUST live in
        // the team switch — it previously sat in the player switch and was therefore unreachable
        // (evaluateAward dispatches on award.type), so the award could never be given.
        const teamsWithDefensiveSets = Object.values(data.teamStats).map(team => {
          let defensiveSets = 0;
          let defensiveOpportunities = 0;
          const teamIndex = Object.values(data.teamStats).indexOf(team);

          data.hands.forEach(hand => {
            if (!isHandComplete(hand)) return;

            try {
              const { bidWinner, bid, decision } = decodeHand(hand);
              const bidderTeamIndex = (bidWinner - 1) % 2;
              const defendingTeamIndex = 1 - bidderTeamIndex;

              // Check if this team was defending against a 4 or 5 bid that was played
              if (defendingTeamIndex === teamIndex &&
                  (bid === 4 || bid === 5 || bid === 'P') &&
                  decision === 'P') {

                defensiveOpportunities++;
                const [score1, score2] = calculateScore(hand);
                const defendingTeamScore = teamIndex === 0 ? score1 : score2;

                // If defending team score is negative, they went set
                if (defendingTeamScore < 0) {
                  defensiveSets++;
                }
              }
            } catch {
              // Skip invalid hands
            }
          });

          return { team, defensiveSets, defensiveOpportunities };
        });

        // Filter teams with at least 2 defensive sets against 4/5 bids
        const qualifyingTeams = teamsWithDefensiveSets.filter(item => item.defensiveSets >= 2);
        if (qualifyingTeams.length === 0) return null;

        // Find team with most defensive sets
        const winner = qualifyingTeams.reduce((most, current) =>
          current.defensiveSets > most.defensiveSets ? current : most
        );

        return {
          ...award,
          winner: winner.team.name,
          statDetails: calculateAwardStats(award.id, winner.team.name, data)
        };
      }
    }
  }

  // Player-specific awards
  if (type === 'player') {
    const playerStats = Object.values(data.playerStats);
    if (playerStats.length === 0) return null;
    
    switch (id) {
      case 'trump_master': {
        // Player with highest suited trump success rate
        const qualifyingPlayers = playerStats.filter(player => {
          // Check for players with at least 3 suited bids (not including N)
          const suitedBids = Object.entries(player.trumpBids)
            .filter(([suit]) => suit !== 'N')
            .reduce((sum, [, data]) => sum + data.attempts, 0);
          
          return suitedBids >= 3;
        });
        
        if (qualifyingPlayers.length === 0) return null;
        
        // Calculate each player's suited trump success rate
        const playersWithRates = qualifyingPlayers.map(player => {
          const suitedAttempts = Object.entries(player.trumpBids)
            .filter(([suit]) => suit !== 'N')
            .reduce((sum, [, data]) => sum + data.attempts, 0);
          
          const suitedSuccesses = Object.entries(player.trumpBids)
            .filter(([suit]) => suit !== 'N')
            .reduce((sum, [, data]) => sum + data.successes, 0);
          
          const successRate = suitedSuccesses / suitedAttempts;
          
          return { player, successRate };
        });
        
        const winnerData = playersWithRates.reduce((best, current) => 
          current.successRate > best.successRate ? current : best
        );
        
        if (winnerData.successRate === 0) return null;
        
        return { 
          ...award, 
          winner: winnerData.player.name,
          statDetails: calculateAwardStats(award.id, winnerData.player.name, data)
        };
      }
      
      case 'bid_royalty': {
        // Player who DOMINATED the bidding: the most bids won (min 3), with a clear untied lead.
        // Without these floors this award trivially fires every game (someone always bids the most).
        const winner = playerStats.reduce((most, current) =>
          current.bidsWon > most.bidsWon ? current : most
        );

        if (winner.bidsWon < 3) return null;
        const tiedForLead = playerStats.some(p => p !== winner && p.bidsWon === winner.bidsWon);
        if (tiedForLead) return null;

        return {
          ...award,
          winner: winner.name,
          statDetails: calculateAwardStats(award.id, winner.name, data)
        };
      }
      
      case 'clutch_player': {
        // Player who made winning bid
        const clutchPlayer = playerStats.find(player => player.wonFinalBid);
        return clutchPlayer ? { 
          ...award, 
          winner: clutchPlayer.name,
          statDetails: calculateAwardStats(award.id, clutchPlayer.name, data)
        } : null;
      }
      
      case 'honeypot': {
        // Player with most Big Fours, minimum 2 required
        const qualifyingPlayers = playerStats.filter(player => player.bigFours >= 2);
        if (qualifyingPlayers.length === 0) return null;
        
        // Find the maximum number of Big Fours
        const maxBigFours = Math.max(...qualifyingPlayers.map(p => p.bigFours));
        
        // Get all players with the maximum Big Fours (in case of ties)
        const topPlayers = qualifyingPlayers.filter(p => p.bigFours === maxBigFours);

        // Deterministic tie-break: pick the first tied player by name so the
        // same completed game always yields the same winner across re-renders.
        const winner = [...topPlayers].sort((a, b) => a.name.localeCompare(b.name))[0];
        
        return { 
          ...award, 
          winner: winner.name,
          statDetails: calculateAwardStats(award.id, winner.name, data)
        };
      }
      
      case 'shoot_for_the_moons': {
        // Player who successfully bid at least 2 moons/double moons in a single game
        const qualifyingPlayers = playerStats.filter(player => {
          let successfulHighValueBids = 0;
          
          data.hands.forEach(hand => {
            if (!isHandComplete(hand)) return;
            
            try {
              const { bidWinner, bid } = decodeHand(hand);
              const playerNames = Object.keys(data.playerStats);
              const playerIndex = playerNames.indexOf(player.name) + 1;
              
              if (bidWinner === playerIndex && (bid === 'M' || bid === 'D')) {
                const [score1, score2] = calculateScore(hand);
                const bidderTeamIndex = (bidWinner - 1) % 2;
                const bidderScore = bidderTeamIndex === 0 ? score1 : score2;
                
                // If bid was successful (not set)
                if (bidderScore >= 0) {
                  successfulHighValueBids++;
                }
              }
            } catch {
              // Skip invalid hands
            }
          });
          
          return successfulHighValueBids >= 2;
        });
        
        if (qualifyingPlayers.length === 0) return null;

        // Deterministic tie-break: pick the first qualifying player by name.
        const winner = [...qualifyingPlayers].sort((a, b) => a.name.localeCompare(b.name))[0];

        return {
          ...award,
          winner: winner.name,
          statDetails: calculateAwardStats(award.id, winner.name, data)
        };
      }

      case 'footprints_in_the_sand': {
        // Player whose team won but partner contributed 25% or less of combined net points
        if (data.winningTeam === undefined) return null;
        
        const winningTeamPlayers = playerStats.filter(player => player.team === data.winningTeam);
        if (winningTeamPlayers.length !== 2) return null;
        
        const [player1, player2] = winningTeamPlayers;
        // Use signed net points: a player who bled points should NOT count as a dominant contributor.
        const totalContribution = player1.netPoints + player2.netPoints;

        // If the team's combined net contribution isn't positive, "carried the team" is meaningless.
        if (totalContribution <= 0) return null;

        const player1Percentage = player1.netPoints / totalContribution;
        const player2Percentage = player2.netPoints / totalContribution;
        
        // Check if one player dominated (75%+) while partner contributed little (25% or less)
        if (player1Percentage >= 0.75 && player2Percentage <= 0.25) {
          return { 
            ...award, 
            winner: player1.name,
            statDetails: calculateAwardStats(award.id, player1.name, data)
          };
        } else if (player2Percentage >= 0.75 && player1Percentage <= 0.25) {
          return { 
            ...award, 
            winner: player2.name,
            statDetails: calculateAwardStats(award.id, player2.name, data)
          };
        }
        
        return null;
      }
      
      case 'playing_it_safe': {
        // Player with 80%+ of successful non-pepper bids as 4-bids, min 5 successful.
        // Compute each player's ratio in a single pass, then qualify and rank.
        const playerNames = Object.keys(data.playerStats);
        const playersWithRatios = playerStats.map(player => {
          let successfulNonPepper4Bids = 0;
          let totalSuccessfulNonPepperBids = 0;
          const playerIndex = playerNames.indexOf(player.name) + 1;

          data.hands.forEach((hand, handIndex) => {
            if (isPepperRound(handIndex) || !isHandComplete(hand)) return;

            try {
              const { bidWinner, bid } = decodeHand(hand);
              if (bidWinner === playerIndex) {
                const [score1, score2] = calculateScore(hand);
                const bidderTeamIndex = (bidWinner - 1) % 2;
                const bidderScore = bidderTeamIndex === 0 ? score1 : score2;

                // If bid was successful (not set)
                if (bidderScore >= 0) {
                  totalSuccessfulNonPepperBids++;
                  if (bid === 4) {
                    successfulNonPepper4Bids++;
                  }
                }
              }
            } catch {
              // Skip invalid hands
            }
          });

          const ratio = totalSuccessfulNonPepperBids > 0 ? successfulNonPepper4Bids / totalSuccessfulNonPepperBids : 0;
          return { player, ratio, totalSuccessfulNonPepperBids };
        });

        const qualifyingPlayers = playersWithRatios.filter(
          p => p.totalSuccessfulNonPepperBids >= 5 && p.ratio >= 0.8
        );
        if (qualifyingPlayers.length === 0) return null;

        // Find player with highest percentage of 4-bids
        const winner = qualifyingPlayers.reduce((highest, current) =>
          current.ratio > highest.ratio ? current : highest
        );

        return {
          ...award,
          winner: winner.player.name,
          statDetails: calculateAwardStats(award.id, winner.player.name, data)
        };
      }
      
      case 'no_trump_no_problem': {
        // Player who bid no-trump 50%+ of the time, min 4 bids.
        // Compute each player's ratio in a single pass, then qualify and rank.
        const playerNames = Object.keys(data.playerStats);
        const playersWithRatios = playerStats.map(player => {
          let noTrumpBids = 0;
          let totalBids = 0;
          const playerIndex = playerNames.indexOf(player.name) + 1;

          data.hands.forEach(hand => {
            if (!isHandComplete(hand)) return;

            try {
              const { bidWinner, trump } = decodeHand(hand);
              if (bidWinner === playerIndex) {
                totalBids++;
                if (trump === 'N') {
                  noTrumpBids++;
                }
              }
            } catch {
              // Skip invalid hands
            }
          });

          const ratio = totalBids > 0 ? noTrumpBids / totalBids : 0;
          return { player, ratio, totalBids };
        });

        const qualifyingPlayers = playersWithRatios.filter(
          p => p.totalBids >= 4 && p.ratio >= 0.5
        );
        if (qualifyingPlayers.length === 0) return null;

        // Find player with highest percentage of no-trump bids
        const winner = qualifyingPlayers.reduce((highest, current) =>
          current.ratio > highest.ratio ? current : highest
        );

        return {
          ...award,
          winner: winner.player.name,
          statDetails: calculateAwardStats(award.id, winner.player.name, data)
        };
      }
      
      case 'overreaching': {
        // Player with highest average failed bid value
        const qualifyingPlayers = playerStats.filter(player => player.failedBidValues.length >= 2);
        if (qualifyingPlayers.length === 0) return null;
        
        const playersWithAvgs = qualifyingPlayers.map(player => {
          const avgFailedBidValue = player.failedBidValues.reduce((sum, val) => sum + val, 0) / player.failedBidValues.length;
          return { player, avgFailedBidValue };
        });
        
        const winnerData = playersWithAvgs.reduce((highest, current) => 
          current.avgFailedBidValue > highest.avgFailedBidValue ? current : highest
        );
        
        return { 
          ...award, 
          winner: winnerData.player.name,
          statDetails: calculateAwardStats(award.id, winnerData.player.name, data)
        };
      }
      
      case 'false_confidence': {
        // Player with most failed no-trump bids
        const qualifyingPlayers = playerStats.filter(player => {
          const failedNoTrumps = player.trumpBids['N'] ? player.trumpBids['N'].attempts - player.trumpBids['N'].successes : 0;
          return failedNoTrumps > 0;
        });
        
        if (qualifyingPlayers.length === 0) return null;
        
        const winner = qualifyingPlayers.reduce((most, current) => {
          const mostFailedNoTrumps = most.trumpBids['N'] ? most.trumpBids['N'].attempts - most.trumpBids['N'].successes : 0;
          const currFailedNoTrumps = current.trumpBids['N'] ? current.trumpBids['N'].attempts - current.trumpBids['N'].successes : 0;
          return currFailedNoTrumps > mostFailedNoTrumps ? current : most;
        });
        
        return { 
          ...award, 
          winner: winner.name,
          statDetails: calculateAwardStats(award.id, winner.name, data)
        };
      }
      
      case 'series_mvp': {
        // Player with the highest net points — but an MVP must be a net-POSITIVE contributor and the
        // clear (untied) leader, not merely "least bad". Without these floors this fires every series.
        if (playerStats.length === 0) return null;

        const winner = playerStats.reduce((best, current) =>
          current.netPoints > best.netPoints ? current : best
        );

        if (winner.netPoints <= 0) return null;
        const tiedForLead = playerStats.some(p => p !== winner && p.netPoints === winner.netPoints);
        if (tiedForLead) return null;

        return {
          ...award,
          winner: winner.name,
          statDetails: calculateAwardStats(award.id, winner.name, data)
        };
      }
      
      case 'suit_specialist': {
        // Player with highest success rate in any one suit
        const qualifyingPlayers = playerStats.filter(player => {
          // Check if any suit has at least 4 bids
          return Object.values(player.trumpBids).some(data => data.attempts >= 4);
        });
        
        if (qualifyingPlayers.length === 0) return null;
        
        // Find the best success rate for each player's best suit
        const playersWithBestSuit = qualifyingPlayers.map(player => {
          let bestSuit = '';
          let bestSuccessRate = 0;
          
          Object.entries(player.trumpBids).forEach(([suit, data]) => {
            if (data.attempts >= 4) {
              const successRate = data.successes / data.attempts;
              if (successRate > bestSuccessRate) {
                bestSuccessRate = successRate;
                bestSuit = suit;
              }
            }
          });
          
          return { player, bestSuit, bestSuccessRate };
        });
        
        const winnerData = playersWithBestSuit.reduce((best, current) =>
          current.bestSuccessRate > best.bestSuccessRate ? current : best
        );

        // A specialist must actually be GOOD in their suit (>=60%), not merely the least-bad of the
        // qualifiers. Without a real floor this fires almost every series.
        if (winnerData.bestSuccessRate < 0.6) return null;
        
        return { 
          ...award, 
          winner: winnerData.player.name,
          statDetails: calculateAwardStats(award.id, winnerData.player.name, data)
        };
      }
      
      case 'pepper_perfect': {
        // Perfect pepper round record
        const qualifyingPlayers = playerStats.filter(player => 
          player.pepperRoundBids.attempts > 0 && 
          player.pepperRoundBids.attempts === player.pepperRoundBids.successes &&
          player.pepperRoundBids.opponents_set > 0
        );
        
        if (qualifyingPlayers.length === 0) return null;

        // Deterministic tie-break: pick the first qualifying player by name.
        const player = [...qualifyingPlayers].sort((a, b) => a.name.localeCompare(b.name))[0];
        return player ? {
          ...award, 
          winner: player.name,
          statDetails: calculateAwardStats(award.id, player.name, data)
        } : null;
      }
      
      case 'moon_struck': {
        // Most failed moon/double moon attempts.
        // Count only failed Moon (7) and Double Moon (14) bids from failedBidValues,
        // NOT 6-bids (which highValueBids would also include).
        const countMoonFailures = (player: typeof playerStats[number]) =>
          player.failedBidValues.filter(value => value === 7 || value === 14).length;

        const qualifyingPlayers = playerStats.filter(player => {
          // Check for at least 3 failed moon/double moon bids
          return countMoonFailures(player) >= 3;
        });

        if (qualifyingPlayers.length === 0) return null;

        const winner = qualifyingPlayers.reduce((most, current) => {
          const mostFailed = countMoonFailures(most);
          const currFailed = countMoonFailures(current);
          return currFailed > mostFailed ? current : most;
        });
        
        return { 
          ...award, 
          winner: winner.name,
          statDetails: calculateAwardStats(award.id, winner.name, data)
        };
      }
      
      case 'feast_or_famine': {
        // Player with highest standard deviation in points
        const qualifyingPlayers = playerStats.filter(player => player.pointsPerBid.length >= 4);
        if (qualifyingPlayers.length === 0) return null;
        
        const playersWithStdDev = qualifyingPlayers.map(player => {
          // Calculate standard deviation
          const mean = player.pointsPerBid.reduce((sum, val) => sum + val, 0) / player.pointsPerBid.length;
          const squaredDiffs = player.pointsPerBid.map(val => Math.pow(val - mean, 2));
          const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / player.pointsPerBid.length;
          const stdDev = Math.sqrt(variance);
          
          return { player, stdDev };
        });
        
        const winnerData = playersWithStdDev.reduce((highest, current) =>
          current.stdDev > highest.stdDev ? current : highest
        );

        // Require genuinely wild swings, not just the highest of several steady players.
        if (winnerData.stdDev < 6) return null;

        return {
          ...award,
          winner: winnerData.player.name,
          statDetails: calculateAwardStats(award.id, winnerData.player.name, data)
        };
      }
    }
  }

  return null; // No winner determined for this award
}

// ==============================
// Award Selection
// ==============================

// Awards fall into three display buckets. "Dubious" (tongue-in-cheek) awards are identified by id;
// everything else is bucketed by `type`. Kept as id sets rather than a schema field to avoid
// touching every award definition.
const GAME_DUBIOUS_IDS = new Set([
  'overreaching', 'false_confidence', 'helping_hand', 'playing_it_safe', 'no_trump_no_problem',
]);
const SERIES_DUBIOUS_IDS = new Set(['moon_struck', 'gambling_problem', 'feast_or_famine']);

type AwardCategory = 'team' | 'player' | 'dubious';

function awardCategory(award: AwardDefinition): AwardCategory {
  if (GAME_DUBIOUS_IDS.has(award.id) || SERIES_DUBIOUS_IDS.has(award.id)) return 'dubious';
  return award.type;
}

// Selection weights: when several awards in a category are eligible, higher-weighted ones are more
// likely to be picked. Rarer / more notable awards are weighted UP so they aren't drowned out by
// the always-on generic ones (e.g. bid_royalty). Anything not listed defaults to weight 1. These
// only affect which eligible award SURFACES — never whether it's eligible. Tune freely.
const AWARD_WEIGHTS: Record<string, number> = {
  // Rare + notable — showcase these.
  remember_the_time: 3, honeypot: 3, shoot_for_the_moons: 3, moon_struck: 3, pepper_perfect: 3,
  brick_wall: 3, great_minds: 3, dynamic_duo: 3,
  // Uncommon / characterful.
  footprints_in_the_sand: 2, playing_it_safe: 2, bid_specialists: 2, no_trump_no_problem: 2,
  false_confidence: 2, helping_hand: 2, clutch_player: 2, suit_specialist: 2, misery_loves_company: 2,
  // Everything else (bid_royalty, trump_master, overreaching, defensive_fortress,
  // defensive_specialists, bid_bullies, streak_masters, series_mvp, feast_or_famine,
  // gambling_problem) defaults to weight 1.
};
const awardWeight = (id: string): number => AWARD_WEIGHTS[id] ?? 1;

// Weighted random pick. `rng()` returns a float in [0, 1). Weight 0 or a single item still works.
function weightedPick(items: AwardWithWinner[], rng: () => number): AwardWithWinner | null {
  if (items.length === 0) return null;
  const weights = items.map(a => awardWeight(a.id));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1]; // floating-point safety net
}

/**
 * Shared core: select up to three awards — one team, one player, one "dubious" — chosen at RANDOM
 * from among all awards that are actually eligible in each bucket.
 *
 * Why random: the previous algorithm walked a fixed list and took the FIRST eligible award per
 * bucket, which structurally starved most awards — e.g. `footprints_in_the_sand` was eligible in
 * ~half of games yet surfaced in none, because `bid_royalty`/`trump_master` always came first.
 * Weighted sampling among the eligible gives every award a shot (with rarer/notable ones favoured
 * via AWARD_WEIGHTS) and adds variety across games.
 *
 * `rng` is injectable so tests can seed it for determinism; production uses Math.random.
 */
function selectAwardsByCategory(
  awards: AwardDefinition[],
  data: AwardTrackingData,
  rng: () => number,
): AwardWithWinner[] {
  const selected: AwardWithWinner[] = [];
  for (const category of ['team', 'player', 'dubious'] as AwardCategory[]) {
    const eligible = awards
      .filter(a => awardCategory(a) === category)
      .map(a => evaluateAward(a, data))
      .filter((r): r is AwardWithWinner => r !== null);
    const pick = weightedPick(eligible, rng);
    if (pick) selected.push(pick);
  }
  return selected;
}

/**
 * Select awards for a completed single game (up to 3: one team, one player, one dubious).
 */
export function selectGameAwards(
  data: AwardTrackingData,
  rng: () => number = Math.random,
): AwardWithWinner[] {
  if (!data || !data.playerStats || !data.teamStats) {
    console.error('Invalid award data provided to selectGameAwards');
    return [];
  }
  return selectAwardsByCategory(getAwards({ scope: 'game' }), data, rng);
}

/**
 * Select awards for a completed series (up to 3: one team, one player, one dubious).
 */
export function selectSeriesAwards(
  data: AwardTrackingData,
  rng: () => number = Math.random,
): AwardWithWinner[] {
  if (!data || !data.playerStats || !data.teamStats) {
    console.error('Invalid award data provided to selectSeriesAwards');
    return [];
  }
  return selectAwardsByCategory(getAwards({ scope: 'series' }), data, rng);
}
