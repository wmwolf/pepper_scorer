// pepper-awards.ts - Award definitions for Pepper Scorer
// These types are used for typing functions internally in this module
// eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
import type { AwardTrackingData, PlayerStats, TeamStats } from './statistics-util';

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
    description: 'Consistently delivered on their promises',
    technicalDefinition: 'Team with highest success percentage on bids (min. 3 bids required).',
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
  
  // Dubious Awards
  {
    id: 'overreaching',
    name: 'Overreaching',
    description: 'Eyes bigger than their hand',
    technicalDefinition: 'Player with highest average bid value in failed bids (4=4, 5=5, 6=6, M=7, D=14). Minimum 2 failed bids required.',
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
    description: 'Extraordinarily generous to opponents',
    technicalDefinition: 'Team that allowed opponents to score the most points in a single game.',
    type: 'team',
    scope: 'game',
    important: false,
    icon: 'hand'
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
    technicalDefinition: 'Player on teams that most frequently went set when defending against bids of 4 or 5 (which could have been negotiated).',
    type: 'player',
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
 */
function evaluateAward(award: AwardDefinition, data: AwardTrackingData): AwardWithWinner | null {
  const { id, type } = award;
  
  // Team-specific awards
  if (type === 'team') {
    const teamStats = Object.values(data.teamStats);
    if (teamStats.length === 0) return null;
    
    switch (id) {
      case 'defensive_fortress': {
        // Count how many times each team set the bidding team
        // We're looking at the times when the opponent team bid and went set
        
        // Get team objects
        const teamArray = Object.values(data.teamStats);
        if (teamArray.length < 2) return null;
        
        // For each team, count how many times they set the opponents
        teamArray.forEach(team => {
          // Find the opponent team
          const opponentTeam = teamArray.find(t => t.name !== team.name);
          if (!opponentTeam) return;
          
          // Sets against opponents = opponent's failed bids
          team.setsAgainstOpponents = opponentTeam.totalBids - opponentTeam.successfulBids;
        });
        
        // Find teams that meet the threshold (4+ sets)
        const qualifyingTeams = teamArray.filter(team => team.setsAgainstOpponents >= 4);
        if (qualifyingTeams.length === 0) return null;
        
        // Find the team with the most sets
        const winner = qualifyingTeams.reduce((best, current) => 
          current.setsAgainstOpponents > best.setsAgainstOpponents ? current : best, qualifyingTeams[0]
        );
        
        // Check for a tie
        const secondBest = qualifyingTeams.find(team => 
          team !== winner && team.setsAgainstOpponents === winner.setsAgainstOpponents
        );
        
        // If there's a tie, return null (no award)
        if (secondBest) return null;
        
        return { ...award, winner: winner.name };
      }
      
      case 'bid_specialists': {
        // Team with highest bid success rate (min 3 bids)
        const qualifyingTeams = teamStats.filter(team => team.totalBids >= 3);
        if (qualifyingTeams.length === 0) return null;
        
        const winner = qualifyingTeams.reduce((best, current) => 
          current.bidSuccessRate > best.bidSuccessRate ? current : best
        );
        
        if (winner.bidSuccessRate === 0) return null;
        
        return { ...award, winner: winner.name };
      }
      
      case 'remember_the_time': {
        // Team that overcame a 30+ point deficit
        const comebackTeam = teamStats.find(team => team.comebackAchieved);
        return comebackTeam ? { ...award, winner: comebackTeam.name } : null;
      }
      
      case 'helping_hand': {
        // Team that allowed most points to opponents
        const winner = teamStats.reduce((most, current) => 
          current.pointsAllowedToOpponents > most.pointsAllowedToOpponents ? current : most
        );
        
        if (winner.pointsAllowedToOpponents === 0) return null;
        
        return { ...award, winner: winner.name };
      }
      
      case 'bid_bullies': {
        // Team with most successful high-value bids (6, Moon, Double Moon)
        const qualifyingTeams = teamStats.filter(team => team.highValueBids.successes > 0);
        if (qualifyingTeams.length === 0) return null;
        
        const winner = qualifyingTeams.reduce((most, current) => 
          current.highValueBids.successes > most.highValueBids.successes ? current : most
        );
        
        return { ...award, winner: winner.name };
      }
      
      case 'streak_masters': {
        // Team with longest scoring streak
        const winner = teamStats.reduce((longest, current) => 
          current.longestStreak > longest.longestStreak ? current : longest
        );
        
        if (winner.longestStreak <= 1) return null; // At least 2+ streak to qualify
        
        return { ...award, winner: winner.name };
      }
      
      case 'defensive_specialists': {
        // Team with highest defensive success rate (series)
        const qualifyingTeams = teamStats.filter(team => team.totalDefenses >= 5); // Higher minimum for series
        if (qualifyingTeams.length === 0) return null;
        
        const winner = qualifyingTeams.reduce((best, current) => 
          current.defensiveSuccessRate > best.defensiveSuccessRate ? current : best
        );
        
        if (winner.defensiveSuccessRate === 0) return null;
        
        return { ...award, winner: winner.name };
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
        
        return { ...award, winner: winnerData.player.name };
      }
      
      case 'bid_royalty': {
        // Player who won the most bids
        const winner = playerStats.reduce((most, current) => 
          current.bidsWon > most.bidsWon ? current : most
        );
        
        if (winner.bidsWon === 0) return null;
        
        return { ...award, winner: winner.name };
      }
      
      case 'clutch_player': {
        // Player who made winning bid
        const clutchPlayer = playerStats.find(player => player.wonFinalBid);
        return clutchPlayer ? { ...award, winner: clutchPlayer.name } : null;
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
        
        return { ...award, winner: winnerData.player.name };
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
        
        return { ...award, winner: winner.name };
      }
      
      case 'series_mvp': {
        // Player with highest net points
        const qualifyingPlayers = playerStats.filter(player => player.netPoints > 0);
        if (qualifyingPlayers.length === 0) return null;
        
        const winner = qualifyingPlayers.reduce((best, current) => 
          current.netPoints > best.netPoints ? current : best
        );
        
        return { ...award, winner: winner.name };
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
        
        if (winnerData.bestSuccessRate === 0) return null;
        
        return { ...award, winner: winnerData.player.name };
      }
      
      case 'pepper_perfect': {
        // Perfect pepper round record
        const qualifyingPlayers = playerStats.filter(player => 
          player.pepperRoundBids.attempts > 0 && 
          player.pepperRoundBids.attempts === player.pepperRoundBids.successes &&
          player.pepperRoundBids.opponents_set > 0
        );
        
        if (qualifyingPlayers.length === 0) return null;
        
        // If multiple qualify, pick one at random
        const randomIndex = Math.floor(Math.random() * qualifyingPlayers.length);
        const player = qualifyingPlayers[randomIndex];
        return player ? { ...award, winner: player.name } : null;
      }
      
      case 'moon_struck': {
        // Most failed moon/double moon attempts
        const qualifyingPlayers = playerStats.filter(player => {
          // Check for at least 3 failed moon/double moon bids
          return player.highValueBids.attempts - player.highValueBids.successes >= 3;
        });
        
        if (qualifyingPlayers.length === 0) return null;
        
        const winner = qualifyingPlayers.reduce((most, current) => {
          const mostFailed = most.highValueBids.attempts - most.highValueBids.successes;
          const currFailed = current.highValueBids.attempts - current.highValueBids.successes;
          return currFailed > mostFailed ? current : most;
        });
        
        return { ...award, winner: winner.name };
      }
      
      case 'gambling_problem': {
        // Player with most 4/5 bids that went set
        // This is a simplified implementation - ideally we'd track more details about each hand
        const qualifyingPlayers = playerStats.filter(player => {
          // Look for players with multiple failed bids that could have been negotiated
          const lowFailedBids = player.failedBidValues.filter(val => val <= 5).length;
          return lowFailedBids >= 2;
        });
        
        if (qualifyingPlayers.length === 0) return null;
        
        const winner = qualifyingPlayers.reduce((most, current) => {
          const mostLowFailed = most.failedBidValues.filter(val => val <= 5).length;
          const currLowFailed = current.failedBidValues.filter(val => val <= 5).length;
          return currLowFailed > mostLowFailed ? current : most;
        });
        
        return { ...award, winner: winner.name };
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
        
        return { ...award, winner: winnerData.player.name };
      }
    }
  }
  
  return null; // No winner determined for this award
}

/**
 * Select awards based on tracked game data
 * Ensure we have one positive team award, one positive player award, and one dubious award
 */
export function selectGameAwards(data: AwardTrackingData): AwardWithWinner[] {
  console.log('selectGameAwards called with data:', data);
  if (!data || !data.playerStats || !data.teamStats) {
    console.error('Invalid award data provided to selectGameAwards');
    // Return a default set of awards if data is invalid
    return [];
  }
  const selectedAwards: AwardWithWinner[] = [];
  const awards = getAwards({ scope: 'game' });
  
  // First check for important awards
  // Important team award 
  const importantTeamAwards = awards.filter(a => a.type === 'team' && a.important && !a.id.includes('overreaching') && !a.id.includes('helping_hand'));
  for (const award of importantTeamAwards) {
    const result = evaluateAward(award, data);
    if (result) {
      selectedAwards.push(result);
      break;
    }
  }
  
  // Important player award
  const importantPlayerAwards = awards.filter(a => a.type === 'player' && a.important && !a.id.includes('overreaching') && !a.id.includes('false_confidence'));
  for (const award of importantPlayerAwards) {
    const result = evaluateAward(award, data);
    if (result) {
      selectedAwards.push(result);
      break;
    }
  }
  
  // Important dubious award
  const importantDubiousAwards = awards.filter(a => a.important && (a.id.includes('overreaching') || a.id.includes('false_confidence') || a.id.includes('helping_hand')));
  for (const award of importantDubiousAwards) {
    const result = evaluateAward(award, data);
    if (result) {
      selectedAwards.push(result);
      break;
    }
  }
  
  // If we don't have a positive team award yet, try to find one
  if (!selectedAwards.some(a => a.type === 'team' && !a.id.includes('overreaching') && !a.id.includes('helping_hand'))) {
    const teamAwards = awards.filter(a => a.type === 'team' && !a.important && !a.id.includes('overreaching') && !a.id.includes('helping_hand'));
    for (const award of teamAwards) {
      const result = evaluateAward(award, data);
      if (result) {
        selectedAwards.push(result);
        break;
      }
    }
  }
  
  // If we don't have a positive player award yet, try to find one
  if (!selectedAwards.some(a => a.type === 'player' && !a.id.includes('overreaching') && !a.id.includes('false_confidence'))) {
    const playerAwards = awards.filter(a => a.type === 'player' && !a.important && !a.id.includes('overreaching') && !a.id.includes('false_confidence'));
    for (const award of playerAwards) {
      const result = evaluateAward(award, data);
      if (result) {
        selectedAwards.push(result);
        break;
      }
    }
  }
  
  // If we don't have a dubious award yet, try to find one
  if (!selectedAwards.some(a => a.id.includes('overreaching') || a.id.includes('false_confidence') || a.id.includes('helping_hand'))) {
    const dubiousAwards = awards.filter(a => !a.important && (a.id.includes('overreaching') || a.id.includes('false_confidence') || a.id.includes('helping_hand')));
    for (const award of dubiousAwards) {
      const result = evaluateAward(award, data);
      if (result) {
        selectedAwards.push(result);
        break;
      }
    }
  }
  
  // If we still don't have 3 awards, pad with random ones
  // Ensure at least one player award
  if (!selectedAwards.some(a => a.type === 'player')) {
    const playerValues = Object.values(data.playerStats);
    if (playerValues.length > 0) {
      const player = playerValues[Math.floor(Math.random() * playerValues.length)];
      if (player) {
        const awardDef = awards.find(a => a.id === 'bid_royalty');
        if (awardDef) {
          selectedAwards.push({
            ...awardDef,
            winner: player.name
          });
        }
      }
    }
  }
  
  // Ensure at least one team award
  if (!selectedAwards.some(a => a.type === 'team')) {
    const teamValues = Object.values(data.teamStats);
    if (teamValues.length > 0) {
      const team = teamValues[Math.floor(Math.random() * teamValues.length)];
      if (team) {
        const awardDef = awards.find(a => a.id === 'bid_specialists');
        if (awardDef) {
          selectedAwards.push({
            ...awardDef,
            winner: team.name
          });
        }
      }
    }
  }
  
  // Ensure at least one dubious award
  if (!selectedAwards.some(a => a.id.includes('overreaching') || a.id.includes('false_confidence') || a.id.includes('helping_hand'))) {
    const playerValues = Object.values(data.playerStats);
    if (playerValues.length > 0) {
      const player = playerValues[Math.floor(Math.random() * playerValues.length)];
      if (player) {
        const awardDef = awards.find(a => a.id === 'overreaching');
        if (awardDef) {
          selectedAwards.push({
            ...awardDef,
            winner: player.name
          });
        }
      }
    }
  }
  
  // Cap at 3 awards maximum
  return selectedAwards.slice(0, 3);
}

/**
 * Select awards for a completed series
 */
export function selectSeriesAwards(data: AwardTrackingData): AwardWithWinner[] {
  const selectedAwards: AwardWithWinner[] = [];
  const awards = getAwards({ scope: 'series' });
  
  // Same logic as game awards, but with series-scoped awards
  // Important team award 
  const importantTeamAwards = awards.filter(a => a.type === 'team' && a.important && !a.id.includes('moon_struck') && !a.id.includes('gambling_problem') && !a.id.includes('feast_or_famine'));
  for (const award of importantTeamAwards) {
    const result = evaluateAward(award, data);
    if (result) {
      selectedAwards.push(result);
      break;
    }
  }
  
  // Important player award
  const importantPlayerAwards = awards.filter(a => a.type === 'player' && a.important && !a.id.includes('moon_struck') && !a.id.includes('gambling_problem') && !a.id.includes('feast_or_famine'));
  for (const award of importantPlayerAwards) {
    const result = evaluateAward(award, data);
    if (result) {
      selectedAwards.push(result);
      break;
    }
  }
  
  // Important dubious award
  const importantDubiousAwards = awards.filter(a => a.important && (a.id.includes('moon_struck') || a.id.includes('gambling_problem') || a.id.includes('feast_or_famine')));
  for (const award of importantDubiousAwards) {
    const result = evaluateAward(award, data);
    if (result) {
      selectedAwards.push(result);
      break;
    }
  }
  
  // If we don't have a positive team award yet, try to find one
  if (!selectedAwards.some(a => a.type === 'team' && !a.id.includes('moon_struck') && !a.id.includes('gambling_problem') && !a.id.includes('feast_or_famine'))) {
    const teamAwards = awards.filter(a => a.type === 'team' && !a.important && !a.id.includes('moon_struck') && !a.id.includes('gambling_problem') && !a.id.includes('feast_or_famine'));
    for (const award of teamAwards) {
      const result = evaluateAward(award, data);
      if (result) {
        selectedAwards.push(result);
        break;
      }
    }
  }
  
  // If we don't have a positive player award yet, try to find one
  if (!selectedAwards.some(a => a.type === 'player' && !a.id.includes('moon_struck') && !a.id.includes('gambling_problem') && !a.id.includes('feast_or_famine'))) {
    const playerAwards = awards.filter(a => a.type === 'player' && !a.important && !a.id.includes('moon_struck') && !a.id.includes('gambling_problem') && !a.id.includes('feast_or_famine'));
    for (const award of playerAwards) {
      const result = evaluateAward(award, data);
      if (result) {
        selectedAwards.push(result);
        break;
      }
    }
  }
  
  // If we don't have a dubious award yet, try to find one
  if (!selectedAwards.some(a => a.id.includes('moon_struck') || a.id.includes('gambling_problem') || a.id.includes('feast_or_famine'))) {
    const dubiousAwards = awards.filter(a => !a.important && (a.id.includes('moon_struck') || a.id.includes('gambling_problem') || a.id.includes('feast_or_famine')));
    for (const award of dubiousAwards) {
      const result = evaluateAward(award, data);
      if (result) {
        selectedAwards.push(result);
        break;
      }
    }
  }
  
  // If we still don't have 3 awards, pad with random ones
  // Ensure at least one player award
  if (!selectedAwards.some(a => a.type === 'player')) {
    const playerValues = Object.values(data.playerStats);
    if (playerValues.length > 0) {
      const player = playerValues[Math.floor(Math.random() * playerValues.length)];
      if (player) {
        const awardDef = awards.find(a => a.id === 'series_mvp');
        if (awardDef) {
          selectedAwards.push({
            ...awardDef,
            winner: player.name
          });
        }
      }
    }
  }
  
  // Ensure at least one team award
  if (!selectedAwards.some(a => a.type === 'team')) {
    const teamValues = Object.values(data.teamStats);
    if (teamValues.length > 0) {
      const team = teamValues[Math.floor(Math.random() * teamValues.length)];
      if (team) {
        const awardDef = awards.find(a => a.id === 'streak_masters');
        if (awardDef) {
          selectedAwards.push({
            ...awardDef,
            winner: team.name
          });
        }
      }
    }
  }
  
  // Ensure at least one dubious award
  if (!selectedAwards.some(a => a.id.includes('moon_struck') || a.id.includes('gambling_problem') || a.id.includes('feast_or_famine'))) {
    const playerValues = Object.values(data.playerStats);
    if (playerValues.length > 0) {
      const player = playerValues[Math.floor(Math.random() * playerValues.length)];
      if (player) {
        const awardDef = awards.find(a => a.id === 'feast_or_famine');
        if (awardDef) {
          selectedAwards.push({
            ...awardDef,
            winner: player.name
          });
        }
      }
    }
  }
  
  // Cap at 3 awards maximum
  return selectedAwards.slice(0, 3);
}
