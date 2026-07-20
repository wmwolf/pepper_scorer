// Undo-lock and series-advance coordination (agreed 2026-07-19) against the emulator, driving the
// REAL FirebaseGameManager. The undo lock serializes undos in a hostless game; the series-advance
// node backs the shared, cancelable "next game" countdown. The vanishing/second device is a
// separate Firebase app (its own connection) where a genuinely different uid is needed.
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
  await signOut(getFirebaseAuth()!).catch(() => {})
  await Promise.all(extraApps.splice(0).map(a => deleteApp(a).catch(() => {})))
})

// Create a game as Alice (seated seat 0), returning her live manager + uids.
async function newGame(): Promise<{ gm: FirebaseGameManager; gameId: string; alice: string; bob: string }> {
  const alice = await signIn('alice@test.dev')
  const bob = await signIn('bob@test.dev')
  const carol = await signIn('carol@test.dev')
  const dave = await signIn('dave@test.dev')
  await signIn('alice@test.dev')
  const gm = new FirebaseGameManager(['Alice', 'Bob', 'Carol', 'Dave'], ['We', 'They'])
  await gm.createFirebaseGame(SEATED([alice, bob, carol, dave]), alice)
  return { gm, gameId: gm.getGameId()!, alice, bob }
}

describe('undo lock', () => {
  it('acquires, is idempotent for the holder, and releases', async () => {
    const { gm, gameId, alice } = await newGame()

    expect(await gm.acquireUndoLock()).toBe(true)
    const snap = await get(ref(getFirebaseDatabase()!, `games/${gameId}/undoLock`))
    expect((snap.val() as { uid: string }).uid).toBe(alice)

    // Re-acquiring your own lock succeeds (idempotent).
    expect(await gm.acquireUndoLock()).toBe(true)

    await gm.releaseUndoLock()
    expect((await get(ref(getFirebaseDatabase()!, `games/${gameId}/undoLock`))).exists()).toBe(false)
  })

  it('cannot be acquired while another device holds a FRESH lock', async () => {
    const { gm, gameId, bob } = await newGame()
    // Seed a fresh lock owned by someone else (Alice writes it — the rules gate the WRITER, seated,
    // not the content). Alice's acquire must then abort.
    await set(ref(getFirebaseDatabase()!, `games/${gameId}/undoLock`), { uid: bob, ts: Date.now() })
    expect(await gm.acquireUndoLock()).toBe(false)
  })

  it('takes over a STALE lock (a crashed holder cannot wedge undo forever)', async () => {
    const { gm, gameId, alice, bob } = await newGame()
    // A lock older than the staleness window, owned by someone else.
    await set(ref(getFirebaseDatabase()!, `games/${gameId}/undoLock`), { uid: bob, ts: 1 })
    expect(await gm.acquireUndoLock()).toBe(true)
    const snap = await get(ref(getFirebaseDatabase()!, `games/${gameId}/undoLock`))
    expect((snap.val() as { uid: string }).uid).toBe(alice)
  })
})

describe('series-advance coordination', () => {
  it('publishes a pending request and mirrors it to another device', async () => {
    const { gm, gameId, alice } = await newGame()

    let notified: { by: string } | null | undefined
    gm.setSeriesAdvanceCallback(p => { notified = p })

    expect(await gm.requestSeriesAdvance()).toBe(true)
    await waitUntil(() => gm.getSeriesAdvancePending() !== null)
    expect(gm.getSeriesAdvancePending()!.by).toBe(alice)
    expect(notified?.by).toBe(alice)

    // A second device (fresh manager load) sees the same pending request via its own listener.
    const other = (await FirebaseGameManager.loadFirebaseGame(gameId))!
    await waitUntil(() => other.getSeriesAdvancePending() !== null)
    expect(other.getSeriesAdvancePending()!.by).toBe(alice)
    other.destroy()
  })

  it('lets ANOTHER player cancel the pending advance', async () => {
    const { gm, gameId, alice, bob } = await newGame()
    await gm.requestSeriesAdvance()
    await waitUntil(() => gm.getSeriesAdvancePending() !== null)

    // Bob, on his own device/connection, cancels — clearing the shared node.
    const bobClient = await makeClient('bob-cancel', 'bob@test.dev')
    expect(bobClient.uid).toBe(bob)
    await set(ref(bobClient.db, `games/${gameId}/seriesAdvance`), null)

    // Alice's manager sees the cancellation (countdown would hide everywhere).
    await waitUntil(() => gm.getSeriesAdvancePending() === null)
    expect((await get(ref(getFirebaseDatabase()!, `games/${gameId}/seriesAdvance`))).exists()).toBe(false)
    expect(alice).toBeTruthy()
  })

  it('cancelSeriesAdvance clears the node', async () => {
    const { gm, gameId } = await newGame()
    await gm.requestSeriesAdvance()
    await waitUntil(() => gm.getSeriesAdvancePending() !== null)
    await gm.cancelSeriesAdvance()
    await waitUntil(() => gm.getSeriesAdvancePending() === null)
  })
})
