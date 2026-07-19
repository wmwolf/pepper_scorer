// src/lib/register-sw.ts
// Registers the app-shell service worker (public/sw.js). Base-path aware so it works under the
// GitHub Pages sub-path deploy (`/pepper_scorer/`) and — were it ever enabled — local dev (`/`).
import { getPath } from './path-utils';

export function registerServiceWorker(): void {
  // Only register in the production build. In `astro dev` a service worker would fight HMR and
  // could serve stale modules; test the PWA against `astro build` + `astro preview` instead.
  if (!import.meta.env.PROD) return;
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    const swUrl = getPath('sw.js'); // e.g. /pepper_scorer/sw.js
    const scope = getPath(''); // e.g. /pepper_scorer/  (trailing slash preserved)

    navigator.serviceWorker
      // updateViaCache: 'none' => the browser always revalidates sw.js against the network on
      // update checks, bypassing the GH-Pages HTTP cache. This is what makes the documented
      // kill-switch in public/sw.js able to reach already-installed clients quickly.
      .register(swUrl, { scope, updateViaCache: 'none' })
      .catch((error) => {
        console.error('Service worker registration failed:', error);
      });
  });
}
