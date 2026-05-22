/**
 * Server-side river data access and USGS gauge fetching.
 *
 * River lookup strategy:
 *   1. Query Postgres (populated via client sync).
 *   2. Fall back to rivers.json static seed (works in dev before any sync).
 */

import { sql } from './sql.js';
import { migrate } from './migrate.js';
import type { SyncRiver, SyncEntry } from './sync.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GaugeReading {
	dateTime: string; // ISO string
	value: number; // CFS
}

export interface GaugeData {
	id: string; // gauge ID (e.g. USGS site number)
	source: string; // 'usgs', 'codwr', etc.
	siteName: string | null; // human-readable name from USGS API
	gaugeLat: number | null;
	gaugeLon: number | null;
	currentFlow: number | null; // most recent reading, CFS
	recentReadings: GaugeReading[]; // last 7 days of instantaneous values
	unit: string; // 'CFS'
	gaugeMin: number | null; // runnable minimum from river record
	gaugeMax: number | null; // runnable maximum from river record
}

export interface RiverDetailData {
	river: SyncRiver;
	entries: SyncEntry[];
	gauge: GaugeData | null;
	location: { lat: number; lon: number } | null;
}

// ---------------------------------------------------------------------------
// River lookup
// ---------------------------------------------------------------------------

/**
 * Look up a river by integer ID.
 * First checks Postgres; falls back to the static rivers.json seed.
 * Returns null if the river doesn't exist in either source.
 */
export async function getRiverById(id: number): Promise<SyncRiver | null> {
	await migrate();

	// 1. Try Postgres
	const rows = await sql<
		Array<{
			id: number;
			river_name: string;
			section: string | null;
			state: string;
			aw_id: string | null;
			class_rating: string | null;
			aw_gauge_id: number | null;
			external_gauge_source: string | null;
			external_gauge_id: string | null;
			gauge_min: string | null;
			gauge_max: string | null;
			lat: string | null;
			lon: string | null;
			alt_name: string | null;
			abstract: string | null;
			created_at: Date;
			updated_at: Date;
			deleted_at: Date | null;
		}>
	>`SELECT * FROM rivers WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`;

	if (rows.length > 0) {
		return rowToRiver(rows[0]);
	}

	// 2. Fall back to rivers.json
	try {
		const { readFileSync } = await import('fs');
		const { resolve } = await import('path');
		// rivers.json lives at static/data/rivers.json relative to project root
		const filePath = resolve('static/data/rivers.json');
		const raw: RawRiverJson[] = JSON.parse(readFileSync(filePath, 'utf-8'));
		const match = raw.find((r) => r.id === id);
		if (match) {
			const now = new Date().toISOString();
			return {
				id: match.id,
				riverName: match.riverName,
				section: match.section ?? null,
				state: match.state,
				awId: match.awId ?? null,
				classRating: match.classRating ?? null,
				awGaugeId: match.awGaugeId ?? null,
				externalGaugeSource: match.externalGaugeSource ?? null,
				externalGaugeId: match.externalGaugeId ?? null,
				gaugeMin: match.gaugeMin ?? null,
				gaugeMax: match.gaugeMax ?? null,
				lat: match.lat ?? null,
				lon: match.lon ?? null,
				altName: match.altName ?? null,
				abstract: match.abstract ?? null,
				createdAt: now,
				updatedAt: now,
				deletedAt: null
			};
		}
	} catch {
		// rivers.json not accessible — only Postgres available
	}

	return null;
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
		createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
		updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
		deletedAt: r.deleted_at instanceof Date ? r.deleted_at.toISOString() : (r.deleted_at ?? null)
	};
}

// ---------------------------------------------------------------------------
// Journal entries for a river
// ---------------------------------------------------------------------------

/**
 * Load all non-deleted journal entries for a user on a specific river,
 * sorted newest first.
 */
export async function getRiverEntriesForUser(
	userId: string,
	riverId: number
): Promise<SyncEntry[]> {
	await migrate();

	const rows = await sql<
		Array<{
			id: string;
			river_id: number;
			trip_id: string | null;
			date: Date | string;
			datetime: Date | null;
			flow: string | number;
			description: string;
			tags: Array<{ category: string; value: string }>;
			created_at: Date;
			updated_at: Date;
			deleted_at: Date | null;
		}>
	>`
		SELECT id, river_id, trip_id, date, datetime, flow, description, tags,
		       created_at, updated_at, deleted_at
		FROM entries
		WHERE user_id = ${userId}
		  AND river_id = ${riverId}
		  AND deleted_at IS NULL
		ORDER BY datetime DESC NULLS LAST, date DESC
	`;

	return rows.map((r) => {
		const dateStr =
			typeof r.date === 'string' ? r.date : (r.date as Date).toISOString().slice(0, 10);
		return {
			id: r.id,
			riverId: r.river_id,
			tripId: r.trip_id,
			date: dateStr,
			datetime: r.datetime
				? r.datetime instanceof Date
					? r.datetime.toISOString()
					: (r.datetime as string)
				: dateStr + 'T12:00:00.000Z',
			flow: Number(r.flow),
			description: r.description,
			tags: r.tags ?? [],
			createdAt: (r.created_at as Date).toISOString(),
			updatedAt: (r.updated_at as Date).toISOString(),
			deletedAt: r.deleted_at ? (r.deleted_at as Date).toISOString() : null
		};
	});
}

// ---------------------------------------------------------------------------
// USGS gauge data
// ---------------------------------------------------------------------------

/**
 * Fetch 7 days of instantaneous flow data and site metadata from the USGS
 * Water Services API.  Returns null if the gauge ID is missing or the
 * request fails.
 *
 * Only supports `externalGaugeSource === 'usgs'` for now.
 */
export async function fetchGaugeData(
	source: string,
	gaugeId: string,
	gaugeMin: number | null,
	gaugeMax: number | null
): Promise<GaugeData | null> {
	if (source !== 'usgs' || !gaugeId) return null;

	try {
		const [ivData, siteData] = await Promise.allSettled([
			fetchUsgsIv(gaugeId),
			fetchUsgsSiteInfo(gaugeId)
		]);

		const readings: GaugeReading[] =
			ivData.status === 'fulfilled' ? ivData.value : [];
		const siteInfo =
			siteData.status === 'fulfilled'
				? siteData.value
				: { siteName: null, lat: null, lon: null };

		const currentFlow = readings.length > 0 ? readings[readings.length - 1].value : null;

		return {
			id: gaugeId,
			source,
			siteName: siteInfo.siteName,
			gaugeLat: siteInfo.lat,
			gaugeLon: siteInfo.lon,
			currentFlow,
			recentReadings: readings,
			unit: 'CFS',
			gaugeMin,
			gaugeMax
		};
	} catch {
		return null;
	}
}

/**
 * Fetch 7 days of instantaneous discharge (parameter 00060) for a USGS gauge.
 * Returns readings sorted oldest → newest (for charting).
 */
async function fetchUsgsIv(siteId: string): Promise<GaugeReading[]> {
	const url =
		`https://waterservices.usgs.gov/nwis/iv/?format=json` +
		`&sites=${encodeURIComponent(siteId)}` +
		`&period=P7D` +
		`&parameterCd=00060` +
		`&siteStatus=all`;

	const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
	if (!resp.ok) return [];

	const data = await resp.json();
	const timeSeries = data?.value?.timeSeries;
	if (!Array.isArray(timeSeries) || timeSeries.length === 0) return [];

	const values: Array<{ dateTime: string; value: string; qualifiers: string[] }> =
		timeSeries[0]?.values?.[0]?.value ?? [];

	return values
		.map((v) => ({ dateTime: v.dateTime, value: parseFloat(v.value) }))
		.filter((v) => !isNaN(v.value) && v.value >= 0);
}

/**
 * Fetch site name and coordinates for a USGS gauge site.
 * Uses the instantaneous values endpoint — its sourceInfo block contains
 * site name and coordinates, and we're already calling it from fetchUsgsIv.
 * To avoid a second round-trip, we call it again here with a minimal period.
 */
async function fetchUsgsSiteInfo(
	siteId: string
): Promise<{ siteName: string | null; lat: number | null; lon: number | null }> {
	// Re-use the IV endpoint with a 1-day period — smallest valid window.
	// The response's sourceInfo block carries site name and geolocation.
	const url =
		`https://waterservices.usgs.gov/nwis/iv/?format=json` +
		`&sites=${encodeURIComponent(siteId)}` +
		`&period=P1D` +
		`&parameterCd=00060` +
		`&siteStatus=all`;

	const resp = await fetch(url, { signal: AbortSignal.timeout(8_000) });
	if (!resp.ok) return { siteName: null, lat: null, lon: null };

	const data = await resp.json();
	const sourceInfo = data?.value?.timeSeries?.[0]?.sourceInfo;
	if (!sourceInfo) return { siteName: null, lat: null, lon: null };

	return {
		siteName: (sourceInfo.siteName as string | undefined) ?? null,
		lat: (sourceInfo.geoLocation?.geogLocation?.latitude as number | undefined) ?? null,
		lon: (sourceInfo.geoLocation?.geogLocation?.longitude as number | undefined) ?? null
	};
}

// ---------------------------------------------------------------------------
// Internal: rivers.json shape (matches the seed file structure)
// ---------------------------------------------------------------------------

interface RawRiverJson {
	id: number;
	riverName: string;
	section?: string | null;
	state: string;
	awId?: string | null;
	classRating?: string | null;
	awGaugeId?: number | null;
	externalGaugeSource?: string | null;
	externalGaugeId?: string | null;
	gaugeMin?: number | null;
	gaugeMax?: number | null;
	lat?: number | null;
	lon?: number | null;
	altName?: string | null;
	abstract?: string | null;
}
