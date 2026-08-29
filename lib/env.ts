const explicitMode = process.env.NEXT_PUBLIC_APP_ENV?.trim().toLowerCase();

// "Production UI" mode. NEXT_PUBLIC_APP_ENV=production forces production UI even in the dev
// server (NODE_ENV cannot be overridden via .env in a Next client bundle, hence this var).
// Without it, the value follows the actual build mode (NODE_ENV) automatically.
export const isProd =
  explicitMode === "production" ||
  (explicitMode === undefined && process.env.NODE_ENV === "production");

// Debug/dev-only UI (raw-response panel, API & mapping logs, per-page upload grids,
// degenerate-region warnings, unmatched answers) is hidden in production mode but can be
// forced back on with NEXT_PUBLIC_SHOW_DEBUG=1.
export const showDebugPanels = process.env.NEXT_PUBLIC_SHOW_DEBUG === "1" || !isProd;