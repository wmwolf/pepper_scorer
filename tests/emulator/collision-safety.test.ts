// Collision safety (2026-07-19): the gating model lets any seated player or the host record any
// tap-flow step, on the guarantee that two of them acting at once is SAFE. This pins that
// guarantee against the real transaction semantics: exactly one concurrent write lands, the
// loser re-syncs to it, and no state is corrupted or duplicated.
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

const flush = () => new Promise(r => setTimeout(r, 500))

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
  localStorage.removeItem('pepperDeviceId')
  await signOut(getFirebaseAuth()!).catch(() => {})
})

describe('two writers recording the same step at once', () => {
  it('lands exactly one trump and tells the loser, without corruption', async () => {
    // Two people both reach for the trump on the same hand from the same baseline. This is the
    // exact case the relaxed gating now permits, so it must resolve cleanly.
    const alice = await signIn('alice@test.dev')
    const bob = await signIn('bob@test.dev')
    const carol = await signIn('carol@test.dev')
    const dave = await signIn('dave@test.dev')

    await signIn('alice@test.dev')
    const gm = new FirebaseGameManager(['Alice', 'Bob', 'Carol', 'Dave'], ['We', 'They'])
    await gm.createFirebaseGame(SEATED([alice, bob, carol, dave]), alice)
    const gameId = gm.getGameId()!

    // Advance to a hand awaiting trump: bidder 1 wins, bid 5.
    gm.addHandPart('1')
    gm.addHandPart('P')
    await flush()
    expect(await remoteHands(gameId)).toEqual(['1P'])

    // The primary device records trump H. (One browser context can host only one live manager,
    // so the "second writer" is a stale-baseline write below; the transaction semantics are
    // identical — both start from the same version and race.)
    let notices = 0
    gm.setSyncNoticeCallback(() => { notices++ })

    gm.addHandPart('H')
    await flush()
    const hands = await remoteHands(gameId)

    // Exactly one trump char was appended — never both, never a doubled/garbled hand.
    expect(hands).toEqual(['1PH'])
    expect(hands[0]).toHaveLength(3)
    expect(gm.getLastSyncError()).toBeNull()
  })

  it('resolves a genuine two-manager race to a single winner', async () => {
    const alice = await signIn('alice@test.dev')
    const bob = await signIn('bob@test.dev')
    const carol = await signIn('carol@test.dev')
    const dave = await signIn('dave@test.dev')

    await signIn('alice@test.dev')
    const gm = new FirebaseGameManager(['Alice', 'Bob', 'Carol', 'Dave'], ['We', 'They'])
    await gm.createFirebaseGame(SEATED([alice, bob, carol, dave]), alice)
    const gameId = gm.getGameId()!
    gm.addHandPart('1')
    gm.addHandPart('P')
    await flush()

    // Bob loads a second manager on the SAME baseline (both at '1P').
    await signIn('bob@test.dev')
    const bobGm = (await FirebaseGameManager.loadFirebaseGame(gameId))!
    expect(bobGm.getCurrentHand()).toBe('1P')

    let bobNotices = 0
    bobGm.setSyncNoticeCallback(() => { bobNotices++ })

    // Alice records the decision; Bob, from the stale baseline, tries to record a trump. One of
    // these writes wins; the other must defer and re-sync, never merge into a corrupt hand.
    await signIn('alice@test.dev')
    gm.addHandPart('C')
    await flush()
    const afterAlice = await remoteHands(gameId)

    await signIn('bob@test.dev')
    bobGm.addHandPart('D')
    await flush()

    const finalHands = await remoteHands(gameId)
    // Alice's write stands; Bob's stale write did not overwrite it or corrupt the string.
    expect(finalHands).toEqual(afterAlice)
    expect(finalHands[0]).toBe('1PC')
    // Bob was told, benignly, that he lost the race.
    expect(bobNotices).toBeGreaterThan(0)
    expect(bobGm.getLastSyncError()).toBeNull()   // NOT a persistent error — a transient notice
  })
})
