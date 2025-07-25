# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pepper Scorer is an Astro-based web application for scoring the card game Pepper. It features real-time game state management, comprehensive award tracking, and series support. The application uses localStorage for persistence and includes an advanced statistics system with dynamic award calculations.

## Architecture

### Core Game Logic (`src/lib/`)
- **gameState.ts**: Central game state management with `GameManager` class. Handles hand encoding, score calculation, series management, and undo functionality. This is the heart of the application's game logic.
- **game.ts**: UI controller and main gameplay orchestration. Contains complex UI update logic, confetti effects, and victory celebration handling. Imports and manages all other game components.
- **pepper-awards.ts**: Comprehensive award system with 23+ different awards for individual games and series. Contains award definitions, evaluation logic, and selection algorithms.
- **statistics-util.ts**: Advanced statistical analysis and HTML generation for game summaries.

### State Management
- Game state is managed through the `GameManager` class with immutable operations
- Persistent storage via `localStorage` with JSON serialization
- Support for both single games and multi-game series
- Complex undo system that handles different game phases appropriately

### Game Phases
The game follows a structured progression through phases:
1. **bidder**: Select who won the bid (or throw-in)
2. **bid**: Enter the bid value (4, 5, 6, Moon, Double Moon)  
3. **trump**: Select trump suit (or no-trump)
4. **decision**: Defending team decides to play or fold (with optional free tricks)
5. **tricks**: Enter number of tricks won by defending team

### Award System
Sophisticated award tracking that analyzes completed games/series to assign:
- **Team awards**: Defensive prowess, bidding specialization, comeback achievements
- **Player awards**: Individual performance metrics, clutch plays, specializations
- **Dubious awards**: Humorous recognition for poor strategic decisions
Awards are dynamically selected to ensure variety and relevance to game events.

## Build Commands
- `npm install` - Install dependencies
- `npm run dev` - Start dev server at localhost:4321 (DO NOT run this as dev server is always running)
- `npm run build` - Build production site to ./dist/
- `npm run preview` - Preview production build locally

## Code Quality Checks
- `npx eslint src/**/*.ts` - Run ESLint checks on TypeScript files  
- `npx tsc --noEmit` - Check TypeScript types

## Pre-Commit Quality Assurance
Run these commands before committing to prevent linting issues and type errors:
```bash
npx tsc --noEmit && npx eslint src/**/*.ts
```

Common issues to watch for:
- Unused variables (disable ESLint warnings only when variable will be used later)
- Possible undefined values when accessing object properties or array indices  
- Missing type annotations for function parameters and return values

## LaTeX Commands (in rules directory)
- `pdflatex rules.tex` - Generate PDF from LaTeX
- `latexmk -pdf rules.tex` - Compile LaTeX with dependencies
- `pandoc -o rules.md rules.tex` - Convert LaTeX to Markdown

## Important Development Patterns

### Game State Management
- Always use `GameManager.fromJSON()` to restore game state from localStorage
- Call `updateUI()` after any state changes to keep interface synchronized
- Use `gameManager.undo()` for safe state rollback that handles all game phases
- State is encoded as compact string arrays for efficient storage and undo operations

### UI Updates and Event Handling  
- The `game.ts` file controls all UI updates through the main `updateUI()` function
- Button event handlers are set up once in `setupEventListeners()` and persist throughout gameplay
- Dynamic HTML is generated at runtime for victory celebrations and awards (Astro components can't be used post-build)
- Always call `hideAllControls()` before showing phase-specific controls

### Working with Awards and Statistics
- Award data is generated by `trackAwardData()` in statistics-util.ts
- Use `selectGameAwards()` and `selectSeriesAwards()` to pick relevant awards
- Award evaluation happens dynamically based on actual game performance
- Statistics HTML is generated server-side style but executed in the browser

### Pepper Round Logic
- First 4 hands of each game are "pepper rounds" with special bidding rules
- Use `isPepperRound(handIndex)` to check if special rules apply
- Pepper rounds have automatic bidding progression and forced play/fold decisions

## Code Style Guidelines
- **TypeScript**: Use strict typing with interfaces/types for all data structures
- **Imports**: Group external libraries first, then local modules with blank line separator  
- **Path Aliases**: Use `@/` for imports from src directory (configured in astro.config.mjs)
- **Naming**: camelCase for variables/functions, PascalCase for classes/interfaces/types
- **Error Handling**: Use null checks before accessing properties, especially for DOM elements
- **State Management**: Persist critical data in localStorage, pass transient state via props
- **Comments**: Add comments for complex game logic or non-obvious implementations

## Project Organization
- `/src/lib/` - Core application logic and utility functions
- `/src/components/` - Reusable Astro UI components  
- `/src/layouts/` - Page layout templates
- `/src/pages/` - Page routes (index.astro for setup, game.astro for gameplay)
- `/rules/` - Game rules documentation in LaTeX and generated Markdown

## Development Best Practices
- Remember to run tests often when making changes to the codebase.