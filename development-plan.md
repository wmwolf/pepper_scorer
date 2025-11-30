# Development Plan for Pepper Scorer

## Project Overview
Modernizing the Pepper card game scoring application by moving from Bootstrap 4 and CoffeeScript to Astro and Tailwind CSS, while adding Firebase integration for real-time multiplayer features, user authentication, and comprehensive statistics tracking.

## Completed Phases ✅

### Phase 1: Project Setup and Core Components ✅
1. Set up Astro project with Tailwind CSS ✅
2. Create basic layout components ✅
   - Header/footer with navbar
   - Main layout structure
   - Rules modal with responsive design
3. Implement core game state management ✅
   - Game state encoding system (6-character string format)
   - State management utilities
   - Basic game flow control

### Phase 2: Game Setup and Basic Gameplay ✅
1. Create setup flow components ✅
   - Player name input
   - Team name input
   - Game type selection (single game vs series)
2. Implement main game interface ✅
   - Score display with responsive layout
   - Action area with game controls
   - Running score log with history toggle
3. Add basic game logic ✅
   - Bidding system with pepper round support
   - Score calculation and validation
   - Hand completion and victory detection

### Phase 3: Enhanced Navigation and Series Play ✅
1. Implement enhanced undo functionality ✅
   - State traversal system
   - Phase-aware undo logic
   - UI integration
2. Add series play support ✅
   - Series state management
   - Multiple game tracking
   - Dealer rotation
   - Series statistics and awards

### Phase 4: Statistics and Awards System ✅
1. Implement comprehensive statistics ✅
   - Player performance analysis
   - Team statistics
   - Bid history and success rates
2. Advanced award system ✅
   - 23+ different game and series awards
   - Dynamic award selection algorithms
   - Award visualization in victory celebrations
3. Victory celebrations with confetti and animations ✅

## Current Phase: Firebase Integration 🔥

**Phase 5 Complete!** Authentication and infrastructure are working. Ready for Phase 6.

### Phase 5: Firebase Foundation & Authentication ✅
**Status: Complete - Safari/DuckDuckGo authentication issues resolved**

#### Manual Firebase Setup Complete:
1. **Firebase Project Created** ✅ - Project configured at console.firebase.google.com
2. **Services Enabled** ✅:
   - Realtime Database (test mode active)
   - Authentication with Google sign-in provider
3. **Configuration Complete** ✅ - Environment variables configured
4. **Authorized Domains** ✅ - localhost and billwolf.space configured

#### Code Implementation Complete:
1. **Firebase SDK Integration** ✅ - Dependencies installed and configured
2. **Configuration Infrastructure** ✅ - Environment-based setup with fallbacks
3. **Authentication System** ✅ - Simple popup authentication working across all browsers
4. **Database Schema Design** ✅ - Complete schema for users, games, and real-time sync
5. **Testing Interface** ✅ - Authentication UI added and verified working
6. **User Lookup System** ✅ - Username autocomplete for game setup

#### Critical Authentication Fixes Applied:
- ✅ **Simple popup-only authentication** - Reverted from complex redirect system
- ✅ **Cross-browser compatibility** - Works in Chrome, Safari, DuckDuckGo
- ✅ **Base path configuration** - Development uses root path, production uses /pepper_scorer
- ✅ **Domain configuration** - Proper Firebase authorized domains setup

#### Verified Working Features:
- ✅ Firebase initialization and configuration
- ✅ Google authentication (sign in/sign out) in all browsers
- ✅ User profile creation and management
- ✅ Real-time authentication state management
- ✅ User search and autocomplete in game setup
- ✅ Backward compatibility with localStorage
- ✅ "Continue without signing in" fallback option

#### All Known Issues Resolved ✅:
- ✅ **Login UI State**: Login button now shows proper loading states during authentication process
- ✅ **Account Page Loading**: Eliminated jarring flash of "authentication required" message with smooth loading state
- ✅ **Display Name Persistence**: Custom display names now persist properly and don't revert to Google data on page refresh

### Phase 6: Database Schema & Core Data Migration
**Goal**: Replace localStorage with Firebase, maintain backward compatibility

#### Database Structure:
```
users/{userId}/
  username: string (unique)
  displayName: string
  stats: {
    wins: number,
    losses: number,
    totalGames: number,
    bidStats: {
      totalBids: number,
      successfulBids: number,
      bidsByValue: { 4: {attempts, successes}, 5: {...}, etc }
      bidsBySuit: { C: {attempts, successes}, D: {...}, etc }
    },
    defensiveStats: {
      timesStayed: number,
      timesSet: number,
      timesSetOpponent: number,
      timesNegotiated: number
    },
    partnerStats: { [partnerId]: gamesPlayed }
  }

games/{gameId}/
  metadata: {
    createdBy: userId,
    createdAt: timestamp,
    status: 'setup' | 'active' | 'completed',
    roomCode?: string (for spectators)
  }
  players: [{ userId?, displayName, isAuthenticated, position }]
  teams: [string, string]
  gameState: {
    hands: string[],
    scores: [number, number],
    isComplete: boolean,
    seriesScores?: [number, number],
    etc.
  }
  bidding?: {
    active: boolean,
    dealerIndex: number,
    currentBidder: number,
    bids: { [playerIndex]: { value, suit?, revealed } },
    phase: 'bidding' | 'trump' | 'decision'
  }

userGames/{userId}/{gameId}: true  // Quick lookup for active games
```

### Phase 7: Real-time Game Synchronization
**Goal**: Multiple devices stay in sync during manual play

#### Features:
- Game state listeners for live score updates
- Automatic UI refresh when host updates scores
- Connection status indicators
- Graceful handling of network interruptions
- Fallback to localStorage when offline

### Phase 8: Mobile Bidding Interface
**Goal**: Players can bid via their phones

#### Bidding Flow:
1. Host creates game → generates gameId
2. Players join via username lookup or room code
3. When bidding phase starts, authenticated players see bid interface
4. Bids revealed in dealer order with re-prompt for matched bids
5. Trump selection by bid winner
6. Automatic fallback to manual mode if any player disconnects

#### Mobile UI Components:
- Responsive bid selection interface
- Trump selection with suit symbols
- "Waiting for your turn" states
- Real-time connection status
- Game viewer mode for non-participants

### Phase 9: User Management & Game Discovery
**Goal**: User accounts, game ownership, active game management

#### Features:
- User registration and profile management
- Active games dashboard
- Username autocomplete in game setup
- Room code generation for spectators
- Game invitation system

### Phase 10: Advanced Statistics & Historical Analysis
**Goal**: Comprehensive long-term stat tracking

#### Statistics Features:
- Per-hand outcome categorization
- Partner compatibility analysis
- Bidding pattern analysis
- Performance trends over time
- Comparative statistics (vs. other players)

#### Game Management:
- Historical game browser
- Game replay functionality
- Export game data
- Stats recalculation system (for "edit last tricks")

### Phase 11: Security & Production Features
**Goal**: Secure, scalable deployment ready for public use

#### Security Implementation:
```javascript
// Firebase Security Rules
{
  "rules": {
    "users": {
      "$userId": {
        ".read": true,  // Public read for username lookup
        ".write": "$userId === auth.uid"  // Users can only edit their own data
      }
    },
    "games": {
      "$gameId": {
        ".read": "auth != null && (data.child('players').val().hasChild(auth.uid) || query.orderByChild('roomCode').equalTo($gameId).exists())",
        ".write": "auth != null && data.child('metadata/createdBy').val() === auth.uid"
      }
    }
  }
}
```

#### Production Features:
- Error monitoring and logging
- Performance optimization
- Progressive Web App features
- Offline functionality
- Data backup and recovery

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

## Firebase Integration Technical Details

### Development Strategy
- **Feature Branch Development**: All Firebase features developed in `firebase-integration` branch
- **Backward Compatibility**: Maintain localStorage support during transition
- **Progressive Enhancement**: Add Firebase features without breaking existing functionality
- **Mobile-First**: Design bidding interface for mobile devices primarily

### Data Migration Strategy
1. **Dual-mode Operation**: Support both localStorage and Firebase simultaneously
2. **Import Existing Games**: Allow users to migrate localStorage games to Firebase
3. **Graceful Degradation**: Fall back to localStorage if Firebase unavailable
4. **Data Validation**: Ensure data integrity during migration

### Real-time Synchronization Patterns
```javascript
// Game state listener pattern
onGameStateChange(gameId, callback) {
  return firebase.database().ref(`games/${gameId}/gameState`)
    .on('value', (snapshot) => {
      callback(snapshot.val());
    });
}

// Optimistic updates with rollback
updateGameState(gameId, newState) {
  // Update local state immediately
  updateLocalState(newState);

  // Push to Firebase with error handling
  firebase.database().ref(`games/${gameId}/gameState`)
    .set(newState)
    .catch(error => {
      // Rollback local state on failure
      rollbackLocalState();
      showError('Failed to sync. Please try again.');
    });
}
```

### Bidding Synchronization Logic
1. **Turn-based Updates**: Only current bidder can submit bids
2. **Atomic Transactions**: Use Firebase transactions for bid submission
3. **Conflict Resolution**: Handle simultaneous bid attempts gracefully
4. **State Validation**: Server-side validation of bid sequences

### Performance Considerations
- **Minimal Data Transfer**: Only sync essential game state changes
- **Connection Management**: Implement heartbeat system for connection monitoring
- **Offline Support**: Cache critical data for offline viewing
- **Rate Limiting**: Prevent excessive API calls

## Testing Strategy
- **Manual Testing**: Focus on user experience and edge cases
- **Device Testing**: Test on actual mobile devices for bidding interface
- **Connection Testing**: Test with poor network conditions
- **Firebase Emulator**: Use local Firebase emulator for development
