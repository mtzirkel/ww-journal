import { db, getLastSyncedAt, setLastSyncedAt } from '$lib/db/index.js';
import type { River, JournalEntry, Trip, TagCategory } from '$lib/types.js';

export type SyncState = 'idle' | 'syncing' | 'success' | 'error' | 'offline';

interface SyncStatus {
	state: SyncState;
	lastSyncedAt: string | null;
	lastError: string | null;
	pendingCount: number;
}

// Reactive sync status — Svelte 5 rune-based state
class SyncStore {
	state = $state<SyncState>('idle');
	lastSyncedAt = $state<string | null>(null);
	lastError = $state<string | null>(null);
	pendingCount = $state(0);

	async refreshPendingCount() {
		const [entries, trips, cats] = await Promise.all([
			db.entries.where('dirty').equals(1).count().catch(() => 0),
			db.trips.where('dirty').equals(1).count().catch(() => 0),
			db.tagCategories.where('dirty').equals(1).count().catch(() => 0)
		]);
		// Dexie indexes booleans as 0/1, but we set them as `true`/`false`.
		// Fall back to filtering if the indexed query doesn't match.
		if (entries === 0 && trips === 0 && cats === 0) {
			const allEntries = await db.entries.filter((e) => e.dirty === true).count();
			const allTrips = await db.trips.filter((t) => t.dirty === true).count();
			const allCats = await db.tagCategories.filter((c) => c.dirty === true).count();
			this.pendingCount = allEntries + allTrips + allCats;
			return;
		}
		this.pendingCount = entries + trips + cats;
	}
}

export const syncStore = new SyncStore();

let syncInFlight: Promise<void> | null = null;

/**
 * Run a full sync cycle: pull server changes, then push local dirty records.
 * Coalesces concurrent calls into a single sync.
 */
export async function sync(): Promise<void> {
	if (syncInFlight) return syncInFlight;
	if (typeof navigator !== 'undefined' && !navigator.onLine) {
		syncStore.state = 'offline';
		return;
	}

	syncInFlight = (async () => {
		syncStore.state = 'syncing';
		syncStore.lastError = null;
		try {
			await pullChanges();
			await pushChanges();
			const now = new Date().toISOString();
			await setLastSyncedAt(now);
			syncStore.lastSyncedAt = now;
			syncStore.state = 'success';
			await syncStore.refreshPendingCount();
		} catch (err) {
			syncStore.state = 'error';
			syncStore.lastError = err instanceof Error ? err.message : String(err);
			console.error('[sync] failed:', err);
		} finally {
			syncInFlight = null;
		}
	})();

	return syncInFlight;
}

/**
 * Push everything local, verify nothing is still pending, then clear the local
 * tables and re-pull from the server.
 *
 * Used after a schema change: rather than transforming every record on the
 * device, the server (already migrated, and canonical) becomes the source of
 * truth again. Deliberately refuses to clear anything unless the push fully
 * landed — losing an unsynced entry is worse than leaving the app on the old
 * shape until the user is online.
 */
export async function rebuildLocalData(): Promise<void> {
	if (typeof navigator !== 'undefined' && !navigator.onLine) {
		throw new Error('You are offline. Rebuilding needs the server — try again when connected.');
	}

	// Read through a call so TS does not narrow the store across statements —
	// sync() mutates it, which the type system cannot see.
	const stateNow = (): SyncState => syncStore.state;

	// 1. Push local work up first.
	await sync();
	if (stateNow() === 'error') {
		throw new Error(`Sync failed, nothing was cleared: ${syncStore.lastError}`);
	}

	// 2. Refuse to continue if anything is still unsynced.
	await syncStore.refreshPendingCount();
	if (syncStore.pendingCount > 0) {
		throw new Error(
			`${syncStore.pendingCount} change(s) still unsynced — refusing to clear local data.`
		);
	}

	// 3. Safe to clear. Rivers are left alone; they re-seed from static data.
	await db.transaction(
		'rw',
		[db.entries, db.trips, db.tagCategories, db.syncSettings],
		async () => {
			await db.entries.clear();
			await db.trips.clear();
			await db.tagCategories.clear();
			await db.syncSettings.delete('lastSyncedAt');
		}
	);
	syncStore.lastSyncedAt = null;

	// 4. No lastSyncedAt means the next pull asks for everything.
	await sync();
	if (stateNow() === 'error') {
		throw new Error(`Rebuild pull failed — reload to retry: ${syncStore.lastError}`);
	}
}

async function pullChanges() {
	const since = await getLastSyncedAt();
	const url = since ? `/api/sync/pull?since=${encodeURIComponent(since)}` : '/api/sync/pull';
	const res = await fetch(url, { credentials: 'same-origin' });
	if (!res.ok) throw new Error(`Pull failed: ${res.status} ${res.statusText}`);
	const payload = await res.json() as {
		rivers: River[];
		entries: JournalEntry[];
		trips: Trip[];
		tagCategories: TagCategory[];
	};

	// Apply server changes locally. last-write-wins — only overwrite if server is newer.
	if (payload.rivers?.length) {
		for (const r of payload.rivers) {
			const local = await db.rivers.get(r.id);
			if (!local || (local.updatedAt ?? '') < (r.updatedAt ?? '')) {
				await db.rivers.put({ ...r, dirty: false });
			}
		}
	}

	if (payload.entries?.length) {
		for (const e of payload.entries) {
			const local = await db.entries.get(e.id);
			if (!local || local.updatedAt < e.updatedAt) {
				if (e.deletedAt) {
					// Server says deleted — remove locally
					await db.entries.delete(e.id);
				} else {
					await db.entries.put({ ...e, dirty: false });
				}
			}
		}
	}

	if (payload.trips?.length) {
		for (const t of payload.trips) {
			const local = await db.trips.get(t.id);
			if (!local || local.updatedAt < t.updatedAt) {
				if (t.deletedAt) {
					await db.trips.delete(t.id);
				} else {
					await db.trips.put({ ...t, dirty: false });
				}
			}
		}
	}

	if (payload.tagCategories?.length) {
		for (const c of payload.tagCategories) {
			const local = await db.tagCategories.get(c.id);
			if (!local || local.updatedAt < c.updatedAt) {
				if (c.deletedAt) {
					await db.tagCategories.delete(c.id);
				} else {
					await db.tagCategories.put({ ...c, dirty: false });
				}
			}
		}
	}
}

async function pushChanges() {
	const dirtyEntries = await db.entries.filter((e) => e.dirty === true).toArray();
	const dirtyTrips = await db.trips.filter((t) => t.dirty === true).toArray();
	const dirtyCats = await db.tagCategories.filter((c) => c.dirty === true).toArray();
	const dirtyRivers = await db.rivers.filter((r) => r.dirty === true).toArray();

	if (
		dirtyEntries.length === 0 &&
		dirtyTrips.length === 0 &&
		dirtyCats.length === 0 &&
		dirtyRivers.length === 0
	) {
		return;
	}

	const payload = {
		rivers: dirtyRivers,
		entries: dirtyEntries,
		trips: dirtyTrips,
		tagCategories: dirtyCats
	};

	const res = await fetch('/api/sync/push', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'same-origin',
		body: JSON.stringify(payload)
	});

	if (!res.ok) throw new Error(`Push failed: ${res.status} ${res.statusText}`);

	// Mark all pushed records as clean
	await db.transaction('rw', [db.entries, db.trips, db.tagCategories, db.rivers], async () => {
		for (const e of dirtyEntries) await db.entries.update(e.id, { dirty: false });
		for (const t of dirtyTrips) await db.trips.update(t.id, { dirty: false });
		for (const c of dirtyCats) await db.tagCategories.update(c.id, { dirty: false });
		for (const r of dirtyRivers) await db.rivers.update(r.id, { dirty: false });
	});
}

/**
 * Mark an entry as dirty so the next sync push includes it.
 * Helper for CRUD operations.
 */
export function markDirty<T extends { dirty: boolean; updatedAt: string }>(record: T): T {
	return { ...record, dirty: true, updatedAt: new Date().toISOString() };
}
