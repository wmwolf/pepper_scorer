# Development Plan for Pepper Scorer Rewrite

## Project Overview
Modernizing the Pepper card game scoring application by moving from Bootstrap 4 and CoffeeScript to Astro and Tailwind CSS, while adding new features and improving the architecture.

## Development Phases

### Phase 1: Project Setup and Core Components
1. Set up Astro project with Tailwind CSS
2. Create basic layout components
   - Header/footer
   - Main layout structure
   - Basic responsive design implementation
3. Implement core game state management
   - Game state encoding system (6-character string format)
   - State management utilities
   - Basic game flow control

### Phase 2: Game Setup and Basic Gameplay
1. Create setup flow components
   - Player name input
   - Team name input
   - Game type selection (single game vs series)
2. Implement main game interface
   - Score display
   - Action area
   - Running score log
3. Add basic game logic
   - Bidding system
   - Score calculation
   - Hand completion

### Phase 3: Enhanced Navigation and Series Play
1. Implement enhanced back button functionality
   - State traversal system
   - History management
   - UI for navigation
2. Add series play support
   - Series state management
   - Multiple game tracking
   - Dealer rotation
   - Series statistics

### Phase 4: Data Persistence and Statistics
1. Implement local storage
   - Recent players/teams storage
   - Game state persistence
   - Series tracking
2. Add statistics tracking
   - Player statistics
   - Team statistics
   - Bid history
   - Performance metrics
3. Create statistics display
   - Statistics dashboard
   - Historical view
   - Performance analysis

## Technical Details

### Game State Encoding
Each hand is encoded as a 6-character string:
1. [1-4] - Dealer position
2. [0-4] - Bid winner (0 for throw-in)
3. [4,5,6,M,D,P] - Bid value (P for pepper)
4. [C,D,S,H,N] - Trump suit (N for no trump)
5. [P,F] - Defending team decision (Play/Fold)
6. [0-6] - Tricks won/given

Example: "12PCP3" represents:
- Player 1 deals
- Player 2 "wins" bid
- Pepper round (automatic bid of 4)
- Clubs trump
- Defending team plays
- Defending team wins 3 tricks

### Data Structures
```typescript
interface GameState {
  hands: string[];              // Array of encoded hands
  currentHand: string;          // Current hand being played
  teams: [string, string];      // Team names
  players: string[];            // Player names in order
  scores: [number, number];     // Current scores
}

interface SeriesState {
  games: GameState[];          // Array of completed games
  currentGame: GameState;      // Current game being played
  seriesScore: [number, number]; // Games won by each team
}
```

## Implementation Notes

### State Management
- Use centralized state management
- Implement undo/redo functionality
- Maintain game history for statistics

### Data Persistence
- Use localStorage for game state
- Implement data pruning strategy
- Version control for stored data

### User Interface
- Responsive design for all devices
- Clear navigation
- Intuitive game flow
- Accessible statistics display

## Testing Strategy
Basically no testing; this is a hobby project.
