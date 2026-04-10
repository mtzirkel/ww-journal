import Dexie, { type EntityTable } from 'dexie';
import type { River, JournalEntry } from '$lib/types.js';

const db = new Dexie('ww-journal') as Dexie & {
	rivers: EntityTable<River, 'id'>;
	entries: EntityTable<JournalEntry, 'id'>;
};

db.version(1).stores({
	rivers: 'id, riverName, state, externalGaugeId, [riverName+state]',
	entries: '++id, date, riverId, syncStatus'
});

export { db };

export async function seedRivers() {
	const count = await db.rivers.count();
	if (count > 0) return;

	const response = await fetch('/data/rivers.json');
	const rivers: River[] = await response.json();
	await db.rivers.bulkPut(rivers);
	console.log(`Seeded ${rivers.length} rivers`);
}

export async function seedEntries() {
	const count = await db.entries.count();
	if (count > 0) return;

	const response = await fetch('/data/entries.json');
	const rawEntries = await response.json();

	const now = new Date().toISOString();
	const entries: JournalEntry[] = rawEntries.map((e: { id: number; date: string; riverId: number; flow: number; description: string }) => ({
		id: e.id,
		date: e.date,
		riverId: e.riverId,
		flow: e.flow,
		description: e.description,
		createdAt: now,
		updatedAt: now,
		syncStatus: 'local' as const
	}));

	await db.entries.bulkPut(entries);
	console.log(`Seeded ${entries.length} entries`);
}
