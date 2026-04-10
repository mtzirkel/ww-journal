/**
 * Unit tests for src/lib/api/usgs.ts — USGS Water Services fetch
 *
 * Strategy: mock the global fetch so these tests never hit the network.
 * We test the parsing logic (correct value selection, midday preference)
 * and all the error paths (bad response, empty data, NaN, negative values).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchUsgsFlow } from '$lib/api/usgs.js';

// Helper: build a minimal USGS IV API response with the given time-series values
function makeUsgsResponse(values: Array<{ dateTime: string; value: string }>) {
	return {
		value: {
			timeSeries: [
				{
					values: [{ value: values }]
				}
			]
		}
	};
}

beforeEach(() => {
	// Replace global fetch with a vitest mock before each test
	vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
	vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Happy path — correct value is returned
// ---------------------------------------------------------------------------

describe('fetchUsgsFlow — successful responses', () => {
	it('returns the flow value for a single reading', async () => {
		// Requirement: basic case — one reading available, return its flow value
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: async () => makeUsgsResponse([{ dateTime: '2024-06-01T12:00:00', value: '450' }])
		} as Response);

		const flow = await fetchUsgsFlow('01234567', '2024-06-01');
		expect(flow).toBe(450);
	});

	it('selects the reading closest to noon (12:00)', async () => {
		// Requirement: USGS returns readings every 15 minutes; we want the midday
		// reading to represent a "typical" daily flow, not a midnight low
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: async () =>
				makeUsgsResponse([
					{ dateTime: '2024-06-01T06:00:00', value: '300' },
					{ dateTime: '2024-06-01T11:45:00', value: '425' }, // closest to noon
					{ dateTime: '2024-06-01T18:00:00', value: '380' }
				])
		} as Response);

		const flow = await fetchUsgsFlow('01234567', '2024-06-01');
		expect(flow).toBe(425);
	});

	it('handles integer-like flow values', async () => {
		// Requirement: flow values from USGS can be integers or decimals;
		// parseFloat must handle both correctly
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: async () => makeUsgsResponse([{ dateTime: '2024-06-01T12:00:00', value: '1200' }])
		} as Response);

		const flow = await fetchUsgsFlow('01234567', '2024-06-01');
		expect(flow).toBe(1200);
	});

	it('builds the URL with the correct gauge ID and date range', async () => {
		// Requirement: the gauge ID and date must appear in the USGS API URL so the
		// right gauge data is fetched for the right day
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: async () => makeUsgsResponse([{ dateTime: '2024-06-01T12:00:00', value: '500' }])
		} as Response);

		await fetchUsgsFlow('09366500', '2024-06-15');

		expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
		const url = vi.mocked(fetch).mock.calls[0][0] as string;
		expect(url).toContain('09366500');
		expect(url).toContain('startDT=2024-06-15');
		expect(url).toContain('endDT=2024-06-15');
		expect(url).toContain('parameterCd=00060'); // CFS flow parameter code
	});
});

// ---------------------------------------------------------------------------
// Error and edge cases — requirement: must return null, never throw
// ---------------------------------------------------------------------------

describe('fetchUsgsFlow — error handling', () => {
	it('returns null when fetch returns a non-OK HTTP status', async () => {
		// Requirement: a 404 or 500 from USGS must not crash the app — return null
		vi.mocked(fetch).mockResolvedValue({
			ok: false,
			status: 404
		} as Response);

		const flow = await fetchUsgsFlow('bad-gauge', '2024-06-01');
		expect(flow).toBeNull();
	});

	it('returns null when fetch throws a network error', async () => {
		// Requirement: offline or DNS failure must not surface as an exception to callers
		vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

		const flow = await fetchUsgsFlow('01234567', '2024-06-01');
		expect(flow).toBeNull();
	});

	it('returns null when timeSeries is empty', async () => {
		// Requirement: gauge exists but has no data for the requested date
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: async () => ({ value: { timeSeries: [] } })
		} as Response);

		const flow = await fetchUsgsFlow('01234567', '2024-06-01');
		expect(flow).toBeNull();
	});

	it('returns null when values array is empty', async () => {
		// Requirement: USGS returns a gauge entry but no actual readings for the date
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: async () => ({
				value: {
					timeSeries: [{ values: [{ value: [] }] }]
				}
			})
		} as Response);

		const flow = await fetchUsgsFlow('01234567', '2024-06-01');
		expect(flow).toBeNull();
	});

	it('returns null when response JSON is completely malformed', async () => {
		// Requirement: garbage API response must not cause an unhandled exception
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: async () => ({ unexpected: 'shape' })
		} as Response);

		const flow = await fetchUsgsFlow('01234567', '2024-06-01');
		expect(flow).toBeNull();
	});

	it('returns null when flow value is the string "Ice"', async () => {
		// Requirement: USGS returns non-numeric codes like "Ice" during winter; these
		// are not valid flow values and must be treated as null
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: async () =>
				makeUsgsResponse([{ dateTime: '2024-01-15T12:00:00', value: 'Ice' }])
		} as Response);

		const flow = await fetchUsgsFlow('01234567', '2024-01-15');
		expect(flow).toBeNull();
	});

	it('returns null when flow value is negative (sensor error)', async () => {
		// Requirement: negative CFS values indicate sensor malfunction; treat as null
		// so journal entries don't show impossible flow readings
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: async () =>
				makeUsgsResponse([{ dateTime: '2024-06-01T12:00:00', value: '-999' }])
		} as Response);

		const flow = await fetchUsgsFlow('01234567', '2024-06-01');
		expect(flow).toBeNull();
	});
});
