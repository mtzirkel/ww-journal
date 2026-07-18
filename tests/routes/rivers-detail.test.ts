/**
 * Tests for src/routes/rivers/[id]/+page.server.ts
 *
 * Strategy: mock $lib/server/rivers.js so no Postgres/USGS calls happen.
 * Validate the HTTP layer: auth gate, ID parsing, 404 for unknown rivers,
 * successful load shape, and correct downstream data passed to the page.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the rivers server module — no DB or USGS calls
vi.mock('$lib/server/rivers.js', () => ({
	getRiverById: vi.fn(),
	getRiverEntriesForUser: vi.fn(),
	fetchGaugeData: vi.fn()
}));

import { load } from '../../src/routes/rivers/[id]/+page.server.js';
import {
	getRiverById,
	getRiverEntriesForUser,
	fetchGaugeData
} from '$lib/server/rivers.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_RIVER = {
	id: 1487,
	riverName: 'Animas',
	section: '04. Tacoma to Rockwood Rail Yard (Rockwood Box)',
	state: 'CO',
	awId: '347',
	classRating: 'IV-V',
	awGaugeId: 36667,
	externalGaugeSource: 'usgs',
	externalGaugeId: '09359500',
	gaugeMin: 300,
	gaugeMax: 3000,
	lat: 37.524448,
	lon: -107.782299,
	altName: 'Rockwood Box',
	abstract: 'Rockwood Box / Upper Animas River near Durango, Colorado',
	createdAt: '2024-01-01T00:00:00.000Z',
	updatedAt: '2024-01-01T00:00:00.000Z',
	deletedAt: null
};

const MOCK_ENTRIES = [
	{
		id: 'entry-uuid-1',
		riverId: 1487,
		tripId: null,
		date: '2024-06-15',
		datetime: '2024-06-15T12:00:00.000Z',
		flow: 850,
		description: 'Great run in high water',
		tags: [],
		createdAt: '2024-06-15T13:00:00.000Z',
		updatedAt: '2024-06-15T13:00:00.000Z',
		deletedAt: null
	}
];

const MOCK_GAUGE = {
	id: '09359500',
	source: 'usgs',
	siteName: 'Animas River near Durango CO',
	gaugeLat: 37.53,
	gaugeLon: -107.78,
	currentFlow: 842,
	recentReadings: [{ dateTime: '2024-06-15T12:00:00.000Z', value: 842 }],
	unit: 'CFS',
	gaugeMin: 300,
	gaugeMax: 3000
};

// ---------------------------------------------------------------------------
// Helper: build a minimal RequestEvent for the load function
// ---------------------------------------------------------------------------

function makeEvent(opts: {
	user?: { id: string; username: string } | null | undefined;
	id?: string;
}) {
	const { user = null, id = '1487' } = opts;
	return {
		params: { id },
		locals: { user }
	} as unknown as Parameters<typeof load>[0];
}

beforeEach(() => {
	vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// Auth gate
// ---------------------------------------------------------------------------

describe('GET /rivers/[id] — auth gate', () => {
	it('returns 401 when user is not authenticated', async () => {
		const event = makeEvent({ user: null });

		let thrown: unknown;
		try {
			await load(event);
		} catch (e) {
			thrown = e;
		}

		expect(thrown).toBeDefined();
		expect((thrown as { status?: number }).status).toBe(401);
		expect(vi.mocked(getRiverById)).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// ID validation
// ---------------------------------------------------------------------------

describe('GET /rivers/[id] — ID parsing', () => {
	it('returns 404 for non-numeric id', async () => {
		const event = makeEvent({ user: { id: 'user-1', username: 'test' }, id: 'not-a-number' });

		let thrown: unknown;
		try {
			await load(event);
		} catch (e) {
			thrown = e;
		}

		expect((thrown as { status?: number }).status).toBe(404);
		expect(vi.mocked(getRiverById)).not.toHaveBeenCalled();
	});

	it('returns 404 for float id', async () => {
		// parseInt('12.5') === 12 — a valid integer, so getRiverById is called.
		// The mock returns null → 404.
		vi.mocked(getRiverById).mockResolvedValueOnce(null);
		const event = makeEvent({ user: { id: 'user-1', username: 'test' }, id: '12.5' });
		let thrown: unknown;
		try {
			await load(event);
		} catch (e) {
			thrown = e;
		}
		expect((thrown as { status?: number }).status).toBe(404);
	});
});

// ---------------------------------------------------------------------------
// 404 for unknown river
// ---------------------------------------------------------------------------

describe('GET /rivers/[id] — unknown river', () => {
	it('returns 404 when river does not exist', async () => {
		vi.mocked(getRiverById).mockResolvedValueOnce(null);
		const event = makeEvent({ user: { id: 'user-1', username: 'test' }, id: '99999' });

		let thrown: unknown;
		try {
			await load(event);
		} catch (e) {
			thrown = e;
		}

		expect((thrown as { status?: number }).status).toBe(404);
		expect(vi.mocked(getRiverById)).toHaveBeenCalledWith(99999);
		expect(vi.mocked(getRiverEntriesForUser)).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Successful load
// ---------------------------------------------------------------------------

describe('GET /rivers/[id] — successful load', () => {
	it('returns structured data for a valid river with gauge', async () => {
		vi.mocked(getRiverById).mockResolvedValueOnce(MOCK_RIVER);
		vi.mocked(getRiverEntriesForUser).mockResolvedValueOnce(MOCK_ENTRIES);
		vi.mocked(fetchGaugeData).mockResolvedValueOnce(MOCK_GAUGE);

		const event = makeEvent({ user: { id: 'user-1', username: 'test' }, id: '1487' });
		const result = await load(event);

		expect(result.river).toEqual(MOCK_RIVER);
		expect(result.entries).toEqual(MOCK_ENTRIES);
		expect(result.gauge).toEqual(MOCK_GAUGE);
		expect(result.location).toEqual({ lat: 37.524448, lon: -107.782299 });

		expect(vi.mocked(getRiverById)).toHaveBeenCalledWith(1487);
		expect(vi.mocked(getRiverEntriesForUser)).toHaveBeenCalledWith('user-1', 1487);
		expect(vi.mocked(fetchGaugeData)).toHaveBeenCalledWith('usgs', '09359500', 300, 3000);
	});

	it('returns null gauge for river without gauge info', async () => {
		const riverNoGauge = { ...MOCK_RIVER, externalGaugeSource: null, externalGaugeId: null };
		vi.mocked(getRiverById).mockResolvedValueOnce(riverNoGauge);
		vi.mocked(getRiverEntriesForUser).mockResolvedValueOnce([]);

		const event = makeEvent({ user: { id: 'user-1', username: 'test' }, id: '1487' });
		const result = await load(event);

		expect(result.gauge).toBeNull();
		expect(vi.mocked(fetchGaugeData)).not.toHaveBeenCalled();
	});

	it('returns null location when river has no coordinates', async () => {
		const riverNoCoords = { ...MOCK_RIVER, lat: null, lon: null };
		vi.mocked(getRiverById).mockResolvedValueOnce(riverNoCoords);
		vi.mocked(getRiverEntriesForUser).mockResolvedValueOnce([]);
		vi.mocked(fetchGaugeData).mockResolvedValueOnce(null);

		const event = makeEvent({ user: { id: 'user-1', username: 'test' }, id: '1487' });
		const result = await load(event);

		expect(result.location).toBeNull();
	});

	it('returns empty entries array when user has no entries for this river', async () => {
		vi.mocked(getRiverById).mockResolvedValueOnce(MOCK_RIVER);
		vi.mocked(getRiverEntriesForUser).mockResolvedValueOnce([]);
		vi.mocked(fetchGaugeData).mockResolvedValueOnce(null);

		const event = makeEvent({ user: { id: 'user-1', username: 'test' }, id: '1487' });
		const result = await load(event);

		expect(result.entries).toEqual([]);
	});

	it('returns null gauge when gauge data fetch fails', async () => {
		vi.mocked(getRiverById).mockResolvedValueOnce(MOCK_RIVER);
		vi.mocked(getRiverEntriesForUser).mockResolvedValueOnce(MOCK_ENTRIES);
		vi.mocked(fetchGaugeData).mockResolvedValueOnce(null); // API returned null

		const event = makeEvent({ user: { id: 'user-1', username: 'test' }, id: '1487' });
		const result = await load(event);

		expect(result.gauge).toBeNull();
	});
});
