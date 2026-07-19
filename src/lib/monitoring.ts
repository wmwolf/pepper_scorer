// src/lib/monitoring.ts
// Optional client-side error monitoring via Sentry.
//
// Entirely gated on the PUBLIC_SENTRY_DSN env var: when it is unset the Sentry SDK is never
// imported (the dynamic import below is unreachable), so this is a true no-op with zero runtime
// cost — the SDK ships as a separate chunk that is only fetched when a DSN is configured.
//
// To activate: set PUBLIC_SENTRY_DSN (as a GitHub Actions repo secret, injected at build time like
// the PUBLIC_FIREBASE_* vars — see .github/workflows/astro.yml and .env.example).

let initialized = false;

export async function initMonitoring(): Promise<void> {
  if (initialized) return;
  if (typeof window === 'undefined') return;

  const dsn = import.meta.env.PUBLIC_SENTRY_DSN;
  if (!dsn) return; // unconfigured -> no-op; the SDK chunk is never loaded

  initialized = true;

  try {
    const Sentry = await import('@sentry/browser');
    Sentry.init({
      dsn,
      environment: import.meta.env.PROD ? 'production' : 'development',
      // Optional release tag for grouping errors by deploy (set PUBLIC_SENTRY_RELEASE if wanted).
      release: import.meta.env.PUBLIC_SENTRY_RELEASE || undefined,
      // Error reporting only — no performance tracing or session replay, to keep it lightweight.
      tracesSampleRate: 0,
      sendDefaultPii: false,
      integrations: [
        // Forward console.error() calls (in addition to uncaught errors + unhandled rejections,
        // which Sentry captures automatically).
        Sentry.captureConsoleIntegration({ levels: ['error'] }),
      ],
    });
  } catch (error) {
    // Monitoring must never break the app.
    console.warn('Sentry init skipped:', error);
  }
}
