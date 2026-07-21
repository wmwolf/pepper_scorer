// Auto host-promotion (Phase D) against the Firebase emulator, driving the REAL FirebaseGameManager.
// When the current host's presence vanishes, the next-in-line present seated player must promote
// itself to host (dealer order), so the game still has an administrator to drive tap-flow bidding,
// undo, and series advance. A transient blip must NOT trigger promotion.
//
// The singleton firebase.ts app can hold only one signed-in user at a time, so the vanishing host
// (Alice) runs on a SEPARATE Firebase app instance (its own connection) — that lets us control her
// disconnect independently of Bob's live manager on the singleton. Both apps point at the same
// emulator + database namespace (demo-pepper), so they share game data.
//
// Runs via `npm run test:emulator`. Requires a real Java runtime.

import { beforeAll, afterEach, describe, it, expect } from 'vitest'
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app'
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  getAuth, connectAuthEmulator,
} from 'firebase/auth'
import {
  ref, get, set, remove, getDatabase, connectDatabaseEmulator, type Database,
} from 'firebase/database'
import { getFirebaseAuth, getFirebaseDatabase } from '../../src/lib/firebase'
import { onAuthStateChange, getCurrentUser } from '../../src/lib/auth'
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

// Sign in on the SINGLETON app (creating the account on first use), as the app does.
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

// A SEPARATE Firebase app + connection, signed in as `email` (account must already exist). Used to
// stand in for another device whose connection we control independently of the singleton.
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
  await signOut(getFirebaseAuth()!).catch(() => {})
  await Promise.all(extraApps.splice(0).map(a => deleteApp(a).catch(() => {})))
})

// Create a game (Alice host + seat 0, all four seated) and put Alice's HOST device online on a
// separate app whose connection we can drop on demand. Returns Bob's live manager (seat 1, present),
// which is the device that should auto-promote when Alice vanishes.
async function setup(): Promise<{
  gameId: string; alice: string; bob: string; bobGm: FirebaseGameManager
  aliceDb: Database
}> {
  const alice = await signIn('alice@test.dev')
  const bob = await signIn('bob@test.dev')
  const carol = await signIn('carol@test.dev')
  const dave = await signIn('dave@test.dev')

  await signIn('alice@test.dev')
  const gm = new FirebaseGameManager(['Alice', 'Bob', 'Carol', 'Dave'], ['We', 'They'])
  await gm.createFirebaseGame(SEATED([alice, bob, carol, dave]), alice)
  const gameId = gm.getGameId()!
  gm.destroy() // stop Alice's singleton-bound manager; her presence lives on the separate app below

  // Alice's host device on its own connection.
  const aliceClient = await makeClient('alice-host-device', 'alice@test.dev')
  await set(ref(aliceClient.db, `games/${gameId}/presence/${alice}/laptop`), { mode: 'host', ts: Date.now() })

  // Bob's real manager on the singleton: seat 1, present, player role.
  await signIn('bob@test.dev')
  const bobGm = (await FirebaseGameManager.loadFirebaseGame(gameId))!
  bobGm.setupPresence()
  await flush()

  return { gameId, alice, bob, bobGm, aliceDb: aliceClient.db }
}

describe('auto host-promotion on host presence loss', () => {
  it('promotes the next present seated player when the host vanishes', async () => {
    const { gameId, alice, bob, bobGm, aliceDb } = await setup()

    // Bob sees Alice as the current, present host.
    await waitUntil(() => bobGm.getCurrentHostUid() === alice)
    await waitUntil(() => bobGm.isHostPresent())
    expect(bobGm.isHost()).toBe(false)

    // Alice's host device disconnects.
    await remove(ref(aliceDb, `games/${gameId}/presence/${alice}/laptop`))

    // After the debounce, Bob (the next present seated player) auto-promotes to host — and adopts
    // the host device role (waitUntil, not a bare expect, so a last-tick role update can't flake it).
    await waitUntil(() => bobGm.getCurrentHostUid() === bob, 7000)
    await waitUntil(() => bobGm.getDeviceRole() === 'host', 2000)
    expect(bobGm.isHost()).toBe(true)
    expect(bobGm.getDeviceRole()).toBe('host')
    const hostSnap = await get(ref(getFirebaseDatabase()!, `games/${gameId}/metadata/currentHost`))
    expect(hostSnap.val()).toBe(bob)
  }, 15000)

  it('does NOT promote on a transient blip (host returns within the debounce)', async () => {
    const { gameId, alice, bob, bobGm, aliceDb } = await setup()
    await waitUntil(() => bobGm.getCurrentHostUid() === alice)
    await waitUntil(() => bobGm.isHostPresent())

    // Host drops, then reconnects well within the promotion debounce (3s).
    await remove(ref(aliceDb, `games/${gameId}/presence/${alice}/laptop`))
    await new Promise(r => setTimeout(r, 900))
    await set(ref(aliceDb, `games/${gameId}/presence/${alice}/laptop`), { mode: 'host', ts: Date.now() })

    // Well past the debounce: the host is back, so no promotion happened.
    await new Promise(r => setTimeout(r, 3600))
    expect(bobGm.getCurrentHostUid()).toBe(alice)
    expect(bobGm.isHost()).toBe(false)
    const hostSnap = await get(ref(getFirebaseDatabase()!, `games/${gameId}/metadata/currentHost`))
    expect(hostSnap.val()).toBe(alice)
  }, 15000)
})
