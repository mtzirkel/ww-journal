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
	const count = await db.rivers.count();
	if (count > 0) return;

	const response = await fetch('/data/rivers.json');
	const rivers: River[] = await response.json();
	const now = new Date().toISOString();
	const seeded = rivers.map((r) => ({ ...r, createdAt: now, updatedAt: now, deletedAt: null, dirty: false }));
	await db.rivers.bulkPut(seeded);
	console.log(`Seeded ${rivers.length} rivers`);
}

export async function seedEntries() {
	const count = await db.entries.count();
	if (count > 0) return;

	const response = await fetch('/data/entries.json');
	const rawEntries = await response.json();

	const now = new Date().toISOString();
	const entries: JournalEntry[] = rawEntries.map((e: { id: number; date: string; riverId: number; flow: number; description: string }) => ({
		id: crypto.randomUUID(),
		date: e.date,
		riverId: e.riverId,
		flow: e.flow,
		description: e.description,
		tripId: null,
		tags: [],
		createdAt: now,
		updatedAt: now,
		deletedAt: null,
		dirty: true
	}));

	await db.entries.bulkPut(entries);
	console.log(`Seeded ${entries.length} entries`);
}

export async function getLastSyncedAt(): Promise<string | null> {
	const row = await db.syncSettings.get('lastSyncedAt');
	return row?.value ?? null;
}

export async function setLastSyncedAt(iso: string) {
	await db.syncSettings.put({ key: 'lastSyncedAt', value: iso });
}
