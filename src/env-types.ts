/// <reference types="astro/client" />

// Create .d.ts file for custom window extensions
export {};

declare global {
  interface Window {
    // Function to populate modal content with game data
    // eslint-disable-next-line no-unused-vars
    populateModalContent?: (gameData: {
      startTime: number;
      hands: string[];
      teams: string[];
      scores: number[];
      players: string[];
    }) => void;
  }
}