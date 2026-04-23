/**
 * Tests for src/routes/api/sync/push/+server.ts — POST /api/sync/push
 *
 * Strategy: import the POST handler and call it directly with a minimal
 * RequestEvent-like object. We mock $lib/server/sync.js so no Postgres
 * connection is needed. This validates the HTTP wrapper layer: the auth
 * gate, JSON parsing, and response shape — not the DB logic itself.
 *
 * SvelteKit's error() helper throws a Response-like object, so unauthorized
 * and bad-JSON cases are caught the same way hooks.test.ts catches redirect().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the server sync module — we want to test the HTTP layer, not the DB
vi.mock('$lib/server/sync.js', () => ({
	pushChanges: vi.fn()
}));

import { POST } from '../../src/routes/api/sync/push/+server.js';
import { pushChanges } from '$lib/server/sync.js';

// ---------------------------------------------------------------------------
// Helper: build a minimal SvelteKit RequestEvent for the push endpoint
// ---------------------------------------------------------------------------

function makeEvent(overrides: {
	user?: { id: string; username: string } | null;
	body?: unknown;
	bodyThrows?: boolean;
} = {}): Parameters<typeof POST>[0] {
	const { user = null, body = {}, bodyThrows = false } = overrides;

	return {
		request: {
			json: bodyThrows
				? () => Promise.reject(new SyntaxError('Unexpected token'))
				: () => Promise.resolve(body)
		},
		locals: { user },
		url: new URL('http://localhost/api/sync/push'),
		params: {},
		route: { id: '/api/sync/push' }
	} as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Auth gate
// ---------------------------------------------------------------------------

describe('POST /api/sync/push — auth gate', () => {
	it('returns 401 when locals.user is null', async () => {
		// Requirement: unauthenticated requests must be rejected before any DB
		// work happens — never process a push from an unknown user
		const event = makeEvent({ user: null });

		let thrown: unknown;
		try {
			await POST(event);
		} catch (e) {
			thrown = e;
		}

		// SvelteKit error() throws a Response-like object with a status field
		expect(thrown).toBeDefined();
		const status = (thrown as { status?: number }).status;
		expect(status).toBe(401);

		// Crucially: pushChanges must never be called for unauthorized requests
		expect(vi.mocked(pushChanges)).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Invalid JSON body
// ---------------------------------------------------------------------------

describe('POST /api/sync/push — invalid JSON', () => {
	it('returns 400 when the request body is not valid JSON', async () => {
		// Requirement: a malformed body (e.g. from a buggy client) must return
		// 400 Bad Request, not a 500 crash that exposes internals
		const event = makeEvent({
			user: { id: 'user-1', username: 'travis' },
			bodyThrows: true
		});

		let thrown: unknown;
		try {
			await POST(event);
		} catch (e) {
			thrown = e;
		}

		expect(thrown).toBeDefined();
		const status = (thrown as { status?: number }).status;
		expect(status).toBe(400);

		expect(vi.mocked(pushChanges)).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('POST /api/sync/push — authorized with valid payload', () => {
	it('calls pushChanges with userId and payload, returns JSON with serverTime', async () => {
		// Requirement: a valid authenticated push must (1) forward the userId and
		// payload to pushChanges, and (2) return a JSON body containing serverTime
		// so the client can update its local high-water mark
		const mockResult = { serverTime: '2026-04-22T10:00:00.000Z' };
		vi.mocked(pushChanges).mockResolvedValueOnce(mockResult);

		const payload = {
			entries: [
				{
					id: 'entry-1',
					riverId: 42,
					tripId: null,
					date: '2026-04-20',
					datetime: '2026-04-20T12:00:00.000Z',
					flow: 850,
					description: 'Great run',
					tags: [],
					createdAt: '2026-04-20T12:00:00.000Z',
					updatedAt: '2026-04-20T12:00:00.000Z',
					deletedAt: null
				}
			]
		};

		const event = makeEvent({
			user: { id: 'user-1', username: 'travis' },
			body: payload
		});

		const response = await POST(event);

		// pushChanges must be called with the authenticated user's ID and the full payload
		expect(vi.mocked(pushChanges)).toHaveBeenCalledWith('user-1', payload);

		// Response must be a 200 JSON with serverTime
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data).toHaveProperty('serverTime');
		expect(data.serverTime).toBe('2026-04-22T10:00:00.000Z');
	});

	it('works with an empty payload (no arrays provided)', async () => {
		// Requirement: a client with nothing to push can still call the endpoint
		// (e.g. just to get a serverTime heartbeat); empty payload must not crash
		const mockResult = { serverTime: '2026-04-22T10:00:00.000Z' };
		vi.mocked(pushChanges).mockResolvedValueOnce(mockResult);

		const event = makeEvent({
			user: { id: 'user-2', username: 'river-rat' },
			body: {}
		});

		const response = await POST(event);

		expect(vi.mocked(pushChanges)).toHaveBeenCalledWith('user-2', {});
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data).toHaveProperty('serverTime');
	});
});
