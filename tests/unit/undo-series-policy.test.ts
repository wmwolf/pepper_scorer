import { describe, it, expect } from 'vitest'
import { evaluateUndoPolicy, evaluateSeriesAdvancePolicy, shouldPersistLocalCopy } from '../../src/lib/game'
import type { GameManager } from '../../src/lib/gameState'

// Fake manager satisfying the duck-typed MultiplayerManager the policies read. `firebase: false`
// makes asMultiplayer() return null (a local game). `hostPresent` drives isHostPresent().
function fakeGm(opts: {
  firebase?: boolean
  signedIn?: boolean
  seat?: number | null
  host?: boolean
  hostPresent?: boolean
  deviceRole?: 'player' | 'spectator' | 'host'
}): GameManager {
  return {
    isFirebaseGame: () => opts.firebase ?? true,
    getViewerSeatInfo: () => ({ signedIn: opts.signedIn ?? true, seat: opts.seat ?? null }),
    isManualOverride: () => false,
    isHost: () => opts.host ?? false,
    isHostPresent: () => opts.hostPresent ?? false,
    getDeviceRole: () => opts.deviceRole ?? (opts.host ? 'host' : (opts.seat != null ? 'player' : 'spectator')),
    getFirebasePlayers: () => [],
    state: { teams: ['We', 'They'], players: ['A', 'B', 'C', 'D'] },
  } as unknown as GameManager
}

describe('evaluateUndoPolicy', () => {
  it('is open for a local (non-Firebase) game', () => {
    expect(evaluateUndoPolicy(fakeGm({ firebase: false }))).toEqual({ kind: 'open' })
  })

  it('blocks a signed-out device', () => {
    expect(evaluateUndoPolicy(fakeGm({ signedIn: false })).kind).toBe('blocked')
  })

  // Host present => host-only.
  it('lets the host undo when a host is present', () => {
    expect(evaluateUndoPolicy(fakeGm({ host: true, hostPresent: true, seat: 0 }))).toEqual({ kind: 'open' })
  })

  it('blocks a non-host seated player when a host is present', () => {
    const d = evaluateUndoPolicy(fakeGm({ host: false, hostPresent: true, seat: 1 }))
    expect(d.kind).toBe('blocked')
  })

  // No host present => seated players undo with confirmation, others blocked.
  it('requires confirmation for a seated player when no host is present', () => {
    expect(evaluateUndoPolicy(fakeGm({ hostPresent: false, seat: 2 }))).toEqual({ kind: 'confirm' })
  })

  it('blocks a seated device in spectator mode even with no host present', () => {
    expect(evaluateUndoPolicy(fakeGm({ hostPresent: false, seat: 2, deviceRole: 'spectator' })).kind).toBe('blocked')
  })

  it('blocks a signed-in non-seated device when no host is present', () => {
    expect(evaluateUndoPolicy(fakeGm({ hostPresent: false, seat: null })).kind).toBe('blocked')
  })
})

describe('evaluateSeriesAdvancePolicy', () => {
  it('is open for a local (non-Firebase) game', () => {
    expect(evaluateSeriesAdvancePolicy(fakeGm({ firebase: false }))).toBe('open')
  })

  it('blocks a signed-out device', () => {
    expect(evaluateSeriesAdvancePolicy(fakeGm({ signedIn: false }))).toBe('blocked')
  })

  it('lets the host advance when a host is present', () => {
    expect(evaluateSeriesAdvancePolicy(fakeGm({ host: true, hostPresent: true, seat: 0 }))).toBe('host')
  })

  it('makes non-host players wait when a host is present', () => {
    expect(evaluateSeriesAdvancePolicy(fakeGm({ host: false, hostPresent: true, seat: 1 }))).toBe('host-only')
    expect(evaluateSeriesAdvancePolicy(fakeGm({ host: false, hostPresent: true, seat: null }))).toBe('host-only')
  })

  it('starts a cancelable timer for a seated player when no host is present', () => {
    expect(evaluateSeriesAdvancePolicy(fakeGm({ hostPresent: false, seat: 2 }))).toBe('timer')
  })

  it('blocks a spectator-mode or non-seated device when no host is present', () => {
    expect(evaluateSeriesAdvancePolicy(fakeGm({ hostPresent: false, seat: 2, deviceRole: 'spectator' }))).toBe('blocked')
    expect(evaluateSeriesAdvancePolicy(fakeGm({ hostPresent: false, seat: null }))).toBe('blocked')
  })
})

describe('shouldPersistLocalCopy', () => {
  it('always persists for a local (non-Firebase) game', () => {
    expect(shouldPersistLocalCopy(fakeGm({ firebase: false, seat: null }))).toBe(true)
  })

  it('persists for a seated participant', () => {
    expect(shouldPersistLocalCopy(fakeGm({ seat: 0 }))).toBe(true)
  })

  it('persists for the host (even unseated)', () => {
    expect(shouldPersistLocalCopy(fakeGm({ host: true, seat: null }))).toBe(true)
  })

  it('does NOT persist for a pure spectator (unseated, not host) — the pollution fix', () => {
    expect(shouldPersistLocalCopy(fakeGm({ seat: null, host: false }))).toBe(false)
  })
})
