// src/lib/data-export.ts
// Data backup / export (Phase 11 production polish). Lets a signed-in user download a JSON
// snapshot of all their games + profile, and re-import a backup to view/recover a game locally.
//
// This is read-only against Firebase (it never writes to the cloud), so it works within the
// existing security rules: it reads `userGames/$uid` (self), each `games/$gameId` the user is
// seated in, and `users/$uid` (self). Kept out of the ~1300-line FirebaseGameManager.
import { ref, get } from 'firebase/database';
import { getFirebaseDatabase, isFirebaseConfigured } from './firebase';
import type { FirebaseGameData } from './firebaseGameState';
import type { GameState } from './gameState';

export const BACKUP_FORMAT = 'pepper-scorer-backup';
export const BACKUP_VERSION = 1;

export interface BackupGame {
  id: string;
  data: FirebaseGameData;
}

export interface PepperBackup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string; // ISO timestamp
  userId: string;
  username?: string;
  games: BackupGame[];
}

// Read every game in the user's `userGames` list (active AND completed) plus their profile,
// and assemble a portable backup object. Returns null if Firebase is unavailable.
export async function exportUserData(userId: string): Promise<PepperBackup | null> {
  if (!isFirebaseConfigured()) return null;
  const database = getFirebaseDatabase();
  if (!database) return null;

  const userGamesSnap = await get(ref(database, `userGames/${userId}`));
  const gameIds = userGamesSnap.exists() ? Object.keys(userGamesSnap.val()) : [];

  const games: BackupGame[] = [];
  for (const id of gameIds) {
    const snap = await get(ref(database, `games/${id}`));
    if (snap.exists()) {
      games.push({ id, data: snap.val() as FirebaseGameData });
    }
  }

  // Best-effort username (self-readable); don't fail the whole export if it's unavailable.
  let username: string | undefined;
  try {
    const userSnap = await get(ref(database, `users/${userId}/username`));
    if (userSnap.exists()) username = userSnap.val() as string;
  } catch {
    /* ignore */
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    userId,
    username,
    games,
  };
}

// Trigger a browser download of the backup as a pretty-printed JSON file.
export function downloadBackup(backup: PepperBackup): void {
  const date = backup.exportedAt.slice(0, 10); // YYYY-MM-DD
  const filename = `pepper-scorer-backup-${date}.json`;
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Validate + parse a backup file's text. Throws with a human-readable message on bad input.
export function parseBackup(text: string): PepperBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('That file is not a Pepper Scorer backup.');
  }
  const backup = parsed as Partial<PepperBackup>;
  if (backup.format !== BACKUP_FORMAT || !Array.isArray(backup.games)) {
    throw new Error('That file is not a Pepper Scorer backup.');
  }
  return backup as PepperBackup;
}

// Human-friendly one-line summary of a backed-up game, for the import preview list.
export function describeBackupGame(game: BackupGame): {
  teams: string;
  score: string;
  status: string;
  hands: number;
  date: string;
} {
  const d = game.data;
  const teams = `${d.teams?.[0] ?? 'Team 1'} vs ${d.teams?.[1] ?? 'Team 2'}`;
  const scores = d.gameState?.scores ?? [0, 0];
  const created = d.metadata?.createdAt ? new Date(d.metadata.createdAt).toLocaleDateString() : '';
  return {
    teams,
    score: `${scores[0]} - ${scores[1]}`,
    status: d.metadata?.status ?? 'unknown',
    hands: d.gameState?.hands?.length ?? 0,
    date: created,
  };
}

// Restore a backed-up game to THIS device (localStorage) so it can be opened/reviewed in the
// game view. Purely local — it does not write to Firebase (which would violate the seated-player
// rules and duplicate cloud games). Strips the cloud id so the game opens in local-only mode.
export function restoreGameLocally(game: BackupGame): void {
  const state = { ...(game.data.gameState as GameState) } as GameState & { firebaseGameId?: string };
  delete state.firebaseGameId;
  localStorage.setItem('currentGame', JSON.stringify(state));
}
