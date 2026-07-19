import type {
	ActivityType,
	EntryDetails,
	FishDetails,
	JournalEntry,
	PaddleDetails
} from '$lib/types.js';

export interface ActivityMeta {
	type: ActivityType;
	label: string;
	icon: string;
	/** Activities that happen on a river, and so support gauge/flow lookup. */
	riverBased: boolean;
}

export const ACTIVITIES: ActivityMeta[] = [
	{ type: 'paddle', label: 'Paddle', icon: '🛶', riverBased: true },
	{ type: 'fish', label: 'Fish', icon: '🎣', riverBased: true },
	{ type: 'swim', label: 'Swim', icon: '🏊', riverBased: false },
	{ type: 'camp', label: 'Camp', icon: '⛺', riverBased: false },
	{ type: 'bike', label: 'Bike', icon: '🚲', riverBased: false },
	{ type: 'hike', label: 'Hike', icon: '🥾', riverBased: false },
	{ type: 'snow', label: 'Snow', icon: '🎿', riverBased: false },
	{ type: 'hunt', label: 'Hunt', icon: '🏔', riverBased: false }
];

const BY_TYPE = new Map(ACTIVITIES.map((a) => [a.type, a]));

export function activityMeta(type: ActivityType): ActivityMeta {
	return BY_TYPE.get(type) ?? ACTIVITIES[0];
}

export function isRiverBased(type: ActivityType): boolean {
	return activityMeta(type).riverBased;
}

function riverDetails(details: EntryDetails): PaddleDetails | FishDetails | null {
	if (!details || typeof details !== 'object') return null;
	if (!('riverId' in details) && !('flow' in details)) return null;
	return details as PaddleDetails | FishDetails;
}

/**
 * River id for river-based entries, or null. Use this instead of reaching into
 * `entry.details` directly — non-river activities have no riverId at all.
 */
export function riverIdOf(entry: JournalEntry): number | null {
	const d = riverDetails(entry.details);
	return typeof d?.riverId === 'number' ? d.riverId : null;
}

/** Flow (CFS) for river-based entries, or null. */
export function flowOf(entry: JournalEntry): number | null {
	const d = riverDetails(entry.details);
	return typeof d?.flow === 'number' ? d.flow : null;
}

export function gaugeHeightOf(entry: JournalEntry): number | null {
	const d = riverDetails(entry.details);
	return typeof d?.gaugeHeight === 'number' ? d.gaugeHeight : null;
}

/** True when this entry is attached to a river (paddle, or fishing a river). */
export function hasRiver(entry: JournalEntry): boolean {
	return riverIdOf(entry) !== null;
}

/**
 * River ids across a set of entries, skipping activities that have no river.
 * Use for counts and grouping so a hunt or bike day never lands in river stats.
 */
export function riverIds(entries: JournalEntry[]): number[] {
	return entries.map(riverIdOf).filter((id): id is number => id !== null);
}

/** Look up an entry's river in a map, or undefined for non-river activities. */
export function lookupRiver<T>(rivers: Map<number, T>, entry: JournalEntry): T | undefined {
	const rid = riverIdOf(entry);
	return rid === null ? undefined : rivers.get(rid);
}

/** Recorded flows across a set of entries, skipping entries without one. */
export function flows(entries: JournalEntry[]): number[] {
	return entries.map(flowOf).filter((f): f is number => f !== null);
}

// Metrics are stored in SI (metres, seconds) and shown in imperial.
const METRES_PER_MILE = 1609.344;
const METRES_PER_FOOT = 0.3048;

export const toMiles = (m: number) => m / METRES_PER_MILE;
export const fromMiles = (mi: number) => mi * METRES_PER_MILE;
export const toFeet = (m: number) => m / METRES_PER_FOOT;
export const fromFeet = (ft: number) => ft * METRES_PER_FOOT;

/** "1:45" / "20m" — compact duration for list rows. */
export function formatDuration(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.round((seconds % 3600) / 60);
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}` : `${m}m`;
}

/**
 * Short metric summary for an entry — flow for river days, distance and
 * elevation otherwise. Returns [] when nothing was recorded, so rows stay
 * clean rather than showing zeros.
 */
export function entryMetrics(entry: JournalEntry): string[] {
	const out: string[] = [];
	const flow = flowOf(entry);
	if (flow !== null) out.push(`${flow.toLocaleString()} cfs`);
	if (entry.distance !== null) out.push(`${toMiles(entry.distance).toFixed(1)} mi`);
	if (entry.elevationGain !== null) {
		out.push(`${Math.round(toFeet(entry.elevationGain)).toLocaleString()} ft`);
	}
	if (entry.durationSeconds !== null) out.push(formatDuration(entry.durationSeconds));
	return out;
}

/** Mean of an array, or null when empty — avoids NaN in the UI. */
export function mean(values: number[]): number | null {
	if (values.length === 0) return null;
	return values.reduce((sum, v) => sum + v, 0) / values.length;
}
