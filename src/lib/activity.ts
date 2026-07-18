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
