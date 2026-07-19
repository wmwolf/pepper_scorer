// Regression tests for the live-game corruption of 2026-07-19, driven against the emulator with
// the REAL rules — the only place the interaction between turn-gating and the security rules is
// actually observable. Static reasoning about this got it wrong twice.
//
// The setup that broke a live game: a FIFTH account created the game and handed out the room
// code, so the creator (metadata.createdBy, i.e. the "host") was NOT one of the four seated
// players. gameState writes are granted only to seated uids, so every write that device produced
// was rejected — silently, because syncToFirebase logged and returned.
//
// Runs via `npm run test:emulator`. Requires a real Java runtime.

import { beforeAll, afterEach, describe, it, expect } from 'vitest'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { ref, get } from 'firebase/database'
import { getFirebaseAuth, getFirebaseDatabase } from '../../src/lib/firebase'
import { onAuthStateChange, getCurrentUser } from '../../src/lib/auth'
import { FirebaseGameManager } from '../../src/lib/firebaseGameState'
import { evaluateGating } from '../../src/lib/game'

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

async function remoteVersion(gameId: string): Promise<number> {
  const snap = await get(ref(getFirebaseDatabase()!, `games/${gameId}/gameState`))
  return FirebaseGameManager.versionOf(snap.val())
}

// Seat the four players; `creator` is deliberately NOT among them.
const SEATED = (uids: string[]) => [
  { userId: uids[0]!, username: 'alice', displayName: 'Alice', isAuthenticated: true, position: 0 },
  { userId: uids[1]!, username: 'bob', displayName: 'Bob', isAuthenticated: true, position: 1 },
  { userId: uids[2]!, username: 'carol', displayName: 'Carol', isAuthenticated: true, position: 2 },
  { userId: uids[3]!, username: 'dave', displayName: 'Dave', isAuthenticated: true, position: 3 },
]

// Create a game whose creator is a fifth, unseated account. Returns the game id and the
// creator's manager, still signed in as the creator.
async function createUnseatedHostGame(): Promise<{ gameId: string; hostGm: FirebaseGameManager; seats: string[] }> {
  const alice = await signIn('alice@test.dev')
  const bob = await signIn('bob@test.dev')
  const carol = await signIn('carol@test.dev')
  const dave = await signIn('dave@test.dev')
  const eve = await signIn('eve@test.dev')

  const hostGm = new FirebaseGameManager(['Alice', 'Bob', 'Carol', 'Dave'], ['We', 'They'])
  await hostGm.createFirebaseGame(SEATED([alice, bob, carol, dave]), eve)
  return { gameId: hostGm.getGameId()!, hostGm, seats: [alice, bob, carol, dave] }
}

beforeAll(() => {
  onAuthStateChange(() => {})
})

afterEach(async () => {
  await signOut(getFirebaseAuth()!).catch(() => {})
})

describe('unseated creator ("host") under the real rules', () => {
  it('is the host but holds no seat', async () => {
    const { hostGm } = await createUnseatedHostGame()
    expect(hostGm.isHost()).toBe(true)
    expect(hostGm.getMySeat()).toBeNull()
    // The accessor gating now depends on: no seat for the creator anywhere in the roster.
    expect(hostGm.getHostSeat()).toBeNull()
  })

  it('has every gameState write REJECTED by the rules', async () => {
    const { gameId, hostGm } = await createUnseatedHostGame()

    hostGm.addHandPart('1')
    await flush()

    // Local state advanced; the server never received it.
    expect(hostGm.getCurrentHand()).toBe('1')
    expect(await remoteHands(gameId)).toEqual([])
  })

  it('reports the rejection instead of swallowing it', async () => {
    const { gameId, hostGm } = await createUnseatedHostGame()

    hostGm.addHandPart('1')
    await flush()

    expect(await remoteHands(gameId)).toEqual([])
    // The whole reason this went unnoticed for a full game: nothing surfaced the failure.
    expect(hostGm.getLastSyncError()).toBeTruthy()
    expect(hostGm.getLastSyncError()).toMatch(/not allowed to record/i)
  })

  it('is gated to a read-only spectator, so the tap flow never accepts input', async () => {
    const { hostGm } = await createUnseatedHostGame()
    for (const phase of ['bidder', 'bid', 'trump', 'decision', 'tricks']) {
      const block = evaluateGating(hostGm, '12P', phase)
      expect(block, `phase ${phase}`).not.toBeNull()
      expect(block!.spectator, `phase ${phase}`).toBe(true)
    }
  })

  it('does not leave the seated players deadlocked waiting on it', async () => {
    const { gameId } = await createUnseatedHostGame()
    await signIn('alice@test.dev')
    const aliceGm = (await FirebaseGameManager.loadFirebaseGame(gameId))!
    // Alice is seated but is not the host. With an unseated creator there is no host who can
    // ever record, so gating must drop rather than block her forever.
    expect(aliceGm.getMySeat()).toBe(0)
    expect(aliceGm.isHost()).toBe(false)
    expect(evaluateGating(aliceGm, '12P', 'decision')).toBeNull()
  })
})

describe('a diverged device cannot overwrite good server state', () => {
  it('leaves the seated players\' hands intact when the diverged host force-syncs', async () => {
    const { gameId, hostGm } = await createUnseatedHostGame()

    // 1. The unseated host records a hand. Rejected, but its LOCAL state advances — this is the
    //    divergence: local content ahead of a version that never got bumped by a commit.
    hostGm.addHandPart('1')
    hostGm.addHandPart('2')
    hostGm.addHandPart('P')
    await flush()
    expect(hostGm.getCurrentHand()).toBe('12P')
    expect(await remoteHands(gameId)).toEqual([])

    // 2. Meanwhile a seated player records the real hands.
    await signIn('alice@test.dev')
    const aliceGm = (await FirebaseGameManager.loadFirebaseGame(gameId))!
    aliceGm.addHandPart('1')
    aliceGm.addHandPart('3')
    aliceGm.addHandPart('P')
    await flush()
    aliceGm.addHandPart('C')
    aliceGm.addHandPart('P')
    aliceGm.addHandPart('3')
    await flush()

    const truth = await remoteHands(gameId)
    const truthVersion = await remoteVersion(gameId)
    expect(truth.length).toBeGreaterThan(0)
    expect(truth[0]).toBe('13PCP3')

    // 3. The diverged device presses "Sync Now". This is the reported corruption: the stale
    //    branch overwriting the real game. It must defer instead.
    await signOut(getFirebaseAuth()!)
    await signIn('eve@test.dev')
    await hostGm.forceSyncToFirebase()
    await flush()

    expect(await remoteHands(gameId)).toEqual(truth)
    expect(await remoteVersion(gameId)).toBeGreaterThanOrEqual(truthVersion)
  })

  it('a seated device whose write failed cannot push its stale branch either', async () => {
    // Same divergence, but on a legitimately seated device — the failure mode is not specific to
    // the unseated host, any rejected or dropped write leaves content ahead of the version.
    const alice = await signIn('alice@test.dev')
    const bob = await signIn('bob@test.dev')
    const carol = await signIn('carol@test.dev')
    const dave = await signIn('dave@test.dev')

    await signIn('alice@test.dev')
    const gm = new FirebaseGameManager(['Alice', 'Bob', 'Carol', 'Dave'], ['We', 'They'])
    await gm.createFirebaseGame(SEATED([alice, bob, carol, dave]), alice)
    const gameId = gm.getGameId()!

    gm.addHandPart('1')
    await flush()

    // A second device advances the game several times, bumping the version well past what the
    // first device last agreed with the server on.
    await signIn('bob@test.dev')
    const bobGm = (await FirebaseGameManager.loadFirebaseGame(gameId))!
    bobGm.addHandPart('3')
    bobGm.addHandPart('P')
    await flush()
    bobGm.addHandPart('C')
    bobGm.addHandPart('P')
    bobGm.addHandPart('3')
    await flush()

    const truth = await remoteHands(gameId)

    // The first device force-syncs a state built from the OLD baseline. It must not win.
    await signIn('alice@test.dev')
    await gm.forceSyncToFirebase()
    await flush()

    expect(await remoteHands(gameId)).toEqual(truth)
  })
})

describe('a device whose version sits above the node is not wedged', () => {
  it('adopts the server value and can write again afterwards', async () => {
    // The compare-and-set in resolveSyncWrite defers whenever the versions disagree, INCLUDING
    // when the node sits below us. Without an unconditional adopt on deferral, such a device
    // could never commit again — it would defer forever with no way back. Here we force that
    // state by hand and check the device recovers.
    const alice = await signIn('alice@test.dev')
    const bob = await signIn('bob@test.dev')
    const carol = await signIn('carol@test.dev')
    const dave = await signIn('dave@test.dev')

    await signIn('alice@test.dev')
    const gm = new FirebaseGameManager(['Alice', 'Bob', 'Carol', 'Dave'], ['We', 'They'])
    await gm.createFirebaseGame(SEATED([alice, bob, carol, dave]), alice)
    const gameId = gm.getGameId()!

    gm.addHandPart('1')
    await flush()
    expect(await remoteHands(gameId)).toEqual(['1'])

    // Shove the local version far above the node's, as a stale localStorage restore would.
    ;(gm.state as { version?: number }).version = 999

    // First write defers (versions disagree) and must adopt the server value...
    gm.addHandPart('2')
    await flush()
    expect(FirebaseGameManager.versionOf(gm.state)).toBeLessThan(999)

    // ...after which the device works normally again.
    gm.addHandPart('2')
    gm.addHandPart('P')
    await flush()
    expect(await remoteHands(gameId)).toEqual(['12P'])
  })
})
