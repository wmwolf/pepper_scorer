// Probe: the tap flow has MORE THAN ONE writer per hand by design — the host enters
// bidder/bid/decision/tricks, but the bid winner enters their OWN trump from their own device
// (see evaluateGating's trump exception). So two devices write to the same hand, seconds apart,
// each from whatever baseline its listener last delivered.
//
// syncToFirebase resolves a losing write by DEFERRING and adopting the remote — which discards
// the local edit that triggered the sync. These tests check whether an edit can be silently lost
// that way, which is the shape of "game state is not fully syncing between devices".
//
// Runs via `npm run test:emulator`. Requires a real Java runtime.

import { beforeAll, afterEach, describe, it, expect } from 'vitest'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { ref, get } from 'firebase/database'
import { getFirebaseAuth, getFirebaseDatabase } from '../../src/lib/firebase'
import { onAuthStateChange, getCurrentUser } from '../../src/lib/auth'
import { FirebaseGameManager } from '../../src/lib/firebaseGameState'

const PW = 'password123'

async function waitUntil(pred: () => boolean, ms = 4000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('waitUntil timed out')
    await new Promise(r => setTimeout(r, 25))
  }
}

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

const SEATED = (uids: string[]) => [
  { userId: uids[0]!, username: 'alice', displayName: 'Alice', isAuthenticated: true, position: 0 },
  { userId: uids[1]!, username: 'bob', displayName: 'Bob', isAuthenticated: true, position: 1 },
  { userId: uids[2]!, username: 'carol', displayName: 'Carol', isAuthenticated: true, position: 2 },
  { userId: uids[3]!, username: 'dave', displayName: 'Dave', isAuthenticated: true, position: 3 },
]

beforeAll(() => {
  onAuthStateChange(() => {})
})

afterEach(async () => {
  await signOut(getFirebaseAuth()!).catch(() => {})
})

describe('two seated devices writing the same hand', () => {
  it('keeps BOTH devices\' contributions when the writes are spaced out', async () => {
    // The ordinary case: host sets bidder+bid, the bid winner adds trump from their phone.
    const alice = await signIn('alice@test.dev')
    const bob = await signIn('bob@test.dev')
    const carol = await signIn('carol@test.dev')
    const dave = await signIn('dave@test.dev')

    await signIn('alice@test.dev')
    const hostGm = new FirebaseGameManager(['Alice', 'Bob', 'Carol', 'Dave'], ['We', 'They'])
    await hostGm.createFirebaseGame(SEATED([alice, bob, carol, dave]), alice)
    const gameId = hostGm.getGameId()!

    // Host: dealer 1, bid winner 2 (Bob), bid P.
    hostGm.addHandPart('1')
    hostGm.addHandPart('2')
    hostGm.addHandPart('P')
    await flush()
    expect(await remoteHands(gameId)).toEqual(['12P'])

    // Bob's device loads and enters his own trump.
    await signIn('bob@test.dev')
    const bobGm = (await FirebaseGameManager.loadFirebaseGame(gameId))!
    bobGm.addHandPart('C')
    await flush()

    expect(await remoteHands(gameId)).toEqual(['12PC'])
  })

  it('does not silently drop an edit made from a stale baseline', async () => {
    // The risky case: Bob's device loaded BEFORE the host finished the bid, so it syncs from an
    // older baseline. If the losing write is simply deferred, Bob's trump vanishes with no error
    // and no retry — the hand sits unfinished on every device.
    const alice = await signIn('alice@test.dev')
    const bob = await signIn('bob@test.dev')
    const carol = await signIn('carol@test.dev')
    const dave = await signIn('dave@test.dev')

    await signIn('alice@test.dev')
    const hostGm = new FirebaseGameManager(['Alice', 'Bob', 'Carol', 'Dave'], ['We', 'They'])
    await hostGm.createFirebaseGame(SEATED([alice, bob, carol, dave]), alice)
    const gameId = hostGm.getGameId()!

    hostGm.addHandPart('1')
    await flush()

    // Bob loads here — his baseline is the dealer-only state.
    await signIn('bob@test.dev')
    const bobGm = (await FirebaseGameManager.loadFirebaseGame(gameId))!

    // Host moves the hand on, twice, while Bob's device sits on its stale baseline.
    await signIn('alice@test.dev')
    hostGm.addHandPart('2')
    hostGm.addHandPart('P')
    await flush()
    expect(await remoteHands(gameId)).toEqual(['12P'])

    // Now Bob enters his trump from the stale baseline. His step ('C' onto '1') is no longer the
    // current one — the hand is already at '12P' awaiting a decision. The write must not be lost
    // in silence: Bob's device re-syncs to the real state and flashes a benign notice. (In the
    // collision-safe model this is the norm, not a failure — the notice channel, not the error.)
    let notices = 0
    bobGm.setSyncNoticeCallback(() => { notices++ })
    await signIn('bob@test.dev')
    bobGm.addHandPart('C')
    await flush()

    // Bob's stale write did not corrupt the hand, and he was told.
    expect(await remoteHands(gameId)).toEqual(['12P'])
    expect(bobGm.getCurrentHand()).toBe('12P')       // re-synced to the truth
    expect(notices).toBeGreaterThan(0)
    expect(bobGm.getLastSyncError()).toBeNull()      // benign, not a persistent error
  })
})
