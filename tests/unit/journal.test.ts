/**
 * Business rules in src/lib/server/journal.ts (data layer mocked):
 * - river entries validate the river and auto-fill USGS flow
 * - riverId is refused for non-river activities
 * - writes go through pushChanges as the given user
 * - update only touches the caller's entries; delete is a soft delete
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('$lib/server/sql.js', () => ({ sql: Object.assign((...a: unknown[]) => sqlMock(...a), { json: (v: unknown) => v }) }));
vi.mock('$lib/server/migrate.js', () => ({ migrate: vi.fn() }));
vi.mock('$lib/server/sync.js', () => ({
	pullChanges: vi.fn().mockResolvedValue({ trips: [], entries: [], tagCategories: [] }),
	pushChanges: vi.fn().mockResolvedValue({ serverTime: '' }),
	rowToEntry: (r: unknown) => r
}));
vi.mock('$lib/server/rivers.js', () => ({
	getRiverById: vi.fn(),
	fetchGaugeData: vi.fn()
}));
vi.mock('$lib/api/usgs.js', () => ({ fetchUsgsFlow: vi.fn() }));

import { createEntry, updateEntry } from '$lib/server/journal.js';
import { pushChanges } from '$lib/server/sync.js';
import { getRiverById } from '$lib/server/rivers.js';
import { fetchUsgsFlow } from '$lib/api/usgs.js';

const SKY = { id: 2002, riverName: 'Skykomish', lat: 47.8, lon: -121.6, externalGaugeSource: 'usgs', externalGaugeId: '12134500' };

beforeEach(() => {
	vi.clearAllMocks();
	// getEntry → SELECT returns whatever was "saved"
	sqlMock.mockImplementation(async () => [{ id: 'saved', details: {} }]);
});

describe('createEntry', () => {
	it('auto-fills flow from USGS for a gauged river', async () => {
		vi.mocked(getRiverById).mockResolvedValue(SKY as never);
		vi.mocked(fetchUsgsFlow).mockResolvedValue(2120);
		const r = await createEntry('u1', { activityType: 'paddle', date: '2026-11-09', riverId: 2002 });
		expect(r.flowSource).toBe('usgs');
		expect(fetchUsgsFlow).toHaveBeenCalledWith('12134500', '2026-11-09');
		const pushed = vi.mocked(pushChanges).mock.calls[0];
		expect(pushed[0]).toBe('u1');
		const e = pushed[1].entries![0];
		expect(e.details).toEqual({ riverId: 2002, flow: 2120 });
		expect(e.lat).toBe(47.8);
		expect(e.id).toMatch(/^[0-9a-f-]{36}$/);
	});

	it('keeps a provided flow and does not call USGS', async () => {
		vi.mocked(getRiverById).mockResolvedValue(SKY as never);
		const r = await createEntry('u1', { activityType: 'paddle', date: '2026-11-09', riverId: 2002, flow: 1500 });
		expect(r.flowSource).toBe('provided');
		expect(fetchUsgsFlow).not.toHaveBeenCalled();
	});

	it('refuses an unknown river', async () => {
		vi.mocked(getRiverById).mockResolvedValue(null);
		await expect(createEntry('u1', { activityType: 'paddle', date: '2026-11-09', riverId: 9 })).rejects.toThrow(/find_river/);
		expect(pushChanges).not.toHaveBeenCalled();
	});

	it('refuses riverId on non-river activities', async () => {
		await expect(createEntry('u1', { activityType: 'hike', date: '2026-11-09', riverId: 2002 })).rejects.toThrow(/only applies/);
	});

	it('refuses bad dates', async () => {
		await expect(createEntry('u1', { activityType: 'hike', date: '11/9/2026' })).rejects.toThrow(/YYYY-MM-DD/);
	});
});

describe('updateEntry', () => {
	const existing = {
		id: '678cc47a-e4d1-4f81-9c02-111a76d6f00d',
		date: '2026-11-09',
		datetime: '2026-11-09T20:00:00.000Z',
		description: 'old',
		details: { riverId: 2002, flow: 1940 },
		updatedAt: '2026-01-01T00:00:00.000Z',
		deletedAt: null
	};

	it('only finds entries owned by the caller', async () => {
		sqlMock.mockResolvedValue([]);
		await expect(updateEntry('someone-else', existing.id, { description: 'x' })).rejects.toThrow('Entry not found');
		expect(pushChanges).not.toHaveBeenCalled();
	});

	it('patches given fields, bumps updatedAt, keeps the rest', async () => {
		sqlMock.mockResolvedValue([existing]);
		await updateEntry('u1', existing.id, { description: 'new', flow: 2000 });
		const e = vi.mocked(pushChanges).mock.calls[0][1].entries![0];
		expect(e.description).toBe('new');
		expect(e.details).toEqual({ riverId: 2002, flow: 2000 });
		expect(e.updatedAt > existing.updatedAt).toBe(true);
		expect(e.deletedAt).toBeNull();
	});

	it('delete is a soft delete', async () => {
		sqlMock.mockResolvedValue([existing]);
		await updateEntry('u1', existing.id, { deleted: true });
		expect(vi.mocked(pushChanges).mock.calls[0][1].entries![0].deletedAt).toBeTruthy();
	});
});
