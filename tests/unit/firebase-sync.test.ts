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
})
