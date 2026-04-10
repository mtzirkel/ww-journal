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
}

export interface JournalEntry {
	id?: number;
	date: string;
	riverId: number;
	flow: number;
	description: string;
	createdAt: string;
	updatedAt: string;
	syncStatus: 'local' | 'synced' | 'pending';
}
