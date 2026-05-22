# ADR: Multi-Device Sync Conflict Resolution Strategy

**Status:** Proposed  
**Date:** 2026-05-22  
**Context:** ww-journal SvelteKit PWA

---

## Background

The current sync implementation (`src/lib/sync.svelte.ts` + `src/lib/server/sync.ts`) already has both pull and push working. The protocol is:

1. Pull: fetch all server records updated since `lastSyncedAt`, apply locally with LWW (`local.updatedAt < server.updatedAt`)
2. Push: collect all `dirty=true` local records, POST to `/api/sync/push`; server applies with LWW (`WHERE updated_at < EXCLUDED.updated_at`)

**The problem:** This is LWW without conflict detection. Two devices can both edit the same record offline; whoever syncs last silently overwrites the other. The user never sees the conflict. One version of their journal entry disappears with no warning.

Concretely:

```
T0: both devices in sync. Entry E has updatedAt=T0.
T1: Phone edits E offline. Phone's E.updatedAt=T1, dirty=true.
T2: Desktop edits E online. Server's E.updated_at=T2. T2 > T1.
T3: Phone comes online, sync runs:
    pull: server.updatedAt(T2) > local.updatedAt(T1) → overwrites phone edit, sets dirty=false
    push: dirty=false, nothing to push
    → Phone's T1 edit is silently gone.
```

---

## Strategies Evaluated

### Strategy 1: Last-Write-Wins (pure timestamp, current behavior)

Compare `client.updatedAt` vs `server.updated_at`. Newer wins, unconditionally.

**Implementation complexity:** Already done. Zero additional work.

**UX impact:** Silent data loss. User editing on phone while offline may lose changes when the same record was edited on desktop. No notification, no recovery.

**Data-loss risk:** High. Any offline edit on a device that's "behind" on wall-clock time (clock drift, timezone bug) loses unconditionally.

**Offline-first suitability:** Poor. Punishes offline use — the scenario where offline-first should shine.

**Verdict:** Acceptable only if this is a single-device app. Not acceptable for multi-device.

---

### Strategy 2: Field-Level Merge

Track which fields were modified per record per device. Merge non-conflicting fields automatically (e.g., Device A changed `description`, Device B changed `flow` → both changes land). Flag only true field-level conflicts.

**Implementation complexity:** High.

- Requires a `dirtyFields: string[]` array on every record in IndexedDB and Postgres
- Server merge logic must understand each field's semantics
- Tags are an array — "field-level merge" of arrays is undefined without further policy decisions (union? intersection? last-write per element?)
- Dexie schema migration to add `dirtyFields` to all tables
- Server must be aware of each table's schema

**UX impact:** Good when it works (automatic non-conflicting merge). Complex when it doesn't (user sees a field-level conflict UI for description vs flow edits).

**Data-loss risk:** Low for non-conflicting field changes. Still needs a policy for true field conflicts.

**Offline-first suitability:** Good in principle, complex in practice.

**Verdict:** Right idea for a multi-user collaborative app. Overkill for a single-user personal journal where conflicts are rare and accidental. The complexity cost exceeds the benefit.

---

### Strategy 3: Conflict Queue

When a conflict is detected (both sides modified since last common ancestor), push both versions to a queue table. User or server-side logic resolves.

**Implementation complexity:** Medium-high.

- Requires a `conflicts` table on the server
- Requires a UI for surfacing and resolving queued conflicts
- Requires a mechanism for the client to check for pending conflicts on sync
- Conflicts can accumulate if the user ignores them

**UX impact:** High visibility — user explicitly sees and resolves conflicts. But can be jarring for a journaling app; the user may be confused about why an entry is "in conflict."

**Data-loss risk:** Near zero. Both versions are preserved until resolved.

**Offline-first suitability:** Good. No data lost.

**Verdict:** Right for multi-user or high-stakes data. For a personal journal, the UX overhead of a conflict queue is likely worse than the problem it solves.

---

## Recommendation: Enhanced LWW with Version Guard

**Recommended strategy:** Augment the existing LWW approach with a server-authoritative `version` integer and a `baseVersion` field in push payloads. Push succeeds (LWW) when no true conflict exists. Push is rejected with both versions returned when a true conflict is detected, giving the client enough information to show a simple "which version do you want to keep?" prompt.

This is the minimum viable conflict-awareness layer. It preserves the simplicity of LWW for the common case (no concurrent edits) while providing a recovery path for the rare case.

### Why this fits ww-journal

- Single user, typically one active device at a time
- Journal entries are not collaborative — conflicts are rare accidents, not expected workflow
- "Which version do you want?" is a natural UX for a personal journal; it's rare enough that a modal prompt is fine
- Implementation is small: one new column per table, one new field in push payload, conflict handling in ~30 lines of server code

### How it works

**The invariant:** Every server record has a monotonically increasing `version` integer, bumped on every server write. The client stores the `version` it last saw from the server (`syncedVersion` in IndexedDB alongside the record).

**Conflict definition:** A true conflict exists when:
```
client.baseVersion != server.current_version
AND
server.current_version > client.baseVersion
```
i.e., the server record has been updated by another device since the client last synced this record.

**No conflict (fast path):** `client.baseVersion == server.current_version`. Client's update is the only change since last sync. Apply LWW as today.

**True conflict (slow path):** `client.baseVersion < server.current_version`. Both sides edited. Server returns `409 Conflict` with both versions. Client shows a simple prompt.

---

## Data Model Changes

### Postgres: add `version` to sync tables

Apply to `entries`, `trips`, `tag_categories`. Rivers are shared/reference data — conflicts there would be admin-level issues, not user-level. Skip rivers for now.

```sql
-- Idempotent migrations (add to migrate.ts)
ALTER TABLE entries       ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE trips         ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE tag_categories ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
```

Existing rows get `version = 1`. Every subsequent server write increments version:

```sql
ON CONFLICT (id) DO UPDATE SET
    ...,
    version    = entries.version + 1,
    updated_at = EXCLUDED.updated_at
WHERE entries.updated_at < EXCLUDED.updated_at
  AND entries.version = EXCLUDED.base_version  -- conflict guard
```

### Dexie (client): add `syncedVersion` to JournalEntry, Trip, TagCategory

```typescript
// In types.ts
export interface JournalEntry {
    // ... existing fields ...
    syncedVersion: number;  // version from server at last pull; 0 if never synced
}
// Same for Trip and TagCategory
```

`syncedVersion = 0` for records created locally and never seen by the server.

**Dexie schema migration** (version 7):
- Add `syncedVersion` to entries, trips, tagCategories (default 0)
- No data loss — all existing records get `syncedVersion: 0`, which means "never synced", which correctly means no base version to compare against on first push

---

## Push Sync Contract

### Request

`POST /api/sync/push`

```typescript
interface PushPayload {
    rivers?:        SyncRiver[];        // unchanged — no version guard
    entries?:       SyncEntryPush[];
    trips?:         SyncTripPush[];
    tagCategories?: SyncTagCategoryPush[];
}

interface SyncEntryPush extends SyncEntry {
    baseVersion: number;   // syncedVersion from IndexedDB; 0 = "I created this"
}
// Same pattern for SyncTripPush, SyncTagCategoryPush
```

### Response — success (all records applied or no conflict)

**HTTP 200**
```typescript
interface PushResponse {
    serverTime: string;
    applied: string[];   // IDs that were accepted and written
    skipped: string[];   // IDs skipped (server version was already newer — silent LWW)
    conflicts: ConflictRecord[];  // IDs where a true conflict was detected
}
```

### Response — partial conflict

**HTTP 200** (not 409 — partial success is still a 200; conflicts are in the body)

```typescript
interface ConflictRecord {
    id:          string;
    table:       'entries' | 'trips' | 'tagCategories';
    clientVersion: SyncEntryPush;   // what the client sent
    serverVersion: SyncEntry;       // what the server currently has
}
```

The client handles conflicts after push returns. Non-conflicting records are applied normally.

### Server logic (pseudo-SQL for entries)

```sql
-- Attempt: apply if no conflict
INSERT INTO entries (..., version, base_version_sent)
VALUES (...)
ON CONFLICT (id) DO UPDATE SET
    river_id   = EXCLUDED.river_id,
    ...
    updated_at = EXCLUDED.updated_at,
    version    = entries.version + 1
WHERE entries.user_id   = $userId
  AND entries.updated_at < EXCLUDED.updated_at   -- LWW timestamp check
  AND entries.version    = EXCLUDED.base_version  -- conflict guard

-- If 0 rows affected: check if it was a conflict or just a stale LWW skip
-- Conflict: entries.version != EXCLUDED.base_version
-- Stale skip: entries.updated_at >= EXCLUDED.updated_at
```

In practice: run the UPDATE, check `rowcount`. If 0, SELECT the current server row and check:
- `server.version != client.baseVersion` → conflict → add to conflicts list
- `server.updated_at >= client.updatedAt` → LWW skip → add to skipped list

### Pull response: include `version`

`GET /api/sync/pull?since=...`

Add `version: number` to `SyncEntry`, `SyncTrip`, `SyncTagCategory` in the pull response. Client stores this as `syncedVersion` alongside the record.

```typescript
// server/sync.ts — rowToEntry addition
function rowToEntry(r: any): SyncEntry {
    return {
        ...existing fields...,
        version: r.version ?? 1,   // new field
    };
}
```

Client, on applying a pulled record:
```typescript
await db.entries.put({ ...e, dirty: false, syncedVersion: e.version });
```

---

## Client Conflict Resolution UX

When `pushChanges()` returns conflicts, surface them to the user:

1. Show a modal/drawer: "2 entries have conflicting edits from another device."
2. For each conflict, show both versions side by side (datetime, flow, description excerpt).
3. Buttons: "Keep mine" / "Keep other device's version".
4. "Keep mine": re-push that record with `baseVersion` set to the server's current version (force-win). Or: the server could accept a `force: true` flag to skip the conflict guard.
5. "Keep theirs": apply the server version locally, set `dirty: false`, `syncedVersion` updated.

The conflict modal should be non-blocking — the user can dismiss and resolve later (the records remain `dirty` until resolved).

---

## Sequence Diagram (conflict scenario)

```
Phone (offline)     Server              Desktop
     |                |                    |
     | edit entry E   |  edit entry E      |
     | (base=1)       |  → version=2       |
     |                |                    |
     |    -- phone comes online --          |
     |                |                    |
     | pull since T0  |                    |
     |  ← E v2 -------|                    |
     | conflict: local base=1, server=2    |
     | (local is dirty, server is newer)   |
     |                |                    |
     | push E (base=1)|                    |
     |  ← 200 {conflicts: [E]} ----------  |
     |                |                    |
     | show conflict UI                    |
     | user picks "keep mine"              |
     | push E (base=2, force=true)         |
     |  ← 200 {applied: [E]} ----------   |
     | syncedVersion=3                     |
```

---

## Files That Will Need Changes

| File | Change |
|---|---|
| `src/lib/server/sync.ts` | `pushChanges()` — add conflict guard to SQL; return conflict list. `pullChanges()` — include `version` in response. `rowToEntry/Trip/TagCategory()` — add version field. |
| `src/lib/sync.svelte.ts` | `pushChanges()` — include `baseVersion` in payload; handle `conflicts` in response; surface to UI. `pullChanges()` — store `syncedVersion` from response. |
| `src/lib/types.ts` | Add `syncedVersion: number` to JournalEntry, Trip, TagCategory. |
| `src/lib/db/index.ts` | Dexie v7 migration — add `syncedVersion` (default 0). |
| `src/lib/server/migrate.ts` | Add `ALTER TABLE ... ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1`. |
| `src/routes/api/sync/push/+server.ts` | Update to handle new payload shape and return conflict records. |
| `src/lib/components/` | New `ConflictResolutionModal.svelte` component. |

---

## Open Questions for Coder

1. **Force-win mechanism:** Should "keep mine" use a `force: true` flag in the push payload, or should the client re-fetch the server's current version to get the right `baseVersion` before re-pushing? The force flag is simpler; re-fetch is safer against a third concurrent edit during conflict resolution.

2. **Rivers conflict guard:** Rivers are shared reference data, not user-owned. Should they also get a `version` guard, or stay pure LWW? Right now rivers have no `user_id` column (they're global). Skip for now is the safe default; flag this for follow-up.

3. **Conflict persistence:** Should unresolved conflicts survive a page reload? Currently the conflict state would live only in the `SyncStore` in memory. If the user closes the tab mid-conflict, they'd push again next sync and hit the conflict again (which is fine — it re-surfaces). No persistent conflict table needed on the client. Confirm this is acceptable.

4. **Batch conflict limit:** If a user has 50 conflicting records (extreme offline scenario), showing them one by one is unusable. Should there be a "keep all mine" / "keep all theirs" bulk option? Recommend yes — implement as a button in the conflict modal.

5. **Delete vs. edit conflict:** What if Device A soft-deletes an entry while Device B edits it offline? Current LWW would: pull sees `deletedAt` from server, deletes locally; push tries to push Device B's edit but the row was just deleted. The conflict guard would catch this (`version` mismatch). Recommended policy: **delete wins** — if the server version has `deletedAt` set, skip the client's edit. Document this explicitly in the implementation.

6. **Clock drift tolerance:** The existing LWW timestamp comparison is sensitive to client clock drift. The `version` integer guard does NOT depend on timestamps — it depends only on server-authoritative version numbers. This makes it more reliable. The `updatedAt` timestamp comparison in the SQL can remain as a secondary guard but should not be the sole arbiter. Confirm the SQL logic: `WHERE version = base_version` (primary guard) and keep the timestamp check as a belt-and-suspenders.

7. **Dexie index for `syncedVersion`:** Does `syncedVersion` need to be indexed? Unlikely — we only read it per-record during push, not in bulk queries. Omit from the Dexie `stores()` schema unless there's a use case.

---

## What This Is NOT

- Not vector clocks. This app is single-user; vector clocks would be overengineering.
- Not operational transforms. No real-time collaboration, no need.
- Not a full CRDT. The data (journal entries) is not naturally composable; entries are atomic documents.
- Not a background conflict queue that accumulates indefinitely. Conflicts surface immediately on the sync that produced them and are resolved in-session.
