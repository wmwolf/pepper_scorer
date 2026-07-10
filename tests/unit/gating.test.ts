import { describe, it, expect } from 'vitest'
import { evaluateGating } from '../../src/lib/game'
import type { GameManager } from '../../src/lib/gameState'

// Build a fake manager satisfying the duck-typed MultiplayerManager that evaluateGating reads.
// `firebase: false` makes asMultiplayer() return null (a local game).
function fakeGm(opts: {
  firebase?: boolean
  signedIn?: boolean
  seat?: number | null
  override?: boolean
  host?: boolean
  presenceKnown?: boolean
  hostPresent?: boolean
  hostName?: string
}): GameManager {
  return {
    isFirebaseGame: () => opts.firebase ?? true,
    getViewerSeatInfo: () => ({ signedIn: opts.signedIn ?? true, seat: opts.seat ?? null }),
    isManualOverride: () => opts.override ?? false,
    isHost: () => opts.host ?? false,
    hasPresenceData: () => opts.presenceKnown ?? false,
    isHostPresent: () => opts.hostPresent ?? true,
    getHostName: () => opts.hostName ?? 'Alice',
    getFirebasePlayers: () => [],
    state: { teams: ['We', 'They'], players: ['A', 'B', 'C', 'D'] },
  } as unknown as GameManager
}

const PHASE = 'decision'
const HAND = '12P C' // arbitrary; evaluateGating keys off phase + host, not the hand string

describe('evaluateGating — host-based model', () => {
  it('applies no gating to a local (non-Firebase) game', () => {
    expect(evaluateGating(fakeGm({ firebase: false }), HAND, PHASE)).toBeNull()
  })

  it('lets the host act in every phase', () => {
    for (const phase of ['bidder', 'bid', 'trump', 'decision', 'tricks']) {
      expect(evaluateGating(fakeGm({ host: true }), HAND, phase)).toBeNull()
    }
  })

  it('lets any player act while manual override is on', () => {
    expect(evaluateGating(fakeGm({ host: false, seat: 1, override: true }), HAND, PHASE)).toBeNull()
  })

  it('lets the bid winner pick their OWN trump (pepper auto-win), not just the host', () => {
    // hand[1]='2' -> bid winner is seat index 1; that seat may pick trump without override.
    expect(evaluateGating(fakeGm({ host: false, seat: 1 }), '12P', 'trump')).toBeNull()
  })

  it('blocks a non-bid-winner non-host from picking trump, naming the bid winner', () => {
    const block = evaluateGating(fakeGm({ host: false, seat: 0 }), '12P', 'trump')
    expect(block).not.toBeNull()
    expect(block!.spectator).toBe(false)
    expect(block!.responsibleName).toBe('B') // gm.state.players[1]
    expect(block!.verb).toBe('pick trump')
  })

  it('still gates non-trump phases (decision) to the host even for the bid winner', () => {
    // The bid winner is not special for decision/tricks — those stay the host's job.
    const block = evaluateGating(fakeGm({ host: false, seat: 1, hostName: 'Bob' }), '12P', 'decision')
    expect(block).not.toBeNull()
    expect(block!.responsibleName).toBe('Bob')
  })

  it('blocks a signed-in non-host seated player, waiting on the host', () => {
    const block = evaluateGating(fakeGm({ host: false, seat: 1, hostName: 'Bob' }), HAND, PHASE)
    expect(block).not.toBeNull()
    expect(block!.spectator).toBe(false)
    expect(block!.responsibleName).toBe('Bob')
    expect(block!.verb).toBe('make the play/fold decision')
  })

  it('drops gating when presence is known and the host is offline', () => {
    const block = evaluateGating(
      fakeGm({ host: false, seat: 1, presenceKnown: true, hostPresent: false }), HAND, PHASE)
    expect(block).toBeNull()
  })

  it('keeps blocking when the host is present', () => {
    const block = evaluateGating(
      fakeGm({ host: false, seat: 1, presenceKnown: true, hostPresent: true }), HAND, PHASE)
    expect(block).not.toBeNull()
    expect(block!.spectator).toBe(false)
  })

  it('treats a signed-in non-seated viewer as a read-only spectator', () => {
    const block = evaluateGating(fakeGm({ host: false, signedIn: true, seat: null }), HAND, PHASE)
    expect(block).not.toBeNull()
    expect(block!.spectator).toBe(true)
  })

  it('treats a signed-out device as read-only (rules forbid it writing anyway)', () => {
    const block = evaluateGating(fakeGm({ signedIn: false }), HAND, PHASE)
    expect(block).not.toBeNull()
    expect(block!.spectator).toBe(true)
    expect(block!.responsibleName).toBe('the host')
  })
})
