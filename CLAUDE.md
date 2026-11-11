# Whitewater Journal

Offline-first PWA for logging whitewater kayaking days. SvelteKit + TypeScript + Tailwind/DaisyUI.

## Architecture

- **Client data**: IndexedDB via Dexie.js — all data lives locally, works offline
- **Server data**: Postgres, synced via `/api/sync/{pull,push,status}` (last-write-wins by `updatedAt`)
- **Auth**: noegos-auth service via JWT cookie on `.noegosunderwater.com`
- **Charts**: Observable Plot (replaced hand-rolled SVG, May 2026)
- **Maps**: MapLibre GL + MapTiler outdoor-v2 (replaced Leaflet, May 2026)
- **Deployment**: adapter-node behind Caddy at ww-journal.noegosunderwater.com
- **MCP server**: `/mcp` (Streamable HTTP, stateless) for AI agents. OAuth 2.1 bearer tokens from
  noegos-auth (audience `<origin>/mcp`, scopes `read`/`write`), verified in `src/lib/server/auth.ts`.
  Tools in `src/lib/server/mcp.ts`; data ops in `src/lib/server/journal.ts` write via `pushChanges`
  so they behave exactly like PWA sync. `/mcp` and `/.well-known/*` bypass the cookie hook.

## Development

```bash
npm run dev -- --port 5174
```

Auth service must be running on port 5173 for login to work. Set `DEV_BYPASS_AUTH=true` in `.env` to skip auth during development.

Set `MCP_ORIGIN=https://ww-journal.noegosunderwater.com` in production so the MCP resource URL
is right behind the proxy. With `DEV_BYPASS_AUTH=true`, `/mcp` without a token acts as the dev user.

## Key Directories

- `src/lib/db/` — Dexie.js database, seeding, queries
- `src/lib/api/` — External API clients (USGS, future Garmin)
- `src/lib/components/` — Reusable Svelte components
- `src/lib/types.ts` — TypeScript interfaces (River, JournalEntry)
- `static/data/` — Seed data (rivers.json, entries.json from Django export)

## Data Sources

- 1,220 rivers from original Django app (`~/Projects/aw-journal/datadump.json`)
- 7 gauge sources: usgs, codwr, virtual, dream, wadoe, noaa, popud
- USGS Water Services API for flow data

## What NOT to do

- Don't build auth/login flows — noegos-auth handles it
- Don't use SQLite on the server — use Postgres (per project standards)
- Don't add heavyweight chart libraries — keep bundles small for PWA
