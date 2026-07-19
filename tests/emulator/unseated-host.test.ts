// Unseated hosts and unseated non-hosts, against the REAL rules. Static reasoning about this got
// it wrong twice, so it is pinned here.
//
// History: on 2026-07-19 a fifth account created a game and handed out the room code. It was
// therefore the "host" but held no seat, and the client let it into the whole tap flow while the
// rules — which then granted writes to seated uids only — rejected every write it produced,
// silently. Ten minutes of scoring were lost.
//
// Phase 12C makes that configuration SUPPORTED rather than blocked: metadata/currentHost may be
// held by an unseated account, and the rules grant it write access. So the tests below assert the
// inverse of what they originally did — while still pinning the case that must stay closed: a
// signed-in device that is neither seated nor host.
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

async function remoteHost(gameId: string): Promise<string | null> {
  const snap = await get(ref(getFirebaseDatabase()!, `games/${gameId}/metadata/currentHost`))
  return (snap.val() as string | null) || null
}

// Seat the four players; the creator is deliberately NOT among them.
const SEATED = (uids: string[]) => [
  { userId: uids[0]!, username: 'alice', displayName: 'Alice', isAuthenticated: true, position: 0 },
  { userId: uids[1]!, username: 'bob', displayName: 'Bob', isAuthenticated: true, position: 1 },
  { userId: uids[2]!, username: 'carol', displayName: 'Carol', isAuthenticated: true, position: 2 },
  { userId: uids[3]!, username: 'dave', displayName: 'Dave', isAuthenticated: true, position: 3 },
]

async function createUnseatedHostGame(): Promise<{
  gameId: string; hostGm: FirebaseGameManager; seats: string[]; eve: string
}> {
  const alice = await signIn('alice@test.dev')
  const bob = await signIn('bob@test.dev')
  const carol = await signIn('carol@test.dev')
  const dave = await signIn('dave@test.dev')
  const eve = await signIn('eve@test.dev')

  const hostGm = new FirebaseGameManager(['Alice', 'Bob', 'Carol', 'Dave'], ['We', 'They'])
  await hostGm.createFirebaseGame(SEATED([alice, bob, carol, dave]), eve)
  return { gameId: hostGm.getGameId()!, hostGm, seats: [alice, bob, carol, dave], eve }
}

beforeAll(() => {
  onAuthStateChange(() => {})
})

afterEach(async () => {
  localStorage.removeItem('pepperDeviceId')
  await signOut(getFirebaseAuth()!).catch(() => {})
})

describe('an unseated host administers the game (Phase 12C)', () => {
  it('is seeded as currentHost at creation, holding no seat', async () => {
    const { gameId, hostGm, eve } = await createUnseatedHostGame()
    expect(hostGm.isHost()).toBe(true)
    expect(hostGm.getMySeat()).toBeNull()
    expect(hostGm.getHostSeat()).toBeNull()
    // Seeded at creation — an unset claim would leave the creator unable to write at all,
    // since the rules key write access off this field.
    expect(await remoteHost(gameId)).toBe(eve)
  })

  it('CAN write gameState — the configuration this phase exists to support', async () => {
    const { gameId, hostGm } = await createUnseatedHostGame()

    hostGm.addHandPart('1')
    hostGm.addHandPart('2')
    hostGm.addHandPart('P')
    await flush()

    expect(await remoteHands(gameId)).toEqual(['12P'])
    expect(hostGm.getLastSyncError()).toBeNull()
  })

  it('is admitted to every phase of the tap flow', async () => {
    const { hostGm } = await createUnseatedHostGame()
    for (const phase of ['bidder', 'bid', 'trump', 'decision', 'tricks']) {
      expect(evaluateGating(hostGm, '12P', phase), `phase ${phase}`).toBeNull()
    }
  })

  it('leaves seated players waiting on it, as host-driven play intends', async () => {
    const { gameId } = await createUnseatedHostGame()
    await signIn('alice@test.dev')
    const aliceGm = (await FirebaseGameManager.loadFirebaseGame(gameId))!
    expect(aliceGm.getMySeat()).toBe(0)
    expect(aliceGm.isHost()).toBe(false)
    const block = evaluateGating(aliceGm, '12P', 'decision')
    expect(block).not.toBeNull()
    expect(block!.spectator).toBe(false)   // a seated player, not a spectator
  })
})

describe('a signed-in device that is neither seated nor host stays read-only', () => {
  it('has its writes rejected and is gated to a spectator', async () => {
    const { gameId } = await createUnseatedHostGame()

    // Frank is authenticated, holds no seat, and does not hold the host claim.
    await signIn('frank@test.dev')
    const frankGm = (await FirebaseGameManager.loadFirebaseGame(gameId))!
    expect(frankGm.getMySeat()).toBeNull()
    expect(frankGm.isHost()).toBe(false)

    for (const phase of ['bidder', 'bid', 'trump', 'decision', 'tricks']) {
      const block = evaluateGating(frankGm, '12P', phase)
      expect(block, `phase ${phase}`).not.toBeNull()
      expect(block!.spectator, `phase ${phase}`).toBe(true)
    }

    // And if it somehow does write anyway, the rules refuse and the failure is reported.
    frankGm.addHandPart('1')
    await flush()
    expect(await remoteHands(gameId)).toEqual([])
    expect(frankGm.getLastSyncError()).toMatch(/not allowed to record/i)
  })

  it('cannot claim host', async () => {
    const { gameId } = await createUnseatedHostGame()
    await signIn('frank@test.dev')
    const frankGm = (await FirebaseGameManager.loadFirebaseGame(gameId))!
    expect(frankGm.canClaimHost()).toBe(false)
    expect(await frankGm.claimHost()).toBe(false)
  })
})

describe('claiming and releasing the host role', () => {
  it('lets a seated player take over, and the previous host sees it', async () => {
    const { gameId, seats } = await createUnseatedHostGame()
    const alice = seats[0]!

    await signIn('alice@test.dev')
    const aliceGm = (await FirebaseGameManager.loadFirebaseGame(gameId))!
    expect(aliceGm.canClaimHost()).toBe(true)
    expect(await aliceGm.claimHost()).toBe(true)
    await flush()

    expect(await remoteHost(gameId)).toBe(alice)
    expect(aliceGm.isHost()).toBe(true)

    // The device that LOST host must stop believing it is one, or it keeps offering controls
    // whose writes are now rejected.
    //
    // Checked by re-loading rather than by watching a live listener: this harness drives every
    // account through ONE browser context, and signing out cancels the previous account's
    // listeners (reads require auth != null). Live push is exercised in the app, where each
    // device holds its own auth. The claim is what matters here, and it has persisted.
    await signIn('eve@test.dev')
    const eveGm = (await FirebaseGameManager.loadFirebaseGame(gameId))!
    expect(eveGm.getCurrentHostUid()).toBe(alice)
    expect(eveGm.isHost()).toBe(false)
  })

  it('moves write access along with the claim', async () => {
    const { gameId, hostGm } = await createUnseatedHostGame()

    await signIn('alice@test.dev')
    const aliceGm = (await FirebaseGameManager.loadFirebaseGame(gameId))!
    await aliceGm.claimHost()
    await flush()

    // Alice (now host, and seated) can write.
    aliceGm.addHandPart('1')
    await flush()
    expect(await remoteHands(gameId)).toEqual(['1'])

    // Eve, having lost the claim and holding no seat, can no longer write.
    await signIn('eve@test.dev')
    hostGm.addHandPart('2')
    await flush()
    expect(await remoteHands(gameId)).toEqual(['1'])
    expect(hostGm.getLastSyncError()).toBeTruthy()
  })

  it('releases the claim, leaving the game hostless and seated players unblocked', async () => {
    const { gameId, hostGm } = await createUnseatedHostGame()
    expect(await hostGm.releaseHost()).toBe(true)
    await flush()
    expect(await remoteHost(gameId)).toBeNull()

    await signIn('alice@test.dev')
    const aliceGm = (await FirebaseGameManager.loadFirebaseGame(gameId))!
    expect(aliceGm.getCurrentHostUid()).toBeNull()
    // Nobody to wait on, so a seated player must not be blocked.
    expect(evaluateGating(aliceGm, '12P', 'decision')).toBeNull()
  })
})

describe('a diverged device cannot overwrite good server state', () => {
  it('leaves the real hands intact when a rejected device force-syncs', async () => {
    const { gameId } = await createUnseatedHostGame()

    // Frank (no seat, no claim) records locally; every write is rejected, so his local state
    // runs ahead of a version that never advanced.
    await signIn('frank@test.dev')
    const frankGm = (await FirebaseGameManager.loadFirebaseGame(gameId))!
    frankGm.addHandPart('1')
    frankGm.addHandPart('2')
    frankGm.addHandPart('P')
    await flush()
    expect(frankGm.getCurrentHand()).toBe('12P')
    expect(await remoteHands(gameId)).toEqual([])

    // A seated player records the real hands.
    await signIn('alice@test.dev')
    const aliceGm = (await FirebaseGameManager.loadFirebaseGame(gameId))!
    await aliceGm.claimHost()
    aliceGm.addHandPart('1')
    aliceGm.addHandPart('3')
    aliceGm.addHandPart('P')
    await flush()
    aliceGm.addHandPart('C')
    aliceGm.addHandPart('P')
    aliceGm.addHandPart('3')
    await flush()

    const truth = await remoteHands(gameId)
    expect(truth[0]).toBe('13PCP3')

    // Frank presses "Sync Now". It must not push his stale branch.
    await signIn('frank@test.dev')
    await frankGm.forceSyncToFirebase()
    await flush()
    expect(await remoteHands(gameId)).toEqual(truth)
  })

  it('a seated device whose write failed cannot push its stale branch either', async () => {
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

    await signIn('alice@test.dev')
    await gm.forceSyncToFirebase()
    await flush()
    expect(await remoteHands(gameId)).toEqual(truth)
  })
})

describe('a device whose version sits above the node is not wedged', () => {
  it('adopts the server value and can write again afterwards', async () => {
    // resolveSyncWrite defers whenever the versions disagree, INCLUDING when the node sits below
    // us. Without an unconditional adopt on deferral, such a device could never commit again.
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

    ;(gm.state as { version?: number }).version = 999

    gm.addHandPart('2')
    await flush()
    expect(FirebaseGameManager.versionOf(gm.state)).toBeLessThan(999)

    gm.addHandPart('2')
    gm.addHandPart('P')
    await flush()
    expect(await remoteHands(gameId)).toEqual(['12P'])
  })
})
