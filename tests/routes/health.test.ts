/**
 * Route handler test for GET /api/health
 *
 * The health endpoint is intentionally simple and public — no auth, no DB.
 * Tests confirm the correct status code and JSON body shape.
 */

import { describe, it, expect } from 'vitest';
import { GET } from '../../src/routes/api/health/+server.js';

describe('GET /api/health', () => {
	it('returns HTTP 200', async () => {
		// Requirement: every route must return an expected status. Health endpoints
		// are monitored externally; a non-200 triggers alerts.
		const response = await GET({} as Parameters<typeof GET>[0]);
		expect(response.status).toBe(200);
	});

	it('returns JSON with status:"ok"', async () => {
		// Requirement: monitoring systems check for status:"ok" to distinguish
		// "server is running but degraded" from a healthy state
		const response = await GET({} as Parameters<typeof GET>[0]);
		const body = await response.json();
		expect(body.status).toBe('ok');
	});

	it('returns JSON with app:"ww-journal"', async () => {
		// Requirement: the app field identifies which service responded — useful
		// when multiple services share infrastructure or a load balancer
		const response = await GET({} as Parameters<typeof GET>[0]);
		const body = await response.json();
		expect(body.app).toBe('ww-journal');
	});

	it('response body contains exactly the expected keys', () => {
		// Requirement: health endpoint contract should not silently grow to expose
		// version strings, env vars, or internal state
		// (We call GET again to check the key set)
		const getAndCheck = async () => {
			const response = await GET({} as Parameters<typeof GET>[0]);
			const body = await response.json();
			const keys = Object.keys(body).sort();
			expect(keys).toEqual(['app', 'status']);
		};
		return getAndCheck();
	});
});
