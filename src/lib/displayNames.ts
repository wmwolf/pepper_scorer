// Deterministic short display names for the tight parts of the UI.
//
// Google sign-in fills player names with full "First Last" display names, which crowd the
// bidder buttons and the score-log cells and force the score-table team headers to wrap. We
// can't invent nicknames ("Nate" from "Nathaniel") — no string algorithm does that — so the
// mechanical, honest shortening is: show the FIRST name, disambiguate a shared first name with
// a last initial, and ellipsis-truncate anything still too long.
//
// Both the game UI (game.ts) and the setup-time "this will be shortened" hint (index.astro)
// import from here, so the warning the user sees at setup always matches what actually renders.

// Character budgets. These are approximations tied to the compact mobile layout, not exact
// pixel measurements — a soft heads-up, not a guarantee. Tune together with the CSS max-widths
// in game.ts / game.astro if the layout changes.
export const SHORT_NAME_MAX = 14;      // hard cap on a short label (buttons ellipsis beyond this)
export const SCORE_CELL_NAME_MAX = 11; // first name longer than this truncates in score-log cells
export const TEAM_HEADER_MAX = 18;     // team label longer than this truncates in score-table headers

export function firstName(full: string): string {
  return (full || '').trim().split(/\s+/)[0] || '';
}

function lastInitial(full: string): string {
  const tokens = (full || '').trim().split(/\s+/).filter(Boolean);
  return tokens.length > 1 ? tokens[tokens.length - 1][0].toUpperCase() : '';
}

function ellipsize(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// Given the four seat names, return four short labels — first name, disambiguated + capped.
// Collisions are compared case-insensitively; only the colliding names get a last initial, and
// the cap is applied to the first-name stem BEFORE the initial so disambiguation survives.
export function shortNames(players: string[]): string[] {
  const firsts = players.map(firstName);
  const counts = new Map<string, number>();
  firsts.forEach(f => {
    if (!f) return;
    const key = f.toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return players.map((full, i) => {
    const stem = ellipsize(firsts[i], SHORT_NAME_MAX);
    const collides = firsts[i] && (counts.get(firsts[i].toLowerCase()) || 0) > 1;
    if (collides) {
      const li = lastInitial(full);
      if (li) return `${stem} ${li}.`;
    }
    return stem;
  });
}

// Does this single player name get ellipsis-truncated in the compact score-log cells?
// (The roomy 2x2 bidder buttons rarely truncate a first name; the narrow log cells do.)
export function playerNameWillTruncate(full: string): boolean {
  return firstName(full).length > SCORE_CELL_NAME_MAX;
}

// Does this team name get ellipsis-truncated in the score-table column headers?
export function teamNameWillTruncate(name: string): boolean {
  return (name || '').trim().length > TEAM_HEADER_MAX;
}
