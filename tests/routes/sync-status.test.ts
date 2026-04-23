/**
 * Tests for src/routes/api/sync/status/+server.ts — GET /api/sync/status
 *
 * Strategy: import the GET handler and call it directly with a minimal
 * RequestEvent-like object. We mock $lib/server/sync.js so no Postgres
 * connection is needed. This validates the HTTP wrapper layer: the auth
 * gate, the getSyncStatus call, and the response shape.
 *
 * Shape returned by getSyncStatus (from reading the source):
 *   { entryCount: number, tripCount: number, serverTime: string, lastActivity: string | null }
 *
 * The endpoint returns this object verbatim via json(), so tests assert the
 * full shape arrives in the response.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the server sync module — we want to test the HTTP layer, not the DB
vi.mock('$lib/server/sync.js', () => ({
	getSyncStatus: vi.fn()
}));

import { GET } from '../../src/routes/api/sync/status/+server.js';
import { getSyncStatus } from '$lib/server/sync.js';

// ---------------------------------------------------------------------------
// Helper: build a minimal SvelteKit RequestEvent for the status endpoint
// ---------------------------------------------------------------------------

function makeEvent(overrides: {
	user?: { id: string; username: string } | null;
} = {}): Parameters<typeof GET>[0] {
	const { user = null } = overrides;

	return {
		url: new URL('http://localhost/api/sync/status'),
		locals: { user },
		request: new Request('http://localhost/api/sync/status'),
		params: {},
		route: { id: '/api/sync/status' }
	} as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Auth gate
// ---------------------------------------------------------------------------

describe('GET /api/sync/status — auth gate', () => {
	it('returns 401 when locals.user is null', async () => {
		// Requirement: sync status (entry count, trip count) is user-specific
		// data — unauthenticated clients must not be able to query it
		const event = makeEvent({ user: null });

		let thrown: unknown;
		try {
			await GET(event);
		} catch (e) {
			thrown = e;
		}

		expect(thrown).toBeDefined();
		const status = (thrown as { status?: number }).status;
		expect(status).toBe(401);

		// getSyncStatus must never be called for unauthorized requests
		expect(vi.mocked(getSyncStatus)).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Authorized — happy path
// ---------------------------------------------------------------------------

describe('GET /api/sync/status — authorized', () => {
	it('calls getSyncStatus with the authenticated userId', async () => {
		// Requirement: the status query must use the requesting user's ID so
		// counts reflect only that user's data, not all users' data
		const mockStatus = {
			entryCount: 42,
			tripCount: 7,
			serverTime: '2026-04-22T10:00:00.000Z',
			lastActivity: '2026-04-20T12:00:00.000Z'
		};
		vi.mocked(getSyncStatus).mockResolvedValueOnce(mockStatus);

		const event = makeEvent({ user: { id: 'user-1', username: 'travis' } });
		await GET(event);

		expect(vi.mocked(getSyncStatus)).toHaveBeenCalledWith('user-1');
	});

	it('returns JSON with entryCount, tripCount, serverTime, and lastActivity', async () => {
		// Requirement: the client uses all four fields to display sync health —
		// missing any field would break the client-side status display
		const mockStatus = {
			entryCount: 42,
			tripCount: 7,
			serverTime: '2026-04-22T10:00:00.000Z',
			lastActivity: '2026-04-20T12:00:00.000Z'
		};
		vi.mocked(getSyncStatus).mockResolvedValueOnce(mockStatus);

		const event = makeEvent({ user: { id: 'user-1', username: 'travis' } });
		const response = await GET(event);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data).toEqual({
			entryCount: 42,
			tripCount: 7,
			serverTime: '2026-04-22T10:00:00.000Z',
			lastActivity: '2026-04-20T12:00:00.000Z'
		});
	});

	it('returns null lastActivity when the user has no entries', async () => {
		// Requirement: a brand-new user with no data must get lastActivity: null,
		// not an error or undefined — the client must handle the null case
		const mockStatus = {
			entryCount: 0,
			tripCount: 0,
			serverTime: '2026-04-22T10:00:00.000Z',
			lastActivity: null
		};
		vi.mocked(getSyncStatus).mockResolvedValueOnce(mockStatus);

		const event = makeEvent({ user: { id: 'new-user', username: 'newcomer' } });
		const response = await GET(event);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.lastActivity).toBeNull();
		expect(data.entryCount).toBe(0);
	});
});
