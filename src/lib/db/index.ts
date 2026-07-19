import Dexie, { type EntityTable } from 'dexie';
import type { River, JournalEntry, Trip, TagCategory, SyncSetting } from '$lib/types.js';

const db = new Dexie('ww-journal') as Dexie & {
	rivers: EntityTable<River, 'id'>;
	entries: EntityTable<JournalEntry, 'id'>;
	trips: EntityTable<Trip, 'id'>;
	tagCategories: EntityTable<TagCategory, 'id'>;
	syncSettings: EntityTable<SyncSetting, 'key'>;
};

// v1: original schema
db.version(1).stores({
	rivers: 'id, riverName, state, externalGaugeId, [riverName+state]',
	entries: '++id, date, riverId, syncStatus'
});

// v2: added trips
db.version(2).stores({
	rivers: 'id, riverName, state, externalGaugeId, [riverName+state]',
	entries: '++id, date, riverId, tripId, syncStatus',
	trips: '++id, name, startDate'
}).upgrade(tx => {
	return tx.table('entries').toCollection().modify(entry => {
		if (entry.tripId === undefined) entry.tripId = null;
	});
});

// v3: added tag categories and tags on entries
db.version(3).stores({
	rivers: 'id, riverName, state, externalGaugeId, [riverName+state]',
	entries: '++id, date, riverId, tripId, syncStatus',
	trips: '++id, name, startDate',
	tagCategories: '++id, name'
}).upgrade(tx => {
	return tx.table('entries').toCollection().modify(entry => {
		if (entry.tags === undefined) entry.tags = [];
	});
});

// v4: switch entries/trips/tagCategories to UUID string IDs for sync.
// Add dirty/deletedAt/createdAt/updatedAt to all sync-tracked tables.
// Add syncSettings store for lastSyncedAt.
db.version(4).stores({
	rivers: 'id, riverName, state, externalGaugeId, [riverName+state], updatedAt, dirty',
	entries: 'id, date, riverId, tripId, updatedAt, dirty, deletedAt',
	trips: 'id, name, startDate, updatedAt, dirty, deletedAt',
	tagCategories: 'id, name, updatedAt, dirty, deletedAt',
	syncSettings: 'key'
}).upgrade(async tx => {
	const now = new Date().toISOString();

	// Migrate entries to UUIDs
	const oldEntries = await tx.table('entries').toArray();
	await tx.table('entries').clear();
	for (const e of oldEntries) {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { id: _oldId, syncStatus: _ss, ...rest } = e;
		await tx.table('entries').put({
			...rest,
			id: crypto.randomUUID(),
			tripId: null, // old integer tripIds can't be remapped since trips also get new IDs
			tags: rest.tags ?? [],
			createdAt: rest.createdAt ?? now,
			updatedAt: rest.updatedAt ?? now,
			deletedAt: null,
			dirty: true
		});
	}

	// Migrate trips to UUIDs
	const oldTrips = await tx.table('trips').toArray();
	await tx.table('trips').clear();
	for (const t of oldTrips) {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { id: _oldId, ...rest } = t;
		await tx.table('trips').put({
			...rest,
			id: crypto.randomUUID(),
			createdAt: rest.createdAt ?? now,
			updatedAt: rest.updatedAt ?? now,
			deletedAt: null,
			dirty: true
		});
	}

	// Migrate tag categories to UUIDs
	const oldCats = await tx.table('tagCategories').toArray();
	await tx.table('tagCategories').clear();
	for (const c of oldCats) {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { id: _oldId, ...rest } = c;
		await tx.table('tagCategories').put({
			...rest,
			id: crypto.randomUUID(),
			createdAt: now,
			updatedAt: now,
			deletedAt: null,
			dirty: true
		});
	}

	// Mark all existing rivers as not-dirty (they'll come from server pull)
	await tx.table('rivers').toCollection().modify(r => {
		if (!r.updatedAt) r.updatedAt = now;
		if (r.dirty === undefined) r.dirty = false;
	});
});

// v6: rename date → datetime (ISO timestamp), default noon UTC.
// Also clears dirty=false entries and resets lastSyncedAt so the phone
// pulls a fresh canonical copy from the server instead of keeping stale seeds/dupes.
db.version(6).stores({
	rivers: 'id, riverName, state, externalGaugeId, [riverName+state], updatedAt, dirty',
	entries: 'id, datetime, riverId, tripId, updatedAt, dirty, deletedAt',
	trips: 'id, name, startDate, updatedAt, dirty, deletedAt',
	tagCategories: 'id, name, updatedAt, dirty, deletedAt',
	syncSettings: 'key'
}).upgrade(async tx => {
	// Convert existing entries: date (YYYY-MM-DD) → datetime (ISO timestamp at noon UTC)
	await tx.table('entries').toCollection().modify((entry: Record<string, unknown>) => {
		if (!entry.datetime && entry.date) {
			entry.datetime = (entry.date as string) + 'T12:00:00.000Z';
		}
		delete entry.date;
	});

	// Nuke entries that are already clean (seeds + synced records) so the phone
	// pulls a fresh copy from server rather than keeping stale dupes.
	const dirtyIds = await tx.table('entries')
		.filter((e: { dirty: boolean }) => e.dirty === true)
		.primaryKeys();
	const allIds = await tx.table('entries').toCollection().primaryKeys();
	const toDelete = (allIds as string[]).filter((id: string) => !(dirtyIds as string[]).includes(id));
	await tx.table('entries').bulkDelete(toDelete);

	// Reset lastSyncedAt so next sync is a full pull (gets canonical entries from server)
	await tx.table('syncSettings').delete('lastSyncedAt');
});

// v5: mark all existing entries as not-dirty so seed data doesn't get pushed to server
db.version(5).stores({
	rivers: 'id, riverName, state, externalGaugeId, [riverName+state], updatedAt, dirty',
	entries: 'id, date, riverId, tripId, updatedAt, dirty, deletedAt',
	trips: 'id, name, startDate, updatedAt, dirty, deletedAt',
	tagCategories: 'id, name, updatedAt, dirty, deletedAt',
	syncSettings: 'key'
}).upgrade(async tx => {
	// Seed entries were incorrectly marked dirty=true — fix them so they
	// don't push as duplicates. Real user entries will have dirty=true set
	// explicitly in save().
	await tx.table('entries').toCollection().modify(entry => {
		entry.dirty = false;
	});
});

// v7: multi-activity. Adds activityType + envelope metrics; moves the
// paddle-only riverId/flow into details.paddle. Note v5/v6 above are declared
// out of numeric order — Dexie sorts by version internally, so it still works.
//
// Clean (already-synced) entries are dropped and lastSyncedAt reset so they are
// re-pulled from the server in canonical v7 shape — same approach as v6. Dirty
// (unpushed) entries are converted in place so nothing local-only is lost.
db.version(7).stores({
	rivers: 'id, riverName, state, externalGaugeId, [riverName+state], updatedAt, dirty',
	entries: 'id, datetime, activityType, details.riverId, tripId, updatedAt, dirty, deletedAt',
	trips: 'id, name, startDate, updatedAt, dirty, deletedAt',
	tagCategories: 'id, name, updatedAt, dirty, deletedAt',
	syncSettings: 'key'
}).upgrade(async tx => {
	// Idempotent: tolerates entries already carrying details, and entries with
	// no riverId at all. A half-applied upgrade can be re-run safely.
	await tx.table('entries').toCollection().modify((entry: Record<string, unknown>) => {
		if (!entry.activityType) entry.activityType = 'paddle';

		if (!entry.details || typeof entry.details !== 'object') {
			const details: Record<string, unknown> = {};
			if (typeof entry.riverId === 'number') details.riverId = entry.riverId;
			if (typeof entry.flow === 'number') details.flow = entry.flow;
			entry.details = details;
		}
		delete entry.riverId;
		delete entry.flow;

		if (entry.title === undefined) entry.title = null;
		if (entry.place === undefined) entry.place = null;
		if (entry.lat === undefined) entry.lat = null;
		if (entry.lon === undefined) entry.lon = null;
		if (entry.distance === undefined) entry.distance = null;
		if (entry.durationSeconds === undefined) entry.durationSeconds = null;
		if (entry.elevationGain === undefined) entry.elevationGain = null;
	});

	// Drop clean entries so the next sync re-pulls them from the server, which
	// is canonical and already migrated. Dirty entries are kept and pushed.
	const dirtyIds = await tx.table('entries')
		.filter((e: { dirty: boolean }) => e.dirty === true)
		.primaryKeys();
	const allIds = await tx.table('entries').toCollection().primaryKeys();
	const toDelete = (allIds as string[]).filter((id: string) => !(dirtyIds as string[]).includes(id));
	await tx.table('entries').bulkDelete(toDelete);

	await tx.table('syncSettings').delete('lastSyncedAt');
});

export { db };

db.on('ready', () => {
	console.log(`[ww-journal] IndexedDB open, version ${db.verno}`);
});

export async function seedTagCategories() {
	const count = await db.tagCategories.count();
	if (count > 0) return;

	const now = new Date().toISOString();
	const defaults: TagCategory[] = [
		{ id: crypto.randomUUID(), name: 'People', icon: '👤', values: [], createdAt: now, updatedAt: now, deletedAt: null, dirty: true },
		{ id: crypto.randomUUID(), name: 'Boat', icon: '🚣', values: [], createdAt: now, updatedAt: now, deletedAt: null, dirty: true }
	];
	await db.tagCategories.bulkAdd(defaults);
	console.log('Seeded default tag categories');
}

export async function seedRivers() {
	const response = await fetch('/data/rivers.json');
	const rivers: River[] = await response.json();
	const now = new Date().toISOString();
	// bulkPut upserts by id — safe to run every time, updates altNames/gauges without touching user data
	const seeded = rivers.map((r) => ({ ...r, createdAt: now, updatedAt: now, deletedAt: null, dirty: false }));
	await db.rivers.bulkPut(seeded);
	console.log(`Seeded/refreshed ${rivers.length} rivers`);
}

export async function getLastSyncedAt(): Promise<string | null> {
	const row = await db.syncSettings.get('lastSyncedAt');
	return row?.value ?? null;
}

export async function setLastSyncedAt(iso: string) {
	await db.syncSettings.put({ key: 'lastSyncedAt', value: iso });
}

const FAVOURITES_KEY = 'favoriteActivities';

/**
 * Activities pinned to the top of the picker.
 *
 * Device-local: syncSettings is not part of the sync payload, so this does not
 * follow the user between devices. Moving it server-side would need a settings
 * table; until then a phone and a laptop each keep their own list.
 *
 * Returns null when the user has never chosen, so callers can fall back to
 * usage rather than to an arbitrary default.
 */
export async function getFavoriteActivities(): Promise<string[] | null> {
	const row = await db.syncSettings.get(FAVOURITES_KEY);
	if (!row?.value) return null;
	try {
		const parsed = JSON.parse(row.value);
		return Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export async function setFavoriteActivities(types: string[]) {
	await db.syncSettings.put({ key: FAVOURITES_KEY, value: JSON.stringify(types) });
}

/** Activity types the user has actually logged, most-used first. */
export async function activityUsage(): Promise<string[]> {
	const counts = new Map<string, number>();
	await db.entries.each((e) => {
		if (e.deletedAt) return;
		counts.set(e.activityType, (counts.get(e.activityType) ?? 0) + 1);
	});
	return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([type]) => type);
}
