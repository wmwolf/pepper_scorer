/// <reference types="astro/client" />

interface Window {
  populateModalContent?: (gameData: {
    startTime: number;
    hands: string[];
    teams: string[];
    scores: number[];
    players: string[];
  }) => void;
  
  fs: {
    readFile(path: string, options?: { encoding?: string }): Promise<Uint8Array | string>;
  };
}