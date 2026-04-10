# Whitewater Journal

Offline-first PWA for logging whitewater kayaking days. SvelteKit + TypeScript + Tailwind/DaisyUI.

## Architecture

- **Client data**: IndexedDB via Dexie.js — all data lives locally, works offline
- **Server data**: Postgres (not yet wired up — Phase 3)
- **Auth**: noegos-auth service via JWT cookie on `.noegosunderwater.com`
- **Charts**: CSS bar charts (LayerCake planned for future)
- **Maps**: Leaflet with OpenStreetMap tiles
- **Deployment**: adapter-node behind Caddy at journal.noegosunderwater.com

## Development

```bash
npm run dev -- --port 5174
```

Auth service must be running on port 5173 for login to work. Set `DEV_BYPASS_AUTH=true` in `.env` to skip auth during development.

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
