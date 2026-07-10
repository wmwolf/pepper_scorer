// @vitest-environment jsdom
//
// Drives the REAL concurrent-auction DOM renderer (renderAuction from game.ts) and its event
// wiring against a fake multiplayer manager backed by the REAL auction engine. This is the
// faithful, repeatable substitute for a live 4-device browser session (which can't be stood up
// here — it needs real Firebase + four Google sign-ins). It covers the DOM path that was
// previously verified only manually.

import { describe, it, expect, beforeEach } from 'vitest'
import { renderAuction } from '../../src/lib/game'
import {
  createAuction,
  enterBid as engineEnterBid,
  setTrump as engineSetTrump,
  type AuctionState,
  type ActionValue,
  type TrumpSuit,
} from '../../src/lib/auction'

// A minimal stand-in for FirebaseGameManager holding a mutable AuctionState mutated only through
// the real engine — exactly what the wiring calls in production.
function makeHarness(dealerSeat: number, mySeat0: number | null) {
  const players = [
    { userId: 'u1', displayName: 'Alice', isAuthenticated: true, position: 0 },
    { userId: 'u2', displayName: 'Bob', isAuthenticated: true, position: 1 },
    { userId: 'u3', displayName: 'Carol', isAuthenticated: true, position: 2 },
    { userId: 'u4', displayName: 'Dave', isAuthenticated: true, position: 3 },
  ]
  let auction: AuctionState | null = createAuction(dealerSeat, 0)
  const gm = { state: { players: ['Alice', 'Bob', 'Carol', 'Dave'], hands: ['1'] } }
  const mp = {
    getMySeat: () => mySeat0,
    getFirebasePlayers: () => players,
    getAuction: () => auction,
    ensureAuctionForCurrentHand: async () => {},
    enterBid: async (seat: number, value: ActionValue, suit?: string) => {
      auction = engineEnterBid(auction!, seat, value, suit as TrumpSuit | undefined)
    },
    setTrump: async (seat: number, suit: string) => {
      auction = engineSetTrump(auction!, seat, suit as TrumpSuit)
    },
  }
  return { gm, mp, engineEnter: (seat: number, v: ActionValue, s?: TrumpSuit) => { auction = engineEnterBid(auction!, seat, v, s) } }
}

function render(h: ReturnType<typeof makeHarness>) {
  renderAuction(h.gm as never, h.mp as never)
}

function html() {
  return document.getElementById('auction-controls')!.innerHTML
}

const tick = () => new Promise(res => setTimeout(res, 0))

beforeEach(() => {
  document.body.innerHTML = `<div id="game-instruction"></div><div id="auction-controls"></div>`
  ;(window as unknown as { updateUI?: () => void }).updateUI = undefined
})

describe('freshly-created auction (RTDB dropped empty entries/order)', () => {
  it('renders without crashing when entries/order are undefined', () => {
    // A just-created auction round-trips through RTDB with entries (and possibly order) dropped.
    // renderAuction must not throw on `auction.entries[seat]` — else the UI freezes on
    // "Starting the auction…" (the multi-device auction-stuck bug).
    const gm = { state: { players: ['Alice', 'Bob', 'Carol', 'Dave'], hands: ['1'] } }
    const mp = {
      getMySeat: () => 1,
      getFirebasePlayers: () => [],
      getAuction: () => ({ handIndex: 0, order: [2, 3, 4, 1] }), // no `entries` key
      ensureAuctionForCurrentHand: async () => {},
      enterBid: async () => {},
      setTrump: async () => {},
    }
    expect(() => renderAuction(gm as never, mp as never)).not.toThrow()
    expect(html()).toContain('Bidding')
  })
})

describe('concurrent bid entry (no turn pointer)', () => {
  it('offers every bid value plus Pass immediately, before anyone has entered', () => {
    // dealer 1 -> order [2,3,4,1]; viewer is seat 2 (0-based 1).
    const h = makeHarness(1, 1)
    render(h)
    const out = html()
    expect(out).toContain('Enter your bid')
    // All five values offered (no legalBids filtering).
    for (const v of ['4', '5', '6']) expect(out).toContain(`data-bidval="${v}"`)
    expect(out).toContain('data-bidval="M"')
    expect(out).toContain('data-bidval="D"')
    expect(out).toContain('data-bidval="PASS"')
  })

  it('clicking a bid value enters it via the manager and then shows the trump menu', async () => {
    const h = makeHarness(1, 1) // viewer seat 2 = order[0], so its bid reveals immediately
    ;(window as unknown as { updateUI: () => void }).updateUI = () => render(h)
    render(h)
    document.querySelector<HTMLButtonElement>('.btn-auction-bid[data-bidval="5"]')!.click()
    await tick()
    const out = html()
    expect(out).toContain('choose your trump')
    expect(out).toContain('btn-auction-suit')
    // The bid is now recorded in the engine (revealed for order[0]) — value shown in the strip.
    expect(out).toContain('bid 5')
  })
})

describe('masked reveal (hidden until dealer-prefix reached)', () => {
  it('shows the author a masked "bid logged", not the value, when unrevealed', () => {
    // Viewer is seat 4 = order index 2. Entering before seats 2 & 3 keeps it hidden.
    const h = makeHarness(1, 3)
    h.engineEnter(4, '6', 'C')
    render(h)
    const out = html()
    expect(out).toContain('bid logged')     // masked status for my own row / action
    expect(out).not.toContain('bid 6')      // value not revealed to anyone yet
  })

  it('cascade-reveals the prefix once the gap fills', () => {
    const h = makeHarness(1, 3) // order [2,3,4,1]
    h.engineEnter(4, '6', 'C')  // hidden
    h.engineEnter(3, '5')       // still hidden (seat 2 missing)
    h.engineEnter(2, '4')       // fills the front -> 2,3,4 all reveal
    render(h)
    const out = html()
    expect(out).toContain('bid 4')
    expect(out).toContain('bid 5')
    expect(out).toContain('bid 6')
  })
})

describe('edit windows', () => {
  it('offers Edit bid while the successor is unrevealed, and withdraws it once locked', () => {
    const h = makeHarness(1, 1) // viewer seat 2 = order[0]
    h.engineEnter(2, '5', 'H')  // my bid revealed, successor (seat 3) not yet
    render(h)
    expect(html()).toContain('auction-edit-bid')
    // Successor reveals -> my bid locks -> Edit bid disappears.
    h.engineEnter(3, 'PASS')
    render(h)
    expect(html()).not.toContain('auction-edit-bid')
  })
})

describe('winner awaiting trump', () => {
  beforeEach(() => {
    // Auction where seat 2 wins 6 with NO trump and everyone else passes -> complete but unresolved.
  })

  it('shows the trump menu to the winner and a waiting note to others', () => {
    const winner = makeHarness(1, 1) // viewer is the winner (seat 2)
    for (const [seat, v] of [[2, '6'], [3, 'PASS'], [4, 'PASS'], [1, 'PASS']] as [number, ActionValue][]) {
      winner.engineEnter(seat, v)
    }
    render(winner)
    expect(html()).toContain('btn-auction-suit') // winner still owes a trump

    const other = makeHarness(1, 2) // viewer is seat 3 (a passer)
    for (const [seat, v] of [[2, '6'], [3, 'PASS'], [4, 'PASS'], [1, 'PASS']] as [number, ActionValue][]) {
      other.engineEnter(seat, v)
    }
    render(other)
    expect(html()).toContain('to choose trump')
  })
})

describe('throw-in', () => {
  it('reports a thrown-in hand to a spectator', () => {
    const h = makeHarness(1, null) // spectator
    for (const seat of [2, 3, 4, 1]) h.engineEnter(seat, 'PASS')
    render(h)
    expect(html()).toContain('Thrown in')
  })
})
