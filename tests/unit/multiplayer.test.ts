import { describe, it, expect } from 'vitest'
import {
  resolveSeat,
  teamOfSeat,
  type SeatPlayer,
} from '../../src/lib/multiplayer'

// Pure helpers for the Phase 8 multiplayer layer. These back "which seat am I" and the
// seat→team mapping, so they are worth protecting directly even though the surrounding
// Firebase/DOM code is verified manually.

const players: SeatPlayer[] = [
  { userId: 'uid-0', position: 0, displayName: 'Alice' },
  { userId: 'uid-1', position: 1, displayName: 'Bob' },
  { userId: undefined, position: 2, displayName: 'Guest' }, // unauthenticated seat
  { userId: 'uid-3', position: 3, displayName: 'Dana' },
]

describe('resolveSeat', () => {
  it('returns the seat position for a seated authenticated user', () => {
    expect(resolveSeat(players, 'uid-0')).toBe(0)
    expect(resolveSeat(players, 'uid-3')).toBe(3)
  })

  it('returns null for a user who is not seated (spectator)', () => {
    expect(resolveSeat(players, 'uid-stranger')).toBeNull()
  })

  it('returns null when uid or players are missing', () => {
    expect(resolveSeat(players, null)).toBeNull()
    expect(resolveSeat(players, undefined)).toBeNull()
    expect(resolveSeat(null, 'uid-0')).toBeNull()
    expect(resolveSeat(undefined, 'uid-0')).toBeNull()
  })

  it('does not match an unauthenticated seat against an undefined uid', () => {
    // A seat with userId===undefined must never be claimed by a null/undefined lookup.
    expect(resolveSeat(players, undefined)).toBeNull()
  })
})

describe('teamOfSeat', () => {
  it('assigns seats 0 & 2 to team 0 and seats 1 & 3 to team 1', () => {
    expect(teamOfSeat(0)).toBe(0)
    expect(teamOfSeat(2)).toBe(0)
    expect(teamOfSeat(1)).toBe(1)
    expect(teamOfSeat(3)).toBe(1)
  })
})
