// src/lib/game.ts

import { GameManager, getCurrentPhase, isPepperRound, calculateScore } from './gameState';
import { getPath } from './path-utils';
export function loadGameState() {
    // Check for debug game first
    const debugGame = localStorage.getItem('debugGame');
    if (debugGame) {
        localStorage.removeItem('debugGame'); // Use once
        console.log('🔧 Loading debug game...');
        const debugData = JSON.parse(debugGame);
        
        // Create a new GameManager and reconstruct the game state properly
        const gameManager = new GameManager(debugData.players, debugData.teams);
        
        // Add each hand one by one to properly calculate scores and maintain state consistency
        debugData.hands.forEach((hand: string) => {
            // For complete hands, add all parts at once
            if (hand.length >= 6 || hand[1] === '0') {
                gameManager.state.hands.push(hand);
            } else {
                // For incomplete hands, just set as the current hand
                gameManager.state.hands.push(hand);
            }
        });
        
        // Recalculate scores from scratch
        gameManager.state.scores = gameManager.getScores();
        
        // Mark as complete if it qualifies and trigger completion logic
        if (gameManager.isGameComplete()) {
            gameManager.completeGame();
        }
        
        console.log('🔧 Debug game state reconstructed:', gameManager.state);
        return gameManager.state;
    }
    
    // Original logic for normal games
    const storedGame = localStorage.getItem('currentGame');
    if (!storedGame) {
        window.location.href = getPath(''); // Redirect to home
        return null;
    }
    return JSON.parse(storedGame);
}

// UI functions
function bidToString(bid: string) {
    switch (bid) {
        case 'P': return '4';
        case '4': return '4';
        case '5': return '5';
        case '6': return '6';
        case 'M': return '🌙';
        case 'D': return '🌙🌙';
        default: return bid;
    }
}

function trumpToString(trump: string): string {
    switch (trump) {
      case 'C': return '♣️';
      case 'D': return '♦️';
      case 'S': return '♠️';
      case 'H': return '♥️';
      case 'N': return '∅';
      default: return trump;
    }
  }

function hideAllControls() {
    ['player-controls', 'bid-controls', 'trump-controls', 
     'decision-controls', 'tricks-controls', 'end-game-controls'].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.classList.add('hidden');
    });
}

function updateInstructions(text: string) {
    const element = document.getElementById('game-instruction');
    if (element) element.textContent = text;
}

function updateHandInfo(gameManager: GameManager) {
    const currentHand = gameManager.getCurrentHand();
    const handIndex = gameManager.state.hands.length - 1;
    const handNumber = handIndex + 1;
    
    // Basic hand info elements
    const handInfoEl = document.getElementById('hand-info');
    const handInfoMobileEl = document.getElementById('hand-info-mobile');
    const bidInfoEl = document.getElementById('bid-info');
    const bidInfoMobileEl = document.getElementById('bid-info-mobile');
    
    // Only update if at least one element exists
    if (!handInfoEl && !handInfoMobileEl && !bidInfoEl && !bidInfoMobileEl) return;
    
    // Get current dealer
    const dealerIndex = parseInt(currentHand[0] || '1') - 1;
    const dealer = gameManager.state.players[dealerIndex];
    
    // Hand number and dealer info
    const handInfoText = `Hand ${handNumber}: ${dealer} is dealer`;
    if (handInfoEl) handInfoEl.textContent = handInfoText;
    if (handInfoMobileEl) handInfoMobileEl.textContent = handInfoText;
    
    // Bid info text depends on phase
    const phase = getCurrentPhase(currentHand);
    let bidInfoText = "Waiting for bid";
    
    if (phase === 'bidder') {
        const nextPlayerIndex = (dealerIndex + 1) % 4;
        const nextPlayer = gameManager.state.players[nextPlayerIndex];
        
        if (isPepperRound(handIndex)) {
            bidInfoText = `${nextPlayer} has first bid (pepper)`;
        } else {
            bidInfoText = `Bidding starts with ${nextPlayer}`;
        }
    } else if (phase === 'bid') {
        const bidderIndex = parseInt(currentHand[1] || '1') - 1;
        const bidder = gameManager.state.players[bidderIndex];
        bidInfoText = `${bidder} won the bid`;
    } else if (phase === 'trump' || phase === 'decision' || phase === 'tricks') {
        const bidderIndex = parseInt(currentHand[1] || '1') - 1;
        const bidder = gameManager.state.players[bidderIndex];
        const bid = currentHand[2] || '';
        const bidText = bidToString(bid);
        
        if (phase === 'trump') {
            bidInfoText = `${bidder} bid ${bidText}`;
        } else {
            const trump = currentHand[3] || '';
            const trumpText = trumpToString(trump);
            bidInfoText = `${bidder} bid ${bidText} in ${trumpText}`;
        }
    }
    
    if (bidInfoEl) bidInfoEl.textContent = bidInfoText;
    if (bidInfoMobileEl) bidInfoMobileEl.textContent = bidInfoText;
}

function showPhaseControls(gameManager: GameManager) {
    const currentHand = gameManager.getCurrentHand();
    const phase = getCurrentPhase(currentHand);
    switch (phase) {
        case 'bidder': {
            const dealerIndex = parseInt(currentHand[0] || '1') - 1;
            const dealer = gameManager.state.players[dealerIndex];

            // Check if we're in pepper round...
            const handIndex = gameManager.state.hands.length - 1;
            if (isPepperRound(handIndex)) {
                const nextPlayer = ((dealerIndex + 1) % 4 + 1).toString();
                gameManager.addHandPart(nextPlayer);
                gameManager.addHandPart('P');
                hideAllControls();
                showPhaseControls(gameManager);
                break;
            }
                    
            // Rearrange player buttons in bidding order
            const container = document.getElementById('player-grid');
            if (container) {
                const buttons = Array.from(container.children);
                const biddingOrder = Array.from({length: 4}, (_, i) => 
                    (dealerIndex + 1 + i) % 4
                );
                        
                // Sort buttons according to bidding order
                buttons.sort((a, b) => {
                    const aElement = a as HTMLElement;
                    const bElement = b as HTMLElement;
                    const aIndex = parseInt(aElement.dataset.player || '1') - 1;
                    const bIndex = parseInt(bElement.dataset.player || '1') - 1;
                    return biddingOrder.indexOf(aIndex) - biddingOrder.indexOf(bIndex);
                });
                        
                // Reattach buttons in new order
                buttons.forEach(button => container.appendChild(button));
            }
                                
            const controls = document.getElementById('player-controls');
            if (controls) controls.classList.remove('hidden');
            updateInstructions(`${dealer} deals. Who won the bid?`);
            break;
        }
        case 'bid': {
            const controls = document.getElementById('bid-controls');
            if (controls) controls.classList.remove('hidden');
            const bidder = gameManager.state.players[parseInt(currentHand[1] || '1') - 1];
            updateInstructions(`What did ${bidder} bid?`);
            break;
        }
        case 'trump': {
            const controls = document.getElementById('trump-controls');
            if (controls) controls.classList.remove('hidden');
            const bidder = gameManager.state.players[parseInt(currentHand[1] || '1') - 1];
            updateInstructions(`${bidder} bid ${bidToString(currentHand[2] || '')}. What's trump?`);
            break;
        }
        case 'decision': {
            // If the bid is clubs, the defenders must play
            if (currentHand[3] === 'C') {
                gameManager.addHandPart('P');
                hideAllControls();
                showPhaseControls(gameManager);
                break;
            }
            const controls = document.getElementById('decision-controls');
            if (controls) controls.classList.remove('hidden');
            // only show the buttons that are valid for the current bid
            // first remove disabled from all buttons
            document.querySelectorAll('.btn-decision').forEach(button => {
                button.classList.remove('hidden');
            });
            const bid = currentHand[2];
            if (bid != '4' && bid != 'P') {
                document.getElementById('btn-pass-2')?.classList.add('hidden');
                if (bid != '5') {
                    document.getElementById('btn-pass-1')?.classList.add('hidden');
                }
            }
            const bidder = gameManager.state.players[parseInt(currentHand[1] || '1') - 1];
            updateInstructions(`${bidder} bid ${bidToString(currentHand[2] || '')} in ${trumpToString(currentHand[3] || '')}. Play or fold?`);
            break;
        }
        case 'tricks': {
            const controls = document.getElementById('tricks-controls');
            if (controls) controls.classList.remove('hidden');
            const bidder = gameManager.state.players[parseInt(currentHand[1] || '1') - 1];
            // If the bid is clubs, the defenders must play
            if (currentHand[3] === 'C') {
                const defendingTeam = gameManager.getDefendingTeamName() || 'Defender';
                updateInstructions(`${bidder} bid ${bidToString(currentHand[2] || '')} in ${trumpToString(currentHand[3] || '')}, so ${defendingTeam} must play. How many tricks did ${defendingTeam} win?`);
            } else {
                const defendingTeam = gameManager.getDefendingTeamName() || 'Defender';
                updateInstructions(`${bidder} bid ${bidToString(currentHand[2] || '')} in ${trumpToString(currentHand[3] || '')}. How many tricks did ${defendingTeam} win?`);
            }
            break;
        }
    }
}

function setupPlayerButtons(gameManager: GameManager, updateUI: () => void) {
    const container = document.getElementById('player-grid');  // Changed to player-grid
    if (!container) return;

    container.innerHTML = '';

    // Get current dealer from the current hand
    const currentHand = gameManager.getCurrentHand();
    const dealerIndex = parseInt(currentHand[0] || '1') - 1;
    
    // Create array of indices in bidding order
    const biddingOrder = Array.from({length: 4}, (_, i) => 
        (dealerIndex + 1 + i) % 4
    );
    
    // Create buttons in bidding order
    biddingOrder.forEach((index) => {
        const player = gameManager.state.players[index];
        const button = document.createElement('button');
        button.className = 'px-4 py-2 bg-blue-100 hover:bg-blue-200 text-blue-800 font-medium rounded-lg transition-colors';
        button.dataset.player = (index + 1).toString();
        button.textContent = player || '';
        button.addEventListener('click', () => {
            gameManager.addHandPart((index + 1).toString());
            updateUI();
        });
        container.appendChild(button);
    });

    // Add "No one" button to parent container
    const noOneButton = document.createElement('button');
    noOneButton.className = 'w-full px-4 py-2 bg-red-100 hover:bg-red-200 text-red-800 font-medium rounded-lg transition-colors';
    noOneButton.dataset.player = '0';
    noOneButton.textContent = 'No one bid - throw in hand';
    noOneButton.addEventListener('click', () => {
        gameManager.addHandPart('0');
        updateUI();
    });

    document.getElementById('player-buttons')?.appendChild(noOneButton);
}

function setupTrumpButtons(gameManager: GameManager, updateUI: () => void) {
    document.querySelectorAll('.btn-trump').forEach(button => {
        button.addEventListener('click', (e) => {
            const button = e.currentTarget as HTMLButtonElement; // Use currentTarget instead of target
            const suit = button.dataset.suit;
            if (suit) {
                gameManager.addHandPart(suit);
                processPepperRound(gameManager, updateUI);
                updateUI();
            }
        });
    });
}

function setupBidButtons(gameManager: GameManager, updateUI: () => void) {
    document.querySelectorAll('.btn-bid').forEach(button => {
        button.addEventListener('click', (e) => {
            const target = e.target as HTMLButtonElement;
            const bid = target.dataset.bid;
            if (bid) {
                gameManager.addHandPart(bid);
                updateUI();
            }
        });
    });
}

function setupDecisionButtons(gameManager: GameManager, updateUI: () => void) {
    document.querySelectorAll('.btn-decision').forEach(button => {
        button.addEventListener('click', (e) => {
            const target = e.target as HTMLButtonElement;
            const decision = target.dataset.decision;
            if (decision) {
                const [action, tricks] = decision.split('');
                // Add the decision (P or F)
                if (action) gameManager.addHandPart(action);
                // If there are free tricks (F1 or F2), add those
                if (tricks) {
                    gameManager.addHandPart(tricks);
                } else if (action === 'F') {
                    gameManager.addHandPart('0'); // Fold with no tricks
                }
                updateUI();
            }
        });
    });
}

function setupTricksButtons(gameManager: GameManager, updateUI: () => void) {
    document.querySelectorAll('.btn-tricks').forEach(button => {
        button.addEventListener('click', (e) => {
            const target = e.target as HTMLButtonElement;
            const tricks = target.dataset.tricks;
            if (tricks) {
                gameManager.addHandPart(tricks);
                updateUI();
            }
        });
    });
}

function setupUndoButton(gameManager: GameManager, updateUI: () => void) {
    const undoButton = document.getElementById('undo-button');
    if (!undoButton) return;
  
    undoButton.addEventListener('click', () => {
      // If we're in the end-game state
      if (gameManager.isGameComplete()) {
        // Check if statistics are visible
        const statsVisible = document.getElementById('game-statistics-container')?.classList.contains('hidden') === false;
        
        // If statistics are showing, just show victory modal instead of undoing
        if (statsVisible) {
          // Hide statistics
          document.getElementById('game-statistics-container')?.classList.add('hidden');
          
          // Hide post-victory controls if present
          const postControls = document.getElementById('post-victory-controls');
          if (postControls) postControls.remove();
          
          // Show victory celebration (which has its own undo button)
          showVictoryCelebration(gameManager);
          return;
        }
        
        // If victory modal is visible, remove it
        const victoryModal = document.getElementById('dynamic-victory-overlay') || 
                          document.getElementById('victory-overlay');
        if (victoryModal) {
          victoryModal.remove();
        }
      }

      // Now perform the actual undo
      gameManager.undo();
      updateUI();
    });
}

function processPepperRound(gameManager: GameManager, updateUI: () => void) {
    const currentHand = gameManager.getCurrentHand();
    const phase = getCurrentPhase(currentHand);
    const handIndex = gameManager.state.hands.length;

    if (isPepperRound(handIndex)) {
        if (phase === 'bidder') {
            const dealer = parseInt(currentHand[0] || '1');
            const nextPlayer = ((dealer % 4) + 1).toString();
            gameManager.addHandPart(nextPlayer);
            gameManager.addHandPart('4');
            updateUI();
        } else if (phase === 'trump') {
            // After trump selection in pepper round, automatically add decision phase
            if (currentHand[3] === 'C') {
                gameManager.addHandPart('P'); // Must play if clubs
                updateUI();
            } else {
                gameManager.addHandPart('F'); // Default to fold for other suits
                updateUI();
            }
        }
    }
}

export function startGameplay(gameData: Record<string, unknown>) {
    const gameManager = GameManager.fromJSON(JSON.stringify(gameData));
    // Initialize reverse history preference from localStorage
    let reverseHistory = localStorage.getItem('reverseHistory') === 'true';
    
    function updateUI() {
        // Using currentHand would be for future feature needs
        // const currentHand = gameManager.getCurrentHand();
        // const phase = getCurrentPhase(currentHand);
        const scores = gameManager.getScores();

        // Update scores
        updateScores(scores);
        
        // Update hand and bid info
        updateHandInfo(gameManager);
        
        hideAllControls();

        // Update undo button state
        const undoButton = document.getElementById('undo-button');
        if (undoButton) {
          const currentHand = gameManager.getCurrentHand();
          const canUndo = currentHand.length > 1 || gameManager.state.hands.length > 1;
          (undoButton as HTMLButtonElement).disabled = !canUndo;
        }
    
        // Update the score log
        const team1Header = document.getElementById('log-team1');
        const team2Header = document.getElementById('log-team2');
        if (team1Header) team1Header.textContent = gameManager.state.teams[0] || 'Team 1';
        if (team2Header) team2Header.textContent = gameManager.state.teams[1] || 'Team 2';
        
        // Update history toggle button text
        const reverseButtonText = document.getElementById('reverse-button-text');
        if (reverseButtonText) {
            reverseButtonText.textContent = reverseHistory ? "Newest First" : "Oldest First";
        }
        
        // Update history toggle button icon
        const historyIcon = document.getElementById('history-icon');
        if (historyIcon) {
            // Rotate icon 180 degrees when in reverse chronological order
            if (reverseHistory) {
                historyIcon.style.transform = 'rotate(180deg)';
            } else {
                historyIcon.style.transform = 'rotate(0deg)';
            }
        }
        
        const scoreLog = document.getElementById('score-log');
        if (scoreLog) {
            scoreLog.innerHTML = '';  // Clear existing log
            
            // Get hands array to display
            let handsToDisplay = [...gameManager.state.hands];
            
            // Reverse the array if needed (but create a copy first to avoid affecting the actual game state)
            if (reverseHistory) {
                handsToDisplay = handsToDisplay.slice().reverse();
            }
            
            const runningScores: [number, number] = [0, 0];
            
            // If we're showing newest first, we need to pre-calculate the running scores
            if (reverseHistory) {
                gameManager.state.hands.forEach((hand) => {
                    if (hand.length === 6 || (hand.length >= 2 && hand[1] === '0')) {
                        const [score1, score2] = calculateScore(hand);
                        runningScores[0] += score1;
                        runningScores[1] += score2;
                    }
                });
            }
            
            handsToDisplay.forEach((hand, displayIndex) => {
                const row = document.createElement('tr');
                
                // Get the actual index in the original array
                const actualIndex = reverseHistory 
                    ? gameManager.state.hands.length - 1 - displayIndex 
                    : displayIndex;
                
                // Always show hand number and dealer
                const dealer = parseInt(hand[0] || '1');
                const dealerName = gameManager.state.players[dealer - 1];
                
                // Initialize cells with known data
                let bidDisplay = '';
                let team1Score = '';
                let team2Score = '';
                
                // If we have enough info for the bid
                if (hand.length >= 4) {
                    const bidWinner = parseInt(hand[1] || '0');
                    if (bidWinner === 0) {
                        bidDisplay = 'Pass';
                    } else {
                        const bidderName = gameManager.state.players[bidWinner - 1];
                        bidDisplay = `${bidderName}: ${bidToString(hand[2] || '')} in ${trumpToString(hand[3] || '')}`;
                    }
                }
                
                // Get hand classification for styling
                const classification = gameManager.getHandClassification(actualIndex);
                
                // Apply background color based on classification
                switch (classification.type) {
                    case 'pass':
                        row.classList.add('bg-green-50');
                        break;
                    case 'forced-set':
                        row.classList.add('bg-yellow-50');
                        break;
                    case 'unforced-set':
                        row.classList.add('bg-red-50');
                        break;
                }
                
                // Calculate scores based on display order
                if (hand.length === 6 || (hand.length >= 2 && hand[1] === '0')) {
                    const [score1, score2] = calculateScore(hand);
                    
                    if (reverseHistory) {
                        // For reverse order, decrement from the total
                        runningScores[0] -= score1;
                        runningScores[1] -= score2;
                        
                        // Display the scores after subtracting this hand
                        team1Score = `${runningScores[0]}`;
                        team2Score = `${runningScores[1]}`;
                    } else {
                        // For chronological order, increment as usual
                        runningScores[0] += score1;
                        runningScores[1] += score2;
                        
                        team1Score = `${runningScores[0]}`;
                        team2Score = `${runningScores[1]}`;
                    }
                }
                
                // Show actual hand number regardless of display order
                const handNumber = actualIndex + 1;
                
                // Add cells with score coloring based on classification
                row.innerHTML = `
                    <td class="py-2 text-center">${handNumber}</td>
                    <td class="py-2 px-4 text-left">${dealerName}</td>
                    <td class="py-2 px-4 text-left">${bidDisplay}</td>
                    <td class="py-2 text-center ${classification.setTeam === 0 ? 'text-red-600 font-medium' : ''}">${team1Score}</td>
                    <td class="py-2 text-center ${classification.setTeam === 1 ? 'text-red-600 font-medium' : ''}">${team2Score}</td>
                `;                
                scoreLog.appendChild(row);
            });
        }

        showPhaseControls(gameManager);
        
        // Save current state
        localStorage.setItem('currentGame', gameManager.toJSON());

        // Check for game completion
        if (gameManager.isGameComplete()) {
            // If not already marked as complete, do that first
            if (!gameManager.state.isComplete) {
                gameManager.completeGame();
                // Save again after marking as complete
                localStorage.setItem('currentGame', gameManager.toJSON());
            }
            
            const winnerIndex = gameManager.getWinner() || 0;
            const winningTeam = gameManager.state.teams[winnerIndex] || 'Winner';
            // Following values kept for future UI enhancements
            // const losingTeam = gameManager.state.teams[1 - winnerIndex] || 'Loser';
            // Scores used in future UI enhancements
            // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
            const [score1, score2] = scores;
            // const winningScore = winnerIndex === 0 ? score1 : score2;
            // const losingScore = winnerIndex === 0 ? score2 : score1;
            
            // const seriesComplete = gameManager.state.isSeries && gameManager.isSeriesComplete();
            // Unused
          // const nextDealer = seriesComplete ? null : gameManager.getNextDealer();
          
            // Update instruction area with victory message
            const instructionEl = document.getElementById('game-instruction');
            if (instructionEl) {
              instructionEl.textContent = `${winningTeam} wins${gameManager.state.isSeries ? ` Game ${gameManager.state.gameNumber}` : ''}!`;
            }
            
            // Check if victory modal is already present
            const existingModal = document.getElementById('dynamic-victory-overlay') || 
                                document.getElementById('victory-overlay');
            
            // Only show victory celebration if not already displayed
            if (!existingModal) {
                // Show victory celebration instead of normal end game controls
                showVictoryCelebration(gameManager);
            }
            
            return; // Don't continue with normal UI updates
          }
    }

    function setupEventListeners() {
        setupPlayerButtons(gameManager, updateUI);
        setupTrumpButtons(gameManager, updateUI);
        setupBidButtons(gameManager, updateUI);
        setupDecisionButtons(gameManager, updateUI);
        setupTricksButtons(gameManager, updateUI);
        setupUndoButton(gameManager, updateUI);
        
        // Setup history toggle button
        const reverseButton = document.getElementById('reverse-history-button');
        if (reverseButton) {
            // Set initial button text based on current state via updateUI
            
            reverseButton.addEventListener('click', () => {
                reverseHistory = !reverseHistory;
                localStorage.setItem('reverseHistory', reverseHistory.toString());
                updateUI();
            });
        }
    }

    // Start game
    if (gameManager.getCurrentHand() === '') {
        // First hand: dealer is 1, bidder is 2, bid is P for pepper
        gameManager.addHandPart('1');
        gameManager.addHandPart('2');
        gameManager.addHandPart('P');
        updateUI();
    }
    
    setupEventListeners();
    updateUI();
    
    // Debug functions for browser console
    if (typeof window !== 'undefined') {
      (window as any).exportGame = () => {
        const gameData = {
          players: gameManager.state.players,
          teams: gameManager.state.teams,
          hands: gameManager.state.hands
        };
        console.log('=== GAME EXPORT ===');
        console.log(JSON.stringify(gameData, null, 2));
        console.log('=== END EXPORT ===');
        console.log('To import: importGame(' + JSON.stringify(gameData) + ')');
        return gameData;
      };
      
      (window as any).importGame = (gameData: any) => {
        console.log('Importing game data:', gameData);
        localStorage.setItem('debugGame', JSON.stringify(gameData));
        console.log('Debug game loaded. Reloading page...');
        window.location.reload();
      };
      
      (window as any).clearDebugGame = () => {
        localStorage.removeItem('debugGame');
        console.log('Debug game cleared');
      };
      
      console.log('🔧 Debug functions available: exportGame(), importGame(data), clearDebugGame()');
    }
    
    return gameManager;
}

function updateScores(scores: [number, number]) {
    // Update both desktop and mobile score elements
    const team1Score = document.getElementById('team1-score');
    const team2Score = document.getElementById('team2-score');
    const team1ScoreMobile = document.getElementById('team1-score-mobile');
    const team2ScoreMobile = document.getElementById('team2-score-mobile');
    
    // Update scores
    const score1Text = scores[0].toString();
    const score2Text = scores[1].toString();
    
    // Set score values
    if (team1Score) team1Score.textContent = score1Text;
    if (team2Score) team2Score.textContent = score2Text;
    if (team1ScoreMobile) team1ScoreMobile.textContent = score1Text;
    if (team2ScoreMobile) team2ScoreMobile.textContent = score2Text;
    
    // Update colors based on score values
    updateScoreColor(team1Score, scores[0]);
    updateScoreColor(team2Score, scores[1]);
    updateScoreColor(team1ScoreMobile, scores[0]);
    updateScoreColor(team2ScoreMobile, scores[1]);
}

function updateScoreColor(element: HTMLElement | null, score: number) {
    if (!element) return;
    
    // Remove all existing color classes
    element.classList.remove(
        'text-red-600', 'text-blue-600', 
        'text-gray-800', 'text-orange-500'
    );
    
    // Add appropriate color class based on score
    if (score < 0) {
        element.classList.add('text-red-600'); // Negative scores - danger
    } else if (score >= 40) {
        element.classList.add('text-orange-500'); // Very close to winning
    } else if (score >= 28) {
        element.classList.add('text-blue-600'); // Approaching win condition
    } else {
        element.classList.add('text-gray-800'); // Normal scores
    }
}

function createConfettiEffect() {
    // Create a canvas for the confetti
    const canvas = document.createElement('canvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '1000';
    canvas.id = 'confetti-canvas';
    document.body.appendChild(canvas);
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const particles: Array<{
      x: number;
      y: number;
      size: number;
      color: string;
      speedX: number;
      speedY: number;
      rotation: number;
      rotationSpeed: number;
    }> = [];
    
    const colors = [
      '#f44336', '#e91e63', '#9c27b0', '#673ab7', 
      '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4',
      '#009688', '#4caf50', '#8bc34a', '#cddc39', 
      '#ffeb3b', '#ffc107', '#ff9800', '#ff5722'
    ];
    
    // Constants for timing
    const ANIMATION_DURATION = 15000; // 15 seconds total
    const FADE_START = 14000;         // Start fading at 14 seconds
    const FADE_DURATION = 1000;       // 1 second fade duration
    
    // Create particles
    for (let i = 0; i < 180; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height - canvas.height,
        size: Math.random() * 10 + 5,
        color: colors[Math.floor(Math.random() * colors.length)] || '#ff0000',
        speedX: Math.random() * 6 - 3,
        speedY: Math.random() * 3 + 2,
        rotation: Math.random() * 360,
        rotationSpeed: Math.random() * 10 - 5
      });
    }
    
    const startTime = Date.now();
    let canvasOpacity = 1;
    
    // Animation loop
    function animate() {
      const now = Date.now();
      const elapsed = now - startTime;
      
      // Check if animation is complete
      if (elapsed > ANIMATION_DURATION) {
        canvas.remove();
        return;
      }
      
      // Calculate canvas opacity for fade-out
      if (elapsed > FADE_START) {
        canvasOpacity = 1 - (elapsed - FADE_START) / FADE_DURATION;
        if (canvasOpacity < 0) canvasOpacity = 0;
      }
      
      // Clear canvas
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Set global canvas opacity
        ctx.globalAlpha = canvasOpacity;
      }
      
      // Draw and update particles
      particles.forEach(particle => {
        // Draw particle
        if (ctx) {
          ctx.save();
          ctx.translate(particle.x, particle.y);
          ctx.rotate((particle.rotation * Math.PI) / 180);
          ctx.fillStyle = particle.color;
          ctx.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size);
          ctx.restore();
        }
        
        // Update position
        particle.x += particle.speedX;
        particle.y += particle.speedY;
        particle.rotation += particle.rotationSpeed;
        
        // Reset particle if it's off screen
        if (particle.y > canvas.height) {
          // Gradually reduce recycling probability over time
          // This creates a natural thinning effect
          const timeRatio = Math.min(1, elapsed / FADE_START);
          const recycleChance = 0.9 - (0.7 * timeRatio);
          
          if (Math.random() < recycleChance) {
            particle.y = -particle.size;
            particle.x = Math.random() * canvas.width;
          }
        }
      });
      
      // Continue animation
      requestAnimationFrame(animate);
    }
    
    // Start animation
    animate();
  }
  
  // Create animated trophy element
  // Function kept for future implementation
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
  function createAnimatedTrophy() {
    const trophy = document.createElement('div');
    trophy.innerHTML = '🏆';
    trophy.className = 'text-6xl trophy-bounce fixed z-[1001]';
    trophy.style.top = '20%';
    trophy.style.left = '50%';
    trophy.style.transform = 'translate(-50%, -50%)';
    trophy.style.transition = 'opacity 1.5s ease, transform 0.3s ease';
    document.body.appendChild(trophy);
    
    // Start fade out after 3.5 seconds
    setTimeout(() => {
      trophy.style.opacity = '0';
    }, 3500);
    
    // Remove the trophy after fade completes
    setTimeout(() => {
      trophy.remove();
    }, 5000);
  }
  
  // Function to create and display the victory celebration
  // This creates dynamic HTML content at runtime since Astro components can't be used here
  function showVictoryCelebration(gameManager: GameManager) {
    // Hide all current controls
    hideAllControls();
    
    // First, we need to generate the award data using our tracking utilities
    const winnerIndex = gameManager.getWinner()!;
    // These score variables are used in other parts of the codebase
    // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
    const [score1, score2] = gameManager.getScores();
    
    // Add controls to the main decision pane
    const endGameControls = document.getElementById('end-game-controls');
    if (endGameControls) {
      endGameControls.innerHTML = `
        <h3 class="text-lg font-medium text-gray-900 mb-4">Game Results</h3>
        <div class="mb-4 p-4 bg-blue-50 rounded-lg text-center">
          <div class="text-2xl font-semibold mb-2">
            <span class="text-blue-600">${gameManager.state.teams[winnerIndex]}</span> Wins!
          </div>
          ${gameManager.state.isSeries && gameManager.state.seriesScores ? 
            `<div class="text-lg text-gray-700">Series Score: ${gameManager.state.seriesScores[0]}-${gameManager.state.seriesScores[1]}</div>` : 
            ''}
        </div>
        <div class="flex flex-wrap gap-4">
          ${!gameManager.state.isSeries ? `
            <button 
              id="post-victory-series-btn"
              class="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              Make it a Series
            </button>
          ` : !gameManager.isSeriesComplete() ? `
            <button 
              id="post-victory-new-series-btn"
              class="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
            >
              Next Game
            </button>
          ` : `
            <button 
              id="post-victory-start-new-series-btn"
              class="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              Start New Series
            </button>
          `}
          
          <button 
            id="post-victory-new-game-btn" 
            class="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            New Game
          </button>
        </div>
      `;
      
      // Add event listeners to the post-victory buttons
      document.getElementById('post-victory-series-btn')?.addEventListener('click', () => {
        gameManager.convertToSeries();
        gameManager.startNextGame();
        localStorage.setItem('currentGame', gameManager.toJSON());
        window.location.reload();
      });
      
      document.getElementById('post-victory-new-series-btn')?.addEventListener('click', () => {
        // In series mode, this is "Next Game"
        gameManager.startNextGame();
        localStorage.setItem('currentGame', gameManager.toJSON());
        window.location.reload();
      });
      
      document.getElementById('post-victory-start-new-series-btn')?.addEventListener('click', () => {
        // At the end of a series, create a new series with the same players and teams
        const players = [...gameManager.state.players];
        const teams = [...gameManager.state.teams];
        
        // Rotate dealer to the next player
        const lastDealerIndex = parseInt(gameManager.getCurrentHand()[0] || '1') - 1;
        const nextDealerIndex = (lastDealerIndex + 1) % 4;
        
        // Create a new game manager with the same players but new state
        const newGameManager = new GameManager(players, teams);
        // Start with the next dealer
        newGameManager.addHandPart((nextDealerIndex + 1).toString());
        
        // Convert to series immediately
        newGameManager.state.isSeries = true;
        newGameManager.state.seriesScores = [0, 0];
        newGameManager.state.gameNumber = 1;
        
        localStorage.setItem('currentGame', newGameManager.toJSON());
        window.location.reload();
      });
      
      document.getElementById('post-victory-new-game-btn')?.addEventListener('click', () => {
        localStorage.removeItem('currentGame');
        window.location.href = getPath('');
      });
    }
    
    // Now we'll use our award system to find and render awards
    Promise.all([
      import('../lib/statistics-util.ts'),
      import('../lib/pepper-awards.ts')
    ]).then(async ([statsModule, awardsModule]) => {
      try {
        console.log('Generating awards - hands:', gameManager.state.hands);
        console.log('Players:', gameManager.state.players);
        console.log('Teams:', gameManager.state.teams);
        console.log('Scores:', gameManager.getScores());
        console.log('Winner index:', winnerIndex);
        
        // Generate award data - explicitly access properties to avoid namespace issues
        const { trackAwardData } = statsModule;
        // Make sure we have a valid winnerIndex before proceeding
        if (winnerIndex === null || winnerIndex === undefined) {
          console.error('No winner index available, cannot generate awards');
          throw new Error('No winner index available');
        }
        
        const awardData = trackAwardData(
          gameManager.state.hands,
          gameManager.state.players,
          gameManager.state.teams,
          gameManager.getScores(),
          winnerIndex
        );
        
        console.log('Award data generated:', awardData);
        
        // Select awards for the game - explicitly access properties to avoid namespace issues
        const { selectGameAwards } = awardsModule;
        const gameAwards = selectGameAwards(awardData);
        console.log('Game awards selected:', gameAwards);
        
        // Select series awards if series is complete
        let seriesAwards: Array<{id: string; name: string; description: string; technicalDefinition: string; type: string; scope: string; icon: string; winner: string}> = [];
        if (gameManager.state.isSeries && gameManager.state.seriesWinner !== undefined) {
          const { selectSeriesAwards } = awardsModule;
          seriesAwards = selectSeriesAwards(awardData);
          console.log('Series awards selected:', seriesAwards);
        }
        
        // Create victory celebration with awards
        createVictoryCelebration(gameManager, winnerIndex, gameAwards, seriesAwards);
        
        // Trigger confetti effect
        createConfettiEffect();
      } catch (err) {
        console.error('Error generating awards:', err);
        // If there's an error with award generation, just create a basic victory celebration
        createVictoryCelebration(gameManager, winnerIndex);
      }
    }).catch(err => {
      console.error('Error loading modules:', err);
      // If there's an error loading modules, just create a basic victory celebration
      createVictoryCelebration(gameManager, winnerIndex);
    });
  }
  
  // Function to create and display the victory celebration with dynamic HTML
  // This is needed because Astro components can only be rendered at build time
  function createVictoryCelebration(
    gameManager: GameManager, 
    winnerIndex: number, 
    gameAwards: Array<{id: string; name: string; description: string; technicalDefinition: string; type: string; scope: string; icon: string; winner: string}> = [],
    seriesAwards: Array<{id: string; name: string; description: string; technicalDefinition: string; type: string; scope: string; icon: string; winner: string}> = []
  ) {
    // Ensure we have a valid winner index
    const winningTeam = winnerIndex !== null ? (gameManager.state.teams[winnerIndex] || 'Winner') : 'Winner';
    const [score1, score2] = typeof gameManager.getScores === 'function' ? 
    gameManager.getScores() : 
    gameManager.state.scores || [0, 0];
    
    // Create victory overlay element
    const victoryElement = document.createElement('div');
    victoryElement.id = 'dynamic-victory-overlay';
    victoryElement.className = 'fixed inset-0 bg-gray-900 bg-opacity-80 z-50 flex items-start justify-center overflow-y-auto transition-opacity duration-500';
    
    // Prepare the series data if applicable
    const seriesScoresHtml = gameManager.state.isSeries && gameManager.state.seriesScores 
      ? `<p class="text-xl text-blue-300 mb-6">Series Score: ${gameManager.state.seriesScores[0]}-${gameManager.state.seriesScores[1]}</p>` 
      : '';
    
    // Generate game awards HTML if we have any
    let gameAwardsHTML = '';
    if (gameAwards && gameAwards.length > 0) {
      gameAwardsHTML = `
        <div class="mb-8">
          <h3 class="text-2xl font-semibold text-white mb-4">Game Awards</h3>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            ${gameAwards.map(award => generateAwardCardHTML(award)).join('')}
          </div>
        </div>
      `;
    }
    
    // Generate series awards HTML if we have any
    let seriesAwardsHTML = '';
    if (seriesAwards && seriesAwards.length > 0) {
      seriesAwardsHTML = `
        <div class="mb-8">
          <h3 class="text-2xl font-semibold text-white mb-4">Series Awards</h3>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            ${seriesAwards.map(award => generateAwardCardHTML(award)).join('')}
          </div>
        </div>
      `;
    }
    
    // Generate HTML content
    victoryElement.innerHTML = `
      <div class="max-w-2xl w-full mx-4 text-center py-12">
        <div class="py-8">
          <span class="text-6xl animate-bounce inline-block">🏆</span>
        </div>
        
        <h2 class="text-4xl font-bold text-white mb-3">
          <span class="text-yellow-300">${winningTeam}</span> Wins!
        </h2>
        
        ${seriesScoresHtml}
        
        <div class="bg-white bg-opacity-10 rounded-lg p-6 backdrop-blur-sm mb-8">
          <div class="grid grid-cols-2 gap-8">
            <div class="space-y-2 ${winnerIndex === 0 ? 'text-yellow-300' : 'text-white'}">
              <h3 class="text-xl font-semibold">${gameManager.state.teams[0]}</h3>
              <p class="text-5xl font-bold ${winnerIndex === 0 ? 'animate-pulse' : ''}">
                ${score1}
              </p>
            </div>
            <div class="space-y-2 ${winnerIndex === 1 ? 'text-yellow-300' : 'text-white'}">
              <h3 class="text-xl font-semibold">${gameManager.state.teams[1]}</h3>
              <p class="text-5xl font-bold ${winnerIndex === 1 ? 'animate-pulse' : ''}">
                ${score2}
              </p>
            </div>
          </div>
        </div>
        
        ${gameAwardsHTML}
        
        ${seriesAwardsHTML}
        
        <div class="flex flex-col sm:flex-row justify-center gap-4 mb-8">
          <button 
            id="edit-last-tricks-btn"
            class="px-6 py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
          >
            Edit Last Tricks
          </button>

          <button 
            id="victory-history-btn"
            class="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            History & Statistics
          </button>
          
          ${!gameManager.state.isSeries ? `
            <button 
              id="victory-series-btn"
              class="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              Make it a Series!
            </button>
          ` : !gameManager.isSeriesComplete() ? `
            <button 
              id="victory-new-series-btn"
              class="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
            >
              Next Game
            </button>
          ` : `
            <button 
              id="victory-start-new-series-btn"
              class="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              Start New Series
            </button>
          `}
          
          <button 
            id="victory-new-game-btn" 
            class="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            New Game
          </button>
        </div>
        
        <!-- Support Development -->
        <div class="mt-8 pt-8 border-t border-gray-300 text-center">
          <h4 class="text-lg font-semibold text-gray-200 mb-4">Enjoyed the scoring experience?</h4>
          <div id="bmc-container" class="flex justify-center">
            <a href="https://buymeacoffee.com/billwolf" target="_blank" rel="noopener noreferrer" 
            class="inline-flex items-center gap-2 px-8 py-4 bg-yellow-400 text-black font-bold rounded-lg hover:bg-yellow-300 transform hover:scale-105 transition-all shadow-lg">
              <span class="text-2xl">🍕</span> 
              <span>Buy me a piece of pizza</span>
            </a>
          </div>
        </div>
    `;
    
    document.body.appendChild(victoryElement);
    
    // Add event listeners to buttons
    document.getElementById('edit-last-tricks-btn')?.addEventListener('click', () => {
      // Remove the victory modal
      victoryElement.remove();
      
      // Get the current hand before undoing
      const currentHand = gameManager.getCurrentHand();
      const phase = getCurrentPhase(currentHand);
      
      // For most victory cases, we want to go back to the tricks entry phase
      // This happens when a hand was just completed with tricks
      if (phase === 'tricks' || (currentHand.length === 6 && currentHand[5] !== undefined)) {
        // The last action was entering tricks - undo just that part
        gameManager.state.hands[gameManager.state.hands.length - 1] = currentHand.slice(0, -1);
      } else {
        // Otherwise use the standard undo logic
        gameManager.undo();
      }
      
      // Always reset the completion flag
      gameManager.state.isComplete = false;
      
      // Recompute scores
      gameManager.state.scores = gameManager.getScores();
      
      // Update the UI
      hideAllControls();
      showPhaseControls(gameManager);
      updateHandInfo(gameManager);
      updateScores(gameManager.getScores());
      
      // Make sure the undo button is enabled
      const undoButton = document.getElementById('undo-button');
      if (undoButton) {
        (undoButton as HTMLButtonElement).disabled = false;
      }
    });
    
    document.getElementById('victory-history-btn')?.addEventListener('click', () => {
      // Remove the victory modal
      victoryElement.remove();
      
      // Show end game controls
      const endGameControls = document.getElementById('end-game-controls');
      if (endGameControls) {
        endGameControls.classList.remove('hidden');
      }
      
      // Generate and display statistics
      const statsContainer = document.getElementById('game-statistics-container');
      if (statsContainer) {
        statsContainer.classList.remove('hidden');
        
        // Always regenerate statistics when the button is clicked
        try {
          // Dynamically import the statistics utility
          import('../lib/statistics-util.ts')
            .then(statsModule => {
              // Ensure we have a valid winnerIndex
              const safeWinnerIndex = gameManager.getWinner() || 0;
              
              try {
                const statsHTML = statsModule.generateStatisticsHTML(
                  gameManager.state.hands,
                  gameManager.state.players,
                  gameManager.state.teams,
                  gameManager.getScores(),
                  safeWinnerIndex
                );
                statsContainer.innerHTML = statsHTML;
                
                // Ensure the stats container is visible
                statsContainer.classList.remove('hidden');
                
                // Scroll to history/stats section after stats are generated
                const historySection = document.getElementById('game-history-section');
                if (historySection) {
                  historySection.scrollIntoView({ behavior: 'smooth' });
                  
                  // Highlight the section briefly
                  historySection.classList.add('ring-4', 'ring-blue-400');
                  setTimeout(() => {
                    historySection.classList.remove('ring-4', 'ring-blue-400');
                  }, 2000);
                }
              } catch (err) {
                console.error('Error generating statistics:', err);
                statsContainer.innerHTML = '<div class="p-4 bg-red-50 text-red-600 rounded">Error generating statistics</div>';
              }
            })
            .catch(err => {
              console.error('Error loading statistics module:', err);
              statsContainer.innerHTML = '<div class="p-4 bg-red-50 text-red-600 rounded">Failed to load statistics module</div>';
            });
        } catch (error) {
          console.error('Error generating statistics:', error);
          statsContainer.innerHTML = '<div class="p-4 bg-red-50 text-red-600 rounded">Error generating statistics</div>';
        }
      }
    });
    
    document.getElementById('victory-series-btn')?.addEventListener('click', () => {
      gameManager.convertToSeries();
      gameManager.startNextGame();
      localStorage.setItem('currentGame', gameManager.toJSON());
      window.location.reload();
    });
    
    document.getElementById('victory-new-series-btn')?.addEventListener('click', () => {
      // In series mode, this is "Next Game"
      gameManager.startNextGame();
      localStorage.setItem('currentGame', gameManager.toJSON());
      window.location.reload();
    });
    
    document.getElementById('victory-start-new-series-btn')?.addEventListener('click', () => {
      // At the end of a series, create a new series with the same players and teams
      const players = [...gameManager.state.players];
      const teams = [...gameManager.state.teams];
      
      // Rotate dealer to the next player
      const lastDealerIndex = parseInt(gameManager.getCurrentHand()[0] || '1') - 1;
      const nextDealerIndex = (lastDealerIndex + 1) % 4;
      
      // Create a new game manager with the same players but new state
      const newGameManager = new GameManager(players, teams);
      // Start with the next dealer
      newGameManager.addHandPart((nextDealerIndex + 1).toString());
      
      // Convert to series immediately
      newGameManager.state.isSeries = true;
      newGameManager.state.seriesScores = [0, 0];
      newGameManager.state.gameNumber = 1;
      
      localStorage.setItem('currentGame', newGameManager.toJSON());
      window.location.reload();
    });
    
    document.getElementById('victory-new-game-btn')?.addEventListener('click', () => {
      localStorage.removeItem('currentGame');
      window.location.href = getPath('');
    });
  }
  
  // Helper function to generate HTML for award cards
  function generateAwardCardHTML(award: {
    id: string;
    name: string;
    description: string;
    technicalDefinition: string;
    type: string;
    scope: string;
    icon: string;
    winner: string;
  }) {
    // Define styling based on award type
    const isDubious = award.id.includes('overreaching') || 
                    award.id.includes('false_confidence') || 
                    award.id.includes('helping_hand') || 
                    award.id.includes('moon_struck') || 
                    award.id.includes('gambling_problem') || 
                    award.id.includes('feast_or_famine');
    
    const cardStyle = isDubious ? {
      headerBg: 'bg-amber-600',
      bodyBg: 'bg-amber-50',
      borderColor: 'border-amber-200',
      iconBg: 'bg-amber-500'
    } : award.type === 'player' ? {
      headerBg: 'bg-purple-600',
      bodyBg: 'bg-purple-50',
      borderColor: 'border-purple-200',
      iconBg: 'bg-purple-500'
    } : {
      headerBg: 'bg-blue-600',
      bodyBg: 'bg-blue-50',
      borderColor: 'border-blue-200',
      iconBg: 'bg-blue-500'
    };
    
    // Map icon names to emoji
    const iconMap: Record<string, string> = {
      'shield': '🛡️',
      'check-circle': '✅',
      'trophy': '🏆',
      'trending-up': '📈',
      'clock': '⏱️',
      'crown': '👑',
      'sceptre': '🪄',
      'chili-hot': '🌶️',
      'hand-grabbing': '🫴',
      'thumbs-down': '👎',
      'hand': '✋',
      'shield-check': '🛡️',
      'zap': '⚡',
      'star': '⭐',
      'heart': '❤️',
      'alert-triangle': '⚠️',
      'target': '🎯',
      'award': '🏅',
      'medal': '🥇',
      'flame': '🔥',
      'spade': '♠️',
      'thumbs-up': '👍',
      'music': '🎵',
      'dice': '🎲',
      'dice-5': '🎲',
      'meh': '😐',
      'frown': '😔',
      'smile': '😊',
      'moon': '🌙',
      'sun': '☀️',
      'scale': '⚖️',
      'clock-rewind': '⏪'
    };
    
    const iconEmoji = iconMap[award.icon] || '🏆'; // Default to trophy if icon not found
    
    // Badge text based on scope
    const badgeText = award.scope === 'game' ? 'Game Award' : 'Series Award';
    
    return `
      <div class="award-card rounded-lg overflow-hidden shadow-md border ${cardStyle.borderColor} transition-transform hover:shadow-lg max-w-md flex flex-col h-full">
        <div class="${cardStyle.headerBg} px-4 py-3 text-white relative">
          <div class="flex justify-between items-center">
            <h3 class="text-xl font-bold">${award.name}</h3>
            <span class="text-xs px-2 py-1 bg-white/20 rounded-full">${badgeText}</span>
          </div>
          <p class="text-white/90 text-sm mt-1 text-left">${award.description}</p>
        </div>
        
        <div class="${cardStyle.bodyBg} p-4 flex-1">
          <div class="flex mb-3">
            <div class="${cardStyle.iconBg} h-10 w-10 rounded-full flex items-center justify-center text-white shrink-0">
              ${iconEmoji}
            </div>
            
            ${award.winner ? `
              <div class="ml-3">
                <p class="text-gray-500 text-sm">Awarded to</p>
                <p class="font-semibold text-gray-900">${award.winner}</p>
              </div>
            ` : ''}
          </div>
          
          <p class="text-xs text-gray-600 mt-2 text-left">
            <span class="font-medium text-gray-700">Criteria:</span> ${award.technicalDefinition}
          </p>
        </div>
      </div>
    `;
  }
  
  // Simple function to create confetti particles using DOM elements
  // Function kept for future implementation
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
  function createConfettiParticle(container: HTMLElement) {
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
    
    const particle = document.createElement('div');
    particle.className = 'absolute rounded-full';
    
    // Random properties
    const size = Math.random() * 10 + 5; // 5-15px
    const color = colors[Math.floor(Math.random() * colors.length)];
    
    // Starting position (centered horizontally, from the top)
    const startX = 50; // percentage
    const startY = 0;  // percentage
    
    // Random angle and speed
    const angle = Math.random() * Math.PI * 2;
    const velocity = Math.random() * 2 + 1;
    const rotationSpeed = Math.random() * 360;
    
    particle.style.width = `${size}px`;
    particle.style.height = `${size}px`;
    particle.style.backgroundColor = color || '#ff0000';
    particle.style.left = `calc(${startX}% - ${size/2}px)`;
    particle.style.top = `calc(${startY}% - ${size/2}px)`;
    
    container.appendChild(particle);
    
    // Animate the particle
    let posX = startX;
    let posY = startY;
    let rotation = 0;
    let life = 100; // percentage of life remaining
    
    const animate = () => {
      if (life <= 0) {
        particle.remove();
        return;
      }
      
      // Update position
      posX += Math.cos(angle) * velocity;
      posY += Math.sin(angle) * velocity + 0.5; // Add gravity
      rotation += rotationSpeed;
      life -= 0.7;
      
      // Update styles
      particle.style.left = `calc(${posX}% - ${size/2}px)`;
      particle.style.top = `calc(${posY}% - ${size/2}px)`;
      particle.style.transform = `rotate(${rotation}deg)`;
      particle.style.opacity = (life / 100).toString();
      
      requestAnimationFrame(animate);
    };
    
    requestAnimationFrame(animate);
    
    return particle;
  }