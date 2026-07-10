// End-to-end FirebaseGameManager tests against the emulator, driving the REAL manager + auth.ts
// as the app does (the singleton firebase.ts app, pointed at the Auth+DB emulators). Verifies the
// two fixes that live in the untested Firebase layer:
//   1. Host gating — isHost()/hostUid derive correctly from metadata.createdBy.
//   2. Multi-part sync coalescing — two rapid addHandPart() calls (pepper auto-bid, negotiate,
//      clubs-forces-play) both persist to the REMOTE state instead of the second being dropped.
//
// Runs via `npm run test:emulator` (jsdom project). Requires a real Java runtime.

import { beforeAll, afterEach, describe, it, expect } from 'vitest'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { ref, get } from 'firebase/database'
import { getFirebaseAuth, getFirebaseDatabase } from '../../src/lib/firebase'
import { onAuthStateChange, getCurrentUser } from '../../src/lib/auth'
import { FirebaseGameManager } from '../../src/lib/firebaseGameState'

const PW = 'password123'

async function waitUntil(pred: () => boolean, ms = 4000): Promise<void> {
  const start = Date.now()
  // Date.now() is fine here (real test, not a workflow script).
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

async function remoteHands(gameId: string): Promise<string[]> {
  const snap = await get(ref(getFirebaseDatabase()!, `games/${gameId}/gameState/hands`))
  return (snap.val() as string[]) || []
}

beforeAll(() => {
  // Install auth.ts's onAuthStateChanged listener (it registers on the first subscription).
  onAuthStateChange(() => {})
})

afterEach(async () => {
  await signOut(getFirebaseAuth()!).catch(() => {})
})

describe('FirebaseGameManager host gating', () => {
  it('marks the creator as host and a non-creator as not host', async () => {
    const alice = await signIn('alice@test.dev')
    const gm = new FirebaseGameManager(['Alice', 'Bob', 'Carol', 'Dave'], ['We', 'They'])
    await gm.createFirebaseGame(
      [{ userId: alice, username: 'alice', displayName: 'Alice', isAuthenticated: true, position: 0 }],
      alice,
    )
    const gameId = gm.getGameId()!
    expect(gameId).toBeTruthy()
    expect(gm.isHost()).toBe(true)
    expect(gm.getHostSeat()).toBe(0)

    // A different signed-in user loading the same game is NOT the host.
    await signIn('bob@test.dev')
    const gm2 = await FirebaseGameManager.loadFirebaseGame(gameId)
    expect(gm2).toBeTruthy()
    expect(gm2!.isHost()).toBe(false)
  })
})

describe('FirebaseGameManager multi-part sync coalescing', () => {
  it('persists BOTH parts of a rapid two-part mutation to the remote state', async () => {
    const alice = await signIn('alice@test.dev')
    const gm = new FirebaseGameManager(['Alice', 'Bob', 'Carol', 'Dave'], ['We', 'They'])
    await gm.createFirebaseGame(
      [{ userId: alice, username: 'alice', displayName: 'Alice', isAuthenticated: true, position: 0 }],
      alice,
    )
    const gameId = gm.getGameId()!

    // Set the dealer in its own tick, let it sync.
    gm.addHandPart('1')
    await flush()
    expect(await remoteHands(gameId)).toEqual(['1'])

    // The bug: two rapid addHandPart() calls each fired a version-guarded transaction; the second
    // deferred and applyRemoteState pulled the first (partial) write back in, dropping a part.
    // Simulate the pepper auto-bid: bid winner + 'P' in ONE tick.
    gm.addHandPart('2')
    gm.addHandPart('P')
    await flush()

    // Both parts must have reached the REMOTE state (not just local).
    expect(await remoteHands(gameId)).toEqual(['12P'])
    expect(gm.getCurrentHand()).toBe('12P')
  })

  it('coalesces a three-part burst (initial-hand setup) into the final state', async () => {
    const alice = await signIn('alice@test.dev')
    const gm = new FirebaseGameManager(['Alice', 'Bob', 'Carol', 'Dave'], ['We', 'They'])
    await gm.createFirebaseGame(
      [{ userId: alice, username: 'alice', displayName: 'Alice', isAuthenticated: true, position: 0 }],
      alice,
    )
    const gameId = gm.getGameId()!

    // dealer 1 + bid winner 2 + pepper bid 'P', all in one synchronous burst.
    gm.addHandPart('1')
    gm.addHandPart('2')
    gm.addHandPart('P')
    await flush()

    expect(await remoteHands(gameId)).toEqual(['12P'])
  })
})
