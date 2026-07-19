import { describe, it, expect, beforeEach } from 'vitest';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  parseBackup,
  describeBackupGame,
  restoreGameLocally,
  type PepperBackup,
  type BackupGame,
} from '../../src/lib/data-export';

function makeGame(overrides: Partial<BackupGame['data']> = {}): BackupGame {
  return {
    id: 'game123',
    data: {
      metadata: { createdBy: 'u1', createdAt: 1_700_000_000_000, status: 'completed' },
      players: [],
      teams: ['Us', 'Them'],
      gameState: {
        hands: ['12PCP3', '23PDP0'],
        scores: [21, 15],
        teams: ['Us', 'Them'],
        players: ['A', 'B', 'C', 'D'],
      } as unknown as BackupGame['data']['gameState'],
      ...overrides,
    } as BackupGame['data'],
  };
}

function makeBackup(games: BackupGame[]): PepperBackup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: '2026-07-12T00:00:00.000Z',
    userId: 'u1',
    username: 'billw',
    games,
  };
}

describe('parseBackup', () => {
  it('accepts a well-formed backup', () => {
    const backup = makeBackup([makeGame()]);
    const parsed = parseBackup(JSON.stringify(backup));
    expect(parsed.format).toBe(BACKUP_FORMAT);
    expect(parsed.games).toHaveLength(1);
  });

  it('rejects non-JSON', () => {
    expect(() => parseBackup('not json {')).toThrow(/not valid JSON/i);
  });

  it('rejects a JSON object that is not a backup', () => {
    expect(() => parseBackup(JSON.stringify({ hello: 'world' }))).toThrow(/not a Pepper Scorer backup/i);
  });

  it('rejects a backup missing its games array', () => {
    expect(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT }))).toThrow(/not a Pepper Scorer backup/i);
  });

  it('rejects a bare JSON primitive', () => {
    expect(() => parseBackup('42')).toThrow(/not a Pepper Scorer backup/i);
  });
});

describe('describeBackupGame', () => {
  it('summarizes teams, score, hands, and status', () => {
    const info = describeBackupGame(makeGame());
    expect(info.teams).toBe('Us vs Them');
    expect(info.score).toBe('21 - 15');
    expect(info.hands).toBe(2);
    expect(info.status).toBe('completed');
  });

  it('falls back gracefully on missing fields', () => {
    const game = {
      id: 'g',
      data: { metadata: {}, players: [], teams: undefined, gameState: undefined },
    } as unknown as BackupGame;
    const info = describeBackupGame(game);
    expect(info.teams).toBe('Team 1 vs Team 2');
    expect(info.score).toBe('0 - 0');
    expect(info.hands).toBe(0);
  });
});

describe('restoreGameLocally', () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
        removeItem: (k: string) => {
          delete store[k];
        },
      },
      writable: true,
      configurable: true,
    });
  });

  it('writes the game state to localStorage.currentGame and strips the cloud id', () => {
    const game = makeGame();
    (game.data.gameState as unknown as { firebaseGameId?: string }).firebaseGameId = 'game123';
    restoreGameLocally(game);
    const stored = JSON.parse(localStorage.getItem('currentGame') as string);
    expect(stored.teams).toEqual(['Us', 'Them']);
    expect(stored.hands).toHaveLength(2);
    expect(stored.firebaseGameId).toBeUndefined();
  });
});
