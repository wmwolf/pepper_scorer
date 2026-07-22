import { describe, it, expect } from 'vitest'
import {
  firstName,
  shortNames,
  playerNameWillTruncate,
  teamNameWillTruncate,
  SHORT_NAME_MAX,
  SCORE_CELL_NAME_MAX,
  TEAM_HEADER_MAX,
} from '../../src/lib/displayNames'

describe('firstName', () => {
  it('takes the first whitespace token', () => {
    expect(firstName('William Wolf')).toBe('William')
    expect(firstName('Christopher Lee Wolf')).toBe('Christopher')
  })

  it('returns a single-token name unchanged', () => {
    expect(firstName('Bob')).toBe('Bob')
  })

  it('handles extra/leading whitespace and empties', () => {
    expect(firstName('  Ada   Lovelace ')).toBe('Ada')
    expect(firstName('')).toBe('')
    expect(firstName('   ')).toBe('')
  })
})

describe('shortNames', () => {
  it('drops the surname, keeping just the first name', () => {
    expect(shortNames(['William Wolf', 'Bob Vance', 'Ada Lovelace', 'Grace Hopper']))
      .toEqual(['William', 'Bob', 'Ada', 'Grace'])
  })

  it('disambiguates a shared first name with a last initial (only the colliding pair)', () => {
    const out = shortNames(['Chris Brown', 'Bob Vance', 'Chris Martin', 'Grace Hopper'])
    expect(out[0]).toBe('Chris B.')
    expect(out[2]).toBe('Chris M.')
    // non-colliding names are left as bare first names
    expect(out[1]).toBe('Bob')
    expect(out[3]).toBe('Grace')
  })

  it('is case-insensitive when detecting collisions', () => {
    const out = shortNames(['chris brown', 'CHRIS martin', 'Bob Vance', 'Grace Hopper'])
    expect(out[0]).toBe('chris B.')
    expect(out[1]).toBe('CHRIS M.')
  })

  it('does not add an initial when a colliding name has no surname', () => {
    const out = shortNames(['Chris', 'Chris Martin', 'Bob', 'Grace'])
    // first "Chris" has no last token, so it stays bare; the second gets its initial
    expect(out[0]).toBe('Chris')
    expect(out[1]).toBe('Chris M.')
  })

  it('ellipsis-truncates an absurdly long single first name', () => {
    const longFirst = `${'a'.repeat(SHORT_NAME_MAX + 5)} Longfellow`
    const out = shortNames([longFirst, 'Bob', 'Ada', 'Grace'])
    expect(out[0].endsWith('…')).toBe(true)
    expect(out[0].length).toBe(SHORT_NAME_MAX)
  })

  it('applies the cap to the stem so a disambiguated label keeps its initial', () => {
    const long = 'a'.repeat(SHORT_NAME_MAX + 5)
    const out = shortNames([`${long} Aardvark`, `${long} Byrne`, 'Bob', 'Grace'])
    expect(out[0].endsWith('A.')).toBe(true)
    expect(out[1].endsWith('B.')).toBe(true)
  })

  it('tolerates empty seats', () => {
    expect(shortNames(['William Wolf', '', '', ''])).toEqual(['William', '', '', ''])
  })
})

describe('playerNameWillTruncate', () => {
  it('is false for a short first name even with a long surname', () => {
    expect(playerNameWillTruncate('Bob Vance-Refrigeration')).toBe(false)
  })

  it('is true when the first name alone exceeds the score-cell budget', () => {
    const longFirst = 'x'.repeat(SCORE_CELL_NAME_MAX + 1)
    expect(playerNameWillTruncate(longFirst)).toBe(true)
  })

  it('is false at exactly the budget', () => {
    expect(playerNameWillTruncate('x'.repeat(SCORE_CELL_NAME_MAX))).toBe(false)
  })
})

describe('teamNameWillTruncate', () => {
  it('is false for a short team name', () => {
    expect(teamNameWillTruncate('The Sharks')).toBe(false)
  })

  it('is true for a long default-style team name', () => {
    expect(teamNameWillTruncate("Christopher & Isabella's Team")).toBe(true)
  })

  it('is false at exactly the budget', () => {
    expect(teamNameWillTruncate('x'.repeat(TEAM_HEADER_MAX))).toBe(false)
  })
})
