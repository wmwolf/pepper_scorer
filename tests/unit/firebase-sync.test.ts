import { describe, it, expect } from 'vitest'
import { FirebaseGameManager } from '../../src/lib/firebaseGameState'
import type { GameState } from '../../src/lib/gameState'

// These tests cover the PURE conflict-resolution logic that backs Firebase real-time
// sync (Phases 6+7). The rest of the Firebase layer talks to the network and is verified
// manually by design, but this decision function is the heart of the "manual sync must
// never revert newer state to older state" fix, so it is worth protecting directly.

function stateAt(version: number | undefined, extra: Partial<GameState> = {}): GameState {
  return {
    players: ['A', 'B', 'C', 'D'],
    teams: ['Team 1', 'Team 2'],
    hands: [],
    scores: [0, 0],
    isComplete: false,
    isSeries: false,
    startTime: 1000,
    ...(version === undefined ? {} : { version }),
    ...extra
  }
}

describe('FirebaseGameManager sync conflict resolution', () => {
  describe('versionOf', () => {
    it('reads a numeric version', () => {
      expect(FirebaseGameManager.versionOf(stateAt(7))).toBe(7)
    })

    it('defaults a missing version to 0', () => {
      expect(FirebaseGameManager.versionOf(stateAt(undefined))).toBe(0)
    })

    it('defaults null / non-object to 0', () => {
      expect(FirebaseGameManager.versionOf(null)).toBe(0)
      expect(FirebaseGameManager.versionOf(undefined)).toBe(0)
      expect(FirebaseGameManager.versionOf(42)).toBe(0)
    })
  })

  describe('isRemoteNewer', () => {
    it('is true only when the remote version is strictly greater', () => {
      expect(FirebaseGameManager.isRemoteNewer(stateAt(3), stateAt(2))).toBe(true)
      expect(FirebaseGameManager.isRemoteNewer(stateAt(2), stateAt(2))).toBe(false)
      expect(FirebaseGameManager.isRemoteNewer(stateAt(1), stateAt(2))).toBe(false)
    })
  })

  describe('resolveSyncWrite', () => {
    it('commits our state with a bumped version when we are up to date', () => {
      const local = stateAt(5, { hands: ['12P'] })
      const decision = FirebaseGameManager.resolveSyncWrite(stateAt(5), local)
      expect('commit' in decision).toBe(true)
      if ('commit' in decision) {
        expect(decision.commit.version).toBe(6)
        expect(decision.commit.hands).toEqual(['12P'])
      }
    })

    it('commits (creates) when the remote node is empty', () => {
      const decision = FirebaseGameManager.resolveSyncWrite(null, stateAt(0))
      expect('commit' in decision).toBe(true)
      if ('commit' in decision) expect(decision.commit.version).toBe(1)
    })

    it('bumps past the remote version when remote is ahead but not written by us', () => {
      // local === remote version here, so we still commit; the bumped version must beat
      // whatever is currently on the node.
      const decision = FirebaseGameManager.resolveSyncWrite(stateAt(9), stateAt(9))
      if ('commit' in decision) expect(decision.commit.version).toBe(10)
    })

    it('DEFERS instead of reverting when remote is strictly newer (the core bug fix)', () => {
      // Local is a stale device clicking "Sync Now"; remote has newer progress.
      const stale = stateAt(2, { hands: [] })
      const newer = stateAt(5, { hands: ['12P', '23P'] })
      const decision = FirebaseGameManager.resolveSyncWrite(newer, stale)
      expect(decision).toEqual({ defer: true })
    })

    it('never lowers the version on the node', () => {
      const decision = FirebaseGameManager.resolveSyncWrite(stateAt(4), stateAt(4))
      if ('commit' in decision) {
        expect(decision.commit.version).toBeGreaterThan(4)
      }
    })
  })

  // Regression suite for the live-game corruption of 2026-07-19. The version is bumped ONLY by a
  // successful commit, so a device whose write failed (rejected by the security rules because it
  // is not seated, or a dropped connection) ends up holding divergent content at an EQUAL
  // version. The old "defer only if remote is strictly newer" guard read equal as "no conflict".
  describe('resolveSyncWrite — diverged at an equal version', () => {
    it('DEFERS rather than overwriting a server that has moved past our baseline', () => {
      // A device whose writes were rejected keeps accepting input while its version stays at the
      // baseline it last agreed on. Meanwhile the server climbs, because every accepted write
      // bumps the version. Pressing "Sync Now" here must not push the stale branch.
      const server = stateAt(9, { hands: ['12P', '23P', '34P', '41P', '12N'] })
      const divergedLocal = stateAt(5, { hands: ['12P', '99X'] })
      expect(FirebaseGameManager.resolveSyncWrite(server, divergedLocal)).toEqual({ defer: true })
    })

    it('DEFERS when the remote is behind our version (we never legitimately get ahead)', () => {
      // Our version only ever comes from a commit or an adopt, so a lower remote means the node
      // is not what we last agreed with. Writing forward from an unknown baseline is unsafe.
      const decision = FirebaseGameManager.resolveSyncWrite(stateAt(2), stateAt(5))
      expect(decision).toEqual({ defer: true })
    })

    it('still commits the normal forward edit: local content changed, versions agree', () => {
      // The happy path must keep working — this is every ordinary hand entry. The server sits at
      // the version we last committed, and our content has advanced since.
      const server = stateAt(6, { hands: ['12P'] })
      const local = stateAt(6, { hands: ['12P', '23P'] })
      const decision = FirebaseGameManager.resolveSyncWrite(server, local)
      expect('commit' in decision).toBe(true)
      if ('commit' in decision) {
        expect(decision.commit.hands).toEqual(['12P', '23P'])
        expect(decision.commit.version).toBe(7)
      }
    })

    it('commits into an empty node regardless of our version (nothing to lose)', () => {
      const decision = FirebaseGameManager.resolveSyncWrite(null, stateAt(5, { hands: ['12P'] }))
      expect('commit' in decision).toBe(true)
      if ('commit' in decision) expect(decision.commit.version).toBe(6)
    })
  })
})
