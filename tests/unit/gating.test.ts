import { describe, it, expect } from 'vitest'
import { evaluateGating } from '../../src/lib/game'
import type { GameManager } from '../../src/lib/gameState'

// Build a fake manager satisfying the duck-typed MultiplayerManager that evaluateGating reads.
// `firebase: false` makes asMultiplayer() return null (a local game).
function fakeGm(opts: {
  firebase?: boolean
  signedIn?: boolean
  seat?: number | null
  host?: boolean
  deviceRole?: 'player' | 'spectator' | 'host'
}): GameManager {
  return {
    isFirebaseGame: () => opts.firebase ?? true,
    getViewerSeatInfo: () => ({ signedIn: opts.signedIn ?? true, seat: opts.seat ?? null }),
    isManualOverride: () => false,
    isHost: () => opts.host ?? false,
    getDeviceRole: () => opts.deviceRole ?? (opts.host ? 'host' : (opts.seat != null ? 'player' : 'spectator')),
    getCurrentHostUid: () => (opts.host ? 'host-uid' : null),
    getFirebasePlayers: () => [],
    state: { teams: ['We', 'They'], players: ['A', 'B', 'C', 'D'] },
  } as unknown as GameManager
}

const PHASE = 'decision'
const HAND = '12P C'
const TAP_PHASES = ['bidder', 'bid', 'trump', 'decision', 'tricks']

// The collision-safe model: the only thing gating decides is read-only vs. can-write. Any device
// that can write (a seated player in player mode, or the host) may record ANY tap-flow step —
// per-step ownership is gone, because concurrent writes resolve safely (see firebase-sync tests).
describe('evaluateGating — collision-safe model', () => {
  it('applies no gating to a local (non-Firebase) game', () => {
    expect(evaluateGating(fakeGm({ firebase: false }), HAND, PHASE)).toBeNull()
  })

  it('lets a seated player record every tap-flow step (no per-step ownership)', () => {
    for (const phase of TAP_PHASES) {
      expect(evaluateGating(fakeGm({ seat: 1 }), HAND, phase), `phase ${phase}`).toBeNull()
    }
  })

  it('lets ANY seat pick trump, not only the bid winner', () => {
    // hand[1]='2' -> bid winner is seat 1. Seat 0 may still record the trump; a collision with
    // the bid winner is resolved safely, so there is no reason to block it.
    expect(evaluateGating(fakeGm({ seat: 0 }), '12P', 'trump')).toBeNull()
    expect(evaluateGating(fakeGm({ seat: 1 }), '12P', 'trump')).toBeNull()
  })

  it('lets a SEATED host act in every phase', () => {
    for (const phase of TAP_PHASES) {
      expect(evaluateGating(fakeGm({ host: true, seat: 0 }), HAND, phase), `phase ${phase}`).toBeNull()
    }
  })

  it('lets an UNSEATED host administer every phase', () => {
    for (const phase of TAP_PHASES) {
      expect(evaluateGating(fakeGm({ host: true, seat: null }), HAND, phase), `phase ${phase}`).toBeNull()
    }
  })

  // The 2026-07-19 incident case: signed in, no seat, not host. No write access under the rules.
  it('treats a signed-in device that is neither seated nor host as a read-only spectator', () => {
    for (const phase of TAP_PHASES) {
      const block = evaluateGating(fakeGm({ host: false, seat: null }), HAND, phase)
      expect(block, `phase ${phase}`).not.toBeNull()
      expect(block!.spectator, `phase ${phase}`).toBe(true)
    }
  })

  it('treats a signed-out device as read-only', () => {
    const block = evaluateGating(fakeGm({ signedIn: false }), HAND, PHASE)
    expect(block).not.toBeNull()
    expect(block!.spectator).toBe(true)
  })

  // Phase 12B role toggle: a seated player can opt this device out of recording.
  it('makes a seated device in spectator mode read-only', () => {
    const block = evaluateGating(fakeGm({ seat: 1, deviceRole: 'spectator' }), HAND, PHASE)
    expect(block).not.toBeNull()
    expect(block!.spectator).toBe(true)
  })

  // ...but the host role always outranks a stale spectator flag — holding host IS a recording role.
  it('still lets the host act even if the device role reads spectator', () => {
    expect(evaluateGating(fakeGm({ host: true, seat: 0, deviceRole: 'spectator' }), HAND, PHASE)).toBeNull()
  })
})
