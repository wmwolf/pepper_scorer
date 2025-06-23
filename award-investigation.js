// Award and Statistics Investigation Test Suite
// This file systematically tests the awards and statistics calculations

// Import the core functions we need to test
import { decodeHand, calculateScore } from './src/lib/gameState.js';
import { trackAwardData, calculateGameStats, calculateLongestStreak } from './src/lib/statistics-util.js';
import { selectGameAwards, selectSeriesAwards } from './src/lib/pepper-awards.js';

// Test data setup
const testPlayers = ['Alice', 'Bob', 'Charlie', 'Diana'];
const testTeams = ['Team A', 'Team B'];

console.log('=== PEPPER SCORER AWARD INVESTIGATION ===\n');

// ===== PHASE 1.1: HAND ENCODING/DECODING VERIFICATION =====
console.log('PHASE 1.1: Testing Hand Encoding/Decoding Functions');
console.log('=' .repeat(50));

function testHandDecoding() {
    const testHands = [
        // Format: dealer, bidWinner, bid, trump, decision, tricks
        '124CP0',  // Player 2 bids 4 clubs, plays, 0 tricks (set defenders)
        '124CP3',  // Player 2 bids 4 clubs, plays, 3 tricks (normal scoring)
        '125HF2',  // Player 2 bids 5 hearts, folds, 2 free tricks
        '136NP1',  // Player 3 bids 6 no-trump, plays, 1 trick (bidders set)
        '14MDP0',  // Player 4 bids Moon diamonds, plays, 0 tricks (set defenders)
        '1200',    // Throw-in hand (no one bid)
        '14PCP3'   // Pepper round: Player 4 bids pepper clubs, plays, 3 tricks
    ];

    testHands.forEach((hand, index) => {
        console.log(`\nTest Hand ${index + 1}: "${hand}"`);
        try {
            if (hand.length >= 3 && hand[1] === '0') {
                console.log('  → Throw-in hand detected');
                return;
            }
            
            const decoded = decodeHand(hand);
            console.log(`  → Decoded: dealer=${decoded.dealer}, bidWinner=${decoded.bidWinner}, bid=${decoded.bid}, trump=${decoded.trump}, decision=${decoded.decision}, tricks=${decoded.tricks}`);
            
            const scores = calculateScore(hand);
            console.log(`  → Scores: Team 1: ${scores[0]}, Team 2: ${scores[1]}`);
            
            // Verify the logic
            const bidderTeam = (decoded.bidWinner - 1) % 2;
            console.log(`  → Bidder team: ${bidderTeam} (${testTeams[bidderTeam]})`);
            
        } catch (error) {
            console.log(`  → ERROR: ${error.message}`);
        }
    });
}

// ===== PHASE 1.2: AWARD DATA COLLECTION VALIDATION =====
console.log('\n\nPHASE 1.2: Testing Award Data Collection');
console.log('=' .repeat(50));

function testAwardDataCollection() {
    // Create a sample game with known outcomes
    const sampleGame = [
        '124CP3',  // Hand 1: Player 2 bids 4 clubs, plays, 3 tricks → Team B: 4, Team A: 3
        '234HP2',  // Hand 2: Player 3 bids 4 hearts, plays, 2 tricks → Team A: 4, Team B: 2  
        '345NP1',  // Hand 3: Player 4 bids 5 no-trump, plays, 1 trick → Team B: 5, Team A: 1
        '416SF0',  // Hand 4: Player 1 bids 6 spades, folds, 0 tricks → Team A: 6, Team B: 0
        '125DP0',  // Hand 5: Player 2 bids 5 diamonds, plays, 0 tricks → Team B: 5, Team A: -5 (set)
        '136MP4'   // Hand 6: Player 3 bids moon spades, plays, 4 tricks → Team A: -7, Team B: 7 (bidders set)
    ];
    
    console.log('Sample game hands:', sampleGame);
    
    // Calculate expected final scores manually
    let expectedScores = [0, 0];
    console.log('\nExpected score progression:');
    sampleGame.forEach((hand, index) => {
        const handScores = calculateScore(hand);
        expectedScores[0] += handScores[0];
        expectedScores[1] += handScores[1];
        console.log(`  Hand ${index + 1}: +${handScores[0]}, +${handScores[1]} → Running: [${expectedScores[0]}, ${expectedScores[1]}]`);
    });
    
    console.log(`\nExpected final scores: [${expectedScores[0]}, ${expectedScores[1]}]`);
    
    // Test award data tracking
    const winnerIndex = expectedScores[0] > expectedScores[1] ? 0 : 1;
    console.log(`Expected winner: Team ${winnerIndex} (${testTeams[winnerIndex]})`);
    
    try {
        const awardData = trackAwardData(sampleGame, testPlayers, testTeams, expectedScores, winnerIndex);
        
        console.log('\nPlayer Statistics:');
        Object.entries(awardData.playerStats).forEach(([name, stats]) => {
            console.log(`  ${name} (Team ${stats.team}):`);
            console.log(`    - Bids Won: ${stats.bidsWon}`);
            console.log(`    - Bids Succeeded: ${stats.bidsSucceeded}`); 
            console.log(`    - Bids Failed: ${stats.bidsFailed}`);
            console.log(`    - Net Points: ${stats.netPoints}`);
            console.log(`    - Won Final Bid: ${stats.wonFinalBid}`);
            console.log(`    - Trump Bids:`, stats.trumpBids);
            console.log(`    - High Value Bids: ${stats.highValueBids.attempts}/${stats.highValueBids.successes}`);
        });
        
        console.log('\nTeam Statistics:');
        Object.entries(awardData.teamStats).forEach(([name, stats]) => {
            console.log(`  ${name}:`);
            console.log(`    - Total Bids: ${stats.totalBids}`);
            console.log(`    - Successful Bids: ${stats.successfulBids}`);
            console.log(`    - Bid Success Rate: ${stats.bidSuccessRate.toFixed(2)}`);
            console.log(`    - Total Defenses: ${stats.totalDefenses}`);
            console.log(`    - Successful Defenses: ${stats.successfulDefenses}`);
            console.log(`    - Defensive Success Rate: ${stats.defensiveSuccessRate.toFixed(2)}`);
            console.log(`    - Longest Streak: ${stats.longestStreak}`);
            console.log(`    - Max Deficit: ${stats.maxDeficit}`);
            console.log(`    - Comeback Achieved: ${stats.comebackAchieved}`);
        });
        
    } catch (error) {
        console.log(`ERROR in award data tracking: ${error.message}`);
        console.log(error.stack);
    }
}

// ===== PHASE 1.3: GAME STATE HISTORY AND STREAK CALCULATIONS =====
console.log('\n\nPHASE 1.3: Testing Game State History and Streaks');
console.log('=' .repeat(50));

function testStreakCalculations() {
    // Test streak calculation with known patterns
    const streakTestHands = [
        '124CP3',  // Team B wins
        '234HP4',  // Team A wins  
        '345CP2',  // Team B wins
        '416SP1',  // Team B wins
        '125DP0',  // Team B wins (set defenders)
        '136NP5'   // Team A wins (set bidders)
    ];
    
    console.log('Testing streak calculations with hands:', streakTestHands);
    
    // Calculate manually what streaks should be
    console.log('\nManual streak analysis:');
    streakTestHands.forEach((hand, index) => {
        const decoded = decodeHand(hand);
        const scores = calculateScore(hand);
        const bidderTeam = (decoded.bidWinner - 1) % 2;
        
        console.log(`Hand ${index + 1}: Bidder Team ${bidderTeam}, Scores: [${scores[0]}, ${scores[1]}]`);
        
        // Determine who won points
        if (bidderTeam === 0) {
            // Team 0 bid
            if (scores[0] > 0) {
                console.log('  → Team 0 won points (successful bid)');
            } else {
                console.log('  → Team 1 won points (set the bidders)');
            }
        } else {
            // Team 1 bid  
            if (scores[1] > 0) {
                console.log('  → Team 1 won points (successful bid)');
            } else {
                console.log('  → Team 0 won points (set the bidders)');
            }
        }
    });
    
    const team0Streak = calculateLongestStreak(streakTestHands, 0);
    const team1Streak = calculateLongestStreak(streakTestHands, 1);
    
    console.log(`\nCalculated streaks: Team 0: ${team0Streak}, Team 1: ${team1Streak}`);
}

// ===== PHASE 2: AWARD EVALUATION TESTING =====
console.log('\n\nPHASE 2: Testing Award Evaluation Logic');
console.log('=' .repeat(50));

function testAwardEvaluation() {
    // Create a game designed to trigger specific awards
    const awardTestGame = [
        // Pepper rounds
        '124CP3',  // Alice bids pepper clubs, succeeds
        '235HP2',  // Bob bids 5 hearts, succeeds  
        '346NP1',  // Charlie bids 6 no-trump, succeeds
        '14MDP0',  // Diana bids moon diamonds, sets defenders
        
        // Regular rounds
        '245SF2',  // Bob bids 5 spades, folds with 2 tricks (negotiation)
        '356NP4',  // Charlie bids 6 no-trump, sets bidders (overreaching)
        '146CP3',  // Diana bids 6 clubs, succeeds
        '125NP5',  // Alice bids 5 no-trump, sets bidders (false confidence)
        '236DF3',  // Bob bids 6 diamonds, folds with 3 tricks
        '344CP2'   // Charlie bids 4 clubs, succeeds - winning bid
    ];
    
    console.log('Award test game hands:', awardTestGame);
    
    // Calculate final scores
    let finalScores = [0, 0];
    awardTestGame.forEach(hand => {
        const handScores = calculateScore(hand);
        finalScores[0] += handScores[0];
        finalScores[1] += handScores[1];
    });
    
    console.log('Final scores:', finalScores);
    const winnerIndex = finalScores[0] > finalScores[1] ? 0 : 1;
    console.log('Winner:', testTeams[winnerIndex]);
    
    try {
        const awardData = trackAwardData(awardTestGame, testPlayers, testTeams, finalScores, winnerIndex);
        const gameAwards = selectGameAwards(awardData);
        
        console.log('\nSelected Game Awards:');
        gameAwards.forEach((award, index) => {
            console.log(`${index + 1}. ${award.name} (${award.type}): ${award.winner}`);
            console.log(`   Description: ${award.description}`);
            console.log(`   Criteria: ${award.technicalDefinition}`);
        });
        
        // Test specific award conditions
        console.log('\nDetailed Award Analysis:');
        
        // Check for Trump Master candidates
        console.log('\nTrump Master Analysis:');
        Object.entries(awardData.playerStats).forEach(([name, stats]) => {
            const suitedBids = Object.entries(stats.trumpBids)
                .filter(([suit]) => suit !== 'N')
                .reduce((total, [, data]) => total + data.attempts, 0);
            
            if (suitedBids >= 3) {
                const suitedSuccesses = Object.entries(stats.trumpBids)
                    .filter(([suit]) => suit !== 'N')
                    .reduce((total, [, data]) => total + data.successes, 0);
                const successRate = suitedSuccesses / suitedBids;
                console.log(`  ${name}: ${suitedSuccesses}/${suitedBids} suited trump bids (${(successRate * 100).toFixed(1)}%)`);
            }
        });
        
        // Check for False Confidence candidates
        console.log('\nFalse Confidence Analysis:');
        Object.entries(awardData.playerStats).forEach(([name, stats]) => {
            const noTrumpFailed = stats.trumpBids['N'].attempts - stats.trumpBids['N'].successes;
            if (noTrumpFailed > 0) {
                console.log(`  ${name}: ${noTrumpFailed} failed no-trump bids`);
            }
        });
        
        // Check for Bid Specialists
        console.log('\nBid Specialists Analysis:');
        Object.entries(awardData.teamStats).forEach(([name, stats]) => {
            if (stats.totalBids >= 4) {
                console.log(`  ${name}: ${stats.successfulBids}/${stats.totalBids} bids (${(stats.bidSuccessRate * 100).toFixed(1)}% success rate)`);
            }
        });
        
    } catch (error) {
        console.log(`ERROR in award evaluation: ${error.message}`);
        console.log(error.stack);
    }
}

// ===== MAIN EXECUTION =====
console.log('Starting investigation...\n');

try {
    testHandDecoding();
    testAwardDataCollection();
    testStreakCalculations();
    testAwardEvaluation();
    
    console.log('\n\n=== INVESTIGATION COMPLETE ===');
    console.log('Check the output above for any errors or unexpected behavior.');
    
} catch (error) {
    console.log(`CRITICAL ERROR: ${error.message}`);
    console.log(error.stack);
}