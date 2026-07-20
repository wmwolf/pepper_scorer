// Host-takeover-of-a-live-auction tests against the Firebase emulator, driving the REAL
// FirebaseGameManager + auth.ts (the singleton firebase.ts app, pointed at the emulators) — the
// same setup as manager-flow.test.ts. Covers the "role-aware auction + host takeover" build:
//   1. hostTakeoverBidder() aborts the live auction (clears the bidding node) and writes the bidder
//      part into gameState — the explicit auction abort Phase E needed.
//   2. A throw-in takeover ("no one bid") completes the hand outright.
//   3. The reveal-delay race guard: a completed auction's DELAYED applyAuctionToHand must NOT apply
//      once the bidding node has been aborted, even if this device's local phase hasn't advanced —
//      the host's decision is authoritative. This is the 2.8s race that broke backgrounded phones.
//
// Runs via `npm run test:emulator` (jsdom project). Requires a real Java runtime.

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

const flush = () => new Promise(r => setTimeout(r, 400))

// The manager's reveal hold before a completed auction applies. Keep in sync with
// FirebaseGameManager.AUCTION_REVEAL_MS (2800). We wait a bit past it to let the stale timer fire.
const REVEAL_MS = 2800

async function biddingNode(gameId: string): Promise<unknown> {
  const snap = await get(ref(getFirebaseDatabase()!, `games/${gameId}/bidding`))
  return snap.exists() ? snap.val() : null
}

async function remoteHands(gameId: string): Promise<string[]> {
  const snap = await get(ref(getFirebaseDatabase()!, `games/${gameId}/gameState/hands`))
  return (snap.val() as string[]) || []
}

// Create a game as the host/creator (seated seat 0) and set the dealer, leaving the hand in the
// bidder phase with a live auction node ready to populate. Alice is seated, so the rules let her
// write every seat's entry in the bidding node (the engine, not identity, enforces bid legality) —
// which lets one signed-in client stand in for a four-device auction.
async function newHostedGameWithAuction(): Promise<{ gm: FirebaseGameManager; gameId: string }> {
  const alice = await signIn('alice@test.dev')
  const gm = new FirebaseGameManager(['Alice', 'Bob', 'Carol', 'Dave'], ['We', 'They'])
  await gm.createFirebaseGame(
    [{ userId: alice, username: 'alice', displayName: 'Alice', isAuthenticated: true, position: 0 }],
    alice,
  )
  const gameId = gm.getGameId()!
  gm.addHandPart('1') // dealer 1 -> bidding order [2,3,4,1]; hand '1', phase 'bidder'
  await flush()
  await gm.ensureAuctionForCurrentHand()
  await flush()
  return { gm, gameId }
}

beforeAll(() => {
  onAuthStateChange(() => {})
})

afterEach(async () => {
  await signOut(getFirebaseAuth()!).catch(() => {})
})

describe('host takeover of a live auction', () => {
  it('aborts the bidding node and writes the declared bidder', async () => {
    const { gm, gameId } = await newHostedGameWithAuction()
    // A live, in-progress auction: seat 2 has bid, others have not.
    await gm.enterBid(2, '5')
    expect(await biddingNode(gameId)).not.toBeNull()

    // Host declares seat 3 (Carol) the winner mid-auction.
    await gm.hostTakeoverBidder(3)
    await flush()

    expect(await biddingNode(gameId)).toBeNull()      // auction aborted
    expect(gm.getAuction()).toBeNull()
    expect(gm.getCurrentHand()).toBe('13')            // dealer 1, bid winner 3, now awaiting the bid
    expect(await remoteHands(gameId)).toEqual(['13'])
  })

  it('a throw-in takeover completes the hand and clears the auction', async () => {
    const { gm, gameId } = await newHostedGameWithAuction()
    await gm.enterBid(2, '4')

    await gm.hostTakeoverBidder(0) // "no one bid — throw in"
    await flush()

    expect(await biddingNode(gameId)).toBeNull()
    // A throw-in ('10') is a complete hand (bid winner 0); completing it auto-starts the next hand
    // with the rotated dealer (seat 2), so the remote hands become ['10', '2'].
    const hands = await remoteHands(gameId)
    expect(hands[0]).toBe('10')
    expect(hands).toEqual(['10', '2'])
  })

  it('a completed auction does NOT apply after the host has aborted (reveal-delay race)', async () => {
    const { gm, gameId } = await newHostedGameWithAuction()

    // Drive the auction to completion with a trump-bearing winner: seat 2 wins 5 in hearts, the
    // rest pass. setTrump completes it and schedules applyAuctionToHand REVEAL_MS later.
    await gm.enterBid(2, '5')
    await gm.enterBid(3, 'PASS')
    await gm.enterBid(4, 'PASS')
    await gm.enterBid(1, 'PASS')
    await gm.setTrump(2, 'H') // schedules the delayed apply

    // Simulate the host aborting from ANOTHER device: clear the bidding node directly, WITHOUT
    // advancing this manager's local hand/phase (its gameState listener hasn't caught up). Without
    // the re-read guard in applyAuctionToHand, the stale timer would still fire and write '125H'.
    await set(ref(getFirebaseDatabase()!, `games/${gameId}/bidding`), null)
    expect(gm.getCurrentHand()).toBe('1') // still locally at the bidder phase — the race window

    // Let the delayed applyAuctionToHand fire.
    await new Promise(r => setTimeout(r, REVEAL_MS + 600))

    // The guard must have skipped application: no leaked auction outcome landed on the hand.
    expect(gm.getCurrentHand()).toBe('1')
    expect(await remoteHands(gameId)).toEqual(['1'])
  }, 10000)
})
