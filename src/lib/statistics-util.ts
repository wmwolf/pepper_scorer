// src/lib/statistics-util.ts
import { decodeHand, calculateScore, isPepperRound } from './gameState';

// Trump suit names
const trumpNames = {
  'C': 'Clubs',
  'D': 'Diamonds',
  'H': 'Hearts',
  'S': 'Spades',
  'N': 'No Trump'
};

export interface GameStats {
  totalHands: number;
  highestBid: { value: string; player: string; points: number };
  mostCommonTrump: { suit: string; count: number };
  defensiveWins: number;
  defensivePoints: number;
  biddingPoints: number;
  setHands: number;
  trumpCounts: Record<string, number>;
}

// Enhanced player statistics for awards
export interface PlayerStats {
  name: string;
  team: number;
  bidsWon: number;
  bidsSucceeded: number;
  bidsFailed: number;
  // Award-specific tracking
  trumpBids: Record<string, { attempts: number; successes: number }>;
  highValueBids: { attempts: number; successes: number };  // 6, Moon, Double Moon
  noTrumpBids: { attempts: number; successes: number };
  failedBidValues: number[];  // Track values of failed bids
  pepperRoundBids: { attempts: number; successes: number; opponents_set: number };
  netPoints: number;  // For Series MVP - successful bid points minus failed bid points
  pointsPerBid: number[]; // For feast or famine - track variance
  wonFinalBid: boolean; // Did this player make the bid that won the game
}

// Enhanced team statistics for awards
export interface TeamStats {
  name: string;
  defensiveSuccessRate: number; // Percentage of successful defenses
  totalDefenses: number;
  successfulDefenses: number;
  bidSuccessRate: number; // Percentage of successful bids
  totalBids: number;
  successfulBids: number;
  highValueBids: { attempts: number; successes: number }; // 6, Moon, Double Moon
  pointsAllowedToOpponents: number;
  maxDeficit: number; // Maximum point deficit faced
  minScoreTrailing: number; // Minimum score while trailing
  comebackAchieved: boolean; // Did this team overcome a 30+ point deficit
  longestStreak: number; // Longest streak of scoring hands
  setsAgainstOpponents?: number; // How many times they set the opponents
}

// Award data tracking
export interface AwardTrackingData {
  playerStats: Record<string, PlayerStats>;
  teamStats: Record<string, TeamStats>;
  pointsHistory: Array<[number, number]>; // History of scores to track deficits
  handScores: Array<[number, number]>; // Individual hand scores
  hands: string[]; // Raw hand encodings
  winningTeam: number | null;
  winningTeamName: string;
  gameCompleted: boolean;
}

export function initializeAwardTracking(
  players: string[],
  teams: string[]
): AwardTrackingData {
  const playerStats: Record<string, PlayerStats> = {};
  const teamStats: Record<string, TeamStats> = {};
  
  // Initialize player statistics
  players.forEach((name, index) => {
    const team = Math.floor(index / 2);
    playerStats[name] = {
      name,
      team,
      bidsWon: 0,
      bidsSucceeded: 0,
      bidsFailed: 0,
      trumpBids: { 'C': { attempts: 0, successes: 0 }, 'D': { attempts: 0, successes: 0 }, 
                  'H': { attempts: 0, successes: 0 }, 'S': { attempts: 0, successes: 0 }, 
                  'N': { attempts: 0, successes: 0 } },
      highValueBids: { attempts: 0, successes: 0 },
      noTrumpBids: { attempts: 0, successes: 0 },
      failedBidValues: [],
      pepperRoundBids: { attempts: 0, successes: 0, opponents_set: 0 },
      netPoints: 0,
      pointsPerBid: [],
      wonFinalBid: false
    };
  });
  
  // Initialize team statistics
  teams.forEach((name) => {
    teamStats[name] = {
      name,
      defensiveSuccessRate: 0,
      totalDefenses: 0,
      successfulDefenses: 0,
      bidSuccessRate: 0,
      totalBids: 0,
      successfulBids: 0,
      highValueBids: { attempts: 0, successes: 0 },
      pointsAllowedToOpponents: 0,
      maxDeficit: 0,
      minScoreTrailing: 0,
      comebackAchieved: false,
      longestStreak: 0
    };
  });
  
  return {
    playerStats,
    teamStats,
    pointsHistory: [[0, 0]],
    handScores: [],
    hands: [],
    winningTeam: null,
    winningTeamName: '',
    gameCompleted: false
  };
}

export function calculateGameStats(
  hands: string[], 
  players: string[]
): GameStats {
  console.log('calculateGameStats called with hands:', hands);
  // Initialize statistics
  const stats: GameStats = {
    totalHands: 0,
    highestBid: { value: '', player: '', points: 0 },
    mostCommonTrump: { suit: '', count: 0 },
    defensiveWins: 0,
    defensivePoints: 0,
    biddingPoints: 0,
    setHands: 0,
    trumpCounts: { 'C': 0, 'D': 0, 'H': 0, 'S': 0, 'N': 0 }
  };
  
  // Count completed hands
  stats.totalHands = hands.filter(hand => 
    hand.length === 6 || (hand.length >= 2 && hand[1] === '0')
  ).length;
  
  // Process each completed hand
  hands.forEach(hand => {
    if (hand.length < 6 && (hand.length < 2 || hand[1] !== '0')) {
      return; // Skip incomplete hands
    }
    
    // Skip throw-in hands
    if (hand.length >= 2 && hand[1] === '0') {
      return;
    }
    
    try {
      const { bidWinner, bid, trump, decision, tricks } = decodeHand(hand);
      const bidderName = players[bidWinner - 1] || 'Unknown';
      // This calculation is needed for other parts of the logic
      // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
      const bidderTeam = (bidWinner - 1) % 2;
      // const defenderTeam = 1 - bidderTeam;
      
      // Track trump suits
      // Define valid trump types
      type TrumpKey = 'C' | 'D' | 'H' | 'S' | 'N';
      const isValidTrump = (t: string): t is TrumpKey => 
        t === 'C' || t === 'D' || t === 'H' || t === 'S' || t === 'N';
        
      if (trump && typeof trump === 'string' && isValidTrump(trump) && stats.trumpCounts && stats.trumpCounts[trump] !== undefined) {
        stats.trumpCounts[trump] = stats.trumpCounts[trump]! + 1;
      }
      
      // Convert bid to point value
      const bidString = typeof bid === 'number' ? String(bid) : String(bid || '');
      const bidValue = {
        'P': 4,
        '4': 4,
        '5': 5,
        '6': 6,
        'M': 7,
        'D': 14
      }[bidString] || 0;
      
      // Check for highest bid
      if (bidValue > stats.highestBid.points) {
        stats.highestBid = { 
          value: String(bid || ''), 
          player: bidderName, 
          points: bidValue 
        };
      }
      
      // Calculate points
      if (decision === 'P') { // Played hand
        const bidString = String(bid || '');
        const tricksNeeded = ['M', 'D', '6'].includes(bidString) ? 6 : parseInt(bidString) || 4;
        
        if (tricks === 0) {
          // Defending team set the bidders
          stats.defensiveWins++;
          stats.setHands++; // Count this as a set too
        } else if (tricks + tricksNeeded > 6) {
          // Bidding team was set by defenders
          stats.setHands++;
        }
      }
    } catch (e) {
      console.error('Error processing hand:', hand, e);
    }
  });
  
  // Find most common trump
  const mostCommonTrump = Object.entries(stats.trumpCounts)
    .reduce((max, [suit, count]) => 
      count > max[1] ? [suit, count] : max, 
      ['', 0]
    );
    
  stats.mostCommonTrump = { 
    suit: mostCommonTrump[0], 
    count: mostCommonTrump[1] 
  };
  
  return stats;
}

export function calculateLongestStreak(hands: string[], teamIndex: number): number {
  let currentStreak = 0;
  let longestStreak = 0;
  
  hands.forEach(hand => {
    if (hand.length < 6 && (hand.length < 2 || hand[1] !== '0')) {
      return; // Skip incomplete hands
    }
    
    // For throw-in hands, no points are scored - reset streak
    if (hand.length >= 2 && hand[1] === '0') {
      currentStreak = 0;
      return;
    }
    
    try {
      const { bidWinner, decision } = decodeHand(hand);
      const bidderTeam = (bidWinner - 1) % 2;
      
      // Calculate the actual scores for this hand
      const [score1, score2] = calculateScore(hand);
      const teamScore = teamIndex === 0 ? score1 : score2;
      
      // A team continues their streak if they gain points OR their opponents lose points due to this team's actions
      let teamWonPoints = false;
      
      if (teamIndex === bidderTeam) {
        // This team was bidding
        if (decision === 'F') {
          // Folded/negotiated - always counts as winning points
          teamWonPoints = teamScore > 0;
        } else {
          // Played - they win if they made their bid (got positive points)
          teamWonPoints = teamScore > 0;
        }
      } else {
        // This team was defending
        // They win if they got positive points (either tricks or from setting bidders)
        teamWonPoints = teamScore > 0;
      }
      
      if (teamWonPoints) {
        currentStreak++;
        longestStreak = Math.max(longestStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    } catch (e) {
      console.error('Error processing hand for streak:', hand, e);
    }
  });
  
  return longestStreak;
}

export function trackAwardData(
  hands: string[],
  players: string[],
  teams: string[],
  finalScores: [number, number],
  winnerIndex: number | null
): AwardTrackingData {
  console.log('trackAwardData called with:');
  console.log('- hands:', hands);
  console.log('- players:', players);
  console.log('- teams:', teams);
  console.log('- scores:', finalScores);
  console.log('- winner:', winnerIndex);
  // Initialize award tracking data
  const awardData = initializeAwardTracking(players, teams);
  
  // Store the original hands data
  awardData.hands = [...hands];
  
  // Running score tracking
  const currentScores: [number, number] = [0, 0];
  
  // Process each hand to collect award-relevant data
  hands.forEach((hand, handIndex) => {
    // Skip incomplete or throw-in hands
    if ((hand.length < 6 && (hand.length < 2 || hand[1] !== '0')) || 
        (hand.length >= 2 && hand[1] === '0')) {
      return;
    }
    
    try {
      const { bidWinner, bid, trump, decision, tricks } = decodeHand(hand);
      const bidderIndex = bidWinner - 1;
      const bidderName = players[bidderIndex] || 'Unknown';
      const bidderTeam = bidderIndex % 2;
      const defenderTeam = 1 - bidderTeam;
      const bidderTeamName = teams[bidderTeam];
      const defenderTeamName = teams[defenderTeam];
      const inPepperRound = isPepperRound(handIndex);
      
      // Convert bid to point value
      const bidValue = {
        'P': 4,
        '4': 4,
        '5': 5,
        '6': 6,
        'M': 7,
        'D': 14
      }[bid] || 0;
      
      // 1. Update player-specific stats
      const playerStat = bidderName && bidderName in awardData.playerStats ? awardData.playerStats[bidderName] : undefined;
      if (playerStat) {
        playerStat.bidsWon++;
        
        // Track trump usage
        if (trump && playerStat.trumpBids[trump]) {
          playerStat.trumpBids[trump].attempts++;
        }
        
        // Track high-value bids (6, Moon, Double Moon)
        if (bid && ['6', 'M', 'D'].includes(bid.toString())) {
          playerStat.highValueBids.attempts++;
        }
        
        // Track no-trump bids
        if (trump === 'N') {
          playerStat.noTrumpBids.attempts++;
        }
        
        // Track pepper round bids
        if (inPepperRound) {
          playerStat.pepperRoundBids.attempts++;
        }
        
        // Calculate hand outcome
        const [scoreTeam1, scoreTeam2] = calculateScore(hand);
        const handScores: [number, number] = [scoreTeam1, scoreTeam2];
        awardData.handScores.push(handScores);
        
        const bidderPoints = bidderTeam === 0 ? scoreTeam1 : scoreTeam2;
        // Defender points calculation kept for future feature development
        // const defenderPoints = bidderTeam === 0 ? scoreTeam2 : scoreTeam1;
        
        // Update scoring stats
        if (decision === 'P') {
          const tricksNeeded = ['M', 'D', '6'].includes(bid as string) ? 6 : parseInt(bid as string);
          const bidSucceeded = tricks + tricksNeeded <= 6; // Not set
          
          if (bidSucceeded) {
            // Bid was successful
            playerStat.bidsSucceeded++;
            playerStat.netPoints += bidValue;
            playerStat.pointsPerBid.push(bidValue);
            
            // Track trump success
            if (trump && playerStat.trumpBids[trump]) {
              playerStat.trumpBids[trump].successes++;
            }
            
            // Track high-value bid success
            if (bid && ['6', 'M', 'D'].includes(bid.toString())) {
              playerStat.highValueBids.successes++;
            }
            
            // Track no-trump success
            if (trump === 'N') {
              playerStat.noTrumpBids.successes++;
            }
            
            // Track pepper round success
            if (inPepperRound) {
              playerStat.pepperRoundBids.successes++;
            }
          } else {
            // Bid failed
            playerStat.bidsFailed++;
            playerStat.failedBidValues.push(bidValue);
            playerStat.netPoints -= bidValue;
            playerStat.pointsPerBid.push(-bidValue);
          }
        } else if (decision === 'F') {
          // Folded hands still count as succeeded bids
          playerStat.bidsSucceeded++;
          
          // For net points calculation, use actual points gained, not bid value
          // The bidder gets their bid value, but pays out 'tricks' to defenders
          const netPointsFromFold = bidValue - tricks;
          playerStat.netPoints += netPointsFromFold;
          playerStat.pointsPerBid.push(netPointsFromFold);
          
          // Track trump success for folded hands
          if (trump && playerStat.trumpBids[trump]) {
            playerStat.trumpBids[trump].successes++;
          }
          
          // Track high-value bid success for folded hands
          if (bid && ['6', 'M', 'D'].includes(bid.toString())) {
            playerStat.highValueBids.successes++;
          }
          
          // Track no-trump success for folded hands
          if (trump === 'N') {
            playerStat.noTrumpBids.successes++;
          }
          
          // Track pepper round success for folded hands
          if (inPepperRound) {
            playerStat.pepperRoundBids.successes++;
          }
        }
        
        // 2. Update team-specific stats
        const bidderTeamStat = bidderTeamName && bidderTeamName in awardData.teamStats ? awardData.teamStats[bidderTeamName] : undefined;
        const defenderTeamStat = defenderTeamName && defenderTeamName in awardData.teamStats ? awardData.teamStats[defenderTeamName] : undefined;
        
        if (bidderTeamStat && defenderTeamStat) {
          // Update bidding team stats
          bidderTeamStat.totalBids++;
          
          if (bid && ['6', 'M', 'D'].includes(bid.toString())) {
            bidderTeamStat.highValueBids.attempts++;
          }
          
          if (decision === 'P') {
            const tricksNeeded = bid && ['M', 'D', '6'].includes(String(bid)) ? 6 : (typeof bid === 'number' ? bid : parseInt(String(bid) || '4'));
            const bidSucceeded = tricks + tricksNeeded <= 6; // Not set
            
            if (bidSucceeded) {
              bidderTeamStat.successfulBids++;
              
              if (bid && ['6', 'M', 'D'].includes(bid.toString())) {
                bidderTeamStat.highValueBids.successes++;
              }
            }
            
            // Track if defenders successfully set the bidders
            if (!bidSucceeded) {
              defenderTeamStat.successfulDefenses++;
              
              // For pepper round tracking
              if (inPepperRound) {
                // Check all players on defending team for opponent set counting
                players.forEach((defenderName, idx) => {
                  if (Math.floor(idx / 2) === defenderTeam) {
                    const defenderStat = awardData.playerStats[defenderName];
                    if (defenderStat) {
                      defenderStat.pepperRoundBids.opponents_set++;
                    }
                  }
                });
              }
            }
            
            defenderTeamStat.totalDefenses++;
            
            // Track points allowed to opponents (for "Helping Hand" award)
            defenderTeamStat.pointsAllowedToOpponents += Math.max(0, bidderPoints);
          } else if (decision === 'F') {
            // Folded hands still count as succeeded bids
            bidderTeamStat.successfulBids++;
            
            if (bid && ['6', 'M', 'D'].includes(bid.toString())) {
              bidderTeamStat.highValueBids.successes++;
            }
            
            // Defending team also gained points in negotiation
            if (tricks > 0) {
              defenderTeamStat.successfulDefenses++;
            }
            
            defenderTeamStat.totalDefenses++;
          }
        }
        
        // 3. Update score history
        currentScores[0] += handScores[0];
        currentScores[1] += handScores[1];
        awardData.pointsHistory.push([...currentScores]);
        
        // Check for deficit and comeback
        const team0Deficit = currentScores[1] - currentScores[0];
        const team1Deficit = currentScores[0] - currentScores[1];
        
        const team0Name = teams[0];
        if (team0Name && team0Name in awardData.teamStats) {
          const teamStats = awardData.teamStats[team0Name];
          if (teamStats && team0Deficit > teamStats.maxDeficit) {
            teamStats.maxDeficit = team0Deficit;
            teamStats.minScoreTrailing = currentScores[0];
          }
        }
        
        const team1 = teams[1];
        if (team1 && team1 in awardData.teamStats) {
          const teamStats = awardData.teamStats[team1];
          if (teamStats && team1Deficit > teamStats.maxDeficit) {
            teamStats.maxDeficit = team1Deficit;
            teamStats.minScoreTrailing = currentScores[1];
          }
        }
      }
    } catch (e) {
      console.error('Error processing hand for awards:', hand, e);
    }
  });
  
  // Calculate streaks and success rates
  teams.forEach((team, teamIndex) => {
    const teamStat = awardData.teamStats[team];
    
    if (teamStat) {
      // Calculate longest streak
      teamStat.longestStreak = calculateLongestStreak(hands, teamIndex);
      
      // Calculate defense success rate
      if (teamStat.totalDefenses > 0) {
        teamStat.defensiveSuccessRate = teamStat.successfulDefenses / teamStat.totalDefenses;
      }
      
      // Calculate bid success rate
      if (teamStat.totalBids > 0) {
        teamStat.bidSuccessRate = teamStat.successfulBids / teamStat.totalBids;
      }
      
      // Check for comeback achievement (trailing by 30+ and winning)
      // Must have been behind by 30+ at some point AND won the game
      if (winnerIndex === teamIndex && teamStat.maxDeficit >= 30) {
        // Additional validation: ensure the comeback was meaningful
        // (they were actually behind by 30+ when trailing, not just had a 30+ deficit briefly)
        if (teamStat.minScoreTrailing >= 0) { // Only if they were actually in a trailing position
          teamStat.comebackAchieved = true;
        }
      }
    }
  });
  
  // Mark the player who made the winning bid
  if (winnerIndex !== null) {
    // Find the last bid that pushed the winning team over 42 points
    // const winningScore = finalScores[winnerIndex];
    const runningScore: [number, number] = [0, 0];
    
    for (let i = 0; i < hands.length; i++) {
      const hand = hands[i];
      
      if (!hand || (hand.length < 6 && (hand.length < 2 || hand[1] !== '0')) || 
          (hand.length >= 2 && hand[1] === '0')) {
        continue; // Skip incomplete or throw-in hands
      }
      
      const [team1Score, team2Score] = calculateScore(hand);
      runningScore[0] += team1Score;
      runningScore[1] += team2Score;
      
      // Check if this bid pushed the winning team over 42
      console.log(`Hand ${i+1}: running score = ${runningScore}, winner = ${winnerIndex}`);
      // Need to check if this is truly the hand that pushed the winner over the edge
      // First check if winnerIndex is valid to safely access the array
      let isWinningScore = false;
      // Using non-null assertion operator (!) since we've checked the type and bounds
      if (typeof winnerIndex === 'number' && winnerIndex >= 0 && winnerIndex < runningScore.length) {
        isWinningScore = runningScore[winnerIndex] >= 42;
      }
      // Check if this is the first time the winning team went over 42
      let isFirstTimeOver42 = false;
      if (typeof winnerIndex === 'number' && isWinningScore) {
        const prevScore = winnerIndex === 0 ? 
          runningScore[0] - team1Score : 
          runningScore[1] - team2Score;
        isFirstTimeOver42 = prevScore < 42;
      }
                                  
      if (isWinningScore && isFirstTimeOver42) {
        // This was the winning hand - but we need to verify WHO caused the win
        const { bidWinner } = decodeHand(hand);
        
        // Safety checks for array bounds and valid indices
        if (bidWinner < 1 || bidWinner > players.length) {
          console.error(`Invalid bidWinner index: ${bidWinner}`);
          break;
        }
        
        const bidderName = players[bidWinner - 1];
        const bidderTeam = Math.floor((bidWinner - 1) / 2);
        
        if (bidderName && bidderName in awardData.playerStats) {
          const playerStat = awardData.playerStats[bidderName];
          
          // Only award clutch player if:
          // 1. The bidder is on the winning team AND
          // 2. The bidder's team actually GAINED points from this hand (not just the opponents losing points)
          if (playerStat && typeof winnerIndex === 'number' && bidderTeam === winnerIndex) {
            const winnerTeamScore = winnerIndex === 0 ? team1Score : team2Score;
            
            // The bidder gets clutch player only if their team gained positive points
            // (meaning they succeeded in their bid or negotiated successfully)
            if (winnerTeamScore > 0) {
              console.log(`Player ${bidderName} made the clutch winning bid! Team gained ${winnerTeamScore} points.`);
              playerStat.wonFinalBid = true;
            } else {
              console.log(`Player ${bidderName} made a bid but their team won due to opponent failure, not clutch performance.`);
            }
          } else {
            console.log(`Player ${bidderName} made a bid but is not on winning team.`);
            console.log(`bidWinner=${bidWinner}, bidWinnerTeam=${bidderTeam}, winnerIndex=${winnerIndex}`);
          }
        }
        break;
      }
    }
    
    awardData.winningTeam = winnerIndex;
    awardData.winningTeamName = teams[winnerIndex] || '';
    awardData.gameCompleted = true;
    
    console.log('Assigning winner info to award data:', {
      winningTeam: awardData.winningTeam,
      winningTeamName: awardData.winningTeamName,
      completedStatus: awardData.gameCompleted
    });
  }
  
  return awardData;
}

// Function to generate game statistics HTML
export function generateStatisticsHTML(
  hands: string[], 
  players: string[], 
  teams: string[], 
  scores: [number, number], 
  winnerIndex: number
): string {
  const gameStats = calculateGameStats(hands, players);
  const team1LongestStreak = calculateLongestStreak(hands, 0);
  const team2LongestStreak = calculateLongestStreak(hands, 1);
  
  return `
    <div class="bg-white rounded-lg shadow-sm p-6 my-6">
      <h3 class="text-xl font-semibold text-gray-900 mb-4">Game Statistics</h3>
      
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <!-- Game Overview -->
        <div class="space-y-4">
          <h4 class="text-lg font-medium text-gray-800">Game Overview</h4>
          
          <div class="space-y-2">
            <div class="flex justify-between">
              <span class="text-gray-600">Total Hands:</span>
              <span class="font-medium">${gameStats.totalHands}</span>
            </div>
            
            <div class="flex justify-between">
              <span class="text-gray-600">Winner:</span>
              <span class="font-medium text-blue-600">${teams[winnerIndex]}</span>
            </div>
            
            <div class="flex justify-between">
              <span class="text-gray-600">Final Score:</span>
              <span class="font-medium">${scores[0]} - ${scores[1]}</span>
            </div>
            
            <div class="flex justify-between">
              <span class="text-gray-600">Sets:</span>
              <span class="font-medium">${gameStats.setHands}</span>
            </div>
          </div>
        </div>
        
        <!-- Bid Highlights -->
        <div class="space-y-4">
          <h4 class="text-lg font-medium text-gray-800">Bid Highlights</h4>
          
          <div class="space-y-2">
            <div class="flex justify-between items-start">
              <span class="text-gray-600">Highest Bid:</span>
              <span class="font-medium">
                ${gameStats.highestBid.value === 'M' ? 'Moon' : 
                 gameStats.highestBid.value === 'D' ? 'Double Moon' : 
                 gameStats.highestBid.value === 'P' ? '4 (Pepper)' : 
                 gameStats.highestBid.value} by ${gameStats.highestBid.player}
              </span>
            </div>
            
            <div class="flex justify-between">
              <span class="text-gray-600">Most Common Trump:</span>
              <span class="font-medium">
                ${gameStats.mostCommonTrump.count > 0 ? 
                  `${trumpNames[gameStats.mostCommonTrump.suit as keyof typeof trumpNames]} (${gameStats.mostCommonTrump.count})` : 
                  'None'}
              </span>
            </div>
            
            <div class="flex justify-between">
              <span class="text-gray-600">Defensive Sets:</span>
              <span class="font-medium">${gameStats.defensiveWins}</span>
            </div>
          </div>
        </div>
        
        <!-- Team Performance -->
        <div class="space-y-4">
          <h4 class="text-lg font-medium text-gray-800">Team Performance</h4>
          
          <div class="space-y-2">
            <div class="flex justify-between">
              <span class="text-gray-600">${teams[0]} Streak:</span>
              <span class="font-medium">${team1LongestStreak} hands</span>
            </div>
            
            <div class="flex justify-between">
              <span class="text-gray-600">${teams[1]} Streak:</span>
              <span class="font-medium">${team2LongestStreak} hands</span>
            </div>
            
            <div class="flex justify-between">
              <span class="text-gray-600">Avg. Points/Hand:</span>
              <span class="font-medium">
                ${gameStats.totalHands > 0 ? 
                  ((Math.abs(scores[0]) + Math.abs(scores[1])) / gameStats.totalHands).toFixed(1) : 
                  '0'}
              </span>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Trump Distribution Chart -->
      <div class="mt-8">
        <h4 class="text-lg font-medium text-gray-800 mb-4">Trump Distribution</h4>
        
        <div class="flex justify-between h-40 space-x-2">
          ${Object.entries(gameStats.trumpCounts).map(([suit, count]) => {
            // Calculate the bar height (maximum is 32 units)
            const maxCount = Math.max(...Object.values(gameStats.trumpCounts), 1);
            let barHeight = Math.round((count / maxCount) * 32);
            
            // Ensure bars with count > 0 have some visible height
            if (count > 0 && barHeight < 4) barHeight = 4;
            
            // Set bar color based on suit
            const barColor = suit === 'H' || suit === 'D' ? 'bg-red-500' : 
                           suit === 'C' || suit === 'S' ? 'bg-gray-800' : 
                           'bg-blue-500';
                           
            // Get suit symbol
            // Define valid keys
            type SuitKey = 'C' | 'D' | 'H' | 'S' | 'N';
            const suitSymbols: Record<SuitKey, string> = {
              'C': '♣️',
              'D': '♦️', 
              'H': '♥️', 
              'S': '♠️', 
              'N': '∅'
            };
            
            // Make sure to only use valid keys
            const isValidSuit = (s: string): s is SuitKey => 
              s === 'C' || s === 'D' || s === 'H' || s === 'S' || s === 'N';
            
            const safeKey: SuitKey = (suit && typeof suit === 'string' && isValidSuit(suit)) ? suit : 'C';
            const suitSymbol = suitSymbols[safeKey];
            
            return `
              <div class="flex flex-col items-center" style="flex: 1">
                <div class="flex items-end justify-center w-full h-32">
                  <div class="${barColor} rounded-t-md" style="width: 80%; height: ${barHeight}px"></div>
                </div>
                <div class="text-lg mt-2">${suitSymbol}</div>
                <div class="text-sm font-semibold">${count}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;
}
