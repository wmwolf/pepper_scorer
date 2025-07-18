// src/lib/gameState.ts
import { getPath } from './path-utils';
interface GameState {
  players: string[];
  teams: string[];
  hands: string[];
  scores: [number, number];
  isComplete: boolean;
  isSeries: boolean;
  seriesScores?: [number, number];  // Optional for series tracking
  gameNumber?: number;              // Optional for series tracking
  startTime: number;                // Unix timestamp of game start
  seriesWinner?: number;            // Index of team that won the series
  completedGames?: GameSummary[];   // Array of completed games in the series
}

interface GameSummary {
  winner: number;
  finalScores: [number, number];
  hands: string[];
  startTime: number;
  endTime: number;
}

export interface IGameManager {
  state: GameState;
  getCurrentHand(): string;
  getScores(): [number, number];
  // eslint-disable-next-line no-unused-vars
  addHandPart(part: string): void;
  undo(): void;
  hasWinner(): boolean;
  getWinningTeam(): number | null;
  toJSON(): string;
  getStartTime(): number; // Add this method
  isGameComplete(): boolean;
  getWinner(): number | null;
  completeGame(): void;
  startNextGame(): void;
  getDefendingTeamName(): string | null;
  // eslint-disable-next-line no-unused-vars
  getHandClassification(handIndex: number): HandClassification;
  isSeriesComplete(): boolean;
  getNextDealer(): string;
  convertToSeries(): void;
}

export type HandClassification = {
  type: 'incomplete' | 'pass' | 'play' | 'forced-set' | 'unforced-set';
  setTeam?: 0 | 1;  // Index of team that went set (if applicable)
};

// Hand state encoding/decoding
export function encodeHand(
  dealer: number,
  bidWinner: number,
  bid: number | 'P' | 'M' | 'D',
  trump: 'C' | 'D' | 'S' | 'H' | 'N',
  decision: 'P' | 'F',
  tricks: number
): string {
  return `${dealer}${bidWinner}${bid}${trump}${decision}${tricks}`;
}

export function decodeHand(encoded: string): {
  dealer: number;
  bidWinner: number;
  bid: number | 'P' | 'M' | 'D';
  trump: string;
  decision: 'P' | 'F';
  tricks: number;
} {
  const [dealer, bidWinner, bid, trump, decision, tricks] = encoded.split('');
  return {
    dealer: parseInt(dealer || '1'),
    bidWinner: parseInt(bidWinner || '1'),
    bid: bid as 'P' | 'M' | 'D' || '4',
    trump: trump || 'N',
    decision: (decision || 'P') as 'P' | 'F',
    tricks: parseInt(tricks || '0')
  };
}

// Score calculation
export function calculateScore(hand: string): [number, number] {
  const { bidWinner, bid, decision, tricks } = decodeHand(hand);
  if (bidWinner === 0) return [0, 0];  // Throw-in
  
  // Parse bid value with fallback defaults
  const bidValue = {
    'P': 4,
    '4': 4,
    '5': 5,
    '6': 6,
    'M': 7,
    'D': 14
  }[bid.toString()] || 4; // Default to 4 if bid is undefined or not found
  
  const biddingTeam = (bidWinner - 1) % 2;
  const scores: [number, number] = [0, 0];

  if (decision === 'F') {
    // Folded hand
    scores[biddingTeam] = bidValue;
    if (tricks > 0) {
      scores[1 - biddingTeam] = tricks;
    }
  } else {
    // Played hand
    const tricksNeeded = [14, 7, 6].includes(bidValue) ? 6 : bidValue;
    if (tricks === 0) {
      // Defending team set
      scores[biddingTeam] = bidValue;
      scores[1 - biddingTeam] = -bidValue;
    } else if (tricks + tricksNeeded > 6) {
      // Bidding team set
      scores[biddingTeam] = -bidValue;
      // if the bid was a moon or double moon, defending team gets
      // the full value of the bid
      if (bidValue > 6) {
        scores[1 - biddingTeam] = bidValue;
      } else {
        scores[1 - biddingTeam] = tricks;
      }
    } else {
      // Normal scoring
      scores[biddingTeam] = bidValue;
      scores[1 - biddingTeam] = tricks;
    }
  }
  return scores;
}

// Game progression
export function isHandComplete(encoded: string): boolean {
  // Hand is complete if it has 6 characters or if it's a throw-in
  return encoded.length === 6 || encoded[1] === '0';
}

export function isPepperRound(handIndex: number): boolean {
  return handIndex < 4;
}

export function getNextDealer(currentDealer: number): number {
  return (currentDealer % 4) + 1;
}

export function getCurrentPhase(encoded: string): 'bidder' | 'bid' | 'trump' | 'decision' | 'tricks' {
  if (!encoded) return 'bidder';
  
  const parts = encoded.split('');
  if (parts[1] === undefined) return 'bidder';
  if (parts[2] === undefined) return 'bid';
  if (parts[3] === undefined) return 'trump';
  if (parts[4] === undefined) return 'decision';
  return 'tricks';
}

// Game state management
export class GameManager implements IGameManager {
  public state: GameState;

  constructor(players: string[], teams: string[]) {
    this.state = {
      players,
      teams,
      hands: [],
      scores: [0, 0],
      isComplete: false,
      isSeries: false,
      startTime: Date.now()
    };
  }

  public getStartTime(): number {
    return this.state.startTime;
  }

  public getCurrentHand(): string {
    return this.state.hands[this.state.hands.length - 1] || '';
  }

  public getDealer(): number {
    const currentHand = this.getCurrentHand();
    if (!currentHand) return 1;
    return parseInt(currentHand[0] || '1');
  }

  public getScores(): [number, number] {
    // Calculate scores from scratch by iterating through completed hands
    const scores: [number, number] = [0, 0];
    this.state.hands.forEach((hand) => {
      if (isHandComplete(hand)) {
        const [team1Score, team2Score] = calculateScore(hand);
        scores[0] += team1Score;
        scores[1] += team2Score;
      }
    });
    return scores;
  }

  public addHandPart(part: string): void {
    const currentHand = this.getCurrentHand();
    if (!currentHand || isHandComplete(currentHand)) {
      // Start a new hand with this part
      this.state.hands.push(part);
    } else {
      // Add to existing incomplete hand
      this.state.hands[this.state.hands.length - 1] = 
        this.state.hands[this.state.hands.length - 1] + part;
    }
    
    if (isHandComplete(this.getCurrentHand())) {
      const [team1Score, team2Score] = calculateScore(this.getCurrentHand());
      this.state.scores[0] += team1Score;
      this.state.scores[1] += team2Score;
      
      if (!this.hasWinner()) {
        const lastHand = this.getCurrentHand();
        const lastDealer = parseInt(lastHand[0] || '1');
        const nextDealer = getNextDealer(lastDealer);
        // Start next hand with dealer already set
        this.state.hands.push(nextDealer.toString());
      }
    }
  }

  public getBiddingTeam(): number | null {
    const currentHand = this.getCurrentHand();
    if (!currentHand || !currentHand[1]) return null;
    return (parseInt(currentHand[1]) - 1) % 2;
  }

  public getBiddingTeamName(): string | null {
    const biddingTeam = this.getBiddingTeam();
    if (biddingTeam === null) return null;
    return this.state.teams[biddingTeam] || null;
  }

  public getDefendingTeam(): number | null {
    const biddingTeam = this.getBiddingTeam();
    if (biddingTeam === null) return null;
    return 1 - biddingTeam;
  }

  public getDefendingTeamName(): string | null {
    const defendingTeam = this.getDefendingTeam();
    if (defendingTeam === null) return null;
    return this.state.teams[defendingTeam] || null;
  }

  public undo(): void {
    const currentHand = this.getCurrentHand();
    const wasCompleteBeforeUndo = this.isGameComplete();
    
    // If no current hand, we're at the start of the game
    if (!currentHand) {
      if (this.state.hands.length > 0) {
        // Remove last completed hand and adjust scores
        this.state.hands.pop()!;
        this.state.scores = this.getScores();
      } else {
        // At very start of game, navigate back to setup
        window.location.href = getPath('');
        return;
      }
    } else {
      const handIndex = this.state.hands.length - 1;
      const phase = getCurrentPhase(currentHand);
      
      // Special case: First pepper round, trump phase
      if (handIndex === 0 && phase === 'trump') {
        window.location.href = getPath('');
        return;
      }
      
      // Special case: Pepper round, trump phase (not first hand)
      if (isPepperRound(handIndex) && phase === 'trump') {
        // Remove current hand
        this.state.hands.pop();
        // Go back to previous hand's last phase
        const prevHand = this.state.hands[this.state.hands.length - 1];
        if (prevHand) {
          // if previous hand was played, remove last character to go back to 
          // tricks phase. If it was folded, go back to decision phase
          if (prevHand[4] === 'P') {
            this.state.hands[this.state.hands.length - 1] = prevHand.slice(0, -1);
          } else {
            this.state.hands[this.state.hands.length - 1] = prevHand.slice(0, -2);
          }
        }

        return;
      }
      
      // Special case: Bidding phase
      if (phase === 'bidder') {
        // Remove current hand (which only has dealer)
        this.state.hands.pop();
        // Previous hand exists and should be complete
        if (this.state.hands.length > 0) {
          const prevHand = this.state.hands[this.state.hands.length - 1];
          if (prevHand) {
            const [team1Score, team2Score] = calculateScore(prevHand);
            this.state.scores[0] -= team1Score;
            this.state.scores[1] -= team2Score;
            // Remove last character to go back to tricks/decision phase
            this.state.hands[this.state.hands.length - 1] = prevHand.slice(0, -1);
          }
        }
        return;
      }
      
      // Special case: Clubs bid going from tricks to trump
      if (phase === 'tricks' && currentHand[3] === 'C') {
        this.state.hands[handIndex] = currentHand.slice(0, -2);  // Remove decision and tricks
        return;
      }
      
      // Default case: Remove last character
      this.state.hands[handIndex] = currentHand.slice(0, -1);
    }
    
    // Check if we've undone a victory condition
    const isCompleteAfterUndo = this.isGameComplete();
    
    // If the game was complete before but is no longer complete after the undo,
    // we need to reset the isComplete flag
    if (wasCompleteBeforeUndo && !isCompleteAfterUndo && this.state.isComplete) {
      this.state.isComplete = false;
      
      // If this was in series mode, we need to adjust the series score as well
      if (this.state.isSeries && this.state.seriesScores && this.state.completedGames) {
        // Get the winner that was recorded
        if (this.state.completedGames && this.state.completedGames.length > 0) {
          const lastGame = this.state.completedGames[this.state.completedGames.length - 1];
          if (lastGame && this.state.seriesScores) {
            // Decrement the series score for that winner
            if (this.state.seriesScores && lastGame && typeof lastGame.winner === 'number') {
              if (lastGame.winner !== undefined && this.state.seriesScores !== undefined && 
                typeof lastGame.winner === 'number' && lastGame.winner < this.state.seriesScores.length && 
                this.state.seriesScores[lastGame.winner] !== undefined) {
                if (this.state.seriesScores[lastGame.winner] !== undefined) {
                  this.state.seriesScores[lastGame.winner] = this.state.seriesScores[lastGame.winner]! - 1;
                }
              }
            }
            // Remove the game from completed games
            this.state.completedGames.pop();
          }
        }
      }
    }
  }

  public hasWinner(): boolean {
    return (this.state.scores[0] >= 42 || this.state.scores[1] >= 42) &&
           this.state.scores[0] !== this.state.scores[1];
  }

  public getWinningTeam(): number | null {
    if (!this.hasWinner()) return null;
    return this.state.scores[0] > this.state.scores[1] ? 0 : 1;
  }

  public toJSON(): string {
    return JSON.stringify(this.state);
  }

  public static fromJSON(json: string): GameManager {
    const state = JSON.parse(json);
    const manager = new GameManager(state.players, state.teams);
    manager.state = state;
    return manager;
  }

  public isGameComplete(): boolean {
    const [score1, score2] = this.state.scores;
    return (score1 >= 42 || score2 >= 42) && score1 !== score2;
  }
  
  public getWinner(): number | null {
    if (!this.isGameComplete()) return null;
    return this.state.scores[0] > this.state.scores[1] ? 0 : 1;
  }
  
  public getHandClassification(handIndex: number): HandClassification {
    const hand = this.state.hands[handIndex];
    if (!hand) {
      return { type: 'incomplete' };
    }
  
    // Special case: thrown in hand
    if (hand.length >= 2 && hand[1] === '0') {
      return { type: 'pass' };
    }
  
    // Other incomplete hands
    if (!isHandComplete(hand)) {
      return { type: 'incomplete' };
    }
    
    // For completed hands, determine bidding and defending teams
    const bidWinner = parseInt(hand[1] || '0');
    
    // Check if hand was folded or negotiated
    if (hand[4] === 'F') {
      return { type: 'pass' };
    }
  
    const biddingTeam = (bidWinner - 1) % 2;
    const defendingTeam = 1 - biddingTeam;
    const [score1, score2] = calculateScore(hand);
    
    // If no one went set, it's a normal played hand
    if (score1 >= 0 && score2 >= 0) {
      return { type: 'play' };
    }
  
    // Determine which team went set
    const setTeam = score1 < 0 ? 0 : 1;
    
    // Check if it's a forced set
    const inPepperRound = handIndex < 4;
    const defendingAgainstClubs = hand[3] === 'C';
    
    if ((inPepperRound && setTeam === biddingTeam) || 
        (defendingAgainstClubs && setTeam === defendingTeam)) {
      return { 
        type: 'forced-set',
        setTeam 
      };
    }
  
    // Otherwise it's an unforced set
    return { 
      type: 'unforced-set',
      setTeam 
    };
  }
  
  public isSeriesComplete(): boolean {
    if (!this.state.isSeries || !this.state.seriesScores) return false;
    const [score1, score2] = this.state.seriesScores;
    return score1 === 2 || score2 === 2;
  }

  public getNextDealer(): string {
    const currentGame = this.state.hands;
    if (currentGame.length === 0) return this.state.players[0] || '';
    
    const lastHand = currentGame[currentGame.length - 1];
    if (!lastHand) return this.state.players[0] || '';
    
    const currentDealer = parseInt(lastHand[0] || '1');
    const nextDealer = (currentDealer % 4) + 1;
    return this.state.players[nextDealer - 1] || '';
  }

  public completeGame(): void {
    if (this.state.isComplete) return;

    const winner = this.getWinner();
    if (winner === null) return;

    this.state.isComplete = true;

    if (this.state.isSeries && this.state.seriesScores) {
        // Update series score
        if (this.state.seriesScores && typeof winner === 'number') {
          if (winner !== undefined && this.state.seriesScores !== undefined &&
              typeof winner === 'number' && winner < this.state.seriesScores.length &&
              this.state.seriesScores[winner] !== undefined) {
            this.state.seriesScores[winner]++;
          }
        }

        // Save completed game summary
        const gameSummary: GameSummary = {
          winner,
          finalScores: [...this.state.scores] as [number, number],
          hands: [...this.state.hands],
          startTime: this.state.startTime,
          endTime: Date.now()
        };

        this.state.completedGames = this.state.completedGames || [];
        this.state.completedGames.push(gameSummary);

        // Check for series winner
        if (this.state.seriesScores && typeof winner === 'number' && this.state.seriesScores[winner] === 2) {
          this.state.seriesWinner = winner;
        }
      }
    }
  

  public convertToSeries(): void {
    if (this.state.isSeries) {
      throw new Error("Game is already part of a series");
    }

    // Store the completed game summary
    const winner = this.getWinner();
    if (winner === null) throw new Error("Cannot convert: game not complete");

    const gameSummary: GameSummary = {
      winner,
      finalScores: [...this.state.scores] as [number, number],
      hands: [...this.state.hands],
      startTime: this.state.startTime,
      endTime: Date.now()
    };

    // Convert to series
    this.state.isSeries = true;
    this.state.seriesScores = [0, 0];
    if (this.state.seriesScores && typeof winner === 'number') {
      this.state.seriesScores[winner] = 1;
    }
    this.state.gameNumber = 1;
    this.state.completedGames = [gameSummary];
  }

  public startNextGame(): void {
    if (!this.state.isSeries || this.isSeriesComplete()) {
      throw new Error("Cannot start next game: series is complete or not in series mode");
    }

    const { 
      players, 
      teams, 
      isSeries, 
      seriesScores, 
      completedGames 
    } = this.state;

    const gameNumber = (this.state.gameNumber || 1) + 1;
    const nextDealer = this.getNextDealer();
    const nextDealerIndex = this.state.players.indexOf(nextDealer) + 1;

    this.state = {
      players,
      teams,
      hands: [nextDealerIndex.toString()],
      scores: [0, 0],
      isComplete: false,
      isSeries,
      seriesScores,
      completedGames,
      gameNumber,
      startTime: Date.now()
    };
  }
}