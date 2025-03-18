// src/lib/game.ts

import { GameManager, getCurrentPhase, isPepperRound, calculateScore, getNextDealer } from './gameState';
import { getPath } from './path-utils';
export function loadGameState() {
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
     'decision-controls', 'tricks-controls'].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.classList.add('hidden');
    });
}

function updateInstructions(text: string) {
    const element = document.getElementById('game-instruction');
    if (element) element.textContent = text;
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
                    const aIndex = parseInt(a.dataset.player!) - 1;
                    const bIndex = parseInt(b.dataset.player!) - 1;
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
            const bidder = gameManager.state.players[parseInt(currentHand[1]) - 1];
            updateInstructions(`What did ${bidder} bid?`);
            break;
        }
        case 'trump': {
            const controls = document.getElementById('trump-controls');
            if (controls) controls.classList.remove('hidden');
            const bidder = gameManager.state.players[parseInt(currentHand[1]) - 1];
            updateInstructions(`${bidder} bid ${bidToString(currentHand[2])}. What's trump?`);
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
            const bidder = gameManager.state.players[parseInt(currentHand[1]) - 1];
            updateInstructions(`${bidder} bid ${bidToString(currentHand[2])} in ${trumpToString(currentHand[3])}. Play or fold?`);
            break;
        }
        case 'tricks': {
            const controls = document.getElementById('tricks-controls');
            if (controls) controls.classList.remove('hidden');
            const bidder = gameManager.state.players[parseInt(currentHand[1]) - 1];
            // If the bid is clubs, the defenders must play
            if (currentHand[3] === 'C') {
                updateInstructions(`${bidder} bid ${bidToString(currentHand[2])} in ${trumpToString(currentHand[3])}, so ${gameManager.getDefendingTeamName()} must play. How many tricks did ${gameManager.getDefendingTeamName()} win?`);
            } else {
                updateInstructions(`${bidder} bid ${bidToString(currentHand[2])} in ${trumpToString(currentHand[3])}. How many tricks did ${gameManager.getDefendingTeamName()} win?`);
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
        button.textContent = player;
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
                gameManager.addHandPart(action);
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

export function startGameplay(gameData: any) {
    const gameManager = GameManager.fromJSON(JSON.stringify(gameData));
    // Initialize reverse history preference from localStorage
    let reverseHistory = localStorage.getItem('reverseHistory') === 'true';
    
    function updateUI() {
        const currentHand = gameManager.getCurrentHand();
        const phase = getCurrentPhase(currentHand);
        const scores = gameManager.getScores();

        // Update scores
        updateScores(scores);
        hideAllControls();

        // Update undo button state
        const undoButton = document.getElementById('undo-button');
        if (undoButton) {
          const currentHand = gameManager.getCurrentHand();
          const canUndo = currentHand.length > 1 || gameManager.state.hands.length > 1;
          undoButton.disabled = !canUndo;
        }
    
        // Update the score log
        const team1Header = document.getElementById('log-team1');
        const team2Header = document.getElementById('log-team2');
        if (team1Header) team1Header.textContent = gameManager.state.teams[0];
        if (team2Header) team2Header.textContent = gameManager.state.teams[1];
        
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
            
            let runningScores: [number, number] = [0, 0];
            
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
                const dealer = parseInt(hand[0]);
                const dealerName = gameManager.state.players[dealer - 1];
                
                // Initialize cells with known data
                let bidDisplay = '';
                let team1Score = '';
                let team2Score = '';
                
                // If we have enough info for the bid
                if (hand.length >= 4) {
                    const bidWinner = parseInt(hand[1]);
                    if (bidWinner === 0) {
                        bidDisplay = 'Pass';
                    } else {
                        const bidderName = gameManager.state.players[bidWinner - 1];
                        bidDisplay = `${bidderName}: ${bidToString(hand[2])} in ${trumpToString(hand[3])}`;
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
        if (gameManager.isGameComplete() && !gameManager.state.isComplete) {
            gameManager.completeGame();
            
            const winnerIndex = gameManager.getWinner()!;
            const winningTeam = gameManager.state.teams[winnerIndex];
            const losingTeam = gameManager.state.teams[1 - winnerIndex];
            const [score1, score2] = scores;
            const winningScore = winnerIndex === 0 ? score1 : score2;
            const losingScore = winnerIndex === 0 ? score2 : score1;
            
            const seriesComplete = gameManager.state.isSeries && gameManager.isSeriesComplete();
            const nextDealer = seriesComplete ? null : gameManager.getNextDealer();
        
            // Update instruction area with victory message
            const instructionEl = document.getElementById('game-instruction');
            if (instructionEl) {
                instructionEl.textContent = `${winningTeam} wins${gameManager.state.isSeries ? ` Game ${gameManager.state.gameNumber}` : ''}!`;
            }
            
            // Hide all game controls and show end game controls
            hideAllControls();
            const endGameControls = document.getElementById('end-game-controls');
            if (endGameControls) {
                endGameControls.classList.remove('hidden');
                endGameControls.innerHTML = `
                    <div class="grid ${gameManager.state.isSeries ? 'grid-cols-1' : 'grid-cols-2'} gap-4">
                        ${gameManager.state.isSeries ? 
                            !seriesComplete ? `
                                <button
                                    id="next-game-control"
                                    class="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700"
                                >
                                    Start Next Game
                                </button>
                            ` : `
                                <button
                                    id="new-game-control"
                                    class="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700"
                                >
                                    Start New Series
                                </button>
                            `
                        : `
                            <button
                                id="make-series-control"
                                class="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700"
                            >
                                Let's make it a series!
                            </button>
                            <button
                                id="new-game-control"
                                class="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700"
                            >
                                New Game
                            </button>
                        `}
                    </div>
                `;
                
                // Add event listeners to buttons
                document.getElementById('next-game-control')?.addEventListener('click', () => {
                    gameManager.startNextGame();
                    localStorage.setItem('currentGame', gameManager.toJSON());
                    window.location.reload();
                });
                
                document.getElementById('make-series-control')?.addEventListener('click', () => {
                    gameManager.convertToSeries();
                    gameManager.startNextGame();
                    localStorage.setItem('currentGame', gameManager.toJSON());
                    window.location.reload();
                });
                
                document.getElementById('new-game-control')?.addEventListener('click', () => {
                    localStorage.removeItem('currentGame');
                    window.location.href = getPath(''); // Redirect to home
                });
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
    
    return gameManager;
}

function updateScores(scores: [number, number]) {
    const team1Score = document.getElementById('team1-score');
    const team2Score = document.getElementById('team2-score');
    if (team1Score) team1Score.textContent = scores[0].toString();
    if (team2Score) team2Score.textContent = scores[1].toString();
}