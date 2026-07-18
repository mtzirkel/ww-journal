export interface River {
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
	createdAt?: string;
	updatedAt?: string;
	deletedAt?: string | null;
	dirty?: boolean;
}

/**
 * Activity types. Kept deliberately short — a type only earns its own entry
 * when its `details` shape differs. Variation within a type (kayak vs raft,
 * road vs gravel, alpine vs nordic) belongs in tags, not here.
 */
export type ActivityType =
	| 'paddle'
	| 'fish'
	| 'swim'
	| 'camp'
	| 'bike'
	| 'hike'
	| 'snow'
	| 'hunt';

/** River running. riverId drives USGS flow lookup and the per-river timeline. */
export interface PaddleDetails {
	riverId: number;
	flow: number | null;
	gaugeHeight?: number | null;
}

/** Fishing reuses the paddle shape, but river is optional (lakes). */
export interface FishDetails {
	riverId?: number | null;
	flow?: number | null;
	gaugeHeight?: number | null;
}

export interface SwimDetails {
	poolLengthM?: number | null;
	waterTempC?: number | null;
	openWater?: boolean;
}

export interface CampDetails {
	nights?: number | null;
}

/** bike / hike / snow / hunt need nothing type-specific — the envelope covers them. */
export type EmptyDetails = Record<string, never>;

export type EntryDetails =
	| PaddleDetails
	| FishDetails
	| SwimDetails
	| CampDetails
	| EmptyDetails;

/**
 * Common envelope + typed details.
 *
 * Cross-sport metrics (distance, duration, elevationGain) live on the envelope
 * so aggregates like "miles this year across everything" don't have to reach
 * into per-sport shapes. Only genuinely sport-specific data goes in `details`.
 */
export interface JournalEntry {
	id: string;
	datetime: string;
	activityType: ActivityType;
	title: string | null;
	description: string;
	tripId: string | null;
	tags: EntryTag[];

	/** Free-text location for non-river activities. Rivers carry their own coords. */
	place: string | null;
	lat: number | null;
	lon: number | null;

	/** Cross-sport metrics. Null where not applicable or not recorded. */
	distance: number | null;
	durationSeconds: number | null;
	elevationGain: number | null;

	details: EntryDetails;

	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
	dirty: boolean;
}

export interface EntryTag {
	category: string;
	value: string;
}

export interface TagCategory {
	id: string;
	name: string;
	icon: string;
	values: string[];
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
	dirty: boolean;
}

export interface Trip {
	id: string;
	name: string;
	description: string;
	startDate: string | null;
	endDate: string | null;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
	dirty: boolean;
}

export interface SyncSetting {
	key: string;
	value: string;
}
