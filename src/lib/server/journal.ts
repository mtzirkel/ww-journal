/**
 * Journal operations for non-PWA clients (the MCP server).
 *
 * Writes go through `pushChanges` — the exact code path the PWA sync uses — so
 * user isolation and last-write-wins semantics stay identical, and the PWA
 * picks MCP-created entries up on its next pull with no client changes.
 */
import { sql } from './sql.js';
import { migrate } from './migrate.js';
import { pullChanges, pushChanges, rowToEntry, type SyncEntry, type SyncTrip } from './sync.js';
import { getRiverById, fetchGaugeData } from './rivers.js';
import { fetchUsgsFlow } from '$lib/api/usgs.js';

export const ACTIVITY_TYPES = ['paddle', 'fish', 'swim', 'camp', 'bike', 'hike', 'snow', 'hunt'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export const RIVER_ACTIVITIES: ActivityType[] = ['paddle', 'fish'];

export interface RiverHit {
	id: number;
	river: string;
	section: string | null;
	state: string;
	classRating: string | null;
	altName: string | null;
	gauge: { source: string; id: string; min: number | null; max: number | null } | null;
	awId: string | null;
}

/** Fuzzy-ish river lookup: every word must appear in name/section/alt name/state. */
export async function findRivers(query: string, limit = 10): Promise<RiverHit[]> {
	await migrate();
	const words = query
		.toLowerCase()
		.split(/[^a-z0-9.]+/i)
		.filter((w) => w.length > 0)
		.slice(0, 6);
	if (words.length === 0) return [];
	const hay = sql`lower(coalesce(river_name,'') || ' ' || coalesce(section,'') || ' ' || coalesce(alt_name,'') || ' ' || coalesce(state,''))`;
	const conds = words.map((w) => sql`${hay} LIKE ${'%' + w.replace(/[%_\\]/g, '\\$&') + '%'}`);
	const where = conds.reduce((acc, c) => sql`${acc} AND ${c}`);
	const rows = await sql`
		SELECT id, river_name, section, state, class_rating, alt_name, aw_id,
			external_gauge_source, external_gauge_id, gauge_min, gauge_max
		FROM rivers
		WHERE deleted_at IS NULL AND ${where}
		ORDER BY (lower(river_name) LIKE ${words[0] + '%'}) DESC, river_name, section
		LIMIT ${Math.min(Math.max(limit, 1), 50)}
	`;
	return rows.map((r) => ({
		id: r.id,
		river: r.river_name,
		section: r.section,
		state: r.state,
		classRating: r.class_rating,
		altName: r.alt_name,
		awId: r.aw_id,
		gauge:
			r.external_gauge_source && r.external_gauge_id
				? {
						source: r.external_gauge_source,
						id: r.external_gauge_id,
						min: r.gauge_min === null ? null : Number(r.gauge_min),
						max: r.gauge_max === null ? null : Number(r.gauge_max)
					}
				: null
	}));
}

export interface EntryFilters {
	from?: string;
	to?: string;
	riverId?: number;
	activityType?: string;
	tripId?: string;
	limit?: number;
}

export async function listEntries(userId: string, f: EntryFilters = {}): Promise<SyncEntry[]> {
	await migrate();
	const limit = Math.min(Math.max(f.limit ?? 20, 1), 200);
	const conds = [sql`user_id = ${userId}`, sql`deleted_at IS NULL`];
	if (f.from) conds.push(sql`date >= ${f.from}`);
	if (f.to) conds.push(sql`date <= ${f.to}`);
	if (f.riverId !== undefined) conds.push(sql`river_id = ${f.riverId}`);
	if (f.activityType) conds.push(sql`activity_type = ${f.activityType}`);
	if (f.tripId) conds.push(sql`trip_id = ${f.tripId}`);
	const where = conds.reduce((acc, c) => sql`${acc} AND ${c}`);
	const rows = await sql`SELECT * FROM entries WHERE ${where} ORDER BY date DESC, datetime DESC NULLS LAST LIMIT ${limit}`;
	return rows.map(rowToEntry);
}

export async function getEntry(userId: string, id: string): Promise<SyncEntry | null> {
	if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
	await migrate();
	const rows = await sql`SELECT * FROM entries WHERE id = ${id} AND user_id = ${userId} AND deleted_at IS NULL`;
	return rows.length ? rowToEntry(rows[0]) : null;
}

export interface NewEntry {
	activityType: ActivityType;
	date: string; // YYYY-MM-DD
	time?: string; // HH:MM (local, optional)
	riverId?: number;
	flow?: number;
	title?: string;
	description?: string;
	place?: string;
	tripId?: string;
	tags?: Array<{ category: string; value: string }>;
	distance?: number;
	durationMinutes?: number;
	details?: Record<string, unknown>;
}

export interface CreateResult {
	entry: SyncEntry;
	flowSource: 'provided' | 'usgs' | 'none';
}

function assertDate(d: string) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(Date.parse(d))) throw new Error(`Invalid date "${d}" (want YYYY-MM-DD)`);
}

export async function createEntry(userId: string, input: NewEntry): Promise<CreateResult> {
	assertDate(input.date);
	if (!ACTIVITY_TYPES.includes(input.activityType)) throw new Error(`Unknown activity type ${input.activityType}`);
	if (input.tripId && !(await getTrip(userId, input.tripId))) throw new Error('Trip not found');

	let flow = input.flow;
	let flowSource: CreateResult['flowSource'] = flow !== undefined ? 'provided' : 'none';
	const place = input.place ?? null;
	let lat: number | null = null;
	let lon: number | null = null;

	if (input.riverId !== undefined) {
		if (!RIVER_ACTIVITIES.includes(input.activityType)) {
			throw new Error(`riverId only applies to ${RIVER_ACTIVITIES.join('/')} entries`);
		}
		const river = await getRiverById(input.riverId);
		if (!river) throw new Error(`River ${input.riverId} not found — use find_river`);
		lat = river.lat;
		lon = river.lon;
		if (flow === undefined && river.externalGaugeSource === 'usgs' && river.externalGaugeId) {
			const f = await fetchUsgsFlow(river.externalGaugeId, input.date);
			if (f !== null) {
				flow = f;
				flowSource = 'usgs';
			}
		}
	}

	const now = new Date().toISOString();
	const time = input.time && /^\d{2}:\d{2}$/.test(input.time) ? input.time : '12:00';
	const details: SyncEntry['details'] = { ...(input.details ?? {}) };
	if (input.riverId !== undefined) details.riverId = input.riverId;
	if (flow !== undefined) details.flow = flow;

	const entry: SyncEntry = {
		id: crypto.randomUUID(),
		activityType: input.activityType,
		tripId: input.tripId ?? null,
		date: input.date,
		datetime: new Date(`${input.date}T${time}:00`).toISOString(),
		title: input.title ?? null,
		description: input.description ?? '',
		place,
		lat,
		lon,
		distance: input.distance ?? null,
		durationSeconds: input.durationMinutes !== undefined ? Math.round(input.durationMinutes * 60) : null,
		elevationGain: null,
		details,
		tags: input.tags ?? [],
		createdAt: now,
		updatedAt: now,
		deletedAt: null
	};
	await pushChanges(userId, { entries: [entry] });
	const saved = await getEntry(userId, entry.id);
	if (!saved) throw new Error('Entry was not saved');
	return { entry: saved, flowSource };
}

export type EntryPatch = Partial<Omit<NewEntry, 'activityType'>> & { deleted?: boolean };

export async function updateEntry(userId: string, id: string, patch: EntryPatch): Promise<SyncEntry> {
	const existing = await getEntry(userId, id);
	if (!existing) throw new Error('Entry not found');
	const next: SyncEntry = { ...existing, details: { ...existing.details }, updatedAt: new Date().toISOString() };

	if (patch.date !== undefined) {
		assertDate(patch.date);
		const time = existing.datetime.slice(11, 16) || '12:00';
		next.date = patch.date;
		next.datetime = new Date(`${patch.date}T${patch.time ?? time}:00`).toISOString();
	} else if (patch.time !== undefined) {
		next.datetime = new Date(`${existing.date}T${patch.time}:00`).toISOString();
	}
	if (patch.riverId !== undefined) {
		if (!(await getRiverById(patch.riverId))) throw new Error(`River ${patch.riverId} not found`);
		next.details.riverId = patch.riverId;
	}
	if (patch.flow !== undefined) next.details.flow = patch.flow;
	if (patch.title !== undefined) next.title = patch.title;
	if (patch.description !== undefined) next.description = patch.description;
	if (patch.place !== undefined) next.place = patch.place;
	if (patch.tripId !== undefined) {
		if (patch.tripId && !(await getTrip(userId, patch.tripId))) throw new Error('Trip not found');
		next.tripId = patch.tripId || null;
	}
	if (patch.tags !== undefined) next.tags = patch.tags;
	if (patch.distance !== undefined) next.distance = patch.distance;
	if (patch.durationMinutes !== undefined) next.durationSeconds = Math.round(patch.durationMinutes * 60);
	if (patch.details !== undefined) next.details = { ...next.details, ...patch.details };
	if (patch.deleted) next.deletedAt = next.updatedAt;

	await pushChanges(userId, { entries: [next] });
	if (patch.deleted) return next;
	const saved = await getEntry(userId, id);
	if (!saved) throw new Error('Entry was not saved');
	return saved;
}

export async function listTrips(userId: string): Promise<SyncTrip[]> {
	const { trips = [] } = await pullChanges(userId, null);
	return trips
		.filter((t) => !t.deletedAt)
		.sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''));
}

async function getTrip(userId: string, id: string): Promise<SyncTrip | null> {
	return (await listTrips(userId)).find((t) => t.id === id) ?? null;
}

export async function createTrip(
	userId: string,
	t: { name: string; description?: string; startDate?: string; endDate?: string }
): Promise<SyncTrip> {
	if (t.startDate) assertDate(t.startDate);
	if (t.endDate) assertDate(t.endDate);
	const now = new Date().toISOString();
	const trip: SyncTrip = {
		id: crypto.randomUUID(),
		name: t.name,
		description: t.description ?? '',
		startDate: t.startDate ?? null,
		endDate: t.endDate ?? null,
		createdAt: now,
		updatedAt: now,
		deletedAt: null
	};
	await pushChanges(userId, { trips: [trip] });
	return trip;
}

export async function listTagCategories(userId: string) {
	const { tagCategories = [] } = await pullChanges(userId, null);
	return tagCategories.filter((c) => !c.deletedAt).map((c) => ({ name: c.name, values: c.values }));
}

export async function getRiverConditions(riverId: number) {
	const river = await getRiverById(riverId);
	if (!river) return null;
	const gauge =
		river.externalGaugeSource && river.externalGaugeId
			? await fetchGaugeData(river.externalGaugeSource, river.externalGaugeId, river.gaugeMin, river.gaugeMax)
			: null;
	return {
		river: {
			id: river.id,
			name: river.riverName,
			section: river.section,
			state: river.state,
			classRating: river.classRating,
			awId: river.awId,
			awUrl: river.awId ? `https://www.americanwhitewater.org/content/River/view/river-detail/${river.awId}/main` : null
		},
		gauge: gauge
			? {
					source: river.externalGaugeSource,
					id: river.externalGaugeId,
					siteName: gauge.siteName,
					currentFlow: gauge.currentFlow,
					runnableMin: gauge.gaugeMin,
					runnableMax: gauge.gaugeMax,
					last24h: gauge.recentReadings.slice(-96).filter((_, i, a) => i % 8 === 0 || i === a.length - 1)
				}
			: river.externalGaugeSource
				? { source: river.externalGaugeSource, id: river.externalGaugeId, note: 'Live data only supported for USGS gauges so far' }
				: null
	};
}
