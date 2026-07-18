import { sql } from './sql.js';
import { migrate } from './migrate.js';

export interface SyncRiver {
	id: number;
	riverName: string;
	section: string | null;
	state: string;
	awId: string | null;
	classRating: string | null;
	awGaugeId: number | null;
	externalGaugeSource: string | null;
	externalGaugeId: string | null;
	gaugeMin: number | null;
	gaugeMax: number | null;
	lat: number | null;
	lon: number | null;
	altName: string | null;
	abstract: string | null;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
}

export interface SyncEntry {
	id: string;
	activityType: string;
	tripId: string | null;
	date: string;
	datetime: string;
	title: string | null;
	description: string;
	place: string | null;
	lat: number | null;
	lon: number | null;
	distance: number | null;
	durationSeconds: number | null;
	elevationGain: number | null;
	/** Sport-specific payload. Paddle/fish carry riverId + flow here. */
	details: Record<string, unknown>;
	tags: Array<{ category: string; value: string }>;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
}

export interface SyncTrip {
	id: string;
	name: string;
	description: string;
	startDate: string | null;
	endDate: string | null;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
}

export interface SyncTagCategory {
	id: string;
	name: string;
	icon: string;
	values: string[];
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
}

export interface SyncPayload {
	rivers?: SyncRiver[];
	entries?: SyncEntry[];
	trips?: SyncTrip[];
	tagCategories?: SyncTagCategory[];
}

export interface SyncPullResponse extends SyncPayload {
	serverTime: string;
}

/**
 * Pull all records updated since a given timestamp for a user.
 * Includes soft-deleted records so the client can mirror deletions.
 */
export async function pullChanges(userId: string, since: string | null): Promise<SyncPullResponse> {
	await migrate();
	const sinceDate = since ? new Date(since) : new Date(0);

	// Rivers are shared — pull all rivers updated since `since`,
	// regardless of who created them
	const rivers = await sql`
		SELECT * FROM rivers WHERE updated_at > ${sinceDate}
	`;

	const entries = await sql`
		SELECT * FROM entries
		WHERE user_id = ${userId} AND updated_at > ${sinceDate}
	`;

	const trips = await sql`
		SELECT * FROM trips
		WHERE user_id = ${userId} AND updated_at > ${sinceDate}
	`;

	const tagCategories = await sql`
		SELECT * FROM tag_categories
		WHERE user_id = ${userId} AND updated_at > ${sinceDate}
	`;

	return {
		rivers: rivers.map(rowToRiver),
		entries: entries.map(rowToEntry),
		trips: trips.map(rowToTrip),
		tagCategories: tagCategories.map(rowToTagCategory),
		serverTime: new Date().toISOString()
	};
}

/**
 * Push dirty records from the client. Last-write-wins by updated_at.
 * Returns the server timestamps the records were stored at.
 */
export async function pushChanges(userId: string, payload: SyncPayload): Promise<{ serverTime: string }> {
	await migrate();

	if (payload.rivers) {
		for (const r of payload.rivers) {
			await sql`
				INSERT INTO rivers (
					id, river_name, section, state, aw_id, class_rating, aw_gauge_id,
					external_gauge_source, external_gauge_id, gauge_min, gauge_max,
					lat, lon, alt_name, abstract, created_by_user_id,
					created_at, updated_at, deleted_at
				) VALUES (
					${r.id}, ${r.riverName}, ${r.section}, ${r.state}, ${r.awId},
					${r.classRating}, ${r.awGaugeId}, ${r.externalGaugeSource},
					${r.externalGaugeId}, ${r.gaugeMin}, ${r.gaugeMax}, ${r.lat}, ${r.lon},
					${r.altName}, ${r.abstract}, ${userId},
					${new Date(r.createdAt)}, ${new Date(r.updatedAt)},
					${r.deletedAt ? new Date(r.deletedAt) : null}
				)
				ON CONFLICT (id) DO UPDATE SET
					river_name = EXCLUDED.river_name,
					section = EXCLUDED.section,
					state = EXCLUDED.state,
					aw_id = EXCLUDED.aw_id,
					class_rating = EXCLUDED.class_rating,
					aw_gauge_id = EXCLUDED.aw_gauge_id,
					external_gauge_source = EXCLUDED.external_gauge_source,
					external_gauge_id = EXCLUDED.external_gauge_id,
					gauge_min = EXCLUDED.gauge_min,
					gauge_max = EXCLUDED.gauge_max,
					lat = EXCLUDED.lat,
					lon = EXCLUDED.lon,
					alt_name = EXCLUDED.alt_name,
					abstract = EXCLUDED.abstract,
					updated_at = EXCLUDED.updated_at,
					deleted_at = EXCLUDED.deleted_at
				WHERE rivers.updated_at < EXCLUDED.updated_at
			`;
		}
	}

	if (payload.entries) {
		for (const e of payload.entries) {
			// riverId/flow land in their own columns; everything else stays in the
			// details blob, so the two never disagree about the same value.
			const { riverId, flow, ...restDetails } = (e.details ?? {}) as {
				riverId?: number | null;
				flow?: number | null;
			};

			await sql`
				INSERT INTO entries (
					id, user_id, activity_type, river_id, trip_id, date, datetime, flow,
					title, description, place, lat, lon, distance, duration_seconds,
					elevation_gain, details, tags, created_at, updated_at, deleted_at
				) VALUES (
					${e.id}, ${userId}, ${e.activityType ?? 'paddle'}, ${riverId ?? null}, ${e.tripId},
					${e.datetime.slice(0, 10)}, ${new Date(e.datetime)}, ${flow ?? null},
					${e.title ?? null}, ${e.description}, ${e.place ?? null},
					${e.lat ?? null}, ${e.lon ?? null}, ${e.distance ?? null},
					${e.durationSeconds ?? null}, ${e.elevationGain ?? null},
					${sql.json(restDetails)}, ${sql.json(e.tags)},
					${new Date(e.createdAt)}, ${new Date(e.updatedAt)},
					${e.deletedAt ? new Date(e.deletedAt) : null}
				)
				ON CONFLICT (id) DO UPDATE SET
					activity_type = EXCLUDED.activity_type,
					river_id = EXCLUDED.river_id,
					trip_id = EXCLUDED.trip_id,
					date = EXCLUDED.date,
					datetime = EXCLUDED.datetime,
					flow = EXCLUDED.flow,
					title = EXCLUDED.title,
					description = EXCLUDED.description,
					place = EXCLUDED.place,
					lat = EXCLUDED.lat,
					lon = EXCLUDED.lon,
					distance = EXCLUDED.distance,
					duration_seconds = EXCLUDED.duration_seconds,
					elevation_gain = EXCLUDED.elevation_gain,
					details = EXCLUDED.details,
					tags = EXCLUDED.tags,
					updated_at = EXCLUDED.updated_at,
					deleted_at = EXCLUDED.deleted_at
				WHERE entries.updated_at < EXCLUDED.updated_at
				  AND entries.user_id = ${userId}
			`;
		}
	}

	if (payload.trips) {
		for (const t of payload.trips) {
			await sql`
				INSERT INTO trips (
					id, user_id, name, description, start_date, end_date,
					created_at, updated_at, deleted_at
				) VALUES (
					${t.id}, ${userId}, ${t.name}, ${t.description},
					${t.startDate}, ${t.endDate},
					${new Date(t.createdAt)}, ${new Date(t.updatedAt)},
					${t.deletedAt ? new Date(t.deletedAt) : null}
				)
				ON CONFLICT (id) DO UPDATE SET
					name = EXCLUDED.name,
					description = EXCLUDED.description,
					start_date = EXCLUDED.start_date,
					end_date = EXCLUDED.end_date,
					updated_at = EXCLUDED.updated_at,
					deleted_at = EXCLUDED.deleted_at
				WHERE trips.updated_at < EXCLUDED.updated_at
				  AND trips.user_id = ${userId}
			`;
		}
	}

	if (payload.tagCategories) {
		for (const c of payload.tagCategories) {
			await sql`
				INSERT INTO tag_categories (
					id, user_id, name, icon, values,
					created_at, updated_at, deleted_at
				) VALUES (
					${c.id}, ${userId}, ${c.name}, ${c.icon}, ${sql.json(c.values)},
					${new Date(c.createdAt)}, ${new Date(c.updatedAt)},
					${c.deletedAt ? new Date(c.deletedAt) : null}
				)
				ON CONFLICT (id) DO UPDATE SET
					name = EXCLUDED.name,
					icon = EXCLUDED.icon,
					values = EXCLUDED.values,
					updated_at = EXCLUDED.updated_at,
					deleted_at = EXCLUDED.deleted_at
				WHERE tag_categories.updated_at < EXCLUDED.updated_at
				  AND tag_categories.user_id = ${userId}
			`;
		}
	}

	return { serverTime: new Date().toISOString() };
}

export async function getSyncStatus(userId: string) {
	await migrate();
	const [{ count: entryCount }] = await sql<[{ count: number }]>`
		SELECT count(*)::int FROM entries WHERE user_id = ${userId} AND deleted_at IS NULL
	`;
	const [{ count: tripCount }] = await sql<[{ count: number }]>`
		SELECT count(*)::int FROM trips WHERE user_id = ${userId} AND deleted_at IS NULL
	`;
	const [latest] = await sql<[{ updated_at: Date | null }]>`
		SELECT max(updated_at) as updated_at FROM entries WHERE user_id = ${userId}
	`;
	return {
		entryCount,
		tripCount,
		serverTime: new Date().toISOString(),
		lastActivity: latest?.updated_at?.toISOString() ?? null
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToRiver(r: any): SyncRiver {
	return {
		id: r.id,
		riverName: r.river_name,
		section: r.section,
		state: r.state,
		awId: r.aw_id,
		classRating: r.class_rating,
		awGaugeId: r.aw_gauge_id,
		externalGaugeSource: r.external_gauge_source,
		externalGaugeId: r.external_gauge_id,
		gaugeMin: r.gauge_min !== null ? Number(r.gauge_min) : null,
		gaugeMax: r.gauge_max !== null ? Number(r.gauge_max) : null,
		lat: r.lat !== null ? Number(r.lat) : null,
		lon: r.lon !== null ? Number(r.lon) : null,
		altName: r.alt_name,
		abstract: r.abstract,
		createdAt: r.created_at.toISOString(),
		updatedAt: r.updated_at.toISOString(),
		deletedAt: r.deleted_at?.toISOString() ?? null
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToEntry(r: any): SyncEntry {
	const dateStr = typeof r.date === 'string' ? r.date : r.date.toISOString().slice(0, 10);
	// river_id/flow live as relational columns but travel to the client nested
	// under details, so non-river activities carry no river fields at all.
	const details: Record<string, unknown> = { ...(r.details ?? {}) };
	if (r.river_id !== null && r.river_id !== undefined) details.riverId = r.river_id;
	if (r.flow !== null && r.flow !== undefined) details.flow = Number(r.flow);

	return {
		id: r.id,
		activityType: r.activity_type ?? 'paddle',
		tripId: r.trip_id,
		date: dateStr,
		datetime: r.datetime ? (r.datetime instanceof Date ? r.datetime.toISOString() : r.datetime) : dateStr + 'T12:00:00.000Z',
		title: r.title ?? null,
		description: r.description,
		place: r.place ?? null,
		lat: r.lat === null || r.lat === undefined ? null : Number(r.lat),
		lon: r.lon === null || r.lon === undefined ? null : Number(r.lon),
		distance: r.distance === null || r.distance === undefined ? null : Number(r.distance),
		durationSeconds: r.duration_seconds ?? null,
		elevationGain:
			r.elevation_gain === null || r.elevation_gain === undefined ? null : Number(r.elevation_gain),
		details,
		tags: r.tags ?? [],
		createdAt: r.created_at.toISOString(),
		updatedAt: r.updated_at.toISOString(),
		deletedAt: r.deleted_at?.toISOString() ?? null
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTrip(r: any): SyncTrip {
	return {
		id: r.id,
		name: r.name,
		description: r.description,
		startDate: r.start_date ? (typeof r.start_date === 'string' ? r.start_date : r.start_date.toISOString().slice(0, 10)) : null,
		endDate: r.end_date ? (typeof r.end_date === 'string' ? r.end_date : r.end_date.toISOString().slice(0, 10)) : null,
		createdAt: r.created_at.toISOString(),
		updatedAt: r.updated_at.toISOString(),
		deletedAt: r.deleted_at?.toISOString() ?? null
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTagCategory(r: any): SyncTagCategory {
	return {
		id: r.id,
		name: r.name,
		icon: r.icon,
		values: r.values ?? [],
		createdAt: r.created_at.toISOString(),
		updatedAt: r.updated_at.toISOString(),
		deletedAt: r.deleted_at?.toISOString() ?? null
	};
}
