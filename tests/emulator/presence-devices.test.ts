// Phase 12B: per-device presence against the emulator. The Phase 8 node was keyed by uid alone,
// so one account signed in on a phone and a laptop was a single entry — the app could not tell
// "this player is playing" from "this player's only client is spectating". Presence is now
// keyed by uid AND deviceId.
//
// Runs via `npm run test:emulator`. Requires a real Java runtime.

import { beforeAll, afterEach, describe, it, expect } from 'vitest'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { ref, get, set } from 'firebase/database'
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

describe('per-device presence', () => {
  it('writes presence under uid/deviceId with the device role, and the rules allow it', async () => {
    const alice = await signIn('alice@test.dev')
    const bob = await signIn('bob@test.dev')
    const carol = await signIn('carol@test.dev')
    const dave = await signIn('dave@test.dev')

    await signIn('alice@test.dev')
    const gm = new FirebaseGameManager(['Alice', 'Bob', 'Carol', 'Dave'], ['We', 'They'])
    await gm.createFirebaseGame(SEATED([alice, bob, carol, dave]), alice)
    const gameId = gm.getGameId()!

    gm.setupPresence()
    await flush()

    const snap = await get(ref(getFirebaseDatabase()!, `games/${gameId}/presence/${alice}`))
    const devices = snap.val() as Record<string, { mode: string }>
    expect(devices).toBeTruthy()
    const entries = Object.values(devices)
    expect(entries).toHaveLength(1)
    // Alice is seated, so her device defaults to player mode.
    expect(entries[0]!.mode).toBe('player')
  })

  it('distinguishes a seated player spectating on a second device', async () => {
    const alice = await signIn('alice@test.dev')
    const bob = await signIn('bob@test.dev')
    const carol = await signIn('carol@test.dev')
    const dave = await signIn('dave@test.dev')

    await signIn('alice@test.dev')
    const gm = new FirebaseGameManager(['Alice', 'Bob', 'Carol', 'Dave'], ['We', 'They'])
    await gm.createFirebaseGame(SEATED([alice, bob, carol, dave]), alice)
    const gameId = gm.getGameId()!
    gm.setupPresence()
    await flush()

    // A SECOND device for the same account, spectating. Written directly: one browser context
    // has one deviceId, so a second device is simulated at the node.
    await set(ref(getFirebaseDatabase()!, `games/${gameId}/presence/${alice}/laptop`),
      { mode: 'spectator', ts: Date.now() })
    await flush()

    // Both devices are visible, and the seat still counts as playable because the phone is.
    expect(gm.getPresentRoles(alice)).toHaveLength(2)
    expect(gm.getPresentRoles(alice)).toEqual(expect.arrayContaining(['player', 'spectator']))
    expect(gm.seatHasPlayerDevice(0)).toBe(true)
    expect(gm.isSeatPresent(0)).toBe(true)
  })

  it('reports a seat as unplayable when its only device is spectating', async () => {
    const alice = await signIn('alice@test.dev')
    const bob = await signIn('bob@test.dev')
    const carol = await signIn('carol@test.dev')
    const dave = await signIn('dave@test.dev')

    await signIn('alice@test.dev')
    const gm = new FirebaseGameManager(['Alice', 'Bob', 'Carol', 'Dave'], ['We', 'They'])
    await gm.createFirebaseGame(SEATED([alice, bob, carol, dave]), alice)
    const gameId = gm.getGameId()!

    // Bob joins on his own device and switches it to spectating. Driven through a real second
    // manager rather than a raw write: presence/$uid is self-write only, and signing in as Bob
    // resets the realtime connection, which fires the onDisconnect cleanup for other clients.
    await signIn('bob@test.dev')
    const bobGm = (await FirebaseGameManager.loadFirebaseGame(gameId))!
    bobGm.setDeviceRole('spectator')
    bobGm.setupPresence()
    await flush()

    expect(bobGm.getPresentRoles(bob)).toEqual(['spectator'])
    expect(bobGm.isSeatPresent(1)).toBe(true)          // Bob IS online...
    expect(bobGm.seatHasPlayerDevice(1)).toBe(false)   // ...but cannot take part in the auction.
    expect(bobGm.allSeatsHavePlayerDevice()).toBe(false)
  })

  it('lets one account be a PLAYER on one device and the HOST on another, at once', async () => {
    // The "one user, two devices, two roles" workflow: a seated player scores/hosts on a laptop
    // while playing on their phone. The seat must stay playable (its phone is a player device) and
    // BOTH roles' writes must be accepted for the one account against the real rules.
    const alice = await signIn('alice@test.dev')
    const bob = await signIn('bob@test.dev')
    const carol = await signIn('carol@test.dev')
    const dave = await signIn('dave@test.dev')

    await signIn('alice@test.dev')
    const gm = new FirebaseGameManager(['Alice', 'Bob', 'Carol', 'Dave'], ['We', 'They'])
    await gm.createFirebaseGame(SEATED([alice, bob, carol, dave]), alice)
    const gameId = gm.getGameId()!
    gm.setDeviceRole('player') // the phone: Alice plays here
    gm.setupPresence()
    await flush()

    // The laptop: same account, host role, distinct deviceId. One browser context has one deviceId,
    // so the second device is written at the node (self-write, allowed by the rules).
    await set(ref(getFirebaseDatabase()!, `games/${gameId}/presence/${alice}/laptop`),
      { mode: 'host', ts: Date.now() })
    await flush()

    // Both roles are live for the one account, and the seat is still playable (the phone plays).
    expect(gm.getPresentRoles(alice)).toEqual(expect.arrayContaining(['player', 'host']))
    expect(gm.seatHasPlayerDevice(0)).toBe(true)

    // The account can act as a PLAYER (enter a bid) — accepted by the rules for a seated uid.
    gm.addHandPart('1') // dealer 1, phase bidder
    await flush()
    await gm.ensureAuctionForCurrentHand()
    await gm.enterBid(1, '5') // Alice's own seat (1-based)
    const biddingSnap = await get(ref(getFirebaseDatabase()!, `games/${gameId}/bidding`))
    expect(biddingSnap.exists()).toBe(true)

    // ...and as the HOST (abort the auction + declare a winner) — accepted for currentHost=Alice.
    await gm.hostTakeoverBidder(2)
    await flush()
    const cleared = await get(ref(getFirebaseDatabase()!, `games/${gameId}/bidding`))
    expect(cleared.exists()).toBe(false)
    const hands = await get(ref(getFirebaseDatabase()!, `games/${gameId}/gameState/hands`))
    expect((hands.val() as string[])[0]).toBe('12')
  })

  it('re-announces with the new role when the device switches modes', async () => {
    const alice = await signIn('alice@test.dev')
    const bob = await signIn('bob@test.dev')
    const carol = await signIn('carol@test.dev')
    const dave = await signIn('dave@test.dev')

    await signIn('alice@test.dev')
    const gm = new FirebaseGameManager(['Alice', 'Bob', 'Carol', 'Dave'], ['We', 'They'])
    await gm.createFirebaseGame(SEATED([alice, bob, carol, dave]), alice)
    const gameId = gm.getGameId()!
    gm.setupPresence()
    await flush()
    expect(gm.getDeviceRole()).toBe('player')

    gm.setDeviceRole('spectator')
    await flush()

    const snap = await get(ref(getFirebaseDatabase()!, `games/${gameId}/presence/${alice}`))
    const modes = Object.values(snap.val() as Record<string, { mode: string }>).map(d => d.mode)
    expect(modes).toEqual(['spectator'])
    expect(gm.seatHasPlayerDevice(0)).toBe(false)
  })
})
