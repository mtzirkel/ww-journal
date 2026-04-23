/**
 * Tests for src/routes/api/sync/pull/+server.ts — GET /api/sync/pull
 *
 * Strategy: import the GET handler and call it directly with a minimal
 * RequestEvent-like object. We mock $lib/server/sync.js so no Postgres
 * connection is needed. This validates the HTTP wrapper layer: the auth
 * gate, the `?since` query param handling, and response passthrough.
 *
 * Key behavior observed in the source:
 *   - url.searchParams.get('since') returns null when the param is absent —
 *     the endpoint passes that null directly to pullChanges(), so the test
 *     must assert pullChanges(userId, null) in that case.
 *   - When `?since=<ISO>` is present, the raw string is forwarded as-is;
 *     the parsing (new Date(since)) happens inside pullChanges(), not here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the server sync module — we want to test the HTTP layer, not the DB
vi.mock('$lib/server/sync.js', () => ({
	pullChanges: vi.fn()
}));

import { GET } from '../../src/routes/api/sync/pull/+server.js';
import { pullChanges } from '$lib/server/sync.js';
import type { SyncPullResponse } from '$lib/server/sync.js';

// ---------------------------------------------------------------------------
// Helper: build a minimal SvelteKit RequestEvent for the pull endpoint
// ---------------------------------------------------------------------------

function makeEvent(overrides: {
	user?: { id: string; username: string } | null;
	since?: string | null;
} = {}): Parameters<typeof GET>[0] {
	const { user = null, since = null } = overrides;

	const params = new URLSearchParams();
	if (since !== null) params.set('since', since);
	const url = new URL(`http://localhost/api/sync/pull?${params.toString()}`);

	return {
		url,
		locals: { user },
		request: new Request(url),
		params: {},
		route: { id: '/api/sync/pull' }
	} as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Auth gate
// ---------------------------------------------------------------------------

describe('GET /api/sync/pull — auth gate', () => {
	it('returns 401 when locals.user is null', async () => {
		// Requirement: unauthenticated clients must not be able to pull any data —
		// data belongs to authenticated users only
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

		// No DB work should happen for unauthorized requests
		expect(vi.mocked(pullChanges)).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// `since` param handling
// ---------------------------------------------------------------------------

describe('GET /api/sync/pull — since param', () => {
	it('calls pullChanges(userId, null) when no ?since param is present', async () => {
		// Requirement: a fresh client with no local data calls pull without a
		// timestamp; the endpoint must pass null so pullChanges returns everything
		// (sinceDate = new Date(0), i.e. epoch)
		const mockResult = {
			rivers: [],
			entries: [],
			trips: [],
			tagCategories: [],
			serverTime: '2026-04-22T10:00:00.000Z'
		};
		vi.mocked(pullChanges).mockResolvedValueOnce(mockResult);

		const event = makeEvent({
			user: { id: 'user-1', username: 'travis' },
			since: null // no param
		});

		const response = await GET(event);

		// The null must flow through — not defaulted to a string inside the handler
		expect(vi.mocked(pullChanges)).toHaveBeenCalledWith('user-1', null);
		expect(response.status).toBe(200);
	});

	it('calls pullChanges(userId, <ISO>) and returns its result when ?since is provided', async () => {
		// Requirement: an incremental sync passes the client's last-known
		// serverTime as ?since so only newer records come back; the raw ISO
		// string must be forwarded to pullChanges without modification
		const sinceTimestamp = '2026-04-01T00:00:00.000Z';
		const mockResult = {
			rivers: [{ id: 1, riverName: 'Gauley River', section: 'Upper', state: 'WV' }],
			entries: [],
			trips: [],
			tagCategories: [],
			serverTime: '2026-04-22T10:00:00.000Z'
		} as unknown as SyncPullResponse;
		vi.mocked(pullChanges).mockResolvedValueOnce(mockResult);

		const event = makeEvent({
			user: { id: 'user-1', username: 'travis' },
			since: sinceTimestamp
		});

		const response = await GET(event);

		// The ISO string must be passed exactly as received from the URL param
		expect(vi.mocked(pullChanges)).toHaveBeenCalledWith('user-1', sinceTimestamp);

		// The full result from pullChanges must be returned as JSON
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data).toMatchObject({
			rivers: mockResult.rivers,
			serverTime: mockResult.serverTime
		});
	});

	it('passes the correct userId, not a hardcoded value', async () => {
		// Requirement: the user's own ID from locals must be used — never a
		// different user's ID — to prevent cross-user data leakage
		const mockResult = {
			rivers: [],
			entries: [],
			trips: [],
			tagCategories: [],
			serverTime: '2026-04-22T10:00:00.000Z'
		};
		vi.mocked(pullChanges).mockResolvedValueOnce(mockResult);

		const event = makeEvent({ user: { id: 'different-user-99', username: 'someone-else' } });
		await GET(event);

		expect(vi.mocked(pullChanges)).toHaveBeenCalledWith('different-user-99', null);
	});
});
