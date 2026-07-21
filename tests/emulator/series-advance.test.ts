// Series advance against the emulator, driving the REAL FirebaseGameManager. Regression coverage
// for the "Make it a Series / Next Game looped and never advanced" bug (real-game feedback
// 2026-07-21): the fix moved navigation ownership into the manager (advanceSeriesAndNavigate) so
// the button handler no longer races it with a reload. These tests pin the DB-level effects the
// advance MUST produce, plus the host force-advance failsafe (which must not spawn duplicates).
//
// Navigation (window.location.*) is a no-op / non-fatal in jsdom; we `.catch(() => {})` the advance
// calls and assert on the resulting database state.
//
// Runs via `npm run test:emulator`. Requires a real Java runtime.

import { beforeAll, afterEach, describe, it, expect } from 'vitest'
import { signOut } from 'firebase/auth'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth'
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

const SEATED = (uids: string[]) => [
  { userId: uids[0]!, username: 'alice', displayName: 'Alice', isAuthenticated: true, position: 0 },
  { userId: uids[1]!, username: 'bob', displayName: 'Bob', isAuthenticated: true, position: 1 },
  { userId: uids[2]!, username: 'carol', displayName: 'Carol', isAuthenticated: true, position: 2 },
  { userId: uids[3]!, username: 'dave', displayName: 'Dave', isAuthenticated: true, position: 3 },
]

async function seriesNode(seriesId: string): Promise<{ currentGameId: string; gameIds: string[] } | null> {
  const snap = await get(ref(getFirebaseDatabase()!, `series/${seriesId}`))
  return snap.exists() ? (snap.val() as { currentGameId: string; gameIds: string[] }) : null
}

beforeAll(() => {
  onAuthStateChange(() => {})
})

afterEach(async () => {
  localStorage.removeItem('pepperDeviceId')
  localStorage.removeItem('currentGame')
  await signOut(getFirebaseAuth()!).catch(() => {})
})

// Create a COMPLETED Firebase game as Alice (seated seat 0, the host/creator). isGameComplete()
// reads state.scores, so we can mark completion by setting scores directly, then sync.
async function completedGame(): Promise<{ gm: FirebaseGameManager; gameId: string }> {
  const alice = await signIn('alice@test.dev')
  const bob = await signIn('bob@test.dev')
  const carol = await signIn('carol@test.dev')
  const dave = await signIn('dave@test.dev')
  await signIn('alice@test.dev')
  const gm = new FirebaseGameManager(['Alice', 'Bob', 'Carol', 'Dave'], ['We', 'They'])
  await gm.createFirebaseGame(SEATED([alice, bob, carol, dave]), alice)
  const gameId = gm.getGameId()!
  gm.state.hands = ['12PCP0']
  gm.state.scores = [42, 10] // team 0 (We) wins
  await gm.forceSyncToFirebase()
  await flush()
  expect(gm.isGameComplete()).toBe(true)
  return { gm, gameId }
}

describe('series advance (Make it a Series → Next Game)', () => {
  it('converts to a series pointing at the current game', async () => {
    const { gm, gameId } = await completedGame()
    await gm.convertToSeries()
    await flush()

    expect(gm.state.isSeries).toBe(true)
    const seriesId = (await get(ref(getFirebaseDatabase()!, `games/${gameId}/metadata/seriesId`))).val() as string
    expect(seriesId).toBeTruthy()
    const series = await seriesNode(seriesId)
    expect(series!.currentGameId).toBe(gameId)
    expect(series!.gameIds).toEqual([gameId])
  })

  it('advances to a NEW game and repoints the series (the fix — no loop, no same-node reuse)', async () => {
    const { gm, gameId } = await completedGame()
    await gm.convertToSeries()
    await flush()
    const seriesId = gm.getSeriesId()!

    // advanceSeriesAndNavigate owns navigation (a no-op in jsdom); assert the DB effects.
    await gm.advanceSeriesAndNavigate().catch(() => {})
    await flush()

    const series = await seriesNode(seriesId)
    expect(series!.currentGameId).not.toBe(gameId)      // moved to a fresh game node
    expect(series!.gameIds).toHaveLength(2)             // exactly one new game, no duplicates
    // The new game node exists, is active, and is linked to the series.
    const newId = series!.currentGameId
    const newMeta = (await get(ref(getFirebaseDatabase()!, `games/${newId}/metadata`))).val() as { status: string; seriesId: string }
    expect(newMeta.status).toBe('active')
    expect(newMeta.seriesId).toBe(seriesId)
  })
})

describe('host force-advance failsafe', () => {
  it('navigates to the existing next game instead of spawning a duplicate', async () => {
    const { gm, gameId } = await completedGame()
    await gm.convertToSeries()
    await flush()
    const seriesId = gm.getSeriesId()!

    // Normal advance creates game #2.
    await gm.advanceSeriesAndNavigate().catch(() => {})
    await flush()
    const afterFirst = await seriesNode(seriesId)
    expect(afterFirst!.gameIds).toHaveLength(2)
    const nextGameId = afterFirst!.currentGameId

    // Force-advance again from the (now stale) original manager: the series already advanced, so it
    // must GO to the existing next game, NOT create a third one.
    await gm.forceAdvanceSeries().catch(() => {})
    await flush()
    const afterForce = await seriesNode(seriesId)
    expect(afterForce!.gameIds).toHaveLength(2)         // still exactly two — no duplicate spawned
    expect(afterForce!.currentGameId).toBe(nextGameId)
  })
})
