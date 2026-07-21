// @vitest-environment jsdom
//
// Drives the REAL concurrent-auction DOM renderer (renderAuction from game.ts) and its event
// wiring against a fake multiplayer manager backed by the REAL auction engine. This is the
// faithful, repeatable substitute for a live 4-device browser session (which can't be stood up
// here — it needs real Firebase + four Google sign-ins). It covers the DOM path that was
// previously verified only manually.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderAuction, auctionEligible } from '../../src/lib/game'
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
function makeHarness(
  dealerSeat: number,
  mySeat0: number | null,
  opts: { role?: 'player' | 'spectator' | 'host'; isHost?: boolean } = {},
) {
  const players = [
    { userId: 'u1', displayName: 'Alice', isAuthenticated: true, position: 0 },
    { userId: 'u2', displayName: 'Bob', isAuthenticated: true, position: 1 },
    { userId: 'u3', displayName: 'Carol', isAuthenticated: true, position: 2 },
    { userId: 'u4', displayName: 'Dave', isAuthenticated: true, position: 3 },
  ]
  let auction: AuctionState | null = createAuction(dealerSeat, 0)
  const declared: number[] = []
  const gm = { state: { players: ['Alice', 'Bob', 'Carol', 'Dave'], hands: ['1'] } }
  const mp = {
    getMySeat: () => mySeat0,
    getDeviceRole: () => opts.role ?? (mySeat0 !== null ? 'player' : 'spectator'),
    isHost: () => opts.isHost ?? false,
    getFirebasePlayers: () => players,
    getAuction: () => auction,
    ensureAuctionForCurrentHand: async () => {},
    enterBid: async (seat: number, value: ActionValue, suit?: string) => {
      auction = engineEnterBid(auction!, seat, value, suit as TrumpSuit | undefined)
    },
    setTrump: async (seat: number, suit: string) => {
      auction = engineSetTrump(auction!, seat, suit as TrumpSuit)
    },
    // Mirror FirebaseGameManager.hostTakeoverBidder: abort the auction and record the declaration.
    hostTakeoverBidder: async (seat: number) => { declared.push(seat); auction = null },
  }
  return {
    gm, mp, declared,
    engineEnter: (seat: number, v: ActionValue, s?: TrumpSuit) => { auction = engineEnterBid(auction!, seat, v, s) },
  }
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

// Role-aware rendering (the shared-display leak fix): participation keys on the DEVICE role, not
// the account's seat. A seated account on a shared display (spectator or host role) must never see
// the bid pad or trump selector — the trump selector's mere presence broadcasts bid-vs-pass.
// Real-game bug (2026-07-21): the auction stuck on "Starting the auction…" forever after a lost
// init write, because ensureAuctionForCurrentHand was fire-and-forget and never retried. The render
// must now self-heal — retry the init on a timer until the bidding node appears.
describe('auction init self-heals a lost write (no permanent "Starting…")', () => {
  it('retries ensureAuctionForCurrentHand after a failure instead of sticking', async () => {
    vi.useFakeTimers()
    try {
      const players = [
        { userId: 'u1', displayName: 'Alice', isAuthenticated: true, position: 0 },
        { userId: 'u2', displayName: 'Bob', isAuthenticated: true, position: 1 },
        { userId: 'u3', displayName: 'Carol', isAuthenticated: true, position: 2 },
        { userId: 'u4', displayName: 'Dave', isAuthenticated: true, position: 3 },
      ]
      let auction: AuctionState | null = null
      let ensureCalls = 0
      const gm = { state: { players: ['Alice', 'Bob', 'Carol', 'Dave'], hands: ['1'] } }
      const mp = {
        getMySeat: () => 1,
        getFirebasePlayers: () => players,
        getAuction: () => auction,
        ensureAuctionForCurrentHand: async () => {
          ensureCalls++
          if (ensureCalls === 1) throw new Error('lost write') // first attempt fails
          auction = createAuction(1, 0)                        // retry succeeds
        },
        enterBid: async () => {},
        setTrump: async () => {},
      }
      ;(window as unknown as { updateUI: () => void }).updateUI = () => renderAuction(gm as never, mp as never)

      renderAuction(gm as never, mp as never)
      await Promise.resolve() // let the rejected ensure's .catch reset the guard
      expect(html()).toContain('Starting the auction')
      expect(ensureCalls).toBe(1)

      // Advance past the self-heal interval: the retry re-attempts the init (which now succeeds).
      await vi.advanceTimersByTimeAsync(2600)
      expect(ensureCalls).toBeGreaterThanOrEqual(2)

      // A final re-render (as the bidding listener would trigger) now shows the auction, not "Starting…".
      renderAuction(gm as never, mp as never)
      expect(html()).not.toContain('Starting the auction')
      expect(html()).toContain('Bidding')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('role-aware rendering', () => {
  it('gives a seated device in PLAYER role the bid pad (unchanged behavior)', () => {
    const h = makeHarness(1, 1) // seat 2, defaults to player role
    render(h)
    const out = html()
    expect(out).toContain('Enter your bid')
    expect(out).toContain('btn-auction-bid')
  })

  it('hides the bid pad AND trump selector from a seated device in SPECTATOR role', () => {
    // The leak scenario: seat 2 is signed in on a shared display set to spectate. Even after that
    // seat has bid in the engine, this device must show only the read-only view.
    const h = makeHarness(1, 1, { role: 'spectator' })
    h.engineEnter(2, '5', 'H') // seat 2 (order[0]) bid + trump — would open the selector if seated
    render(h)
    const out = html()
    expect(out).not.toContain('btn-auction-bid')
    expect(out).not.toContain('btn-auction-suit')   // the leak: trump selector must NOT appear
    expect(out).not.toContain('choose your trump')
    expect(out).not.toContain('Enter your bid')
    expect(out).toContain('Waiting for players to bid')
  })

  it('does not leak "(you)"/edit affordances to a seated spectator', () => {
    const h = makeHarness(1, 1, { role: 'spectator' })
    h.engineEnter(2, '5', 'H')
    render(h)
    const out = html()
    expect(out).not.toContain('auction-edit-bid')
    expect(out).not.toContain('auction-edit-trump')
  })
})

describe('host takeover of a live auction', () => {
  it('shows the host declare controls (no bid pad / trump selector) with a masked strip', () => {
    const h = makeHarness(1, null, { role: 'host', isHost: true }) // unseated host on a laptop
    h.engineEnter(2, '6', 'C') // a live, in-progress bid
    render(h)
    const out = html()
    expect(out).toContain('You are hosting this auction')
    expect(out).toContain('Declaring a winner ends the live auction')
    expect(out).toContain('btn-host-declare')
    expect(out).not.toContain('btn-auction-bid')
    expect(out).not.toContain('btn-auction-suit')
    // Masked: seat 2 (order[0]) is revealed and public, but the host never gets a participant view.
    expect(out).not.toContain('Enter your bid')
  })

  it('offers a declare button per seat plus a throw-in', () => {
    const h = makeHarness(1, null, { role: 'host', isHost: true })
    render(h)
    const out = html()
    for (const name of ['Alice', 'Bob', 'Carol', 'Dave']) expect(out).toContain(name)
    expect(out).toContain('data-declare="0"')       // throw-in
    expect(out).toContain('No one bid')
  })

  it('declaring a winner calls hostTakeoverBidder with that seat (ending the auction)', async () => {
    const h = makeHarness(1, null, { role: 'host', isHost: true }) // dealer 1 -> order [2,3,4,1]
    ;(window as unknown as { updateUI: () => void }).updateUI = () => render(h)
    render(h)
    // Declare seat 3 (Carol) the winner.
    document.querySelector<HTMLButtonElement>('.btn-host-declare[data-declare="3"]')!.click()
    await tick()
    expect(h.declared).toEqual([3])
  })

  it('declaring a throw-in calls hostTakeoverBidder(0)', async () => {
    const h = makeHarness(1, null, { role: 'host', isHost: true })
    ;(window as unknown as { updateUI: () => void }).updateUI = () => render(h)
    render(h)
    document.querySelector<HTMLButtonElement>('.btn-host-declare[data-declare="0"]')!.click()
    await tick()
    expect(h.declared).toEqual([0])
  })

  it('lets a host account PLAYING on a player-role device still bid (not the takeover view)', () => {
    // Host account, seated seat 2, but this device is in player role (their phone). They play.
    const h = makeHarness(1, 1, { role: 'player', isHost: true })
    render(h)
    const out = html()
    expect(out).toContain('Enter your bid')
    expect(out).not.toContain('btn-host-declare')
  })
})

// auctionEligible gates whether the concurrent auction runs at all. Beyond the four-seats check, it
// must not stall on a seat that cannot bid (its only device is spectating/hosting, or it's offline);
// when presence reports such a seat, it falls back to host tap-flow entry.
describe('auctionEligible — player-device fallback', () => {
  const seated4 = [
    { userId: 'u1', displayName: 'Alice' }, { userId: 'u2', displayName: 'Bob' },
    { userId: 'u3', displayName: 'Carol' }, { userId: 'u4', displayName: 'Dave' },
  ]
  // handIndex 4 (5th hand) is past the pepper rounds, so isPepperRound is false.
  const gm = { state: { hands: ['h0', 'h1', 'h2', 'h3', ''] } }
  function mp(over: Record<string, unknown>) {
    return {
      isManualOverride: () => false,
      getFirebasePlayers: () => seated4,
      hasPresenceData: () => true,
      allSeatsHavePlayerDevice: () => true,
      ...over,
    }
  }

  it('is eligible when all four seats have a present player device', () => {
    expect(auctionEligible(gm as never, mp({}) as never, '5', 'bidder')).toBe(true)
  })

  it('falls back (not eligible) when a seat lacks a present player device', () => {
    expect(auctionEligible(gm as never, mp({ allSeatsHavePlayerDevice: () => false }) as never, '5', 'bidder')).toBe(false)
  })

  it('does NOT drop the auction before presence has reported (first-paint guard)', () => {
    // hasPresenceData() false => trust the four-seats check, keep the old behavior.
    expect(auctionEligible(gm as never, mp({ hasPresenceData: () => false, allSeatsHavePlayerDevice: () => false }) as never, '5', 'bidder')).toBe(true)
  })

  it('is not eligible outside the bidder phase or under manual override', () => {
    expect(auctionEligible(gm as never, mp({}) as never, '5', 'bid')).toBe(false)
    expect(auctionEligible(gm as never, mp({ isManualOverride: () => true }) as never, '5', 'bidder')).toBe(false)
  })
})
