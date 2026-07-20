// Spectator-audit cleanups against the emulator, driving the REAL FirebaseGameManager + auth.ts:
//   1. Anonymous watch/TV mode — a signed-OUT device signs in anonymously (ensureAnonymousAuth) so
//      it can READ a shared game, is treated as a read-only spectator, and creates NO profile /
//      directory entry (no pollution of the public roster with throwaway accounts).
//   2. localStorage `currentGame` is NOT overwritten for a spectator on live updates (it would make
//      the home page later offer to "resume" a game the device was only watching) — but IS for a
//      participant (offline fallback).
//
// Runs via `npm run test:emulator`. Requires a real Java runtime.

import { beforeAll, afterEach, describe, it, expect } from 'vitest'
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app'
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  getAuth, connectAuthEmulator,
} from 'firebase/auth'
import {
  ref, get, set, getDatabase, connectDatabaseEmulator, type Database,
} from 'firebase/database'
import { getFirebaseAuth, getFirebaseDatabase } from '../../src/lib/firebase'
import { onAuthStateChange, getCurrentUser, awaitAuthReady, ensureAnonymousAuth } from '../../src/lib/auth'
import { FirebaseGameManager } from '../../src/lib/firebaseGameState'

const PW = 'password123'
const cfg = {
  apiKey: 'demo-key',
  authDomain: 'demo-pepper.firebaseapp.com',
  databaseURL: 'https://demo-pepper-default-rtdb.firebaseio.com',
  projectId: 'demo-pepper',
  appId: 'demo-app',
}

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

const extraApps: FirebaseApp[] = []
async function makeClient(name: string, email: string): Promise<{ db: Database; uid: string }> {
  const app = initializeApp(cfg, name)
  extraApps.push(app)
  const auth = getAuth(app)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  const db = getDatabase(app)
  connectDatabaseEmulator(db, '127.0.0.1', 9000)
  const cred = await signInWithEmailAndPassword(auth, email, PW)
  return { db, uid: cred.user.uid }
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
  localStorage.removeItem('currentGame')
  await signOut(getFirebaseAuth()!).catch(() => {})
  await Promise.all(extraApps.splice(0).map(a => deleteApp(a).catch(() => {})))
})

// Create a game as Alice (all four seated) and return its id + seat uids, then sign OUT the
// singleton so callers can enter watch mode.
async function createGameThenSignOut(): Promise<{ gameId: string; uids: string[] }> {
  const alice = await signIn('alice@test.dev')
  const bob = await signIn('bob@test.dev')
  const carol = await signIn('carol@test.dev')
  const dave = await signIn('dave@test.dev')
  await signIn('alice@test.dev')
  const gm = new FirebaseGameManager(['Alice', 'Bob', 'Carol', 'Dave'], ['We', 'They'])
  await gm.createFirebaseGame(SEATED([alice, bob, carol, dave]), alice)
  const gameId = gm.getGameId()!
  gm.addHandPart('1') // give it a starting hand
  await flush()
  gm.destroy()
  await signOut(getFirebaseAuth()!)
  return { gameId, uids: [alice, bob, carol, dave] }
}

describe('anonymous watch/TV mode', () => {
  it('lets a signed-out device sign in anonymously and READ a shared game as a spectator', async () => {
    const { gameId } = await createGameThenSignOut()

    // Signed out: awaitAuthReady settles to null, then watch mode signs in anonymously.
    expect(await awaitAuthReady()).toBeNull()
    const guest = await ensureAnonymousAuth()
    expect(guest).toBeTruthy()
    expect(guest!.isAnonymous).toBe(true)
    expect(getCurrentUser()?.isAnonymous).toBe(true)

    // The anon watcher can READ the game, and is a read-only spectator.
    const watcher = (await FirebaseGameManager.loadFirebaseGame(gameId))!
    expect(watcher).toBeTruthy()
    expect(watcher.getMySeat()).toBeNull()
    expect(watcher.isHost()).toBe(false)
    expect(watcher.shouldPersistLocalCopy()).toBe(false)
    watcher.destroy()
  })

  it('creates NO profile or directory entry for the anonymous session', async () => {
    await createGameThenSignOut()
    const guest = await ensureAnonymousAuth()
    const uid = guest!.uid

    // No throwaway account leaks into /users or the public /directory.
    expect((await get(ref(getFirebaseDatabase()!, `users/${uid}`))).exists()).toBe(false)
    expect((await get(ref(getFirebaseDatabase()!, `directory/${uid}`))).exists()).toBe(false)
  })
})

describe('localStorage currentGame is not polluted by spectating', () => {
  it('does NOT overwrite currentGame for a spectator on a live update', async () => {
    const { gameId, uids } = await createGameThenSignOut()

    await ensureAnonymousAuth()
    const watcher = (await FirebaseGameManager.loadFirebaseGame(gameId))!
    localStorage.setItem('currentGame', 'SENTINEL')

    // A seated player pushes a newer state; the watcher's listener applies it.
    const alice = await makeClient('alice-writer', 'alice@test.dev')
    expect(alice.uid).toBe(uids[0])
    await set(ref(alice.db, `games/${gameId}/gameState`), {
      hands: ['15', '2'], scores: [0, 0], players: ['Alice', 'Bob', 'Carol', 'Dave'], teams: ['We', 'They'], version: 999,
    })

    await waitUntil(() => watcher.getCurrentHand() === '2') // the update was received & applied
    // ...but the spectator's own resumable game was left untouched.
    expect(localStorage.getItem('currentGame')).toBe('SENTINEL')
    watcher.destroy()
  })

  it('DOES overwrite currentGame for a seated participant on a live update', async () => {
    const alice = await signIn('alice@test.dev')
    const bob = await signIn('bob@test.dev')
    const carol = await signIn('carol@test.dev')
    const dave = await signIn('dave@test.dev')
    await signIn('alice@test.dev')
    const gm = new FirebaseGameManager(['Alice', 'Bob', 'Carol', 'Dave'], ['We', 'They'])
    await gm.createFirebaseGame(SEATED([alice, bob, carol, dave]), alice)
    const gameId = gm.getGameId()!
    await flush()

    expect(gm.shouldPersistLocalCopy()).toBe(true) // Alice is seated
    localStorage.setItem('currentGame', 'SENTINEL')

    const bobClient = await makeClient('bob-writer', 'bob@test.dev')
    await set(ref(bobClient.db, `games/${gameId}/gameState`), {
      hands: ['15', '2'], scores: [0, 0], players: ['Alice', 'Bob', 'Carol', 'Dave'], teams: ['We', 'They'], version: 999,
    })

    await waitUntil(() => gm.getCurrentHand() === '2')
    // A participant keeps a local copy (offline fallback), so it was overwritten.
    expect(localStorage.getItem('currentGame')).not.toBe('SENTINEL')
    expect(localStorage.getItem('currentGame')).toContain('15')
    gm.destroy()
  })
})
