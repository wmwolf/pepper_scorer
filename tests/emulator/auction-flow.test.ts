// End-to-end concurrent-auction integration test against the Firebase emulator.
//
// This is the closest thing to "4 real devices" that runs headlessly: FOUR separate Firebase
// app instances, each signed in ANONYMOUSLY (its own uid), all pointed at the emulator. Each
// seat's bid is a REAL per-seat-authenticated RTDB transaction on `games/{id}/bidding`, so the
// REAL security rules (database.rules.json) and REAL transaction semantics are exercised — with
// the REAL auction engine (src/lib/auction.ts) doing the state transitions inside the txn, exactly
// as FirebaseGameManager.mutateAuction does in production.
//
// Runs via `npm run test:emulator` (needs the auth + database emulators; the npm script starts
// them). Requires a real Java runtime — CI-only historically, runnable locally once Temurin is
// installed.

import { readFileSync } from 'node:fs'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth'
import {
  getDatabase, connectDatabaseEmulator, ref, set, get, onValue, runTransaction, type Database,
} from 'firebase/database'
import {
  createAuction, enterBid, setTrump, auctionResult, revealedCount, isComplete,
  type AuctionState, type ActionValue, type TrumpSuit,
} from '../../src/lib/auction'

const cfg = {
  apiKey: 'demo-key',
  authDomain: 'demo-pepper.firebaseapp.com',
  databaseURL: 'https://demo-pepper-default-rtdb.firebaseio.com',
  projectId: 'demo-pepper',
  appId: 'demo-app',
}

const DEALER = 1        // order [2,3,4,1]
const HAND = 0

interface Seat { app: FirebaseApp; db: Database; uid: string }
const apps: FirebaseApp[] = []

async function makeClient(name: string): Promise<Seat> {
  const app = initializeApp(cfg, name)
  apps.push(app)
  const auth = getAuth(app)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  const db = getDatabase(app)
  connectDatabaseEmulator(db, '127.0.0.1', 9000)
  const cred = await signInAnonymously(auth)
  return { app, db, uid: cred.user.uid }
}

const normalize = (raw: any): AuctionState =>
  ({ handIndex: raw.handIndex, order: raw.order || [], entries: raw.entries || {} })

// A bidding-node transaction authed as `seat.db`'s user (mirrors FirebaseGameManager.mutateAuction).
const unsubs: Array<() => void> = []

// Subscribe every client to the bidding node (as a real device does via FirebaseGameManager's
// listener) and resolve once all four have their first snapshot. An ACTIVE listener keeps the
// value in the sync tree so runTransaction's optimistic first pass sees real data instead of
// null (a bare get() doesn't retain it once it resolves).
function subscribeAll(gameId: string): Promise<void> {
  return Promise.all(seats.map(seat => new Promise<void>(res => {
    let first = true
    unsubs.push(onValue(ref(seat.db, `games/${gameId}/bidding`), () => { if (first) { first = false; res() } }))
  }))).then(() => {})
}

async function mutate(seat: Seat, gameId: string, fn: (s: AuctionState) => AuctionState) {
  const r = ref(seat.db, `games/${gameId}/bidding`)
  const txn = await runTransaction(r, (remote: any) => {
    const state = remote ? normalize(remote) : null
    if (!state || state.handIndex !== HAND) return
    try { return fn(state) } catch { return }
  })
  return txn.committed ? normalize(txn.snapshot.val()) : null
}

let seats: Seat[]
let outsider: Seat

beforeAll(async () => {
  seats = await Promise.all([makeClient('c1'), makeClient('c2'), makeClient('c3'), makeClient('c4')])
  outsider = await makeClient('outsider')
}, 30000)

afterAll(async () => {
  unsubs.forEach(u => u())
  await Promise.all(apps.map(a => deleteApp(a).catch(() => {})))
})

async function seedGame(gameId: string) {
  const players = ['Alice', 'Bob', 'Carol', 'Dave'].map((displayName, position) => ({
    userId: seats[position]!.uid, displayName, isAuthenticated: true, position,
  }))
  // Seat 1 is the creator (rules require createdBy === caller).
  await set(ref(seats[0]!.db, `games/${gameId}`), {
    metadata: { createdBy: seats[0]!.uid, createdAt: 1, status: 'active' },
    players,
    teams: ['We', 'They'],
    gameState: { hands: [String(DEALER)], scores: [0, 0], version: 0 },
  })
  // Initialize the auction node directly (mutate() intentionally aborts on a missing node —
  // that's its production guard). Seat 1 is seated, so the rules permit this write.
  await set(ref(seats[0]!.db, `games/${gameId}/bidding`), createAuction(DEALER, HAND))
  await subscribeAll(gameId)
}

describe('concurrent auction over the real security rules', () => {
  it('runs a full ascending auction across 4 authenticated clients and resolves a winner + trump', async () => {
    const gameId = 'flow-ascending'
    await seedGame(gameId)

    // Out-of-order concurrent entry: seat 4 enters first (hidden), then 3, then 1, then 2 fills
    // the front and cascade-reveals everyone. Order is [2,3,4,1].
    await mutate(seats[3]!, gameId, s => enterBid(s, 4, '5', 'H' as TrumpSuit)) // seat 4
    await mutate(seats[2]!, gameId, s => enterBid(s, 3, 'PASS' as ActionValue)) // seat 3
    let mid = await get(ref(seats[0]!.db, `games/${gameId}/bidding`)).then(s => normalize(s.val()))
    expect(revealedCount(mid)).toBe(0) // seat 2 (first in order) still missing -> nothing revealed

    await mutate(seats[0]!, gameId, s => enterBid(s, 1, '6', 'S' as TrumpSuit)) // seat 1 (dealer)
    const committed = await mutate(seats[1]!, gameId, s => enterBid(s, 2, '4', 'C' as TrumpSuit)) // seat 2 fills front

    expect(committed).not.toBeNull()
    expect(isComplete(committed!)).toBe(true)
    const result = auctionResult(committed!)!
    expect(result.thrownIn).toBe(false)
    expect(result.winnerSeat).toBe(1) // seat 1 bid 6, the high
    expect(result.winningBid).toBe('6')
    expect(result.winningSuit).toBe('S')
  })

  it('lets a winner set trump after a bidding-complete-without-trump, then resolves', async () => {
    const gameId = 'flow-late-trump'
    await seedGame(gameId)
    await mutate(seats[1]!, gameId, s => enterBid(s, 2, '6')) // seat 2 bids 6, NO trump
    await mutate(seats[2]!, gameId, s => enterBid(s, 3, 'PASS' as ActionValue))
    await mutate(seats[3]!, gameId, s => enterBid(s, 4, 'PASS' as ActionValue))
    const full = await mutate(seats[0]!, gameId, s => enterBid(s, 1, 'PASS' as ActionValue))
    expect(isComplete(full!)).toBe(true)
    expect(auctionResult(full!)!.winningSuit).toBeNull() // winner owes a trump

    const done = await mutate(seats[1]!, gameId, s => setTrump(s, 2, 'D' as TrumpSuit))
    expect(auctionResult(done!)!.winningSuit).toBe('D')
  })

  it('throws in the hand when all four pass', async () => {
    const gameId = 'flow-throwin'
    await seedGame(gameId)
    for (let i = 0; i < 4; i++) {
      await mutate(seats[i]!, gameId, s => enterBid(s, [2, 3, 4, 1][i]!, 'PASS' as ActionValue))
    }
    const state = await get(ref(seats[0]!.db, `games/${gameId}/bidding`)).then(s => normalize(s.val()))
    expect(auctionResult(state)!.thrownIn).toBe(true)
  })

  it('denies a non-seated user from writing the bidding node (rules enforced)', async () => {
    const gameId = 'flow-rules'
    await seedGame(gameId)
    // The outsider is authenticated but not in players[] -> the RTDB write must be rejected.
    await expect(
      set(ref(outsider.db, `games/${gameId}/bidding/entries/2`), { value: '6', suit: 'C' })
    ).rejects.toThrow()
    // And a seated player's write to the same path succeeds.
    await expect(
      set(ref(seats[1]!.db, `games/${gameId}/bidding/entries/2`), { value: '6', suit: 'C' })
    ).resolves.toBeUndefined()
  })
})
