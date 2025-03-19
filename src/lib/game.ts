// src/lib/game.ts

import { GameManager, getCurrentPhase, isPepperRound, calculateScore } from './gameState';
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
  
  // Add this function after updateScoreColor
  function showVictoryCelebration(gameManager: GameManager) {
    // Hide all current controls
    hideAllControls();
    
    // This function has been updated to use the VictoryCelebration component
    // Instead of generating the HTML directly, we'll use the custom event to
    // display the component that we set up in the game.astro file.
    
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
          ` : `
            <button 
              id="post-victory-new-series-btn"
              class="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              Next Game
            </button>
          `}
          
          ${!gameManager.state.isSeries ? `
            <button 
              id="post-victory-new-game-btn" 
              class="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              New Game
            </button>
          ` : ''}
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
        let seriesAwards: Array<{id: string; name: string; description: string; winner: string}> = [];
        if (gameManager.state.isSeries && gameManager.state.seriesWinner !== undefined) {
          const { selectSeriesAwards } = awardsModule;
          seriesAwards = selectSeriesAwards(awardData);
          console.log('Series awards selected:', seriesAwards);
        }
        
        // Define the props to pass to the victory celebration component
        const victoryProps = {
          winningTeam: gameManager.state.teams[winnerIndex],
          finalScores: gameManager.getScores(),
          teamNames: gameManager.state.teams,
          isSeries: gameManager.state.isSeries || false,
          seriesScores: gameManager.state.seriesScores,
          gameAwards: gameAwards,
          seriesAwards: seriesAwards
        };
        console.log('Victory props:', victoryProps);
        
        // Render the component into the victory container
        const victoryContainer = document.getElementById('victory-celebration-container');
        if (victoryContainer) {
          // Render component by using a custom event with props data
          console.log('Dispatching render-victory-celebration event with props:', victoryProps);
          // Ensure awards are properly serializable before adding to event
          const serializedProps = {
            ...victoryProps,
            gameAwards: victoryProps.gameAwards || [],
            seriesAwards: victoryProps.seriesAwards || []
          };
          document.dispatchEvent(new CustomEvent('render-victory-celebration', { 
            detail: serializedProps 
          }));
        } else {
          // Create a container for the victory celebration component
          const container = document.createElement('div');
          container.id = 'victory-celebration-container';
          document.body.appendChild(container);
          
          // Dispatch event after container is created
          document.dispatchEvent(new CustomEvent('render-victory-celebration', { 
            detail: victoryProps 
          }));
        }
        
        // Trigger confetti effect
        createConfettiEffect();
      } catch (err) {
        console.error('Error generating awards:', err);
        // Fall back to a simpler victory celebration if there's an error
        fallbackVictoryCelebration(gameManager);
      }
    }).catch(err => {
      console.error('Error loading modules:', err);
      // Fall back to a simpler victory celebration if there's an error
      fallbackVictoryCelebration(gameManager);
    });
  }
  
  // Simplified fallback victory celebration when awards system fails
  function fallbackVictoryCelebration(gameManager: GameManager) {
    const winnerIndex = gameManager.getWinner() || 0;
    const winningTeam = gameManager.state.teams[winnerIndex] || 'Winner';
    const [score1, score2] = gameManager.getScores();
    
    // Create victory overlay element
    const victoryElement = document.createElement('div');
    victoryElement.id = 'dynamic-victory-overlay';
    victoryElement.className = 'fixed inset-0 bg-gray-900 bg-opacity-80 z-50 flex items-center justify-center transition-opacity duration-500';
    
    // Prepare the series data if applicable
    const seriesScoresHtml = gameManager.state.isSeries && gameManager.state.seriesScores 
      ? `<p class="text-xl text-blue-300 mb-6">Series Score: ${gameManager.state.seriesScores[0]}-${gameManager.state.seriesScores[1]}</p>` 
      : '';
    
    // Generate HTML content
    victoryElement.innerHTML = `
      <div class="max-w-2xl w-full mx-4 text-center">
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
        
        <div class="flex flex-col sm:flex-row justify-center gap-4">
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
          ` : `
            <button 
              id="victory-new-series-btn"
              class="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
            >
              Next Game
            </button>
          `}
          
          ${!gameManager.state.isSeries ? `
            <button 
              id="victory-new-game-btn" 
              class="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              New Game
            </button>
          ` : ''}
        </div>
      </div>
    `;
    
    document.body.appendChild(victoryElement);
    
    // Trigger confetti effect
    createConfettiEffect();
    
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
      victoryElement.remove();
      
      // First, ensure statistics are generated if they haven't been yet
      const statsContainer = document.getElementById('game-statistics-container');
      if (statsContainer) {
        // Make sure the container is visible
        statsContainer.classList.remove('hidden');
        
        // If statistics haven't been generated yet (container is empty),
        // generate them now
        if (!statsContainer.innerHTML.trim()) {
          const winnerIndex = gameManager.getWinner();
          if (winnerIndex !== null) {
            // Use dynamic import to load the statistics module
            import('../lib/statistics-util.ts').then(module => {
              try {
                const statsHTML = module.generateStatisticsHTML(
                  gameManager.state.hands,
                  gameManager.state.players,
                  gameManager.state.teams,
                  gameManager.getScores(),
                  winnerIndex
                );
                statsContainer.innerHTML = statsHTML;
              } catch (err) {
                console.error('Error generating statistics:', err);
                statsContainer.innerHTML = '<div class="p-4 bg-red-50 text-red-600 rounded">Error generating statistics</div>';
              }
            }).catch(err => {
              console.error('Error loading statistics module:', err);
              statsContainer.innerHTML = '<div class="p-4 bg-red-50 text-red-600 rounded">Failed to load statistics module</div>';
            });
          }
        }
        
        // Show end game controls
        const endGameControls = document.getElementById('end-game-controls');
        if (endGameControls) {
          endGameControls.classList.remove('hidden');
        }
        
        // Scroll to statistics first
        statsContainer.scrollIntoView({ behavior: 'smooth' });
        statsContainer.classList.add('ring-4', 'ring-blue-400');
        setTimeout(() => {
          statsContainer.classList.remove('ring-4', 'ring-blue-400');
        }, 2000);
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
    
    document.getElementById('victory-new-game-btn')?.addEventListener('click', () => {
      localStorage.removeItem('currentGame');
      window.location.href = getPath('');
    });
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