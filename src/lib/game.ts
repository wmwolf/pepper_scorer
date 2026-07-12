// src/lib/game.ts

import { GameManager, getCurrentPhase, isPepperRound, calculateScore, isHandComplete } from './gameState';
import { getPath } from './path-utils';
import { type SeatPlayer } from './multiplayer';
import {
  revealedCount,
  isRevealed,
  isBidLocked,
  isComplete as auctionIsComplete,
  isOutbid,
  isDemoted,
  canSetTrump,
  resolve as resolveAuction,
  auctionResult,
  type AuctionState,
  type ActionValue,
  type BidValue,
} from './auction';

// Duck-typed view of the multiplayer (Firebase) manager. game.ts stays decoupled from
// the concrete FirebaseGameManager (a heavy, network-touching module) — it only needs
// these accessors to gate turn-based input. A local GameManager lacks them, so
// asMultiplayer() returns null and no gating applies.
interface MultiplayerManager {
  isFirebaseGame(): boolean;
  getGameId(): string | null;
  getMySeat(): number | null;
  getFirebasePlayers(): SeatPlayer[];
  getViewerSeatInfo(): { signedIn: boolean; seat: number | null };
  isManualOverride(): boolean;
  // eslint-disable-next-line no-unused-vars
  setManualOverride(value: boolean): void;
  isSeatPresent?(_seat: number): boolean;
  hasPresenceData?(): boolean;
  // Host-based gating: the creator may enter every decision; others wait + override.
  isHost?(): boolean;
  getHostName?(): string;
  isHostPresent?(): boolean;
  // Auction (8b concurrent-entry redesign)
  getAuction(): AuctionState | null;
  ensureAuctionForCurrentHand(): Promise<void>;
  // eslint-disable-next-line no-unused-vars
  enterBid(seat: number, value: ActionValue, suit?: string): Promise<void>;
  // eslint-disable-next-line no-unused-vars
  setTrump(seat: number, suit: string): Promise<void>;
}

function asMultiplayer(gm: GameManager): MultiplayerManager | null {
  const candidate = gm as unknown as Partial<MultiplayerManager>;
  if (
    typeof candidate.isFirebaseGame === 'function' &&
    typeof candidate.getViewerSeatInfo === 'function' &&
    candidate.isFirebaseGame()
  ) {
    return candidate as MultiplayerManager;
  }
  return null;
}

// A blocked turn: the current viewer must wait for someone else to act.
interface GatingBlock {
  spectator: boolean;      // true = signed-in non-participant
  responsibleName: string; // player or team we're waiting on
  verb: string;            // what they need to do
  arrow: string;           // relative-direction glyph (may be empty)
  directionText: string;   // e.g. "on your left" (may be empty)
}

// Human verb for what the host does in each tap-flow phase (used in the waiting message).
function hostVerbForPhase(phase: string): string {
  switch (phase) {
    case 'bidder': return 'record who won the bid';
    case 'bid': return 'enter the bid';
    case 'trump': return 'pick trump';
    case 'decision': return 'record the play/fold decision';
    case 'tricks': return 'record the tricks';
    default: return 'play the hand';
  }
}

// Exported as a test seam (tests/unit/gating.test.ts drives it with a fake manager).
// Decide whether the current viewer may act in `phase`, or must wait. Host-based model with one
// exception: the **bid winner** enters their OWN trump (a pepper auto-win, or any non-auction
// hand) — every other decision (bidder/bid/decision/tricks) is the host's. Other signed-in
// players wait with a manual-override escape hatch. The concurrent auction (all four signed in)
// is handled earlier by auctionEligible()/renderAuction, so this only governs the tap flow.
// Returns null when no gating applies (local game, host, the bid winner picking trump, override).
export function evaluateGating(gm: GameManager, currentHand: string, phase: string): GatingBlock | null {
  const mp = asMultiplayer(gm);
  if (!mp) return null;                 // local game — full control

  const { signedIn, seat } = mp.getViewerSeatInfo();
  const verb = hostVerbForPhase(phase);

  // Not signed in on a Firebase game: the security rules forbid reading/writing it, so this
  // device can't participate — read-only, no override (an override write would be rejected).
  if (!signedIn) {
    return { spectator: true, responsibleName: 'the host', verb, arrow: '', directionText: '' };
  }

  if (mp.isManualOverride()) return null;

  // The host can enter everything.
  if (typeof mp.isHost === 'function' && mp.isHost()) return null;

  // The bid winner picks their OWN trump (bidWinner is currentHand[1], 1-based; 0 = throw-in).
  const bidWinner = parseInt(currentHand[1] || '0');
  const trumpSeat = phase === 'trump' && bidWinner ? bidWinner - 1 : null;
  if (trumpSeat !== null && seat === trumpSeat) return null;

  // Signed-in spectator (not seated): read-only.
  if (seat === null) {
    return { spectator: true, responsibleName: 'the players', verb, arrow: '', directionText: '' };
  }

  // Presence fallback: once presence is known, if the responsible party is offline, drop gating
  // so play isn't stuck. Responsible = the bid winner for trump, else the host. Guarded by
  // hasPresenceData() so the first paint (before presence loads) keeps gating intact.
  const presenceKnown = typeof mp.hasPresenceData === 'function' && mp.hasPresenceData();
  if (presenceKnown) {
    const responsiblePresent = trumpSeat !== null
      ? (typeof mp.isSeatPresent === 'function' ? mp.isSeatPresent(trumpSeat) : true)
      : (typeof mp.isHostPresent === 'function' ? mp.isHostPresent() : true);
    if (!responsiblePresent) return null;
  }

  // Blocked: wait on the responsible party (the bid winner for trump, else the host).
  const responsibleName = trumpSeat !== null
    ? (mp.getFirebasePlayers()[trumpSeat]?.displayName || gm.state.players[trumpSeat] || `Seat ${trumpSeat + 1}`)
    : (typeof mp.getHostName === 'function' ? mp.getHostName() : 'the host');
  return { spectator: false, responsibleName, verb, arrow: '', directionText: '' };
}

// Extend window interface for global properties
declare global {
  interface Window {
    gameManager?: GameManager;
    firebaseGame?: GameManager;
    updateUI?: () => void;
    exportGame?: () => Record<string, unknown>;
    importGame?: (_gameData: Record<string, unknown>) => void;
    clearDebugGame?: () => void;
  }
}
export function loadGameState() {
    // Check for debug game first
    const debugGame = localStorage.getItem('debugGame');
    if (debugGame) {
        localStorage.removeItem('debugGame'); // Use once
        console.log('🔧 Loading debug game...');
        const debugData = JSON.parse(debugGame);
        
        // Create a new GameManager and reconstruct the game state properly
        const gameManager = new GameManager(debugData.players, debugData.teams);
        
        // Add each hand one by one to properly calculate scores and maintain state consistency
        debugData.hands.forEach((hand: string) => {
            // For complete hands, add all parts at once
            if (isHandComplete(hand)) {
                gameManager.state.hands.push(hand);
            } else {
                // For incomplete hands, just set as the current hand
                gameManager.state.hands.push(hand);
            }
        });
        
        // Recalculate scores from scratch
        gameManager.state.scores = gameManager.getScores();
        
        // Mark as complete if it qualifies and trigger completion logic
        if (gameManager.isGameComplete()) {
            gameManager.completeGame();
        }
        
        console.log('🔧 Debug game state reconstructed:', gameManager.state);
        return gameManager.state;
    }
    
    // Original logic for normal games
    const storedGame = localStorage.getItem('currentGame');
    if (!storedGame) {
        window.location.href = getPath(''); // Redirect to home
        return null;
    }
    return JSON.parse(storedGame);
}

// UI functions
function bidToString(bid: string) {
    switch (bid) {
        case 'P': return '4';
        case '4': return '4';
        case '5': return '5';
        case '6': return '6';
        case 'M': return '🌙';
        case 'D': return '🌙🌙';
        default: return bid;
    }
}

function trumpToString(trump: string): string {
    switch (trump) {
      case 'C': return '♣️';
      case 'D': return '♦️';
      case 'S': return '♠️';
      case 'H': return '♥️';
      case 'N': return '∅';
      default: return trump;
    }
  }

function hideAllControls() {
    ['player-controls', 'bid-controls', 'trump-controls',
     'decision-controls', 'tricks-controls', 'end-game-controls', 'waiting-panel',
     'auction-controls'].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.classList.add('hidden');
    });
}

// Render the "waiting for your turn" panel in place of the phase controls.
function showWaitingPanel(block: GatingBlock) {
    const panel = document.getElementById('waiting-panel');
    const arrowEl = document.getElementById('waiting-arrow');
    const messageEl = document.getElementById('waiting-message');
    const manualBtn = document.getElementById('waiting-manual-btn');
    if (!panel) return;

    if (arrowEl) arrowEl.textContent = block.arrow;
    if (messageEl) {
        if (block.spectator) {
            messageEl.textContent = `Spectating — waiting for ${block.responsibleName} to ${block.verb}.`;
        } else {
            const where = block.directionText ? ` (${block.directionText})` : '';
            messageEl.textContent = `Waiting for ${block.responsibleName}${where} to ${block.verb}…`;
        }
    }
    // Spectators can't take over scoring; only seated players see the manual escape hatch.
    if (manualBtn) manualBtn.classList.toggle('hidden', block.spectator);

    panel.classList.remove('hidden');
    updateInstructions(block.spectator ? 'Spectating' : 'Waiting for your turn');
}

// Per-device, per-game localStorage key for the manual-scoring override preference.
function overrideStorageKey(mp: MultiplayerManager): string {
    return `pepperOverride:${mp.getGameId() || 'local'}`;
}

// Show or hide the "manual scoring on" bar to match the manager's override flag.
function renderOverrideBar(gameManager: GameManager) {
    const bar = document.getElementById('manual-override-bar');
    if (!bar) return;
    const mp = asMultiplayer(gameManager);
    bar.classList.toggle('hidden', !(mp && mp.isManualOverride()));
}

// Wire the manual-override toggles (waiting-panel "take over" link and the bar's "Turn
// off" button) once. Also restores any saved override preference for this game.
function setupMultiplayerControls(gameManager: GameManager, updateUI: () => void) {
    const mp = asMultiplayer(gameManager);
    if (!mp) return;

    // Restore saved preference (per device, per game).
    try {
        if (localStorage.getItem(overrideStorageKey(mp)) === 'true') {
            mp.setManualOverride(true);
        }
    } catch { /* localStorage unavailable — ignore */ }

    const setOverride = (value: boolean) => {
        mp.setManualOverride(value);
        try { localStorage.setItem(overrideStorageKey(mp), String(value)); } catch { /* ignore */ }
        updateUI();
    };

    document.getElementById('waiting-manual-btn')?.addEventListener('click', () => setOverride(true));
    document.getElementById('manual-override-off')?.addEventListener('click', () => setOverride(false));
}

function updateInstructions(text: string) {
    const element = document.getElementById('game-instruction');
    if (element) element.textContent = text;
}

function updateHandInfo(gameManager: GameManager) {
    const currentHand = gameManager.getCurrentHand();
    const handIndex = gameManager.state.hands.length - 1;
    const handNumber = handIndex + 1;
    
    // Basic hand info elements
    const handInfoEl = document.getElementById('hand-info');
    const handInfoMobileEl = document.getElementById('hand-info-mobile');
    const bidInfoEl = document.getElementById('bid-info');
    const bidInfoMobileEl = document.getElementById('bid-info-mobile');
    
    // Only update if at least one element exists
    if (!handInfoEl && !handInfoMobileEl && !bidInfoEl && !bidInfoMobileEl) return;
    
    // Get current dealer
    const dealerIndex = parseInt(currentHand[0] || '1') - 1;
    const dealer = gameManager.state.players[dealerIndex];
    
    // Hand number and dealer info
    const handInfoText = `Hand ${handNumber}: ${dealer} is dealer`;
    if (handInfoEl) handInfoEl.textContent = handInfoText;
    if (handInfoMobileEl) handInfoMobileEl.textContent = handInfoText;
    
    // Bid info text depends on phase
    const phase = getCurrentPhase(currentHand);
    let bidInfoText = "Waiting for bid";
    
    if (phase === 'bidder') {
        const nextPlayerIndex = (dealerIndex + 1) % 4;
        const nextPlayer = gameManager.state.players[nextPlayerIndex];
        
        if (isPepperRound(handIndex)) {
            bidInfoText = `${nextPlayer} has first bid (pepper)`;
        } else {
            bidInfoText = `Bidding starts with ${nextPlayer}`;
        }
    } else if (phase === 'bid') {
        const bidderIndex = parseInt(currentHand[1] || '1') - 1;
        const bidder = gameManager.state.players[bidderIndex];
        bidInfoText = `${bidder} won the bid`;
    } else if (phase === 'trump' || phase === 'decision' || phase === 'tricks') {
        const bidderIndex = parseInt(currentHand[1] || '1') - 1;
        const bidder = gameManager.state.players[bidderIndex];
        const bid = currentHand[2] || '';
        const bidText = bidToString(bid);
        
        if (phase === 'trump') {
            bidInfoText = `${bidder} bid ${bidText}`;
        } else {
            const trump = currentHand[3] || '';
            const trumpText = trumpToString(trump);
            bidInfoText = `${bidder} bid ${bidText} in ${trumpText}`;
        }
    }
    
    if (bidInfoEl) bidInfoEl.textContent = bidInfoText;
    if (bidInfoMobileEl) bidInfoMobileEl.textContent = bidInfoText;
}

// ---- Bidding auction UI (Phase 8b) ---------------------------------------------------

// Local (per-device) UI state for the concurrent auction: which hand we've already kicked
// off, and whether the viewer has explicitly reopened their bid or trump menu (to change an
// already-entered value). Cleared when the hand changes.
let auctionEnsuredHand: number | null = null;
let auctionEditingBid = false;
let auctionEditingTrump = false;

// Is the mobile auction the right UI for the current bidder phase? It needs a multiplayer
// game with all four seats authenticated, not in manual-override, and a non-pepper hand
// (pepper auto-bids). Otherwise we fall back to the existing tap bidder/bid controls.
function auctionEligible(gm: GameManager, mp: MultiplayerManager | null, currentHand: string, phase: string): boolean {
    if (!mp || phase !== 'bidder') return false;
    if (mp.isManualOverride()) return false;
    const handIndex = gm.state.hands.length - 1;
    if (isPepperRound(handIndex)) return false;
    const players = mp.getFirebasePlayers();
    if (players.length < 4) return false;
    return [0, 1, 2, 3].every(i => Boolean(players[i]?.userId));
}

function auctionSeatName(gm: GameManager, mp: MultiplayerManager, seat1: number): string {
    const players = mp.getFirebasePlayers();
    return players[seat1 - 1]?.displayName || gm.state.players[seat1 - 1] || `Seat ${seat1}`;
}

// Escape a display name for safe innerHTML interpolation.
function esc(s: string): string {
    return s.replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c
    ));
}

// Render the concurrent auction into #auction-controls (8b redesign). Handles: initializing
// the auction on this device, the dealer-prefix reveal strip (entered-but-unrevealed shows a
// masked "bid logged"), the concurrent bid menu, the decoupled trump menu, the edit windows
// (bid editable until the successor reveals; trump until revealed as winner/outbid), the
// winner-awaiting-trump hand-off, and the spectator view.
// Exported as a test seam so the DOM wiring (previously manual-only) can be driven in jsdom
// against a fake manager backed by the real auction engine (see tests/unit/auction-ui.test.ts).
export function renderAuction(gm: GameManager, mp: MultiplayerManager) {
    const container = document.getElementById('auction-controls');
    if (!container) return;

    const handIndex = gm.state.hands.length - 1;
    const auction = mp.getAuction();

    // Kick off the auction for this hand once if it isn't present/current yet, and clear any
    // stale per-hand UI editing state when the hand changes.
    if ((!auction || auction.handIndex !== handIndex) && auctionEnsuredHand !== handIndex) {
        auctionEnsuredHand = handIndex;
        auctionEditingBid = false;
        auctionEditingTrump = false;
        mp.ensureAuctionForCurrentHand();
    }

    container.classList.remove('hidden');
    updateInstructions('Bidding');

    if (!auction || auction.handIndex !== handIndex) {
        container.innerHTML = '<p class="text-gray-600">Starting the auction…</p>';
        return;
    }
    // Defensive: RTDB drops empty `entries`/`order`, so a freshly-created auction may arrive with
    // them undefined. The manager normalizes on read, but guard here too (this UI is untested):
    // without it, `auction.entries[seat]` would throw and freeze the whole auction.
    if (!auction.entries) auction.entries = {};
    if (!auction.order) auction.order = [];

    const mySeat0 = mp.getMySeat();          // 0-based or null (spectator)
    const mySeat = mySeat0 === null ? null : mySeat0 + 1; // 1-based
    const complete = auctionIsComplete(auction);
    const { highSeat } = resolveAuction(auction);
    const result = auctionResult(auction);   // non-null once complete

    // Reveal strip: show a bid only once revealed (dealer-order prefix). An entered-but-hidden
    // seat (including the viewer's own) shows a masked "bid logged"; not-entered shows "—".
    const strip = auction.order.map(seat => {
        const name = esc(auctionSeatName(gm, mp, seat));
        const entry = auction.entries[seat];
        let detail: string;
        let cls: string;
        if (isRevealed(auction, seat) && entry) {
            // A pass, or a "bogus" bid that couldn't have been legally placed (an earlier seat
            // already bid >=), shows as "passed" so we don't broadcast a value that a live
            // sequential auction would never expose. A legit bid only beaten by a LATER seat
            // still shows its value (struck through).
            if (entry.value === 'PASS' || isDemoted(auction, seat)) {
                detail = 'passed';
                cls = 'text-gray-500';
            } else {
                detail = `bid ${bidToString(entry.value)}`;
                cls = isOutbid(auction, seat) ? 'text-gray-400 line-through' : 'text-blue-700 font-medium';
            }
        } else if (entry) {
            detail = 'bid logged ✓';
            cls = 'text-green-600';
        } else {
            detail = '—';
            cls = 'text-gray-400';
        }
        const isWinner = complete && seat === highSeat;
        return `<div class="flex justify-between px-3 py-1.5 rounded ${isWinner ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50'}">
            <span>${name}${seat === mySeat ? ' <span class="text-xs text-gray-500">(you)</span>' : ''}</span>
            <span class="${cls}">${detail}${isWinner ? ' <span class="text-xs text-blue-600">won</span>' : ''}</span>
        </div>`;
    }).join('');

    const highText = highSeat !== null
        ? `Current high: <strong>${bidToString(auction.entries[highSeat]!.value)}</strong> by ${esc(auctionSeatName(gm, mp, highSeat))}`
        : (revealedCount(auction) > 0 ? 'All passed so far' : 'No bids revealed yet');

    // Reusable menus. These buttons are built dynamically (game.astro's scoped <style> can't
    // reach them), so they carry their own utility classes for a legible, well-spaced look.
    const bidBtn = 'btn-auction-bid px-4 py-4 rounded-lg border border-blue-300 bg-blue-50 text-blue-800 text-xl font-bold shadow-sm hover:bg-blue-100 active:bg-blue-200 transition-colors';
    const passBtn = 'btn-auction-pass px-4 py-4 rounded-lg border border-gray-300 bg-gray-100 text-gray-700 text-lg font-semibold shadow-sm hover:bg-gray-200 active:bg-gray-300 transition-colors';
    const suitBtn = 'btn-auction-suit px-4 py-4 rounded-lg border border-blue-300 bg-blue-50 text-2xl shadow-sm hover:bg-blue-100 active:bg-blue-200 transition-colors';

    const bidMenu = (heading: string, showCancel: boolean) => `
        <p class="text-gray-800 font-medium mb-3">${heading}</p>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            ${(['4', '5', '6', 'M', 'D'] as BidValue[])
                .map(v => `<button class="${bidBtn}" data-bidval="${v}">${bidToString(v)}</button>`).join('')}
            <button class="${passBtn}" data-bidval="PASS">Pass</button>
        </div>
        ${showCancel ? '<div class="mt-3"><button id="auction-edit-cancel" class="text-sm text-gray-500 underline">Keep current bid</button></div>' : ''}`;

    const trumpMenu = (heading: string, showCancel: boolean) => `
        <p class="text-gray-800 mb-3">${heading}</p>
        <div class="grid grid-cols-3 md:grid-cols-5 gap-4">
            <button class="${suitBtn}" data-suit="C">♣️</button>
            <button class="${suitBtn}" data-suit="D">♦️</button>
            <button class="${suitBtn}" data-suit="H">♥️</button>
            <button class="${suitBtn}" data-suit="S">♠️</button>
            <button class="${suitBtn}" data-suit="N"><span class="text-xl font-mathematical">∅</span></button>
        </div>
        ${showCancel ? '<div class="mt-2"><button id="auction-trump-cancel" class="text-sm text-gray-500 underline">Keep current trump</button></div>' : ''}`;

    // Action area, driven by the viewer's own seat state (no turn pointer).
    let action: string;
    if (mySeat === null) {
        // Spectator: read-only.
        action = complete
            ? `<p class="text-gray-600">${result?.thrownIn ? 'Thrown in — everyone passed.' : 'Auction complete.'}</p>`
            : `<p class="text-gray-600">Waiting for players to bid…</p>`;
    } else {
        const myEntry = auction.entries[mySeat];
        const bidLocked = isBidLocked(auction, mySeat);
        const trumpOpen = canSetTrump(auction, mySeat);   // may I pick/change trump now?
        const needsTrump = trumpOpen && myEntry && myEntry.value !== 'PASS' && !myEntry.suit;

        if (!myEntry || (auctionEditingBid && !bidLocked)) {
            // Not entered yet, or explicitly changing my bid (allowed until my successor reveals).
            action = bidMenu(myEntry ? 'Change your bid:' : 'Enter your bid:', Boolean(myEntry));
        } else if (needsTrump || (auctionEditingTrump && trumpOpen)) {
            // Non-pass bid that still needs a trump, or I reopened the trump menu.
            action = trumpMenu(
                myEntry.suit ? 'Change your trump:' : 'Bid logged ✓ — now choose your trump:',
                Boolean(myEntry.suit));
        } else {
            // Settled status line for my seat, plus whatever edits remain open.
            let status: string;
            if (myEntry.value === 'PASS') {
                status = 'You passed.';
            } else if (complete && mySeat === highSeat) {
                status = `You won the bid (${bidToString(myEntry.value)}).`;
            } else if (isOutbid(auction, mySeat)) {
                status = 'You were outbid.';
            } else {
                status = 'Bid logged ✓';
            }
            const editBid = !bidLocked
                ? '<button id="auction-edit-bid" class="text-sm text-blue-600 underline">Edit bid</button>' : '';
            const editTrump = trumpOpen && myEntry.value !== 'PASS' && myEntry.suit
                ? '<button id="auction-edit-trump" class="text-sm text-blue-600 underline">Edit trump</button>' : '';
            const waiting = !complete
                ? '<p class="text-gray-500 text-sm mt-2">Waiting for the other players…</p>'
                : (result && !result.thrownIn && result.winningSuit === null && mySeat !== highSeat
                    ? `<p class="text-gray-500 text-sm mt-2">Waiting for <strong>${esc(auctionSeatName(gm, mp, highSeat!))}</strong> to choose trump…</p>`
                    : '');
            action = `
                <div class="flex items-center gap-3 flex-wrap">
                    <span class="px-3 py-1.5 rounded bg-green-50 border border-green-200 text-green-700">${status}</span>
                    ${editBid}${editTrump}
                </div>
                ${waiting}`;
        }
    }

    // Final-reveal banner: shown once the auction is complete (the hand pauses on this briefly
    // before advancing, so everyone can see who bid what).
    const completeBanner = complete
        ? `<div class="auction-reveal mb-3 p-3 rounded-lg border text-center ${result?.thrownIn
              ? 'bg-gray-50 border-gray-200 text-gray-700'
              : 'bg-blue-50 border-blue-200 text-blue-900'}">
              ${result?.thrownIn
                ? '<strong>Thrown in</strong> — everyone passed.'
                : `<strong>${esc(auctionSeatName(gm, mp, highSeat!))}</strong> won the bid: `
                  + `<strong>${bidToString(auction.entries[highSeat!]!.value)}</strong>`
                  + `${result?.winningSuit ? ` in <strong>${trumpToString(result.winningSuit)}</strong>` : ''}`}
           </div>`
        : '';

    container.innerHTML = `
        <h3 class="text-lg font-medium text-gray-900">Bidding</h3>
        ${completeBanner}
        <p class="text-sm text-gray-600">${highText}</p>
        <div class="space-y-1">${strip}</div>
        <div class="pt-2">${action}</div>`;

    wireAuctionButtons(mp, mySeat);
}

function wireAuctionButtons(mp: MultiplayerManager, mySeat: number | null) {
    if (mySeat === null) return;
    const refresh = () => { if (typeof window.updateUI === 'function') window.updateUI(); };

    // Choosing a bid value enters it immediately (concurrent — no turn check); the trump menu
    // then renders for a non-pass bid. Editing state is cleared once the write goes out.
    document.querySelectorAll('.btn-auction-bid').forEach(btn => {
        btn.addEventListener('click', async () => {
            auctionEditingBid = false;
            auctionEditingTrump = false;
            await mp.enterBid(mySeat, (btn as HTMLElement).dataset.bidval as ActionValue);
            refresh();
        });
    });

    // Pass enters immediately with no trump.
    document.querySelectorAll('.btn-auction-pass').forEach(btn => {
        btn.addEventListener('click', async () => {
            auctionEditingBid = false;
            auctionEditingTrump = false;
            await mp.enterBid(mySeat, 'PASS');
            refresh();
        });
    });

    // Trump menu: picking a suit sets/changes the trump for my existing bid.
    document.querySelectorAll('.btn-auction-suit').forEach(btn => {
        btn.addEventListener('click', async () => {
            auctionEditingTrump = false;
            await mp.setTrump(mySeat, (btn as HTMLElement).dataset.suit as string);
            refresh();
        });
    });

    // Reopen the bid / trump menus (never pre-filled with the current value).
    document.getElementById('auction-edit-bid')?.addEventListener('click', () => { auctionEditingBid = true; refresh(); });
    document.getElementById('auction-edit-trump')?.addEventListener('click', () => { auctionEditingTrump = true; refresh(); });
    document.getElementById('auction-edit-cancel')?.addEventListener('click', () => { auctionEditingBid = false; refresh(); });
    document.getElementById('auction-trump-cancel')?.addEventListener('click', () => { auctionEditingTrump = false; refresh(); });
}

function showPhaseControls(gameManager: GameManager) {
    const currentHand = gameManager.getCurrentHand();
    const phase = getCurrentPhase(currentHand);

    // Phase 8b: the auction owns the bidder phase when eligible (participants act,
    // spectators watch). It produces bidWinner + bid and writes them into the hand.
    const mp = asMultiplayer(gameManager);
    if (auctionEligible(gameManager, mp, currentHand, phase)) {
        renderAuction(gameManager, mp!);
        return;
    }

    // Multiplayer turn-gating: if it isn't this viewer's turn, show a waiting panel
    // instead of the phase controls (and don't run this case's auto-advance side effects,
    // e.g. pepper/clubs, so only a responsible device drives them).
    const block = evaluateGating(gameManager, currentHand, phase);
    if (block) {
        showWaitingPanel(block);
        return;
    }

    switch (phase) {
        case 'bidder': {
            const dealerIndex = parseInt(currentHand[0] || '1') - 1;
            const dealer = gameManager.state.players[dealerIndex];

            // Check if we're in pepper round...
            const handIndex = gameManager.state.hands.length - 1;
            if (isPepperRound(handIndex)) {
                const nextPlayer = ((dealerIndex + 1) % 4 + 1).toString();
                gameManager.addHandPart(nextPlayer);
                gameManager.addHandPart('P');
                hideAllControls();
                showPhaseControls(gameManager);
                break;
            }
                    
            // Rearrange player buttons in bidding order
            const container = document.getElementById('player-grid');
            if (container) {
                const buttons = Array.from(container.children);
                const biddingOrder = Array.from({length: 4}, (_, i) => 
                    (dealerIndex + 1 + i) % 4
                );
                        
                // Sort buttons according to bidding order
                buttons.sort((a, b) => {
                    const aElement = a as HTMLElement;
                    const bElement = b as HTMLElement;
                    const aIndex = parseInt(aElement.dataset.player || '1') - 1;
                    const bIndex = parseInt(bElement.dataset.player || '1') - 1;
                    return biddingOrder.indexOf(aIndex) - biddingOrder.indexOf(bIndex);
                });
                        
                // Reattach buttons in new order
                buttons.forEach(button => container.appendChild(button));
            }
                                
            const controls = document.getElementById('player-controls');
            if (controls) controls.classList.remove('hidden');
            updateInstructions(`${dealer} deals. Who won the bid?`);
            break;
        }
        case 'bid': {
            const controls = document.getElementById('bid-controls');
            if (controls) controls.classList.remove('hidden');
            const bidder = gameManager.state.players[parseInt(currentHand[1] || '1') - 1];
            updateInstructions(`What did ${bidder} bid?`);
            break;
        }
        case 'trump': {
            const controls = document.getElementById('trump-controls');
            if (controls) controls.classList.remove('hidden');
            const bidder = gameManager.state.players[parseInt(currentHand[1] || '1') - 1];
            updateInstructions(`${bidder} bid ${bidToString(currentHand[2] || '')}. What's trump?`);
            break;
        }
        case 'decision': {
            // If the bid is clubs, the defenders must play
            if (currentHand[3] === 'C') {
                gameManager.addHandPart('P');
                hideAllControls();
                showPhaseControls(gameManager);
                break;
            }
            const controls = document.getElementById('decision-controls');
            if (controls) controls.classList.remove('hidden');
            // only show the buttons that are valid for the current bid
            // first remove disabled from all buttons
            document.querySelectorAll('.btn-decision').forEach(button => {
                button.classList.remove('hidden');
            });
            const bid = currentHand[2];
            if (bid != '4' && bid != 'P') {
                document.getElementById('btn-pass-2')?.classList.add('hidden');
                if (bid != '5') {
                    document.getElementById('btn-pass-1')?.classList.add('hidden');
                }
            }
            const bidder = gameManager.state.players[parseInt(currentHand[1] || '1') - 1];
            updateInstructions(`${bidder} bid ${bidToString(currentHand[2] || '')} in ${trumpToString(currentHand[3] || '')}. Play or fold?`);
            break;
        }
        case 'tricks': {
            const controls = document.getElementById('tricks-controls');
            if (controls) controls.classList.remove('hidden');
            const bidder = gameManager.state.players[parseInt(currentHand[1] || '1') - 1];
            // If the bid is clubs, the defenders must play
            if (currentHand[3] === 'C') {
                const defendingTeam = gameManager.getDefendingTeamName() || 'Defender';
                updateInstructions(`${bidder} bid ${bidToString(currentHand[2] || '')} in ${trumpToString(currentHand[3] || '')}, so ${defendingTeam} must play. How many tricks did ${defendingTeam} win?`);
            } else {
                const defendingTeam = gameManager.getDefendingTeamName() || 'Defender';
                updateInstructions(`${bidder} bid ${bidToString(currentHand[2] || '')} in ${trumpToString(currentHand[3] || '')}. How many tricks did ${defendingTeam} win?`);
            }
            break;
        }
    }
}

function setupPlayerButtons(gameManager: GameManager, updateUI: () => void) {
    const container = document.getElementById('player-grid');  // Changed to player-grid
    if (!container) return;

    container.innerHTML = '';

    // Get current dealer from the current hand
    const currentHand = gameManager.getCurrentHand();
    const dealerIndex = parseInt(currentHand[0] || '1') - 1;
    
    // Create array of indices in bidding order
    const biddingOrder = Array.from({length: 4}, (_, i) => 
        (dealerIndex + 1 + i) % 4
    );
    
    // Create buttons in bidding order
    biddingOrder.forEach((index) => {
        const player = gameManager.state.players[index];
        const button = document.createElement('button');
        button.className = 'px-4 py-2 bg-blue-100 hover:bg-blue-200 text-blue-800 font-medium rounded-lg transition-colors';
        button.dataset.player = (index + 1).toString();
        button.textContent = player || '';
        button.addEventListener('click', () => {
            gameManager.addHandPart((index + 1).toString());
            updateUI();
        });
        container.appendChild(button);
    });

    // Add "No one" button to parent container
    const noOneButton = document.createElement('button');
    noOneButton.className = 'w-full px-4 py-2 bg-red-100 hover:bg-red-200 text-red-800 font-medium rounded-lg transition-colors';
    noOneButton.dataset.player = '0';
    noOneButton.textContent = 'No one bid - throw in hand';
    noOneButton.addEventListener('click', () => {
        gameManager.addHandPart('0');
        updateUI();
    });

    document.getElementById('player-buttons')?.appendChild(noOneButton);
}

function setupTrumpButtons(gameManager: GameManager, updateUI: () => void) {
    document.querySelectorAll('.btn-trump').forEach(button => {
        button.addEventListener('click', (e) => {
            const button = e.currentTarget as HTMLButtonElement; // Use currentTarget instead of target
            const suit = button.dataset.suit;
            if (suit) {
                gameManager.addHandPart(suit);
                updateUI();
            }
        });
    });
}

function setupBidButtons(gameManager: GameManager, updateUI: () => void) {
    document.querySelectorAll('.btn-bid').forEach(button => {
        button.addEventListener('click', (e) => {
            const target = e.target as HTMLButtonElement;
            const bid = target.dataset.bid;
            if (bid) {
                gameManager.addHandPart(bid);
                updateUI();
            }
        });
    });
}

function setupDecisionButtons(gameManager: GameManager, updateUI: () => void) {
    document.querySelectorAll('.btn-decision').forEach(button => {
        button.addEventListener('click', (e) => {
            const target = e.target as HTMLButtonElement;
            const decision = target.dataset.decision;
            if (decision) {
                const [action, tricks] = decision.split('');
                // Add the decision (P or F)
                if (action) gameManager.addHandPart(action);
                // If there are free tricks (F1 or F2), add those
                if (tricks) {
                    gameManager.addHandPart(tricks);
                } else if (action === 'F') {
                    gameManager.addHandPart('0'); // Fold with no tricks
                }
                updateUI();
            }
        });
    });
}

function setupTricksButtons(gameManager: GameManager, updateUI: () => void) {
    document.querySelectorAll('.btn-tricks').forEach(button => {
        button.addEventListener('click', (e) => {
            const target = e.target as HTMLButtonElement;
            const tricks = target.dataset.tricks;
            if (tricks) {
                gameManager.addHandPart(tricks);
                updateUI();
            }
        });
    });
}

function setupUndoButton(gameManager: GameManager, updateUI: () => void) {
    const undoButton = document.getElementById('undo-button');
    if (!undoButton) return;
  
    undoButton.addEventListener('click', () => {
      // If we're in the end-game state
      if (gameManager.isGameComplete()) {
        // Check if statistics are visible
        const statsVisible = document.getElementById('game-statistics-container')?.classList.contains('hidden') === false;
        
        // If statistics are showing, just show victory modal instead of undoing
        if (statsVisible) {
          // Hide statistics
          document.getElementById('game-statistics-container')?.classList.add('hidden');
          
          // Hide post-victory controls if present
          const postControls = document.getElementById('post-victory-controls');
          if (postControls) postControls.remove();
          
          // Show victory celebration (which has its own undo button)
          showVictoryCelebration(gameManager);
          return;
        }
        
        // If victory modal is visible, remove it
        const victoryModal = document.getElementById('dynamic-victory-overlay') || 
                          document.getElementById('victory-overlay');
        if (victoryModal) {
          victoryModal.remove();
        }
      }

      // Now perform the actual undo
      gameManager.undo();
      updateUI();
    });
}

// Rebuild the score-log table from the current game state.
// Extracted to module scope so both the main updateUI loop and the
// "Edit Last Tricks" handler can refresh the log after state changes.
function rebuildScoreLog(gameManager: GameManager, reverseHistory: boolean) {
    const scoreLog = document.getElementById('score-log');
    if (scoreLog) {
        scoreLog.innerHTML = '';  // Clear existing log

        // Get hands array to display
        let handsToDisplay = [...gameManager.state.hands];

        // Reverse the array if needed (but create a copy first to avoid affecting the actual game state)
        if (reverseHistory) {
            handsToDisplay = handsToDisplay.slice().reverse();
        }

        const runningScores: [number, number] = [0, 0];

        // If we're showing newest first, we need to pre-calculate the running scores
        if (reverseHistory) {
            gameManager.state.hands.forEach((hand) => {
                if (isHandComplete(hand)) {
                    const [score1, score2] = calculateScore(hand);
                    runningScores[0] += score1;
                    runningScores[1] += score2;
                }
            });
        }

        handsToDisplay.forEach((hand, displayIndex) => {
            const row = document.createElement('tr');

            // Get the actual index in the original array
            const actualIndex = reverseHistory
                ? gameManager.state.hands.length - 1 - displayIndex
                : displayIndex;

            // Always show hand number and dealer
            const dealer = parseInt(hand[0] || '1');
            const dealerName = gameManager.state.players[dealer - 1];

            // Initialize cells with known data
            let bidDisplay = '';
            let team1Score = '';
            let team2Score = '';

            // If we have enough info for the bid
            if (hand.length >= 4) {
                const bidWinner = parseInt(hand[1] || '0');
                if (bidWinner === 0) {
                    bidDisplay = 'Pass';
                } else {
                    const bidderName = gameManager.state.players[bidWinner - 1];
                    bidDisplay = `${bidderName}: ${bidToString(hand[2] || '')} in ${trumpToString(hand[3] || '')}`;
                }
            }

            // Get hand classification for styling
            const classification = gameManager.getHandClassification(actualIndex);

            // Apply background color based on classification
            switch (classification.type) {
                case 'pass':
                    row.classList.add('bg-green-50');
                    break;
                case 'forced-set':
                    row.classList.add('bg-yellow-50');
                    break;
                case 'unforced-set':
                    row.classList.add('bg-red-50');
                    break;
            }

            // Calculate scores based on display order
            if (isHandComplete(hand)) {
                const [score1, score2] = calculateScore(hand);

                if (reverseHistory) {
                    // For reverse order, display the current running total first
                    team1Score = `${runningScores[0]}`;
                    team2Score = `${runningScores[1]}`;

                    // Then decrement for the next iteration
                    runningScores[0] -= score1;
                    runningScores[1] -= score2;
                } else {
                    // For chronological order, increment as usual
                    runningScores[0] += score1;
                    runningScores[1] += score2;

                    team1Score = `${runningScores[0]}`;
                    team2Score = `${runningScores[1]}`;
                }
            }

            // Show actual hand number regardless of display order
            const handNumber = actualIndex + 1;

            // Add cells with score coloring based on classification
            row.innerHTML = `
                <td class="py-2 text-center">${handNumber}</td>
                <td class="py-2 px-4 text-left">${dealerName}</td>
                <td class="py-2 px-4 text-left">${bidDisplay}</td>
                <td class="py-2 text-center ${classification.setTeam === 0 ? 'text-red-600 font-medium' : ''}">${team1Score}</td>
                <td class="py-2 text-center ${classification.setTeam === 1 ? 'text-red-600 font-medium' : ''}">${team2Score}</td>
            `;
            scoreLog.appendChild(row);
        });
    }
}

export function startGameplay(gameData: Record<string, unknown>) {
    // Use FirebaseGameManager if this is a Firebase game, otherwise use regular GameManager
    let gameManager: GameManager;

    if (gameData.firebaseGameId && window.firebaseGame) {
        // Use the existing Firebase game instance
        gameManager = window.firebaseGame;
    } else {
        // Use regular GameManager for local games
        gameManager = GameManager.fromJSON(JSON.stringify(gameData));
    }

    // Make gameManager available globally for Firebase sync
    window.gameManager = gameManager;


    // Initialize reverse history preference from localStorage
    let reverseHistory = localStorage.getItem('reverseHistory') === 'true';

    function updateUI() {
        // Using currentHand would be for future feature needs
        // const currentHand = gameManager.getCurrentHand();
        // const phase = getCurrentPhase(currentHand);
        const scores = gameManager.getScores();

        // Update scores
        updateScores(scores);
        
        // Update hand and bid info
        updateHandInfo(gameManager);
        
        hideAllControls();

        // Update undo button state
        const undoButton = document.getElementById('undo-button');
        if (undoButton) {
          const currentHand = gameManager.getCurrentHand();
          const canUndo = currentHand.length > 1 || gameManager.state.hands.length > 1;
          (undoButton as HTMLButtonElement).disabled = !canUndo;
        }
    
        // Update the score log
        const team1Header = document.getElementById('log-team1');
        const team2Header = document.getElementById('log-team2');
        if (team1Header) team1Header.textContent = gameManager.state.teams[0] || 'Team 1';
        if (team2Header) team2Header.textContent = gameManager.state.teams[1] || 'Team 2';
        
        // Update history toggle button text
        const reverseButtonText = document.getElementById('reverse-button-text');
        if (reverseButtonText) {
            reverseButtonText.textContent = reverseHistory ? "Newest First" : "Oldest First";
        }
        
        // Update history toggle button icon
        const historyIcon = document.getElementById('history-icon');
        if (historyIcon) {
            // Rotate icon 180 degrees when in reverse chronological order
            if (reverseHistory) {
                historyIcon.style.transform = 'rotate(180deg)';
            } else {
                historyIcon.style.transform = 'rotate(0deg)';
            }
        }
        
        rebuildScoreLog(gameManager, reverseHistory);

        renderOverrideBar(gameManager);
        showPhaseControls(gameManager);
        
        // Save current state
        localStorage.setItem('currentGame', gameManager.toJSON());

        // Check for game completion
        if (gameManager.isGameComplete()) {
            // If not already marked as complete, do that first
            if (!gameManager.state.isComplete) {
                gameManager.completeGame();
                // Save again after marking as complete
                localStorage.setItem('currentGame', gameManager.toJSON());
            }
            
            const winnerIndex = gameManager.getWinner() || 0;
            const winningTeam = gameManager.state.teams[winnerIndex] || 'Winner';
            // Following values kept for future UI enhancements
            // const losingTeam = gameManager.state.teams[1 - winnerIndex] || 'Loser';
            // Scores used in future UI enhancements
            // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
            const [score1, score2] = scores;
            // const winningScore = winnerIndex === 0 ? score1 : score2;
            // const losingScore = winnerIndex === 0 ? score2 : score1;
            
            // const seriesComplete = gameManager.state.isSeries && gameManager.isSeriesComplete();
            // Unused
          // const nextDealer = seriesComplete ? null : gameManager.getNextDealer();
          
            // Update instruction area with victory message
            const instructionEl = document.getElementById('game-instruction');
            if (instructionEl) {
              instructionEl.textContent = `${winningTeam} wins${gameManager.state.isSeries ? ` Game ${gameManager.state.gameNumber}` : ''}!`;
            }
            
            // Check if victory modal is already present
            const existingModal = document.getElementById('dynamic-victory-overlay') || 
                                document.getElementById('victory-overlay');
            
            // Only show victory celebration if not already displayed
            if (!existingModal) {
                // Show victory celebration instead of normal end game controls
                showVictoryCelebration(gameManager);
            }
            
            return; // Don't continue with normal UI updates
          }
    }

    function setupEventListeners() {
        setupPlayerButtons(gameManager, updateUI);
        setupTrumpButtons(gameManager, updateUI);
        setupBidButtons(gameManager, updateUI);
        setupDecisionButtons(gameManager, updateUI);
        setupTricksButtons(gameManager, updateUI);
        setupUndoButton(gameManager, updateUI);
        setupMultiplayerControls(gameManager, updateUI);
        
        // Setup history toggle button
        const reverseButton = document.getElementById('reverse-history-button');
        if (reverseButton) {
            // Set initial button text based on current state via updateUI
            
            reverseButton.addEventListener('click', () => {
                reverseHistory = !reverseHistory;
                localStorage.setItem('reverseHistory', reverseHistory.toString());
                updateUI();
            });
        }
    }

    // Start game
    if (gameManager.getCurrentHand() === '') {
        // First hand: dealer is 1, bidder is 2, bid is P for pepper
        gameManager.addHandPart('1');
        gameManager.addHandPart('2');
        gameManager.addHandPart('P');
        updateUI();
    }
    
    setupEventListeners();
    updateUI();

    // Make updateUI available globally for Firebase real-time sync
    window.updateUI = updateUI;

    // Debug functions for browser console
    if (typeof window !== 'undefined') {
      window.exportGame = () => {
        const gameData = {
          players: gameManager.state.players,
          teams: gameManager.state.teams,
          hands: gameManager.state.hands
        };
        console.log('=== GAME EXPORT ===');
        console.log(JSON.stringify(gameData, null, 2));
        console.log('=== END EXPORT ===');
        console.log('To import: importGame(' + JSON.stringify(gameData) + ')');
        return gameData;
      };
      
      window.importGame = (gameData: Record<string, unknown>) => {
        console.log('Importing game data:', gameData);
        localStorage.setItem('debugGame', JSON.stringify(gameData));
        console.log('Debug game loaded. Reloading page...');
        window.location.reload();
      };
      
      window.clearDebugGame = () => {
        localStorage.removeItem('debugGame');
        console.log('Debug game cleared');
      };
      
      console.log('🔧 Debug functions available: exportGame(), importGame(data), clearDebugGame(), showDevPanel()');
    }
    
    return gameManager;
}

function updateScores(scores: [number, number]) {
    // Update both desktop and mobile score elements
    const team1Score = document.getElementById('team1-score');
    const team2Score = document.getElementById('team2-score');
    const team1ScoreMobile = document.getElementById('team1-score-mobile');
    const team2ScoreMobile = document.getElementById('team2-score-mobile');
    
    // Update scores
    const score1Text = scores[0].toString();
    const score2Text = scores[1].toString();
    
    // Set score values
    if (team1Score) team1Score.textContent = score1Text;
    if (team2Score) team2Score.textContent = score2Text;
    if (team1ScoreMobile) team1ScoreMobile.textContent = score1Text;
    if (team2ScoreMobile) team2ScoreMobile.textContent = score2Text;
    
    // Update colors based on score values
    updateScoreColor(team1Score, scores[0]);
    updateScoreColor(team2Score, scores[1]);
    updateScoreColor(team1ScoreMobile, scores[0]);
    updateScoreColor(team2ScoreMobile, scores[1]);
}

function updateScoreColor(element: HTMLElement | null, score: number) {
    if (!element) return;
    
    // Remove all existing color classes
    element.classList.remove(
        'text-red-600', 'text-blue-600', 
        'text-gray-800', 'text-orange-500'
    );
    
    // Add appropriate color class based on score
    if (score < 0) {
        element.classList.add('text-red-600'); // Negative scores - danger
    } else if (score >= 40) {
        element.classList.add('text-orange-500'); // Very close to winning
    } else if (score >= 28) {
        element.classList.add('text-blue-600'); // Approaching win condition
    } else {
        element.classList.add('text-gray-800'); // Normal scores
    }
}

function createConfettiEffect() {
    // Create a canvas for the confetti
    const canvas = document.createElement('canvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '1000';
    canvas.id = 'confetti-canvas';
    document.body.appendChild(canvas);
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const particles: Array<{
      x: number;
      y: number;
      size: number;
      color: string;
      speedX: number;
      speedY: number;
      rotation: number;
      rotationSpeed: number;
    }> = [];
    
    const colors = [
      '#f44336', '#e91e63', '#9c27b0', '#673ab7', 
      '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4',
      '#009688', '#4caf50', '#8bc34a', '#cddc39', 
      '#ffeb3b', '#ffc107', '#ff9800', '#ff5722'
    ];
    
    // Constants for timing
    const ANIMATION_DURATION = 15000; // 15 seconds total
    const FADE_START = 14000;         // Start fading at 14 seconds
    const FADE_DURATION = 1000;       // 1 second fade duration
    
    // Create particles
    for (let i = 0; i < 180; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height - canvas.height,
        size: Math.random() * 10 + 5,
        color: colors[Math.floor(Math.random() * colors.length)] || '#ff0000',
        speedX: Math.random() * 6 - 3,
        speedY: Math.random() * 3 + 2,
        rotation: Math.random() * 360,
        rotationSpeed: Math.random() * 10 - 5
      });
    }
    
    const startTime = Date.now();
    let canvasOpacity = 1;
    
    // Animation loop
    function animate() {
      const now = Date.now();
      const elapsed = now - startTime;
      
      // Check if animation is complete
      if (elapsed > ANIMATION_DURATION) {
        canvas.remove();
        return;
      }
      
      // Calculate canvas opacity for fade-out
      if (elapsed > FADE_START) {
        canvasOpacity = 1 - (elapsed - FADE_START) / FADE_DURATION;
        if (canvasOpacity < 0) canvasOpacity = 0;
      }
      
      // Clear canvas
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Set global canvas opacity
        ctx.globalAlpha = canvasOpacity;
      }
      
      // Draw and update particles
      particles.forEach(particle => {
        // Draw particle
        if (ctx) {
          ctx.save();
          ctx.translate(particle.x, particle.y);
          ctx.rotate((particle.rotation * Math.PI) / 180);
          ctx.fillStyle = particle.color;
          ctx.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size);
          ctx.restore();
        }
        
        // Update position
        particle.x += particle.speedX;
        particle.y += particle.speedY;
        particle.rotation += particle.rotationSpeed;
        
        // Reset particle if it's off screen
        if (particle.y > canvas.height) {
          // Gradually reduce recycling probability over time
          // This creates a natural thinning effect
          const timeRatio = Math.min(1, elapsed / FADE_START);
          const recycleChance = 0.9 - (0.7 * timeRatio);
          
          if (Math.random() < recycleChance) {
            particle.y = -particle.size;
            particle.x = Math.random() * canvas.width;
          }
        }
      });
      
      // Continue animation
      requestAnimationFrame(animate);
    }
    
    // Start animation
    animate();
  }
  
  // Create animated trophy element
  // Function kept for future implementation
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
  function createAnimatedTrophy() {
    const trophy = document.createElement('div');
    trophy.innerHTML = '🏆';
    trophy.className = 'text-6xl trophy-bounce fixed z-[1001]';
    trophy.style.top = '20%';
    trophy.style.left = '50%';
    trophy.style.transform = 'translate(-50%, -50%)';
    trophy.style.transition = 'opacity 1.5s ease, transform 0.3s ease';
    document.body.appendChild(trophy);
    
    // Start fade out after 3.5 seconds
    setTimeout(() => {
      trophy.style.opacity = '0';
    }, 3500);
    
    // Remove the trophy after fade completes
    setTimeout(() => {
      trophy.remove();
    }, 5000);
  }
  
  // Function to create and display the victory celebration
  // This creates dynamic HTML content at runtime since Astro components can't be used here
  function showVictoryCelebration(gameManager: GameManager) {
    // Hide all current controls
    hideAllControls();
    
    // First, we need to generate the award data using our tracking utilities
    const winnerIndex = gameManager.getWinner()!;
    // These score variables are used in other parts of the codebase
    // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
    const [score1, score2] = gameManager.getScores();
    
    // Add controls to the main decision pane
    const endGameControls = document.getElementById('end-game-controls');
    if (endGameControls) {
      endGameControls.innerHTML = `
        <h3 class="text-lg font-medium text-gray-900 mb-4">Game Results</h3>
        <div class="mb-4 p-4 bg-blue-50 rounded-lg text-center">
          <div class="text-2xl font-semibold mb-2">
            <span class="text-blue-600">${gameManager.state.teams[winnerIndex]}</span> Wins!
          </div>
          ${gameManager.state.isSeries && gameManager.state.seriesScores ? 
            `<div class="text-lg text-gray-700">Series Score: ${gameManager.state.seriesScores[0]}-${gameManager.state.seriesScores[1]}</div>` : 
            ''}
        </div>
        <div class="flex flex-wrap gap-4">
          ${!gameManager.state.isSeries ? `
            <button 
              id="post-victory-series-btn"
              class="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              Make it a Series
            </button>
          ` : !gameManager.isSeriesComplete() ? `
            <button 
              id="post-victory-new-series-btn"
              class="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
            >
              Next Game
            </button>
          ` : `
            <button 
              id="post-victory-start-new-series-btn"
              class="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              Start New Series
            </button>
          `}
          
          <button 
            id="post-victory-new-game-btn" 
            class="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            New Game
          </button>
        </div>
      `;
      
      // Add event listeners to the post-victory buttons
      document.getElementById('post-victory-series-btn')?.addEventListener('click', async () => {
        try {
          // Properly await series conversion for Firebase games
          await Promise.resolve(gameManager.convertToSeries());
          gameManager.startNextGame();
          localStorage.setItem('currentGame', gameManager.toJSON());
          window.location.reload();
        } catch (error) {
          console.error('Error creating series:', error);
          // Fallback: just reload to show any partial progress
          window.location.reload();
        }
      });
      
      document.getElementById('post-victory-new-series-btn')?.addEventListener('click', () => {
        // In series mode, this is "Next Game"
        gameManager.startNextGame();
        localStorage.setItem('currentGame', gameManager.toJSON());
        window.location.reload();
      });
      
      document.getElementById('post-victory-start-new-series-btn')?.addEventListener('click', () => {
        // At the end of a series, create a new series with the same players and teams
        const players = [...gameManager.state.players];
        const teams = [...gameManager.state.teams];
        
        // Rotate dealer to the next player
        const lastDealerIndex = parseInt(gameManager.getCurrentHand()[0] || '1') - 1;
        const nextDealerIndex = (lastDealerIndex + 1) % 4;
        
        // Create a new game manager with the same players but new state
        const newGameManager = new GameManager(players, teams);
        // Start with the next dealer
        newGameManager.addHandPart((nextDealerIndex + 1).toString());
        
        // Convert to series immediately
        newGameManager.state.isSeries = true;
        newGameManager.state.seriesScores = [0, 0];
        newGameManager.state.gameNumber = 1;
        
        localStorage.setItem('currentGame', newGameManager.toJSON());
        window.location.reload();
      });
      
      document.getElementById('post-victory-new-game-btn')?.addEventListener('click', () => {
        localStorage.removeItem('currentGame');
        window.location.href = getPath('');
      });
    }
    
    // Now we'll use our award system to find and render awards
    Promise.all([
      import('../lib/statistics-util.ts'),
      import('../lib/pepper-awards.ts'),
      import('../lib/awardRng.ts')
    ]).then(async ([statsModule, awardsModule, rngModule]) => {
      try {
        
        // Generate award data - explicitly access properties to avoid namespace issues
        const { trackAwardData } = statsModule;
        // Make sure we have a valid winnerIndex before proceeding
        if (winnerIndex === null || winnerIndex === undefined) {
          console.error('No winner index available, cannot generate awards');
          throw new Error('No winner index available');
        }
        
        const awardData = trackAwardData(
          gameManager.state.hands,
          gameManager.state.players,
          gameManager.state.teams,
          gameManager.getScores(),
          winnerIndex
        );
        
        
        // Select awards for the game. Seed selection from the game's hands so every device (and
        // every refresh) shows the same awards for the same game — see awardRng.ts.
        const { selectGameAwards } = awardsModule;
        const { rngFromHands } = rngModule;
        const gameAwards = selectGameAwards(awardData, rngFromHands(awardData.hands));
        
        // Select series awards if series is complete
        let seriesAwards: Array<{id: string; name: string; description: string; technicalDefinition: string; type: string; scope: string; icon: string; winner: string; statDetails?: string}> = [];
        if (gameManager.state.isSeries && gameManager.state.seriesWinner !== undefined) {
          const { selectSeriesAwards } = awardsModule;
          const { aggregateSeriesAwardData } = statsModule;
          
          // Use aggregated series data instead of current game data for series awards
          const seriesAwardData = aggregateSeriesAwardData(
            gameManager.state.completedGames || [],
            gameManager.state.hands,
            gameManager.state.players,
            gameManager.state.teams,
            gameManager.state.seriesWinner,
            gameManager.state.seriesScores
          );
          
          // Seed from the aggregated series hands (identical across devices) for the same reason.
          seriesAwards = selectSeriesAwards(seriesAwardData, rngFromHands(seriesAwardData.hands));
        }
        
        // Create victory celebration with awards
        createVictoryCelebration(gameManager, winnerIndex, gameAwards, seriesAwards);
        
        // Trigger confetti effect
        createConfettiEffect();
      } catch (err) {
        console.error('Error generating awards:', err);
        // If there's an error with award generation, just create a basic victory celebration
        createVictoryCelebration(gameManager, winnerIndex);
      }
    }).catch(err => {
      console.error('Error loading modules:', err);
      // If there's an error loading modules, just create a basic victory celebration
      createVictoryCelebration(gameManager, winnerIndex);
    });
  }
  
  // Function to create and display the victory celebration with dynamic HTML
  // This is needed because Astro components can only be rendered at build time
  function createVictoryCelebration(
    gameManager: GameManager, 
    winnerIndex: number, 
    gameAwards: Array<{id: string; name: string; description: string; technicalDefinition: string; type: string; scope: string; icon: string; winner: string; statDetails?: string}> = [],
    seriesAwards: Array<{id: string; name: string; description: string; technicalDefinition: string; type: string; scope: string; icon: string; winner: string; statDetails?: string}> = []
  ) {
    // Ensure we have a valid winner index
    const winningTeam = winnerIndex !== null ? (gameManager.state.teams[winnerIndex] || 'Winner') : 'Winner';
    const [score1, score2] = typeof gameManager.getScores === 'function' ? 
    gameManager.getScores() : 
    gameManager.state.scores || [0, 0];
    
    // Create victory overlay element
    const victoryElement = document.createElement('div');
    victoryElement.id = 'dynamic-victory-overlay';
    victoryElement.className = 'fixed inset-0 bg-gray-900 bg-opacity-80 z-50 flex items-start justify-center overflow-y-auto transition-opacity duration-500';
    
    // Prepare the series data if applicable
    const seriesScoresHtml = gameManager.state.isSeries && gameManager.state.seriesScores 
      ? `<p class="text-xl text-blue-300 mb-6">Series Score: ${gameManager.state.seriesScores[0]}-${gameManager.state.seriesScores[1]}</p>` 
      : '';
    
    // Generate game awards HTML if we have any
    let gameAwardsHTML = '';
    if (gameAwards && gameAwards.length > 0) {
      gameAwardsHTML = `
        <div class="mb-8">
          <h3 class="text-2xl font-semibold text-white mb-4">Game Awards</h3>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            ${gameAwards.map(award => generateAwardCardHTML(award)).join('')}
          </div>
        </div>
      `;
    }
    
    // Generate series awards HTML if we have any
    let seriesAwardsHTML = '';
    if (seriesAwards && seriesAwards.length > 0) {
      seriesAwardsHTML = `
        <div class="mb-8">
          <h3 class="text-2xl font-semibold text-white mb-4">Series Awards</h3>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            ${seriesAwards.map(award => generateAwardCardHTML(award)).join('')}
          </div>
        </div>
      `;
    }
    
    // Generate HTML content
    victoryElement.innerHTML = `
      <div class="max-w-2xl w-full mx-4 text-center py-12">
        <div class="py-8">
          <span class="text-6xl animate-bounce inline-block">🏆</span>
        </div>
        
        <h2 class="text-4xl font-bold text-white mb-3">
          <span class="text-yellow-300">${winningTeam}</span> Wins!
        </h2>
        
        ${seriesScoresHtml}
        
        <div class="bg-white bg-opacity-10 rounded-lg p-6 backdrop-blur-sm mb-8">
          <div class="grid grid-cols-2 gap-8">
            <div class="space-y-2 ${winnerIndex === 0 ? 'text-yellow-300' : 'text-white'}">
              <h3 class="text-xl font-semibold">${gameManager.state.teams[0]}</h3>
              <p class="text-5xl font-bold ${winnerIndex === 0 ? 'animate-pulse' : ''}">
                ${score1}
              </p>
            </div>
            <div class="space-y-2 ${winnerIndex === 1 ? 'text-yellow-300' : 'text-white'}">
              <h3 class="text-xl font-semibold">${gameManager.state.teams[1]}</h3>
              <p class="text-5xl font-bold ${winnerIndex === 1 ? 'animate-pulse' : ''}">
                ${score2}
              </p>
            </div>
          </div>
        </div>
        
        ${gameAwardsHTML}
        
        ${seriesAwardsHTML}
        
        <div class="flex flex-col sm:flex-row justify-center gap-4 mb-8">
          <button 
            id="edit-last-tricks-btn"
            class="px-6 py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
          >
            Edit Last Tricks
          </button>

          <button 
            id="victory-history-btn"
            class="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            History & Statistics
          </button>
          
          ${!gameManager.state.isSeries ? `
            <button 
              id="victory-series-btn"
              class="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              Make it a Series!
            </button>
          ` : !gameManager.isSeriesComplete() ? `
            <button 
              id="victory-new-series-btn"
              class="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
            >
              Next Game
            </button>
          ` : `
            <button 
              id="victory-start-new-series-btn"
              class="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              Start New Series
            </button>
          `}
          
          <button 
            id="victory-new-game-btn" 
            class="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            New Game
          </button>
        </div>
        
        <!-- Support Development -->
        <div class="mt-8 pt-8 border-t border-gray-300 text-center">
          <h4 class="text-lg font-semibold text-gray-200 mb-4">Enjoyed the scoring experience?</h4>
          <div id="bmc-container" class="flex justify-center">
            <a href="https://buymeacoffee.com/billwolf" target="_blank" rel="noopener noreferrer" 
            class="inline-flex items-center gap-2 px-8 py-4 bg-yellow-400 text-black font-bold rounded-lg hover:bg-yellow-300 transform hover:scale-105 transition-all shadow-lg">
              <span class="text-2xl">🍕</span> 
              <span>Buy me a piece of pizza</span>
            </a>
          </div>
        </div>
    `;
    
    document.body.appendChild(victoryElement);

    // Set up series listener for dynamic button updates (Firebase only)
    if ('setupVictoryOverlaySeriesListener' in gameManager && typeof gameManager.setupVictoryOverlaySeriesListener === 'function') {
      // Type guard: we know this has the method since we checked above
      (gameManager as GameManager & { setupVictoryOverlaySeriesListener: () => void }).setupVictoryOverlaySeriesListener();
    }

    // Add event listeners to buttons
    document.getElementById('edit-last-tricks-btn')?.addEventListener('click', () => {
      // Remove the victory modal
      victoryElement.remove();
      
      // Get the current hand before undoing
      const currentHand = gameManager.getCurrentHand();
      const phase = getCurrentPhase(currentHand);
      
      // For most victory cases, we want to go back to the tricks entry phase
      // This happens when a hand was just completed with tricks
      if (phase === 'tricks' || (currentHand.length === 6 && currentHand[5] !== undefined)) {
        // The last action was entering tricks - undo just that part
        gameManager.state.hands[gameManager.state.hands.length - 1] = currentHand.slice(0, -1);
      } else {
        // Otherwise use the standard undo logic
        gameManager.undo();
      }
      
      // Always reset the completion flag
      gameManager.state.isComplete = false;

      // Recompute scores
      gameManager.state.scores = gameManager.getScores();

      // Persist the reverted state so a page reload doesn't restore the
      // still-complete game and snap back to the victory screen
      localStorage.setItem('currentGame', gameManager.toJSON());

      // Update the UI
      hideAllControls();
      showPhaseControls(gameManager);
      updateHandInfo(gameManager);
      updateScores(gameManager.getScores());

      // Rebuild the score-log table so it reflects the reverted state
      // (the old completed row is otherwise left stale)
      rebuildScoreLog(gameManager, localStorage.getItem('reverseHistory') === 'true');

      // Make sure the undo button is enabled
      const undoButton = document.getElementById('undo-button');
      if (undoButton) {
        (undoButton as HTMLButtonElement).disabled = false;
      }
    });
    
    document.getElementById('victory-history-btn')?.addEventListener('click', () => {
      // Remove the victory modal
      victoryElement.remove();
      
      // Show end game controls
      const endGameControls = document.getElementById('end-game-controls');
      if (endGameControls) {
        endGameControls.classList.remove('hidden');
      }
      
      // Generate and display statistics
      const statsContainer = document.getElementById('game-statistics-container');
      if (statsContainer) {
        statsContainer.classList.remove('hidden');
        
        // Always regenerate statistics when the button is clicked
        try {
          // Dynamically import the statistics utility
          import('../lib/statistics-util.ts')
            .then(statsModule => {
              // Ensure we have a valid winnerIndex
              const safeWinnerIndex = gameManager.getWinner() || 0;
              
              try {
                const statsHTML = statsModule.generateStatisticsHTML(
                  gameManager.state.hands,
                  gameManager.state.players,
                  gameManager.state.teams,
                  gameManager.getScores(),
                  safeWinnerIndex
                );
                statsContainer.innerHTML = statsHTML;
                
                // Ensure the stats container is visible
                statsContainer.classList.remove('hidden');
                
                // Scroll to history/stats section after stats are generated
                const historySection = document.getElementById('game-history-section');
                if (historySection) {
                  historySection.scrollIntoView({ behavior: 'smooth' });
                  
                  // Highlight the section briefly
                  historySection.classList.add('ring-4', 'ring-blue-400');
                  setTimeout(() => {
                    historySection.classList.remove('ring-4', 'ring-blue-400');
                  }, 2000);
                }
              } catch (err) {
                console.error('Error generating statistics:', err);
                statsContainer.innerHTML = '<div class="p-4 bg-red-50 text-red-600 rounded">Error generating statistics</div>';
              }
            })
            .catch(err => {
              console.error('Error loading statistics module:', err);
              statsContainer.innerHTML = '<div class="p-4 bg-red-50 text-red-600 rounded">Failed to load statistics module</div>';
            });
        } catch (error) {
          console.error('Error generating statistics:', error);
          statsContainer.innerHTML = '<div class="p-4 bg-red-50 text-red-600 rounded">Error generating statistics</div>';
        }
      }
    });
    
    document.getElementById('victory-series-btn')?.addEventListener('click', async () => {
      try {
        // Properly await series conversion for Firebase games
        await Promise.resolve(gameManager.convertToSeries());
        gameManager.startNextGame();
        localStorage.setItem('currentGame', gameManager.toJSON());
        window.location.reload();
      } catch (error) {
        console.error('Error creating series:', error);
        // Fallback: just reload to show any partial progress
        window.location.reload();
      }
    });
    
    document.getElementById('victory-new-series-btn')?.addEventListener('click', () => {
      // In series mode, this is "Next Game"
      gameManager.startNextGame();
      localStorage.setItem('currentGame', gameManager.toJSON());
      window.location.reload();
    });
    
    document.getElementById('victory-start-new-series-btn')?.addEventListener('click', () => {
      // At the end of a series, create a new series with the same players and teams
      const players = [...gameManager.state.players];
      const teams = [...gameManager.state.teams];
      
      // Rotate dealer to the next player
      const lastDealerIndex = parseInt(gameManager.getCurrentHand()[0] || '1') - 1;
      const nextDealerIndex = (lastDealerIndex + 1) % 4;
      
      // Create a new game manager with the same players but new state
      const newGameManager = new GameManager(players, teams);
      // Start with the next dealer
      newGameManager.addHandPart((nextDealerIndex + 1).toString());
      
      // Convert to series immediately
      newGameManager.state.isSeries = true;
      newGameManager.state.seriesScores = [0, 0];
      newGameManager.state.gameNumber = 1;
      
      localStorage.setItem('currentGame', newGameManager.toJSON());
      window.location.reload();
    });
    
    document.getElementById('victory-new-game-btn')?.addEventListener('click', () => {
      localStorage.removeItem('currentGame');
      window.location.href = getPath('');
    });
  }
  
  // Helper function to generate HTML for award cards
  function generateAwardCardHTML(award: {
    id: string;
    name: string;
    description: string;
    technicalDefinition: string;
    type: string;
    scope: string;
    icon: string;
    winner: string;
    statDetails?: string;
  }) {
    // Define styling based on award type. Keep this list in sync with GAME_DUBIOUS_IDS /
    // SERIES_DUBIOUS_IDS in pepper-awards.ts (the "dubious" tongue-in-cheek awards get amber cards).
    const dubiousIds = [
      'overreaching', 'false_confidence', 'helping_hand', 'playing_it_safe', 'no_trump_no_problem',
      'moon_struck', 'punching_bag', 'feast_or_famine', 'big_talker',
    ];
    const isDubious = dubiousIds.includes(award.id);
    
    const cardStyle = isDubious ? {
      headerBg: 'bg-amber-600',
      bodyBg: 'bg-amber-50',
      borderColor: 'border-amber-200',
      iconBg: 'bg-amber-500'
    } : award.type === 'player' ? {
      headerBg: 'bg-purple-600',
      bodyBg: 'bg-purple-50',
      borderColor: 'border-purple-200',
      iconBg: 'bg-purple-500'
    } : {
      headerBg: 'bg-blue-600',
      bodyBg: 'bg-blue-50',
      borderColor: 'border-blue-200',
      iconBg: 'bg-blue-500'
    };
    
    // Map icon names to emoji
    const iconMap: Record<string, string> = {
      'shield': '🛡️',
      'check-circle': '✅',
      'trophy': '🏆',
      'trending-up': '📈',
      'clock': '⏱️',
      'crown': '👑',
      'sceptre': '🪄',
      'chili-hot': '🌶️',
      'hand-grabbing': '🫴',
      'thumbs-down': '👎',
      'hand': '✋',
      'shield-check': '🛡️',
      'zap': '⚡',
      'star': '⭐',
      'heart': '❤️',
      'alert-triangle': '⚠️',
      'target': '🎯',
      'award': '🏅',
      'medal': '🥇',
      'flame': '🔥',
      'spade': '♠️',
      'thumbs-up': '👍',
      'music': '🎵',
      'dice': '🎲',
      'dice-5': '🎲',
      'meh': '😐',
      'frown': '😔',
      'smile': '😊',
      'moon': '🌙',
      'sun': '☀️',
      'scale': '⚖️',
      'clock-rewind': '⏪',
      'honey-pot': '🍯'
    };
    
    const iconEmoji = iconMap[award.icon] || '🏆'; // Default to trophy if icon not found
    
    // Badge text based on scope
    const badgeText = award.scope === 'game' ? 'Game Award' : 'Series Award';
    
    return `
      <div class="award-card rounded-lg overflow-hidden shadow-md border ${cardStyle.borderColor} transition-transform hover:shadow-lg max-w-md flex flex-col h-full">
        <div class="${cardStyle.headerBg} px-4 py-3 text-white relative">
          <div class="flex justify-between items-center">
            <h3 class="text-xl font-bold">${award.name}</h3>
            <span class="text-xs px-2 py-1 bg-white/20 rounded-full">${badgeText}</span>
          </div>
          <p class="text-white/90 text-sm mt-1 text-left">${award.description}</p>
        </div>
        
        <div class="${cardStyle.bodyBg} p-4 flex-1">
          <div class="flex mb-3">
            <div class="${cardStyle.iconBg} h-10 w-10 rounded-full flex items-center justify-center text-white shrink-0">
              ${iconEmoji}
            </div>
            
            ${award.winner ? `
              <div class="ml-3">
                <p class="text-gray-500 text-sm">Awarded to</p>
                <p class="font-semibold text-gray-900">${award.winner}</p>
              </div>
            ` : ''}
          </div>
          
          <p class="text-xs text-gray-600 mt-2 text-left">
            <span class="font-medium text-gray-700">Criteria:</span> ${award.technicalDefinition}
          </p>
          
          ${award.statDetails ? `
            <p class="text-xs text-gray-500 mt-2 text-left">
              ${award.statDetails}
            </p>
          ` : ''}
        </div>
      </div>
    `;
  }
  
  // Simple function to create confetti particles using DOM elements
  // Function kept for future implementation
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
  function createConfettiParticle(container: HTMLElement) {
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
    
    const particle = document.createElement('div');
    particle.className = 'absolute rounded-full';
    
    // Random properties
    const size = Math.random() * 10 + 5; // 5-15px
    const color = colors[Math.floor(Math.random() * colors.length)];
    
    // Starting position (centered horizontally, from the top)
    const startX = 50; // percentage
    const startY = 0;  // percentage
    
    // Random angle and speed
    const angle = Math.random() * Math.PI * 2;
    const velocity = Math.random() * 2 + 1;
    const rotationSpeed = Math.random() * 360;
    
    particle.style.width = `${size}px`;
    particle.style.height = `${size}px`;
    particle.style.backgroundColor = color || '#ff0000';
    particle.style.left = `calc(${startX}% - ${size/2}px)`;
    particle.style.top = `calc(${startY}% - ${size/2}px)`;
    
    container.appendChild(particle);
    
    // Animate the particle
    let posX = startX;
    let posY = startY;
    let rotation = 0;
    let life = 100; // percentage of life remaining
    
    const animate = () => {
      if (life <= 0) {
        particle.remove();
        return;
      }
      
      // Update position
      posX += Math.cos(angle) * velocity;
      posY += Math.sin(angle) * velocity + 0.5; // Add gravity
      rotation += rotationSpeed;
      life -= 0.7;
      
      // Update styles
      particle.style.left = `calc(${posX}% - ${size/2}px)`;
      particle.style.top = `calc(${posY}% - ${size/2}px)`;
      particle.style.transform = `rotate(${rotation}deg)`;
      particle.style.opacity = (life / 100).toString();
      
      requestAnimationFrame(animate);
    };
    
    requestAnimationFrame(animate);
    
    return particle;
  }