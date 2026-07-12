// src/lib/invitations.ts
//
// Phase 9 game invitation system. Registered players (other than the creator) are SEATED at game
// creation — the RTDB rules make `games/$gameId/players` immutable after creation, so seating must
// happen up front for `gameState` writes to work. The invitation is therefore a consent/notification
// layer, NOT a seating mechanism: it gates whether an invited player's game shows in their
// dashboard. Accept => add `userGames/$uid/$gameId` (game appears); Decline => just drop the invite.
// The invitee is seated either way; declining simply hides it from their list.
//
// Data lives at `invitations/$inviteeUid/$gameId` (invitee-private; see database.rules.json). No PII
// beyond display names already visible in `games/$gameId/players`.
import { ref, set, get, remove } from 'firebase/database';
import { getFirebaseDatabase, isFirebaseConfigured } from './firebase';
import { getCurrentUser } from './auth';

export interface GameInvitation {
  gameId: string;
  from: string; // creator uid — also drives the write rule
  fromName: string; // creator display name (for the "X invited you" line)
  teams: [string, string];
  seat: number; // 0-3 position in the game
  teamIndex: 0 | 1; // seat % 2 — which team the invitee is on
  partnerName: string; // display name of the invitee's partner (the other seat on their team)
  roomCode?: string;
  createdAt: number;
}

// One registered invitee to be notified about a freshly created game.
export interface InvitationTarget {
  userId: string;
  seat: number; // 0-3
  partnerName: string;
}

// Write pending invitations for a newly created game. Called from the game-creation flow AFTER the
// game node exists — this ordering matters: the rule authorizes each write only if `from === auth.uid`
// AND the caller is the referenced game's `metadata/createdBy` (so a stranger can't forge invitations
// into someone else's node), which requires the game to already exist. Failures are swallowed
// per-invite so one bad invitee can't abort game creation.
export async function createGameInvitations(
  gameId: string,
  meta: { from: string; fromName: string; teams: [string, string]; roomCode?: string },
  targets: InvitationTarget[]
): Promise<void> {
  if (!isFirebaseConfigured()) return;
  const database = getFirebaseDatabase();
  if (!database) return;

  const createdAt = Date.now();
  for (const target of targets) {
    if (!target.userId || target.userId === meta.from) continue;
    const invitation: GameInvitation = {
      gameId,
      from: meta.from,
      fromName: meta.fromName,
      teams: meta.teams,
      seat: target.seat,
      teamIndex: (target.seat % 2) as 0 | 1,
      partnerName: target.partnerName,
      roomCode: meta.roomCode,
      createdAt
    };
    try {
      // Strip undefined (RTDB rejects it) — e.g. a game with no room code.
      await set(
        ref(database, `invitations/${target.userId}/${gameId}`),
        JSON.parse(JSON.stringify(invitation))
      );
    } catch (error) {
      console.error('Error creating invitation for', target.userId, error);
    }
  }
}

// All pending invitations for a user, newest first. Prunes any invitation whose game has been
// deleted or already completed so stale rows don't linger in the UI.
export async function getPendingInvitations(uid: string): Promise<GameInvitation[]> {
  if (!isFirebaseConfigured() || !uid) return [];
  const database = getFirebaseDatabase();
  if (!database) return [];

  try {
    const snapshot = await get(ref(database, `invitations/${uid}`));
    if (!snapshot.exists()) return [];

    const byGame = snapshot.val() as Record<string, GameInvitation>;
    const invitations: GameInvitation[] = [];

    for (const [gameId, invitation] of Object.entries(byGame)) {
      const gameSnap = await get(ref(database, `games/${gameId}`));
      const status = gameSnap.exists() ? gameSnap.val()?.metadata?.status : null;
      if (!gameSnap.exists() || status === 'completed') {
        // Game gone or finished — the invite is moot; clean it up.
        await remove(ref(database, `invitations/${uid}/${gameId}`)).catch(() => {});
        continue;
      }
      invitations.push({ ...invitation, gameId });
    }

    return invitations.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } catch (error) {
    console.error('Error loading invitations:', error);
    return [];
  }
}

// Accept an invitation: add the game to the invitee's active games (so it surfaces in the
// dashboard), then drop the invitation. The invitee is already seated in `players`, so nothing
// else is needed to play. Returns true on success.
export async function acceptInvitation(gameId: string): Promise<boolean> {
  const user = getCurrentUser();
  if (!isFirebaseConfigured() || !user) return false;
  const database = getFirebaseDatabase();
  if (!database) return false;

  try {
    await set(ref(database, `userGames/${user.uid}/${gameId}`), true);
    await remove(ref(database, `invitations/${user.uid}/${gameId}`));
    return true;
  } catch (error) {
    console.error('Error accepting invitation:', error);
    return false;
  }
}

// Decline an invitation: drop it without adding to active games. The seat stays reserved in the
// game data (the roster is immutable), but the game never appears in the decliner's dashboard.
export async function declineInvitation(gameId: string): Promise<boolean> {
  const user = getCurrentUser();
  if (!isFirebaseConfigured() || !user) return false;
  const database = getFirebaseDatabase();
  if (!database) return false;

  try {
    await remove(ref(database, `invitations/${user.uid}/${gameId}`));
    return true;
  } catch (error) {
    console.error('Error declining invitation:', error);
    return false;
  }
}
