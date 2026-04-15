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

export interface JournalEntry {
	id: string;
	date: string;
	riverId: number;
	flow: number;
	description: string;
	tripId: string | null;
	tags: EntryTag[];
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
