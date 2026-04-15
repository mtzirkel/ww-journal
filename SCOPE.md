# Whitewater Journal -- Scope Document

## Project Overview

Whitewater Journal is an offline-first PWA for logging whitewater kayaking days -- river, date, flow level, notes, and trip grouping. It replaces a decommissioned Django 3.2/Heroku app with a SvelteKit rewrite that works in canyons with zero cell signal, auto-fetches USGS flow data when online, and will eventually import Garmin GPS tracks and heart rate data. Multi-user via noegos-auth; deployed at journal.noegosunderwater.com.

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | SvelteKit 2 (TypeScript, Svelte 5 runes) | adapter-node for deployment |
| Styling | Tailwind CSS 4 + DaisyUI 5 | Dark/light theme toggle |
| Client Storage | IndexedDB via Dexie.js | All data lives locally, works offline |
| Server Database | Postgres (planned, not yet wired) | Multi-user requires Postgres per project standards |
| Auth | noegos-auth (JWT cookie, JWKS verification) | Shared auth service across NoEgos apps |
| Maps | Leaflet + OpenStreetMap tiles | Circle markers colored by class rating |
| Charts | CSS/SVG bar charts (hand-rolled) | LayerCake planned for future |
| USGS Flow | waterservices.usgs.gov/nwis/iv/ | Instantaneous values, parameter 00060 (discharge) |
| Service Worker | SvelteKit built-in | Cache-first assets, network-first pages, skip API routes |
| Testing | Vitest + Stryker (mutation) | Husky pre-commit hooks |
| Deployment | adapter-node behind Caddy at journal.noegosunderwater.com | Not yet deployed |

## Data Model

Source: `src/lib/types.ts`

### River
| Field | Type | Notes |
|---|---|---|
| id | number | Numeric PK (from Django export) |
| riverName | string | e.g. "Clark Fork" |
| section | string or null | e.g. "Alberton Gorge" |
| state | string | Two-letter code |
| awId | string or null | American Whitewater river ID |
| classRating | string or null | e.g. "III-IV" |
| awGaugeId | number or null | AW gauge reference |
| externalGaugeSource | string or null | One of: usgs, codwr, virtual, dream, wadoe, noaa, popud |
| externalGaugeId | string or null | Gauge site number for the source |
| gaugeMin, gaugeMax | number or null | Runnable flow range (CFS) |
| lat, lon | number or null | Put-in coordinates |
| altName | string or null | Alternate name |
| abstract | string or null | Description from AW |

1,220 rivers seeded from Django datadump. Indexed on `[riverName+state]` and `externalGaugeId`.

### JournalEntry
| Field | Type | Notes |
|---|---|---|
| id | number (autoincrement) | |
| date | string | ISO 8601 (YYYY-MM-DD) |
| riverId | number | FK to River |
| flow | number | CFS at time of run |
| description | string | Free-text notes |
| tripId | number or null | FK to Trip (added in schema v2) |
| createdAt, updatedAt | string | ISO 8601 timestamps |
| syncStatus | 'local' / 'synced' / 'pending' | Only 'local' used currently |

Indexed on `date`, `riverId`, `tripId`, `syncStatus`.

### Trip
| Field | Type | Notes |
|---|---|---|
| id | number (autoincrement) | |
| name | string | e.g. "Main Salmon Spring 2026" |
| description | string | |
| startDate, endDate | string or null | Auto-computed from linked entries |
| createdAt, updatedAt | string | ISO 8601 timestamps |

Dexie schema v2 added the trips table and tripId on entries, with an upgrade migration.

### Relationships
- JournalEntry.riverId -> River.id (many-to-one)
- JournalEntry.tripId -> Trip.id (many-to-one, nullable)
- Trip dates auto-computed from min/max entry dates on the trip detail page

## Risk Analysis

### R1: Offline Data Loss (IndexedDB eviction)

Browsers can evict IndexedDB data under storage pressure, especially on iOS Safari which caps at ~1GB per origin and aggressively purges in low-storage scenarios. A user who has not synced could lose their entire journal.

**Mitigation path:** Phase 3 sync engine. Until then, the `entries.json` seed file acts as the only backup. Users should be warned that pre-sync data is device-local only. Consider requesting `navigator.storage.persist()` on install.

**Severity:** Critical. This is the single biggest risk for a kayaking app used in remote canyons where sync may not happen for days.

### R2: Sync Conflicts (multi-device, Phase 3)

When the same user edits an entry on phone and laptop before either syncs, the last-write-wins strategy based on `updatedAt` will silently discard one edit. The `syncStatus` field exists but the sync engine does not.

**Mitigation path:** Phase 3 conflict resolution. Current design flags conflicts for manual resolution but this is not built. The `syncStatus` enum includes `'pending'` but no code transitions entries through the sync lifecycle.

**Severity:** Medium. Single-user app reduces likelihood, but multi-device is the stated use case.

### R3: USGS API Failures and Response Format Changes

The USGS Water Services API (`waterservices.usgs.gov`) is free, unauthenticated, and has no SLA. The response format is deeply nested JSON (`value.timeSeries[0].values[0].value`). The current client silently returns `null` on any failure, including:
- USGS API downtime (has happened for weeks during government shutdowns)
- Gauge decommissioned or renumbered
- Response format change (no versioned API)
- Negative flow values (filtered, but USGS reports these for tidal gauges)

The client picks the reading closest to noon, which is reasonable for daily recreational use but wrong for dawn patrol or evening runs.

**Mitigation path:** Cache gauge readings in IndexedDB (not yet built). Show last-known flow with staleness indicator. Alert when a gauge has not reported in 24+ hours.

**Severity:** Medium. Flow data enhances entries but is not required to log a day.

### R4: USGS-Only Gauge Support

The River model supports 7 gauge sources (`externalGaugeSource`: usgs, codwr, virtual, dream, wadoe, noaa, popud), but only `usgs` has a client implementation. Rivers with other gauge sources show "Has gauge (codwr)" in the UI but the fetch button only works for USGS.

**Mitigation path:** Phase 4 (all gauge sources). The `externalGaugeSource` field is already on the model, so adding clients is additive.

**Severity:** Low. Most western US rivers use USGS gauges.

### R5: Auth Token Expiry and Forgery

Auth relies on a JWT cookie (`noegos_auth`) verified against the noegos-auth JWKS endpoint. Risks:
- If the auth service is down, JWKS fetch fails and all requests redirect to login (no cached JWKS)
- The `DEV_BYPASS_AUTH=true` env var creates an admin user with hardcoded ID `'dev-user'` -- if this leaks to production, anyone has admin access
- JWT expiry is not checked beyond jose's default behavior -- no explicit `maxTokenAge` configured
- The app-slug check (`user.apps.some(a => a.slug === appSlug)`) means access depends on noegos-auth app registration

**Mitigation path:** Cache JWKS with TTL. Add explicit `maxTokenAge` to `jwtVerify`. Ensure `DEV_BYPASS_AUTH` is never set in production env.

**Severity:** High for the dev bypass leak. Medium otherwise -- auth is well-structured via jose/JWKS.

### R6: River Data Integrity

River IDs are numeric integers from the Django export, not UUIDs. Gauge IDs must correspond to real USGS/external gauge sites. Risks:
- A typo in `externalGaugeId` silently fetches the wrong river's flow
- No validation that a gauge ID exists at USGS before saving
- River deduplication relies on `[riverName+state]` compound index, but different sections of the same river are separate records (correct behavior)
- The "Add River" modal (exists as component) could create rivers with invalid gauge IDs

**Mitigation path:** Validate gauge IDs against USGS API on river creation. Display gauge metadata (station name, location) to let users verify they have the right gauge.

**Severity:** Medium. Wrong flow data is misleading for safety decisions (running a river at flood vs. low water).

### R7: Trip-Entry Relationship Integrity

Deleting a trip sets `tripId = null` on all linked entries (orphan protection). But:
- No cascade validation -- entries can reference a `tripId` for a deleted trip if the `modify()` call fails partway
- Trip date range is auto-computed on the detail page view, not stored reliably -- a trip's `startDate`/`endDate` can be stale if entries are edited elsewhere
- No constraint preventing an entry from being in two trips (currently impossible since tripId is a single FK, which is correct)

**Severity:** Low. The orphan protection pattern is correct. Stale dates are cosmetic.

## Phased Features

### Phase 1: Scaffold + PWA + Auth -- COMPLETE

**What was built:**
- SvelteKit project with TypeScript, Tailwind 4, DaisyUI 5
- PWA manifest (`static/manifest.json`) with WW Journal branding (theme: #238c91)
- Service worker with cache-first assets, network-first pages, offline fallback
- Background sync event listener (stub, not implemented)
- Responsive layout: sidebar on desktop, bottom nav on mobile
- Dark/light theme toggle with localStorage persistence
- noegos-auth integration: JWT cookie verification via JWKS, dev bypass mode
- Layout server load passes user to all pages
- Health check API endpoint (`/api/health`)
- Placeholder routes for all planned pages

**Routes:**
- `+layout.svelte` / `+layout.server.ts` (auth + nav)
- `+page.svelte` (dashboard)
- `entries/+page.svelte`, `entries/new/+page.svelte`, `entries/[id]/+page.svelte`
- `rivers/+page.svelte` (placeholder)
- `map/+page.svelte`
- `settings/+page.svelte`
- `api/health/+server.ts`

**Critical invariants to test:**
- Auth hook redirects unauthenticated requests to noegos-auth login URL with correct `return` param
- Auth hook allows `/api/health` without authentication
- `DEV_BYPASS_AUTH=true` creates a user object with `isAdmin: true` and correct app slug
- JWT verification rejects expired tokens, tokens without the `ww-journal` app slug, and malformed tokens
- Service worker pre-caches all build assets on install and deletes old caches on activate
- PWA manifest is valid and installable (correct `start_url`, `display: standalone`, icon paths)

**Trust boundaries:**
- `noegos_auth` cookie: untrusted input, verified against JWKS before any data access
- `DEV_BYPASS_AUTH` env var: must never be set in production
- `AUTH_URL` env var: controls where JWKS is fetched from and where login redirects go

**State transitions:**
- Unauthenticated -> redirect to `{AUTH_URL}/login?return={currentUrl}`
- Valid JWT + has app access -> `event.locals.user` populated, request proceeds
- Valid JWT + no app access -> returns null, triggers redirect
- Dev bypass -> synthetic admin user, no external calls

**Mutation score target:** 80% for auth module (`src/lib/server/auth.ts`, `src/hooks.server.ts`)

---

### Phase 2: Core Journal + USGS + Map + Dashboard -- COMPLETE

**What was built:**
- IndexedDB database via Dexie.js with versioned schema (v1: rivers + entries, v2: +trips +tripId)
- River seeding from `static/data/rivers.json` (1,220 rivers from Django export)
- Entry seeding from `static/data/entries.json` (historical entries from Django export)
- Entry CRUD: create with river autocomplete, inline edit, delete with confirmation
- Entry list with filter-by-river dropdown, sorted by date descending
- Entry detail with river metadata display (state, class, gauge info)
- Dashboard: stat cards (total days, this year, this month, unique rivers), stacked bar chart (days per river grouped by section), flow timeline chart (SVG scatter plot of CFS over time per river group)
- River autocomplete component with Dexie.js search
- Add River modal component
- USGS flow auto-fetch on entry create/edit (auto-triggers when river + date are both set)
- Map view: Leaflet + OpenStreetMap, circle markers colored by class rating, sized by entry count, popups with river details, auto-fit bounds
- Rivers page: placeholder with search input (not yet functional)

**Components:**
- `RiverAutocomplete.svelte` -- searches IndexedDB as user types
- `AddRiverModal.svelte` -- create new river inline
- `FlowTimeline.svelte` -- reusable flow chart component

**Critical invariants to test:**
- Entry creation requires a selected river and date (save button disabled otherwise)
- Entry flow defaults to 0 when USGS fetch fails or returns null
- USGS fetch only triggers for rivers with `externalGaugeSource === 'usgs'`
- USGS client returns null (not throws) for negative flow, NaN, empty timeSeries, HTTP errors
- USGS client picks the reading closest to noon (not first or last value of the day)
- River seed only runs when IndexedDB rivers table is empty (`count === 0`)
- Entry seed only runs when IndexedDB entries table is empty
- Dexie schema v2 migration adds `tripId = null` to existing entries
- Dashboard stats correctly compute: total = all entries, thisYear = entries where date starts with current year, thisMonth = entries where date starts with YYYY-MM
- Dashboard grouped rivers correctly counts entries per section (same river name, different sections = separate bars in the stack)
- Map only renders rivers that have both lat and lon (filters out null coordinates)
- Entry delete removes from IndexedDB and navigates to `/entries`
- Entry edit updates `updatedAt` timestamp

**Trust boundaries:**
- USGS API responses: untrusted external JSON. Current parsing assumes specific nested structure (`value.timeSeries[0].values[0].value`). Any deviation returns null.
- IndexedDB seed data (`rivers.json`, `entries.json`): trusted static files from Django export. Not validated on load.
- `page.params.id`: parsed with `parseInt()`, used directly in Dexie `.get()`. No bounds checking but Dexie returns undefined for missing IDs.

**State transitions:**
- Entry lifecycle: user fills form -> save to IndexedDB with `syncStatus: 'local'` -> appears in list -> edit updates `updatedAt` -> delete removes
- USGS fetch: river + date set -> auto-fetch fires -> loading state -> flow field populated (or left empty on failure)
- Dashboard selection: click river bar -> flow timeline panel opens (animated) -> click X or title -> panel closes
- River autocomplete: type query -> Dexie search -> select result -> `selectedRiver` bound -> or open AddRiverModal

**Mutation score targets:**
- 80% for `src/lib/api/usgs.ts` (data integrity -- wrong flow data is a safety issue)
- 80% for `src/lib/db/index.ts` (seed logic, schema migrations)
- 60% for dashboard stat computation (UI helpers, not safety-critical)

---

### Phase 2.5: Trips, Flow Timeline, Add River -- COMPLETE

**What was built:**
- Trip model and Dexie table (schema v2)
- Trip CRUD: create, edit name/description, delete (unlinks entries, does not delete them)
- Trip detail page: stats (days, rivers, date range), entry list, remove-entry-from-trip
- Trip auto-date-computation: startDate/endDate derived from min/max entry dates
- Entry creation form includes trip selector dropdown
- Entry list shows trip badge when entry is linked to a trip
- Trips page with entry count per trip
- Routes: `trips/+page.svelte`, `trips/[id]/+page.svelte`

**Critical invariants to test:**
- Deleting a trip sets `tripId = null` on all linked entries (not deletes them)
- Removing an entry from a trip sets its `tripId = null` (not deletes the entry)
- Trip startDate/endDate auto-update when entries change
- Trip deletion confirmation dialog must be accepted before deletion proceeds
- Entry tripId dropdown only shows existing trips
- Trip entry count is computed live via Dexie `liveQuery`

**Trust boundaries:**
- `page.params.id`: parsed with `parseInt()` for trip detail page, same pattern as entries

**State transitions:**
- Trip lifecycle: create (name + description) -> entries tagged with tripId -> dates auto-computed -> edit name/description -> delete (entries unlinked)
- Entry-trip link: entry created with tripId -> shows badge in list -> removable from trip detail -> tripId set to null

**Mutation score target:** 60% (trip logic is organizational, not safety-critical)

---

### Phase 3: Offline Hardening + Sync -- PLANNED

**What needs to be built:**
- Sync engine: push `syncStatus: 'pending'` entries to server, pull server changes
- Server-side Postgres database with matching schema
- SvelteKit API routes for sync: `POST /api/sync` (batch push/pull)
- Conflict resolution: last-write-wins with `updatedAt`, flag conflicts for manual resolution
- `navigator.storage.persist()` request on first visit
- Offline indicator component in layout
- Connectivity-aware UI: disable USGS fetch when offline, show "will sync when online" on new entries
- Background sync via service worker (stub exists, needs implementation)
- `syncStatus` transitions: `'local'` -> `'pending'` (queued for sync) -> `'synced'` (confirmed by server)

---

### Phase 4: All Gauge Sources -- PLANNED

**What needs to be built:**
- API clients for: codwr, virtual, dream, wadoe, noaa, popud
- Gauge reading cache in IndexedDB (`USGSGaugeReading` model from migration plan, renamed to generic `GaugeReading`)
- Cache expiry (30 days)
- Background fetch of recent readings for favorited rivers
- Flow-level color coding: too low (red), runnable (green), high (yellow), flood (red) based on `gaugeMin`/`gaugeMax`
- River detail page with recent gauge readings and sparkline
- Functional river list page (currently placeholder)

---

### Phase 5: Garmin Integration -- PLANNED

**What needs to be built:**
- Garmin OAuth flow (OAuth 1.0a or Health API)
- Activity import filtered to kayaking/paddling
- GarminActivity model (GPS tracks as GeoJSON, heart rate, elevation)
- Activity-entry matching by date and GPS proximity
- GPS track overlay on Leaflet map
- Heart rate and elevation charts on entry detail
- Settings page Garmin connection status

---

### Phase 6: Photos + Deploy -- PLANNED

**What needs to be built:**
- Photo attachments on entries (camera capture on mobile, stored as blobs in IndexedDB)
- Photo sync to server filesystem
- Export: CSV/JSON entries, GPX tracks
- Production deployment: adapter-node, Caddy reverse proxy, systemd service
- Domain: journal.noegosunderwater.com
- Data migration script from Django `datadump.json` / recovered Heroku data

## Deployment Plan

| Component | Detail |
|---|---|
| Host | Self-hosted (twomed-home or VPS) |
| Domain | journal.noegosunderwater.com |
| Reverse Proxy | Caddy with auto-HTTPS |
| Runtime | Node.js via SvelteKit adapter-node |
| Database | Postgres (multi-user) |
| Process Manager | systemd service |
| Auth | noegos-auth service must be running on same domain (.noegosunderwater.com) for cookie sharing |
| HTTPS | Required for service worker (Caddy provides) |

Current dev setup: `npm run dev -- --port 5174` with noegos-auth on port 5173. `DEV_BYPASS_AUTH=true` for solo development.

## Open Questions

1. **Heroku data recovery:** Was the recovery email sent? If Postgres data is recovered, it changes the seed data story and may include entries not in `datadump.json`.

2. **River list page:** Currently a placeholder. Should it be a searchable/filterable list of all 1,220 rivers, or only rivers with entries? The search input exists but has no behavior.

3. **Gauge validation:** Should the app validate `externalGaugeId` against the USGS API when a river is created/edited? This would prevent wrong-gauge-ID bugs but requires network.

4. **Storage persistence:** Should the app call `navigator.storage.persist()` immediately, or wait for Phase 3? Without it, iOS Safari can evict IndexedDB data at any time.

5. **Non-USGS gauges:** What are the API endpoints for codwr, wadoe, noaa, popud? The Django codebase may have these clients. "virtual" and "dream" gauge sources -- are these computed/synthetic values?

6. **Garmin API path:** Official Garmin Health API (requires developer application) vs. `garmin-connect` npm package (unofficial, may break)?

7. **Photo storage:** Blobs in IndexedDB for offline + sync to server filesystem? Or a different approach for multi-user? IndexedDB blob storage varies widely by browser.

8. **Multi-user data isolation:** When Postgres is wired up, entries need a `userId` FK. The current IndexedDB schema has no user concept -- all data is local to the device. How should sync handle a shared river table but per-user entries?
