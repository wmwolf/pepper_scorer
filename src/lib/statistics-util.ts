// src/lib/statistics-util.ts
import { decodeHand } from './gameState';

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

export function calculateGameStats(
  hands: string[], 
  players: string[]
): GameStats {
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
      const bidderTeam = (bidWinner - 1) % 2;
      const defenderTeam = 1 - bidderTeam;
      
      // Track trump suits
      if (trump) {
        stats.trumpCounts[trump]++;
      }
      
      // Convert bid to point value
      const bidValue = {
        'P': 4,
        '4': 4,
        '5': 5,
        '6': 6,
        'M': 7,
        'D': 14
      }[bid] || 0;
      
      // Check for highest bid
      if (bidValue > stats.highestBid.points) {
        stats.highestBid = { 
          value: bid, 
          player: bidderName, 
          points: bidValue 
        };
      }
      
      // Calculate points
      if (decision === 'P') { // Played hand
        const tricksNeeded = ['M', 'D', '6'].includes(bid) ? 6 : parseInt(bid as string);
        
        if (tricks === 0) {
          // Defending team set
          stats.defensiveWins++;
        } else if (tricks + tricksNeeded > 6) {
          // Bidding team set
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
    
    // For throw-in hands, no points are scored
    if (hand.length >= 2 && hand[1] === '0') {
      return;
    }
    
    try {
      const { bidWinner, bid, tricks } = decodeHand(hand);
      const bidderTeam = (bidWinner - 1) % 2;
      
      // Check if this team won points on this hand
      let teamWonPoints = false;
      
      if (teamIndex === bidderTeam) {
        // This is the bidding team
        // They win points if they don't go set
        if (hand.length === 6) {
          const tricksNeeded = ['M', 'D', '6'].includes(bid) ? 6 : parseInt(bid as string);
          teamWonPoints = tricks + tricksNeeded <= 6;
        }
      } else {
        // This is the defending team
        // They win points if they take tricks or set the bidding team
        if (hand.length === 6) {
          teamWonPoints = tricks > 0;
        }
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
                  `${trumpNames[gameStats.mostCommonTrump.suit]} (${gameStats.mostCommonTrump.count})` : 
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
            const suitSymbol = suit === 'C' ? '♣️' : 
                             suit === 'D' ? '♦️' : 
                             suit === 'H' ? '♥️' : 
                             suit === 'S' ? '♠️' : 
                             '∅';
            
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
