import { describe, it, expect } from 'vitest'
import {
  resolveSeat,
  relativeDirection,
  directionArrow,
  directionLabel,
  teamOfSeat,
  turnGateFor,
  type SeatPlayer,
} from '../../src/lib/multiplayer'

// Pure helpers for the Phase 8 multiplayer layer. These back "which seat am I" and the
// relative-direction indicator used by the waiting states, so they are worth protecting
// directly even though the surrounding Firebase/DOM code is verified manually.

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

describe('relativeDirection', () => {
  it('classifies the four seats around the table from seat 0', () => {
    expect(relativeDirection(0, 0)).toBe('self')
    expect(relativeDirection(0, 1)).toBe('left')   // next clockwise
    expect(relativeDirection(0, 2)).toBe('across') // partner
    expect(relativeDirection(0, 3)).toBe('right')  // previous clockwise
  })

  it('wraps correctly from a non-zero seat', () => {
    expect(relativeDirection(3, 0)).toBe('left')   // 0 is clockwise-next from 3
    expect(relativeDirection(3, 1)).toBe('across')
    expect(relativeDirection(3, 2)).toBe('right')
    expect(relativeDirection(3, 3)).toBe('self')
  })

  it('partners are always across from each other', () => {
    expect(relativeDirection(1, 3)).toBe('across')
    expect(relativeDirection(2, 0)).toBe('across')
  })

  it('returns null for a spectator (no seat)', () => {
    expect(relativeDirection(null, 2)).toBeNull()
    expect(relativeDirection(undefined, 2)).toBeNull()
  })
})

describe('directionArrow / directionLabel', () => {
  it('maps directions to arrows', () => {
    expect(directionArrow('left')).toBe('←')
    expect(directionArrow('right')).toBe('→')
    expect(directionArrow('across')).toBe('↑')
    expect(directionArrow('self')).toBe('')
    expect(directionArrow(null)).toBe('')
  })

  it('maps directions to labels', () => {
    expect(directionLabel('left')).toBe('on your left')
    expect(directionLabel('right')).toBe('on your right')
    expect(directionLabel('across')).toBe('across from you')
    expect(directionLabel('self')).toBe('you')
    expect(directionLabel(null)).toBe('')
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

describe('turnGateFor', () => {
  // Hand: dealer=1, bidWinner=2 (seat 1, team 1), bid=5 -> trump/decision/tricks
  it('gates trump to the bid winner seat', () => {
    const gate = turnGateFor('125', 'trump')
    expect(gate).toEqual({ seats: [1], verb: 'pick trump' })
  })

  it('gates the decision to the defending team seats', () => {
    // bidWinner seat 1 is team 1, so defenders are team 0 = seats 0 & 2
    const gate = turnGateFor('125S', 'decision')
    expect(gate?.seats).toEqual([0, 2])
    expect(gate?.verb).toBe('decide to play or fold')
  })

  it('gates tricks entry to the bid winner (scorekeeper)', () => {
    const gate = turnGateFor('125SP', 'tricks')
    expect(gate).toEqual({ seats: [1], verb: 'enter the tricks won' })
  })

  it('flips defenders when the bid winner is on team 0', () => {
    // bidWinner=1 (seat 0, team 0) -> defenders team 1 = seats 1 & 3
    const gate = turnGateFor('114', 'decision')
    expect(gate?.seats).toEqual([1, 3])
  })

  it('does not gate the bidder or bid phases (open to all in 8a)', () => {
    expect(turnGateFor('1', 'bidder')).toBeNull()
    expect(turnGateFor('12', 'bid')).toBeNull()
  })

  it('returns null for a thrown-in hand (no bid winner)', () => {
    expect(turnGateFor('10', 'trump')).toBeNull()
  })
})
