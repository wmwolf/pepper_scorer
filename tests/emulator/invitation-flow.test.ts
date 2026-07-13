// End-to-end game-invitation tests against the emulator (Phase 9). Drives the REAL invitations.ts +
// FirebaseGameManager + auth.ts as the app does (the singleton firebase.ts app, pointed at the
// Auth+DB emulators), under the REAL database.rules.json. This proves the consent-layer model without
// a live Firebase connection: email/password sign-in against the Auth emulator gives real uids/auth
// contexts, which is all the invitation logic needs (it never touches Google specifically).
//
// Runs via `npm run test:emulator` (jsdom project). Requires a real Java runtime.

import { beforeAll, afterEach, describe, it, expect } from 'vitest'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { ref, get, set } from 'firebase/database'
import { getFirebaseAuth, getFirebaseDatabase } from '../../src/lib/firebase'
import { onAuthStateChange, getCurrentUser } from '../../src/lib/auth'
import { FirebaseGameManager } from '../../src/lib/firebaseGameState'
import { getPendingInvitations, acceptInvitation, declineInvitation, subscribeToInvitations } from '../../src/lib/invitations'

const PW = 'password123'

async function waitUntil(pred: () => boolean, ms = 4000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('waitUntil timed out')
    await new Promise(r => setTimeout(r, 25))
  }
}

// Sign in (creating the account on first use), and wait for auth.ts to populate its PepperUser.
async function signIn(email: string): Promise<string> {
  const auth = getFirebaseAuth()!
  await signOut(auth).catch(() => {})
  let uid: string
  try {
    uid = (await createUserWithEmailAndPassword(auth, email, PW)).user.uid
  } catch {
    uid = (await signInWithEmailAndPassword(auth, email, PW)).user.uid
  }
  await waitUntil(() => getCurrentUser()?.uid === uid)
  return uid
}

const flush = () => new Promise(r => setTimeout(r, 400))
const db = () => getFirebaseDatabase()!

// Alice (creator, seat 0) creates a game inviting `invitee` at seat 1. Returns the game id. Must be
// called while Alice is the signed-in user (createFirebaseGame writes the invitation as the creator).
async function createGameInviting(aliceUid: string, inviteeUid: string): Promise<string> {
  const gm = new FirebaseGameManager(['Alice', 'Bob', 'Carol', 'Dave'], ['We', 'They'])
  await gm.createFirebaseGame(
    [
      { userId: aliceUid, username: 'alice', displayName: 'Alice', isAuthenticated: true, position: 0 },
      { userId: inviteeUid, username: 'invitee', displayName: 'Invitee', isAuthenticated: true, position: 1 },
    ],
    aliceUid,
  )
  await flush()
  return gm.getGameId()!
}

beforeAll(() => {
  // Install auth.ts's onAuthStateChanged listener (it registers on the first subscription).
  onAuthStateChange(() => {})
})

afterEach(async () => {
  await signOut(getFirebaseAuth()!).catch(() => {})
})

describe('game invitations — accept', () => {
  it('invites (not silently seeds) a registered player, who accepts to see the game', async () => {
    // Establish the invitee's account first so the creator can reference its uid.
    const bob = await signIn('accept-bob@test.dev')
    const alice = await signIn('alice@test.dev')
    const gameId = await createGameInviting(alice, bob)

    // Creator seeded THEIR OWN active games...
    const aliceGames = await FirebaseGameManager.getUserActiveGames(alice)
    expect(aliceGames.some(g => g.id === gameId)).toBe(true)

    // ...but the invitee was NOT silently added to their list (consent layer).
    await signIn('accept-bob@test.dev')
    expect((await get(ref(db(), `userGames/${bob}/${gameId}`))).val()).toBeNull()

    // The invitee sees a pending invitation with the right details.
    const pending = await getPendingInvitations(bob)
    expect(pending).toHaveLength(1)
    const inv = pending[0]
    expect(inv.gameId).toBe(gameId)
    expect(inv.from).toBe(alice)
    expect(inv.fromName).toBe('Alice')
    expect(inv.seat).toBe(1)
    expect(inv.teamIndex).toBe(1)
    expect(inv.partnerName).toBe('Dave') // seat 1's partner is seat 3
    expect(inv.teams).toEqual(['We', 'They'])

    // Accepting adds the game to the invitee's active games and clears the invitation.
    expect(await acceptInvitation(gameId)).toBe(true)
    expect((await get(ref(db(), `userGames/${bob}/${gameId}`))).val()).toBe(true)
    expect(await getPendingInvitations(bob)).toHaveLength(0)
  })
})

describe('game invitations — decline', () => {
  it('declining drops the invitation without adding the game', async () => {
    const carol = await signIn('decline-carol@test.dev')
    const alice = await signIn('alice@test.dev')
    const gameId = await createGameInviting(alice, carol)

    await signIn('decline-carol@test.dev')
    expect(await getPendingInvitations(carol)).toHaveLength(1)

    expect(await declineInvitation(gameId)).toBe(true)
    expect(await getPendingInvitations(carol)).toHaveLength(0)
    expect((await get(ref(db(), `userGames/${carol}/${gameId}`))).val()).toBeNull()
  })
})

describe('game invitations — live subscription', () => {
  it('pushes the current list on subscribe and on change, and stops after unsubscribe', async () => {
    const bob = await signIn('live-bob@test.dev')
    const alice = await signIn('alice@test.dev')
    const gameId = await createGameInviting(alice, bob)

    await signIn('live-bob@test.dev')
    const lengths: number[] = []
    const unsub = subscribeToInvitations(bob, (invs) => { lengths.push(invs.length) })

    // Immediate emission includes the pending invite.
    await waitUntil(() => lengths.includes(1))

    // Accepting resolves it; the listener re-fires with an empty list — no manual reload.
    await acceptInvitation(gameId)
    await waitUntil(() => lengths[lengths.length - 1] === 0)

    // After unsubscribing, a further change to the node emits nothing.
    unsub()
    const before = lengths.length
    await set(ref(db(), `invitations/${bob}/dummy`), {
      gameId: 'dummy', from: bob, fromName: 'x', teams: ['a', 'b'],
      seat: 1, teamIndex: 1, partnerName: 'p', createdAt: 1,
    })
    await flush()
    expect(lengths.length).toBe(before)
  })
})

describe('game invitations — pruning', () => {
  it('prunes an invitation whose game has been completed', async () => {
    const dave = await signIn('prune-dave@test.dev')
    const alice = await signIn('alice@test.dev')
    const gameId = await createGameInviting(alice, dave)

    // Alice (a seated player) marks the game completed.
    await set(ref(db(), `games/${gameId}/metadata/status`), 'completed')

    // The stale invitation is filtered out AND cleaned up on the next load.
    await signIn('prune-dave@test.dev')
    expect(await getPendingInvitations(dave)).toHaveLength(0)
    expect((await get(ref(db(), `invitations/${dave}/${gameId}`))).val()).toBeNull()
  })
})
