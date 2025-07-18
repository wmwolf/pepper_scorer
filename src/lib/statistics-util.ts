// src/lib/statistics-util.ts
import { decodeHand, calculateScore, isPepperRound, isHandComplete } from './gameState';

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
  bigFours: number;  // Count of "Big Four" hands - 4-bids where opponents play and get zero (excludes clubs)
  netPoints: number;  // For Series MVP - sum of team scores on hands this player bid
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
    const team = index % 2;
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
      bigFours: 0,
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
  stats.totalHands = hands.filter(hand => isHandComplete(hand)).length;
  
  // Process each completed hand
  hands.forEach(hand => {
    if (!isHandComplete(hand)) {
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
  const streaks: number[] = [];
  
  hands.forEach((hand) => {
    // Skip incomplete hands
    if (!isHandComplete(hand)) {
      return;
    }
    
    // For throw-in hands, no points are scored - reset streak
    if (hand.length >= 2 && hand[1] === '0') {
      streaks.push(currentStreak);
      currentStreak = 0;
      return;
    }
    
    try {
      const { bidWinner, bid, decision, tricks } = decodeHand(hand);
      const bidderTeam = (bidWinner - 1) % 2;
      
      let teamContinuesStreak = false;
      
      if (teamIndex === bidderTeam) {
        // This team won the bid - did they make it?
        if (decision === 'F') {
          // Folded/negotiated - always successful
          teamContinuesStreak = true;
        } else {
          // Played - check if they made their bid
          const tricksNeeded = ['M', 'D', '6'].includes(String(bid)) ? 6 : parseInt(String(bid)) || 4;
          const madeTheirBid = tricks + tricksNeeded <= 6; // Not set
          teamContinuesStreak = madeTheirBid;
        }
      } else {
        // The other team won the bid - did they go set?
        if (decision === 'P') {
          // Other team played - check if they went set
          const tricksNeeded = ['M', 'D', '6'].includes(String(bid)) ? 6 : parseInt(String(bid)) || 4;
          const otherTeamWentSet = tricks + tricksNeeded > 6; // They were set
          teamContinuesStreak = otherTeamWentSet;
        } else {
          // Other team folded/negotiated - they succeeded, so this team's streak breaks
          teamContinuesStreak = false;
        }
      }
      
      if (teamContinuesStreak) {
        currentStreak++;
      } else {
        streaks.push(currentStreak);
        currentStreak = 0;
      }
    } catch (e) {
      console.error('Error processing hand for streak:', hand, e);
    }
  });
  
  // Add the final streak
  streaks.push(currentStreak);
  
  const longestStreak = Math.max(...streaks);
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
    // Skip incomplete hands
    if (!isHandComplete(hand)) {
      return;
    }
    
    // Skip throw-in hands
    if (hand.length >= 2 && hand[1] === '0') {
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
        
        // For MVP calculation: add the actual points this player's team scored on their bid
        playerStat.netPoints += bidderPoints;
        playerStat.pointsPerBid.push(bidderPoints);
        
        // Update scoring stats
        if (decision === 'P') {
          // Map bid to required tricks for bidding team
          const bidValueMap: {[key: string]: number} = {
            'P': 4,  // Pepper
            '4': 4,
            '5': 5,
            '6': 6,
            'M': 6,  // Moon requires all 6 tricks
            'D': 6   // Double Moon requires all 6 tricks
          };
          const tricksNeeded = bidValueMap[bid as string] || parseInt(bid as string) || 4;
          
          // Bidding team gets (6 - tricks) tricks
          // Special case: tricks = 0 means defending team got 0, so bidding team got all 6
          const biddingTeamTricks = 6 - tricks;
          const bidSucceeded = biddingTeamTricks >= tricksNeeded;
          console.log(`  ${bidderName} bid ${bid}, tricks ${tricks}, tricksNeeded ${tricksNeeded}, bidSucceeded ${bidSucceeded}`);
          
          if (bidSucceeded) {
            // Bid was successful
            playerStat.bidsSucceeded++;
            
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
            
            // Track Big Fours: 4-bids where opponents played and got zero (excludes clubs)
            if ((bid === 4 || bid === 'P') && trump !== 'C' && tricks === 0) {
              playerStat.bigFours++;
              console.log(`  ${bidderName} achieved a Big Four! Trump: ${trump}, Tricks: ${tricks}`);
            }
          } else {
            // Bid failed
            playerStat.bidsFailed++;
            playerStat.failedBidValues.push(bidValue);
          }
        } else if (decision === 'F') {
          // Folded hands still count as succeeded bids
          playerStat.bidsSucceeded++;
          
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
            const bidSucceeded = tricks === 0 ? true : tricks + tricksNeeded <= 6; // Special case: tricks = 0 means defending team set (bidding team succeeds)
            
            if (bidSucceeded) {
              bidderTeamStat.successfulBids++;
              
              if (bid && ['6', 'M', 'D'].includes(bid.toString())) {
                bidderTeamStat.highValueBids.successes++;
              }
            }
            
            // Track if defenders successfully set the bidders
            if (!bidSucceeded) {
              defenderTeamStat.successfulDefenses++;
              console.log(`  ${defenderTeamName} successfully defended against ${bidderName} (set)`);
              
              // For pepper round tracking
              if (inPepperRound) {
                // Check all players on defending team for opponent set counting
                players.forEach((defenderName, idx) => {
                  if (idx % 2 === defenderTeam) {
                    const defenderStat = awardData.playerStats[defenderName];
                    if (defenderStat) {
                      defenderStat.pepperRoundBids.opponents_set++;
                    }
                  }
                });
              }
            } else {
              console.log(`  ${defenderTeamName} failed to defend against ${bidderName} (bidder succeeded)`);
            }
            
            defenderTeamStat.totalDefenses++;
            console.log(`  ${defenderTeamName} totalDefenses: ${defenderTeamStat.totalDefenses}, successfulDefenses: ${defenderTeamStat.successfulDefenses}`);
            
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
        teamStat.comebackAchieved = true;
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
      
      if (!hand || !isHandComplete(hand) || 
          (hand.length >= 2 && hand[1] === '0')) {
        continue; // Skip incomplete or throw-in hands
      }
      
      const [team1Score, team2Score] = calculateScore(hand);
      runningScore[0] += team1Score;
      runningScore[1] += team2Score;
      
      // Check if this bid pushed the WINNING team over 42 AND they actually won
      console.log(`Hand ${i+1}: running score = ${runningScore}, winner = ${winnerIndex}`);
      
      // Only check hands where the WINNING team reached 42+
      if (typeof winnerIndex === 'number' && winnerIndex >= 0 && winnerIndex < runningScore.length) {
        const winnerCurrentScore = runningScore[winnerIndex];
        const winnerPrevScore = winnerIndex === 0 ? 
          runningScore[0] - team1Score : 
          runningScore[1] - team2Score;
        
        // This is the winning hand if:
        // 1. The winning team is now at 42+ AND
        // 2. They were below 42 before this hand AND  
        // 3. They actually won the game (score difference check)
        const isWinningScore = winnerCurrentScore >= 42;
        const isFirstTimeOver42 = winnerPrevScore < 42;
        const actuallyWonGame = runningScore[winnerIndex] > runningScore[1 - winnerIndex];
        
        if (isWinningScore && isFirstTimeOver42 && actuallyWonGame) {
          // This was the winning hand - find who made the bid that caused this
          const { bidWinner } = decodeHand(hand);
          
          // Safety checks for array bounds and valid indices
          if (bidWinner < 1 || bidWinner > players.length) {
            console.error(`Invalid bidWinner index: ${bidWinner}`);
            break;
          }
          
          const bidderName = players[bidWinner - 1];
          const bidderTeam = (bidWinner - 1) % 2;
          
          if (bidderName && bidderName in awardData.playerStats) {
            const playerStat = awardData.playerStats[bidderName];
            
            // CRITICAL: Only award clutch player if the bidder is on the WINNING team
            if (playerStat && bidderTeam === winnerIndex) {
              const winnerTeamScore = winnerIndex === 0 ? team1Score : team2Score;
              
              // The bidder gets clutch player only if their team gained positive points
              // (meaning they succeeded in their bid or negotiated successfully)
              if (winnerTeamScore > 0) {
                console.log(`Player ${bidderName} made the clutch winning bid! Team ${winnerIndex} gained ${winnerTeamScore} points.`);
                playerStat.wonFinalBid = true;
              } else {
                console.log(`Player ${bidderName} made a bid but their team won due to opponent failure, not clutch performance.`);
              }
            } else {
              console.log(`Player ${bidderName} made the final bid but is NOT on winning team ${winnerIndex}. Bidder team: ${bidderTeam}`);
            }
          }
          break;
        }
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

/**
 * Aggregate award data across all completed games in a series plus the current game
 * This is essential for series awards to properly calculate statistics across multiple games
 */
export function aggregateSeriesAwardData(
  completedGames: Array<{hands: string[], winner: number, finalScores: [number, number]}>,
  currentGameHands: string[],
  players: string[],
  teams: string[],
  seriesWinner: number | null
): AwardTrackingData {
  // Initialize aggregated award tracking data
  const aggregatedData = initializeAwardTracking(players, teams);
  
  // Aggregate hands from all completed games plus current game
  const allHands: string[] = [];
  
  // Add hands from all completed games
  completedGames.forEach(game => {
    allHands.push(...game.hands);
  });
  
  // Add current game hands
  allHands.push(...currentGameHands);
  
  // Store all hands for reference
  aggregatedData.hands = allHands;
  
  // Running series-wide tracking
  const seriesScores: [number, number] = [0, 0];
  
  // Process each completed game + current game
  const allGames = [...completedGames];
  if (currentGameHands.length > 0) {
    // Add current game data
    const currentScores = [0, 0] as [number, number];
    currentGameHands.forEach(hand => {
      if (isHandComplete(hand) && hand.length >= 2 && hand[1] !== '0') {
        const [s1, s2] = calculateScore(hand);
        currentScores[0] += s1;
        currentScores[1] += s2;
      }
    });
    
    allGames.push({
      hands: currentGameHands,
      winner: seriesWinner || 0, // Use series winner as placeholder for current game
      finalScores: currentScores
    });
  }
  
  // Process each game
  allGames.forEach((game) => {
    const gameStartScores: [number, number] = [...seriesScores];
    
    // Process each hand in this game
    game.hands.forEach((hand, handIndex) => {
      if (!isHandComplete(hand) || (hand.length >= 2 && hand[1] === '0')) {
        return; // Skip incomplete or throw-in hands
      }
      
      try {
        const { bidWinner, bid, trump, decision, tricks } = decodeHand(hand);
        const bidderIndex = bidWinner - 1;
        const bidderName = players[bidderIndex];
        const bidderTeam = bidderIndex % 2;
        const defenderTeam = 1 - bidderTeam;
        const bidderTeamName = teams[bidderTeam];
        const defenderTeamName = teams[defenderTeam];
        const inPepperRound = isPepperRound(handIndex); // Pepper round is per-game, not series-wide
        
        // Calculate hand scores
        const [scoreTeam1, scoreTeam2] = calculateScore(hand);
        const handScores: [number, number] = [scoreTeam1, scoreTeam2];
        aggregatedData.handScores.push(handScores);
        
        // Convert bid to point value
        const bidValue = {
          'P': 4, '4': 4, '5': 5, '6': 6, 'M': 7, 'D': 14
        }[bid] || 0;
        
        // Update player stats (accumulate across all games)
        const playerStat = aggregatedData.playerStats[bidderName];
        if (playerStat) {
          playerStat.bidsWon++;
          
          // Track trump usage
          if (trump && playerStat.trumpBids[trump]) {
            playerStat.trumpBids[trump].attempts++;
          }
          
          // Track high-value bids
          if (['6', 'M', 'D'].includes(bid.toString())) {
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
          
          // Calculate bidder points and add to NET POINTS (this is key for Series MVP)
          const bidderPoints = bidderTeam === 0 ? scoreTeam1 : scoreTeam2;
          playerStat.netPoints += bidderPoints; // Accumulate across all games!
          playerStat.pointsPerBid.push(bidderPoints);
          
          // Determine bid success
          if (decision === 'P') {
            const tricksNeeded = (['M', 'D', '6'].includes(String(bid))) ? 6 : (parseInt(String(bid)) || 4);
            const biddingTeamTricks = 6 - tricks;
            const bidSucceeded = biddingTeamTricks >= tricksNeeded;
            
            if (bidSucceeded) {
              playerStat.bidsSucceeded++;
              
              // Track successes
              if (trump && playerStat.trumpBids[trump]) {
                playerStat.trumpBids[trump].successes++;
              }
              if (['6', 'M', 'D'].includes(bid.toString())) {
                playerStat.highValueBids.successes++;
              }
              if (trump === 'N') {
                playerStat.noTrumpBids.successes++;
              }
              if (inPepperRound) {
                playerStat.pepperRoundBids.successes++;
              }
              
              // Track Big Fours
              if ((bid === 4 || bid === 'P') && trump !== 'C' && tricks === 0) {
                playerStat.bigFours++;
              }
            } else {
              playerStat.bidsFailed++;
              playerStat.failedBidValues.push(bidValue);
            }
          } else if (decision === 'F') {
            // Folded hands count as succeeded
            playerStat.bidsSucceeded++;
            
            if (trump && playerStat.trumpBids[trump]) {
              playerStat.trumpBids[trump].successes++;
            }
            if (['6', 'M', 'D'].includes(bid.toString())) {
              playerStat.highValueBids.successes++;
            }
            if (trump === 'N') {
              playerStat.noTrumpBids.successes++;
            }
            if (inPepperRound) {
              playerStat.pepperRoundBids.successes++;
            }
          }
        }
        
        // Update team stats (accumulate across all games)
        const bidderTeamStat = aggregatedData.teamStats[bidderTeamName];
        const defenderTeamStat = aggregatedData.teamStats[defenderTeamName];
        
        if (bidderTeamStat && defenderTeamStat) {
          bidderTeamStat.totalBids++;
          
          if (['6', 'M', 'D'].includes(bid.toString())) {
            bidderTeamStat.highValueBids.attempts++;
          }
          
          if (decision === 'P') {
            const tricksNeeded = (['M', 'D', '6'].includes(String(bid))) ? 6 : (parseInt(String(bid)) || 4);
            const bidSucceeded = tricks === 0 ? true : tricks + tricksNeeded <= 6;
            
            if (bidSucceeded) {
              bidderTeamStat.successfulBids++;
              if (['6', 'M', 'D'].includes(bid.toString())) {
                bidderTeamStat.highValueBids.successes++;
              }
            }
            
            // Track defensive success
            if (!bidSucceeded) {
              defenderTeamStat.successfulDefenses++;
              
              // Track pepper round opponents_set
              if (inPepperRound) {
                players.forEach((defenderName, idx) => {
                  if (idx % 2 === defenderTeam) {
                    const defenderStat = aggregatedData.playerStats[defenderName];
                    if (defenderStat) {
                      defenderStat.pepperRoundBids.opponents_set++;
                    }
                  }
                });
              }
            }
            
            defenderTeamStat.totalDefenses++;
            const bidderPoints = bidderTeam === 0 ? scoreTeam1 : scoreTeam2;
            defenderTeamStat.pointsAllowedToOpponents += Math.max(0, bidderPoints);
          } else if (decision === 'F') {
            bidderTeamStat.successfulBids++;
            if (['6', 'M', 'D'].includes(bid.toString())) {
              bidderTeamStat.highValueBids.successes++;
            }
            
            if (tricks > 0) {
              defenderTeamStat.successfulDefenses++;
            }
            defenderTeamStat.totalDefenses++;
          }
        }
        
        // Update running scores
        seriesScores[0] += handScores[0];
        seriesScores[1] += handScores[1];
        aggregatedData.pointsHistory.push([...seriesScores]);
        
        // Track team deficits across entire series
        const team0Deficit = seriesScores[1] - seriesScores[0];
        const team1Deficit = seriesScores[0] - seriesScores[1];
        
        const team0Stats = aggregatedData.teamStats[teams[0]];
        if (team0Stats && team0Deficit > team0Stats.maxDeficit) {
          team0Stats.maxDeficit = team0Deficit;
          team0Stats.minScoreTrailing = seriesScores[0];
        }
        
        const team1Stats = aggregatedData.teamStats[teams[1]];
        if (team1Stats && team1Deficit > team1Stats.maxDeficit) {
          team1Stats.maxDeficit = team1Deficit;
          team1Stats.minScoreTrailing = seriesScores[1];
        }
        
      } catch (e) {
        console.error('Error processing hand for series awards:', hand, e);
      }
    });
    
    // Update game-end scores for this game
    seriesScores[0] = gameStartScores[0];
    seriesScores[1] = gameStartScores[1];
    
    // Add final scores from this game
    seriesScores[0] += game.finalScores[0];
    seriesScores[1] += game.finalScores[1];
  });
  
  // Calculate final team stats (streaks and success rates)
  teams.forEach((team, teamIndex) => {
    const teamStat = aggregatedData.teamStats[team];
    
    if (teamStat) {
      // Calculate longest streak across entire series
      teamStat.longestStreak = calculateLongestStreak(allHands, teamIndex);
      
      // Calculate defense and bid success rates
      if (teamStat.totalDefenses > 0) {
        teamStat.defensiveSuccessRate = teamStat.successfulDefenses / teamStat.totalDefenses;
      }
      
      if (teamStat.totalBids > 0) {
        teamStat.bidSuccessRate = teamStat.successfulBids / teamStat.totalBids;
      }
      
      // Check for comeback achievement (across entire series)
      if (seriesWinner === teamIndex && teamStat.maxDeficit >= 30) {
        teamStat.comebackAchieved = true;
      }
    }
  });
  
  // Set series completion data
  aggregatedData.winningTeam = seriesWinner;
  aggregatedData.winningTeamName = seriesWinner !== null ? teams[seriesWinner] : '';
  aggregatedData.gameCompleted = true;
  
  console.log('Series award data aggregated:', {
    totalHands: allHands.length,
    games: allGames.length,
    seriesWinner,
    playerNetPoints: Object.fromEntries(
      Object.entries(aggregatedData.playerStats).map(([name, stats]) => [name, stats.netPoints])
    )
  });
  
  return aggregatedData;
}

// Function to generate game statistics HTML
export function generateStatisticsHTML(
  hands: string[], 
  players: string[], 
  teams: string[], 
  scores: [number, number], 
  winnerIndex: number
): string {
  // Validate input data
  if (!hands || hands.length === 0) {
    return '<div class="bg-white rounded-lg shadow-sm p-6"><p class="text-gray-500">No completed hands to display statistics.</p></div>';
  }
  
  if (!teams || teams.length < 2) {
    return '<div class="bg-white rounded-lg shadow-sm p-6"><p class="text-gray-500">Invalid team data.</p></div>';
  }
  
  if (winnerIndex < 0 || winnerIndex >= teams.length) {
    return '<div class="bg-white rounded-lg shadow-sm p-6"><p class="text-gray-500">Invalid winner data.</p></div>';
  }

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
            
            // Ensure bars with count > 0 have some visible height and validate bounds
            if (count > 0 && barHeight < 4) barHeight = 4;
            if (barHeight > 128) barHeight = 128; // Cap maximum height
            if (barHeight < 0) barHeight = 0; // Ensure non-negative
            
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
