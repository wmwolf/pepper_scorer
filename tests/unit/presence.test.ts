import { describe, it, expect } from 'vitest'
import { parsePresence } from '../../src/lib/multiplayer'

// parsePresence turns the raw games/{id}/presence node into uid -> roles of connected devices.
// It has to read BOTH the Phase 12 per-device shape and the Phase 8 uid-keyed shape, because a
// client on the old build keeps writing the old shape through a rollout.

describe('parsePresence', () => {
  it('reads the per-device shape', () => {
    const map = parsePresence({
      alice: { devA: { mode: 'player', ts: 1 } },
      bob: { devB: { mode: 'spectator', ts: 2 } },
    })
    expect(map.get('alice')).toEqual(['player'])
    expect(map.get('bob')).toEqual(['spectator'])
  })

  it('keeps two devices on ONE account distinct — the whole point of the schema', () => {
    const map = parsePresence({
      alice: { phone: { mode: 'player', ts: 1 }, laptop: { mode: 'spectator', ts: 2 } },
    })
    expect(map.get('alice')).toHaveLength(2)
    expect(map.get('alice')).toEqual(expect.arrayContaining(['player', 'spectator']))
  })

  it('treats a legacy uid-keyed entry as one device in player mode', () => {
    // The Phase 8 build wrote `presence/$uid = true`, and only for devices that could act.
    expect(parsePresence({ alice: true }).get('alice')).toEqual(['player'])
  })

  it('handles a mixed-build game (one old client, one new)', () => {
    const map = parsePresence({
      alice: true,
      bob: { devB: { mode: 'spectator', ts: 2 } },
    })
    expect(map.get('alice')).toEqual(['player'])
    expect(map.get('bob')).toEqual(['spectator'])
  })

  it('defaults an unknown or missing mode to player rather than dropping the device', () => {
    // Dropping it would report the seat as offline and wrongly release turn-gating.
    const map = parsePresence({
      alice: { devA: { ts: 1 } },
      bob: { devB: { mode: 'nonsense', ts: 1 } },
    })
    expect(map.get('alice')).toEqual(['player'])
    expect(map.get('bob')).toEqual(['player'])
  })

  it('omits a uid with no parseable devices instead of recording it as present', () => {
    // An empty entry would make isSeatPresent() claim a seat is online with nothing behind it.
    const map = parsePresence({ alice: {}, bob: null, carol: 42 })
    expect(map.has('alice')).toBe(false)
    expect(map.has('bob')).toBe(false)
    expect(map.has('carol')).toBe(false)
  })

  it('returns an empty map for an absent node', () => {
    expect(parsePresence(null).size).toBe(0)
    expect(parsePresence(undefined).size).toBe(0)
  })
})
