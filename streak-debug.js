// Debug script to test streak calculations with the actual game data
// This needs to be run in a browser console or with proper module imports

console.log('=== STREAK CALCULATION DEBUG ===');

// Test data based on screenshot - need to reverse engineer the hand encodings
// Format: dealer, bidWinner, bid, trump, decision, tricks

// Approximate hand encodings based on visible results:
const testHands = [
  '124DP3', // Hand 1: Gina bids 4♦, played, 3 tricks 
  '235HF2', // Hand 2: Bill bids 4♥, folded, 2 tricks  
  '343SP0', // Hand 3: Susie bids 4♠, played, 0 tricks (defensive set)
  '414HP1', // Hand 4: Lisa bids 4♥, played, 1 trick
  '125NP4', // Hand 5: Bill bids 5 no-trump, played, 4 tricks
  '236SP2', // Hand 6: Susie bids 5♠, played, 2 tricks
  '347HP0', // Hand 7: Susie bids 5♥, played, 0 tricks (defensive set)
  '448HP6', // Hand 8: Susie bids 6♥, played, 6 tricks (bidder set)
  '139NP6', // Hand 9: Bill bids no-trump ♥, played, 6 tricks (bidder set)
  '2410HP6', // Hand 10: Susie bids 6♥, played, 6 tricks (bidder set)
  '3411SP1'  // Hand 11: Bill bids 4♠, played, 1 trick
];

console.log('Testing with hand data:', testHands);

// Player mapping: 1=Lisa, 2=Gina, 3=Bill, 4=Susie
// Team mapping: Team 0 (Bloppo) = Lisa(1), Bill(3); Team 1 (Buttsy) = Gina(2), Susie(4)

// Manual streak calculation for Team 0 (Bloppo)
console.log('\n=== TEAM 0 (BLOPPO) STREAK ANALYSIS ===');
let team0Streak = 0;
let team0LongestStreak = 0;

testHands.forEach((hand, index) => {
  const dealer = parseInt(hand[0]);
  const bidWinner = parseInt(hand[1]);
  const bidderTeam = (bidWinner - 1) % 2;
  
  console.log(`Hand ${index + 1}: dealer=${dealer}, bidWinner=${bidWinner}, bidderTeam=${bidderTeam}`);
  
  // Check if Team 0 won points
  let team0WonPoints = false;
  
  if (bidderTeam === 0) {
    // Team 0 was bidding - did they succeed?
    // This requires calculating if they were set or not
    console.log('  Team 0 was bidding');
  } else {
    // Team 0 was defending - did they get points?
    console.log('  Team 0 was defending');
  }
  
  if (team0WonPoints) {
    team0Streak++;
    team0LongestStreak = Math.max(team0LongestStreak, team0Streak);
    console.log(`  Team 0 won points - streak now ${team0Streak}`);
  } else {
    team0Streak = 0;
    console.log('  Team 0 did not win points - streak reset');
  }
});

console.log(`Team 0 longest streak: ${team0LongestStreak}`);

// This script would need actual imports to work properly, but shows the debugging approach