// Firebase Realtime Database security-rules tests (Phase 11).
//
// Drives database.rules.json against the Firebase emulator via @firebase/rules-unit-testing.
// Run with `npm run test:emulator` (wraps `firebase emulators:exec --only database`). Requires a
// real Java runtime for the emulator — runs in CI, not on this dev machine (Java is only a stub).
//
// These tests are the faithful, hermetic coverage of the rules themselves. They do NOT exercise
// FirebaseGameManager orchestration (that needs a signed-in Auth-emulator context so the strict
// rules permit the manager's writes) — see development-plan.md for that scoped follow-up.

import { readFileSync } from 'node:fs'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { ref, set, get } from 'firebase/database'

let testEnv: RulesTestEnvironment

const CREATOR = 'creator-uid'
const SEATED = 'seated-uid'      // a seated non-creator player
const OUTSIDER = 'outsider-uid'  // authenticated but not in this game
const GAME_ID = 'game1'

// A game with CREATOR at seat 0 and SEATED at seat 1; seats 2/3 unauthenticated.
function seedGame() {
  return {
    metadata: { createdBy: CREATOR, createdAt: 1000, status: 'active', roomCode: 'ABCD' },
    players: [
      { userId: CREATOR, displayName: 'Creator', isAuthenticated: true, position: 0 },
      { userId: SEATED, displayName: 'Seated', isAuthenticated: true, position: 1 },
      { displayName: 'Guest3', isAuthenticated: false, position: 2 },
      { displayName: 'Guest4', isAuthenticated: false, position: 3 },
    ],
    teams: ['A', 'B'],
    gameState: { hands: ['12'], scores: [0, 0], version: 0 },
  }
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-pepper',
    database: {
      rules: readFileSync('database.rules.json', 'utf8'),
      host: '127.0.0.1',
      port: 9000,
    },
  })
})

afterAll(async () => {
  await testEnv?.cleanup()
})

beforeEach(async () => {
  await testEnv.clearDatabase()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await set(ref(ctx.database(), `games/${GAME_ID}`), seedGame())
  })
})

describe('users', () => {
  it('allows only self-read and self-write (no reading another user\'s PII)', async () => {
    const alice = testEnv.authenticatedContext('alice').database()
    await assertSucceeds(get(ref(alice, 'users/alice')))                  // own profile
    await assertFails(get(ref(alice, 'users/bob')))                       // someone else's email/stats
    await assertFails(get(ref(alice, 'users')))                           // cannot enumerate the table
    await assertSucceeds(set(ref(alice, 'users/alice'), { username: 'a' }))
    await assertFails(set(ref(alice, 'users/bob'), { username: 'hijack' }))
  })
})

describe('directory', () => {
  it('is readable/searchable by any signed-in user, self-write only, denied to anon', async () => {
    const alice = testEnv.authenticatedContext('alice').database()
    await assertSucceeds(set(ref(alice, 'directory/alice'), { uid: 'alice', username: 'a', displayName: 'Alice' }))
    await assertSucceeds(get(ref(alice, 'directory/bob')))                // read another entry (PII-free)
    await assertSucceeds(get(ref(alice, 'directory')))                    // enumerate for roster search
    await assertFails(set(ref(alice, 'directory/bob'), { username: 'hijack' })) // cannot write another's entry
    const anon = testEnv.unauthenticatedContext().database()
    await assertFails(get(ref(anon, 'directory')))                        // signed-out cannot probe
  })
})

describe('games read', () => {
  it('denies unauthenticated reads and allows any signed-in user (room-code spectators)', async () => {
    const anon = testEnv.unauthenticatedContext().database()
    await assertFails(get(ref(anon, `games/${GAME_ID}/gameState`)))
    const outsider = testEnv.authenticatedContext(OUTSIDER).database()
    await assertSucceeds(get(ref(outsider, `games/${GAME_ID}/gameState`)))
  })
})

describe('games write', () => {
  it('lets a seated player write gameState and bidding', async () => {
    const seated = testEnv.authenticatedContext(SEATED).database()
    await assertSucceeds(set(ref(seated, `games/${GAME_ID}/gameState`), { hands: ['12', '23'], scores: [0, 0], version: 1 }))
    await assertSucceeds(set(ref(seated, `games/${GAME_ID}/bidding`), { handIndex: 1, order: [2, 3, 4, 1], entries: {} }))
  })

  it('forbids a non-seated user from writing gameState or bidding', async () => {
    const outsider = testEnv.authenticatedContext(OUTSIDER).database()
    await assertFails(set(ref(outsider, `games/${GAME_ID}/gameState`), { hands: [], scores: [0, 0], version: 9 }))
    await assertFails(set(ref(outsider, `games/${GAME_ID}/bidding`), { handIndex: 1, order: [], entries: {} }))
  })

  it('lets a seated player bump metadata/status and lastUpdated but not createdBy', async () => {
    const seated = testEnv.authenticatedContext(SEATED).database()
    await assertSucceeds(set(ref(seated, `games/${GAME_ID}/metadata/status`), 'completed'))
    await assertSucceeds(set(ref(seated, `games/${GAME_ID}/metadata/lastUpdated`), 2000))
    await assertFails(set(ref(seated, `games/${GAME_ID}/metadata/createdBy`), OUTSIDER))
  })

  it('allows creating a fresh game only when createdBy is the caller', async () => {
    const alice = testEnv.authenticatedContext('alice').database()
    const good = { metadata: { createdBy: 'alice', createdAt: 1, status: 'setup' }, players: [], teams: ['A', 'B'], gameState: { hands: [], scores: [0, 0], version: 0 } }
    await assertSucceeds(set(ref(alice, 'games/newgame'), good))
    const bad = { ...good, metadata: { ...good.metadata, createdBy: 'someone-else' } }
    await assertFails(set(ref(alice, 'games/otherGame'), bad))
  })
})

describe('series', () => {
  it('is readable and writable by any signed-in user, denied to anon', async () => {
    const alice = testEnv.authenticatedContext('alice').database()
    await assertSucceeds(set(ref(alice, 'series/s1'), { games: ['game1'], seriesScore: [0, 0] }))
    await assertSucceeds(get(ref(alice, 'series/s1')))
    const anon = testEnv.unauthenticatedContext().database()
    await assertFails(set(ref(anon, 'series/s1'), { games: [] }))
  })
})

describe('presence', () => {
  it('lets a player write only their own presence node', async () => {
    const seated = testEnv.authenticatedContext(SEATED).database()
    await assertSucceeds(set(ref(seated, `games/${GAME_ID}/presence/${SEATED}`), true))
    await assertFails(set(ref(seated, `games/${GAME_ID}/presence/${OUTSIDER}`), true))
  })
})

describe('userGames', () => {
  it('lets a user read/write their own list and the creator seed a player list', async () => {
    const seated = testEnv.authenticatedContext(SEATED).database()
    await assertSucceeds(set(ref(seated, `userGames/${SEATED}/${GAME_ID}`), true))
    await assertSucceeds(get(ref(seated, `userGames/${SEATED}`)))
    // The creator may add the game to another seated player's list.
    const creator = testEnv.authenticatedContext(CREATOR).database()
    await assertSucceeds(set(ref(creator, `userGames/${SEATED}/${GAME_ID}`), true))
    // A random user cannot write into someone else's list.
    const outsider = testEnv.authenticatedContext(OUTSIDER).database()
    await assertFails(set(ref(outsider, `userGames/${SEATED}/${GAME_ID}`), true))
    await assertFails(get(ref(outsider, `userGames/${SEATED}`)))
  })
})
