# Debug Export/Import System Implementation Plan

## Overview
Implement a system to export/import game data for debugging awards and statistics calculations. This eliminates the need to manually recreate games for testing.

## Data Format
Simple JSON with three keys:
```json
{
  "players": ["Alice", "Bob", "Charlie", "Diana"],
  "teams": ["Team A", "Team B"],
  "hands": ["124CP3", "235HF2", "346SP0", ...]
}
```

## Implementation Plan: Hybrid Approach

### Phase 1: Console Functions (IMMEDIATE)
Add global functions callable from browser dev console:

**Functions to implement:**
- `window.exportGame()` - Export current game state as JSON
- `window.importGame(gameData)` - Import and restart with debug data
- `window.clearDebugGame()` - Clear debug mode

**Code locations:**
- Add functions to `src/lib/game.ts` after gameManager creation
- Modify `loadGameState()` to check for debug data first
- Use localStorage 'debugGame' key for temporary storage

**Usage:**
```javascript
// Export current game
const gameData = exportGame();

// Import game for testing  
importGame({
  players: ["Lisa", "Gina", "Bill", "Susie"],
  teams: ["Bloppo", "Buttsy"],
  hands: ["124DP3", "235HF2", "343SP0", ...]
});
```

### Phase 2: Hidden Developer Panel (POLISH)
Add collapsible UI panel for non-technical users:

**Features:**
- Toggle visibility with Ctrl+Shift+D
- Export button with copy-to-clipboard
- Import textarea with paste-and-load
- Positioned as fixed overlay (bottom-right)
- Hidden by default in production

**Code locations:**
- Add HTML to game.astro template
- Add event handlers in game.ts
- Add CSS classes for styling
- Add keyboard shortcut handler

### Phase 3: Optional Enhancements
- URL-based sharing (`?debug=<encoded-data>`)
- Game state validation before import
- Export with metadata (timestamp, final scores)
- Quick preset games for common test scenarios

## Immediate Implementation Details

### 1. Modify `src/lib/game.ts`
Add after gameManager creation:
```typescript
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
    return gameData;
  };
  
  (window as any).importGame = (gameData: any) => {
    localStorage.setItem('debugGame', JSON.stringify(gameData));
    window.location.reload();
  };
  
  (window as any).clearDebugGame = () => {
    localStorage.removeItem('debugGame');
    console.log('Debug game cleared');
  };
}
```

### 2. Modify `loadGameState()` function
Check for debug data first:
```typescript
export function loadGameState() {
  // Check for debug game first
  const debugGame = localStorage.getItem('debugGame');
  if (debugGame) {
    localStorage.removeItem('debugGame'); // Use once
    console.log('Loading debug game...');
    return JSON.parse(debugGame);
  }
  
  // Original logic for normal games...
  const storedGame = localStorage.getItem('currentGame');
  if (!storedGame) {
    window.location.href = getPath('');
    return null;
  }
  return JSON.parse(storedGame);
}
```

## Immediate Benefits
- ✅ Export screenshot game data instantly
- ✅ Share exact game states for debugging
- ✅ Test specific scenarios without manual recreation
- ✅ Validate statistics fixes with real data
- ✅ Production-safe (console-only, no UI changes)

## Next Steps
1. Implement Phase 1 console functions
2. Test with screenshot game data
3. Debug streak calculation with exported data
4. Validate statistics fixes
5. Plan Phase 2 UI implementation

This approach gives us immediate debugging capability while providing a path for future user-friendly enhancements.