// End-to-end FIVE-user game against the emulator: four seated players + one UNSEATED host, all
// separate anonymously-authenticated Firebase app instances (the closest headless stand-in for
// four phones + a laptop). This pins the exact topology the multiplayer role model exists for —
// a laptop that both displays the game and administers it while the four players play — under the
// REAL security rules and REAL auction engine.
//
// It exercises the CURRENTLY SHIPPED behavior only. The host-takeover-of-an-active-auction feature
// (development-plan.md "NEXT BUILD") is deliberately out of scope here: the four players run the
// concurrent auction as normal, and the host administers the rest of the hand.
//
// Runs via `npm run test:emulator`. Requires a real Java runtime.

import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth'
import {
  getDatabase, connectDatabaseEmulator, ref, set, get, type Database,
} from 'firebase/database'
import {
  createAuction, enterBid, auctionResult, isComplete,
  type AuctionState, type ActionValue, type TrumpSuit,
} from '../../src/lib/auction'

const cfg = {
  apiKey: 'demo-key',
  authDomain: 'demo-pepper.firebaseapp.com',
  databaseURL: 'https://demo-pepper-default-rtdb.firebaseio.com',
  projectId: 'demo-pepper',
  appId: 'demo-app',
}

const DEALER = 1   // order [2,3,4,1]
const HAND = 0

interface Client { app: FirebaseApp; db: Database; uid: string }
const apps: FirebaseApp[] = []

async function makeClient(name: string): Promise<Client> {
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

// Apply a bidding-node mutation as this client's authenticated user (mirrors
// FirebaseGameManager.mutateAuction; sequential awaits make a plain read-modify-write safe).
async function mutate(c: Client, gameId: string, fn: (s: AuctionState) => AuctionState) {
  const r = ref(c.db, `games/${gameId}/bidding`)
  const snap = await get(r)
  if (!snap.exists()) return null
  const state = normalize(snap.val())
  if (state.handIndex !== HAND) return null
  const next = fn(state)
  await set(r, next)
  return normalize(next)
}

let players: Client[]     // the four SEATED players
let host: Client          // the UNSEATED host (creator)

beforeAll(async () => {
  players = await Promise.all([
    makeClient('p1'), makeClient('p2'), makeClient('p3'), makeClient('p4'),
  ])
  host = await makeClient('host')
}, 30000)

afterAll(async () => {
  await Promise.all(apps.map(a => deleteApp(a).catch(() => {})))
})

// The four players are seated; the host is the CREATOR and holds currentHost, but is NOT seated.
function roster() {
  return ['Alice', 'Bob', 'Carol', 'Dave'].map((displayName, position) => ({
    userId: players[position]!.uid, displayName, isAuthenticated: true, position,
  }))
}

async function seedGame(gameId: string) {
  // The HOST creates the game (rules require createdBy === caller), seats the four players, and
  // seeds itself as currentHost — the laptop-as-scoreboard-and-scorer setup.
  await set(ref(host.db, `games/${gameId}`), {
    metadata: { createdBy: host.uid, currentHost: host.uid, createdAt: 1, status: 'active' },
    players: roster(),
    teams: ['We', 'They'],
    gameState: { hands: [String(DEALER)], scores: [0, 0], version: 0 },
  })
  // The host initializes the auction node — permitted because it is currentHost.
  await set(ref(host.db, `games/${gameId}/bidding`), createAuction(DEALER, HAND))
}

async function readGameState(gameId: string) {
  const snap = await get(ref(host.db, `games/${gameId}/gameState`))
  return snap.val() as { hands: string[]; version: number }
}

describe('five-user game: four seated players + one unseated host', () => {
  it('seats the players and makes the unseated creator the host', async () => {
    const gameId = 'five-topology'
    await seedGame(gameId)

    const rosterUids = roster().map(p => p.userId)
    expect(rosterUids).toHaveLength(4)
    // The host holds no seat...
    expect(rosterUids).not.toContain(host.uid)
    // ...but IS the current host.
    const meta = (await get(ref(host.db, `games/${gameId}/metadata`))).val()
    expect(meta.currentHost).toBe(host.uid)
    expect(meta.createdBy).toBe(host.uid)
  })

  it('runs the players\' concurrent auction, then the host records the rest of the hand', async () => {
    const gameId = 'five-full-hand'
    await seedGame(gameId)

    // The four players bid concurrently (order [2,3,4,1]). Seat 2 bids 6♠; the rest pass.
    await mutate(players[1]!, gameId, s => enterBid(s, 2, '6', 'S' as TrumpSuit))
    await mutate(players[2]!, gameId, s => enterBid(s, 3, 'PASS' as ActionValue))
    await mutate(players[3]!, gameId, s => enterBid(s, 4, 'PASS' as ActionValue))
    const done = await mutate(players[0]!, gameId, s => enterBid(s, 1, 'PASS' as ActionValue))

    expect(done).not.toBeNull()
    expect(isComplete(done!)).toBe(true)
    const result = auctionResult(done!)!
    expect(result.thrownIn).toBe(false)
    expect(result.winnerSeat).toBe(2)
    expect(result.winningBid).toBe('6')
    expect(result.winningSuit).toBe('S')

    // The host applies the resolved auction to the hand (bidder + bid + trump). The host is
    // UNSEATED, so this write proves the rules grant it gameState access as currentHost.
    const afterAuction = `${DEALER}${result.winnerSeat}${result.winningBid}${result.winningSuit}` // "126S"
    await set(ref(host.db, `games/${gameId}/gameState`), {
      hands: [afterAuction], scores: [0, 0], version: 1,
    })
    expect((await readGameState(gameId)).hands).toEqual(['126S'])

    // The host records the defending team's decision (play) and their trick count (3).
    await set(ref(host.db, `games/${gameId}/gameState`), {
      hands: [`${afterAuction}P3`], scores: [0, 0], version: 2,
    })
    const final = await readGameState(gameId)
    expect(final.hands).toEqual(['126SP3'])   // full 6-char hand
    expect(final.version).toBe(2)
  })

  it('lets a seated player ALSO record into gameState (collision-safe: both host and players may)', async () => {
    const gameId = 'five-player-write'
    await seedGame(gameId)
    // A seated player writes the hand directly — permitted, since the rules grant gameState to
    // seated players as well as the host. (Concurrent host/player writes resolve via the version
    // compare-and-set; see collision-safety.test.ts.)
    await set(ref(players[0]!.db, `games/${gameId}/gameState`), {
      hands: ['13P'], scores: [0, 0], version: 1,
    })
    expect((await readGameState(gameId)).hands).toEqual(['13P'])
  })

  it('still rejects a gameState write from someone neither seated nor host', async () => {
    const gameId = 'five-outsider'
    await seedGame(gameId)
    // players[0] is seated (allowed) — but sign a brand-new outsider client to prove the negative.
    const outsider = await makeClient('five-outsider-client')
    await expect(
      set(ref(outsider.db, `games/${gameId}/gameState`), { hands: ['13P'], scores: [0, 0], version: 1 }),
    ).rejects.toThrow()
  })
})
