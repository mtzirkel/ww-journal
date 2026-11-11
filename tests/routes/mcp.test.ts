/**
 * /mcp route + discovery metadata. Auth and the journal data layer are mocked;
 * the real MCP SDK server/transport runs, so this covers JSON-RPC wiring,
 * the 401 discovery contract, scope enforcement and user scoping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: { DEV_BYPASS_AUTH: 'false', AUTH_URL: 'http://localhost:5173', AUTH_APP_SLUG: 'ww-journal' }
}));

vi.mock('$lib/server/auth.js', () => ({
	verifyAccessToken: vi.fn(),
	mcpResourceUrl: (o: string) => `${o}/mcp`
}));

vi.mock('$lib/server/journal.js', () => ({
	ACTIVITY_TYPES: ['paddle', 'fish', 'swim', 'camp', 'bike', 'hike', 'snow', 'hunt'],
	findRivers: vi.fn().mockResolvedValue([{ id: 2002, river: 'Skykomish' }]),
	listEntries: vi.fn().mockResolvedValue([]),
	getEntry: vi.fn().mockResolvedValue(null),
	createEntry: vi.fn().mockResolvedValue({ entry: { id: 'e1' }, flowSource: 'usgs' }),
	updateEntry: vi.fn(),
	listTrips: vi.fn().mockResolvedValue([]),
	createTrip: vi.fn(),
	listTagCategories: vi.fn().mockResolvedValue([]),
	getRiverConditions: vi.fn().mockResolvedValue(null)
}));

import { POST, OPTIONS } from '../../src/routes/mcp/+server.js';
import { GET as PRM } from '../../src/routes/.well-known/oauth-protected-resource/[...rest]/+server.js';
import { verifyAccessToken } from '$lib/server/auth.js';
import { createEntry, findRivers } from '$lib/server/journal.js';

const ORIGIN = 'https://ww-journal.example.com';

function rpc(body: unknown, token?: string) {
	const request = new Request(`${ORIGIN}/mcp`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
			'mcp-protocol-version': '2025-06-18',
			...(token ? { authorization: `Bearer ${token}` } : {})
		},
		body: JSON.stringify(body)
	});
	return POST({ request, url: new URL(request.url) } as never);
}

const call = (name: string, args: Record<string, unknown>) => ({
	jsonrpc: '2.0',
	id: 1,
	method: 'tools/call',
	params: { name, arguments: args }
});

function principal(scopes: string[], userId = 'user-1') {
	vi.mocked(verifyAccessToken).mockResolvedValue({ userId, username: 'alice', clientId: 'nec_x', scopes });
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('POST /mcp auth', () => {
	it('401 with WWW-Authenticate resource_metadata when no token', async () => {
		const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
		expect(res.status).toBe(401);
		expect(res.headers.get('www-authenticate')).toBe(
			`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`
		);
	});
	it('401 invalid_token when the token does not verify', async () => {
		vi.mocked(verifyAccessToken).mockResolvedValue(null);
		const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'bad');
		expect(res.status).toBe(401);
		expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"');
		expect(verifyAccessToken).toHaveBeenCalledWith('bad', `${ORIGIN}/mcp`);
	});
	it('OPTIONS answers CORS preflight', async () => {
		const res = await OPTIONS({} as never);
		expect(res.status).toBe(204);
		expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
	});
});

describe('MCP tools', () => {
	it('lists the journal tools', async () => {
		principal(['read']);
		const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 't');
		expect(res.status).toBe(200);
		const names = (await res.json()).result.tools.map((t: { name: string }) => t.name);
		expect(names).toEqual(
			expect.arrayContaining(['find_river', 'list_entries', 'create_entry', 'update_entry', 'create_trip', 'get_river_conditions'])
		);
	});

	it('read tools work with a read token', async () => {
		principal(['read']);
		const body = await (await rpc(call('find_river', { query: 'sky' }), 't')).json();
		expect(body.result.isError).toBeFalsy();
		expect(findRivers).toHaveBeenCalledWith('sky', 10);
	});

	it('write tools are refused without the write scope', async () => {
		principal(['read']);
		const body = await (await rpc(call('create_entry', { date: '2026-11-09', river_id: 2002 }), 't')).json();
		expect(body.result.isError).toBe(true);
		expect(body.result.content[0].text).toContain('"write" scope');
		expect(createEntry).not.toHaveBeenCalled();
	});

	it('create_entry writes as the token subject', async () => {
		principal(['read', 'write'], 'user-42');
		const body = await (await rpc(call('create_entry', { date: '2026-11-09', river_id: 2002, description: 'Sky at 2k' }), 't')).json();
		expect(body.result.isError).toBeFalsy();
		expect(createEntry).toHaveBeenCalledWith('user-42', expect.objectContaining({ activityType: 'paddle', riverId: 2002, date: '2026-11-09' }));
	});

	it('rejects malformed arguments', async () => {
		principal(['read', 'write']);
		const body = await (await rpc(call('create_entry', { date: 'yesterday' }), 't')).json();
		expect(body.result?.isError ?? !!body.error).toBe(true);
		expect(createEntry).not.toHaveBeenCalled();
	});

	it('surfaces data-layer errors as tool errors', async () => {
		principal(['read', 'write']);
		vi.mocked(createEntry).mockRejectedValueOnce(new Error('River 9 not found — use find_river'));
		const body = await (await rpc(call('create_entry', { date: '2026-11-09', river_id: 9 }), 't')).json();
		expect(body.result.isError).toBe(true);
		expect(body.result.content[0].text).toContain('find_river');
	});
});

describe('GET /.well-known/oauth-protected-resource', () => {
	for (const rest of ['', 'mcp']) {
		it(`serves metadata at /${rest}`, async () => {
			const res = await PRM({ url: new URL(`${ORIGIN}/.well-known/oauth-protected-resource/${rest}`), params: { rest } } as never);
			const m = await res.json();
			expect(m.resource).toBe(`${ORIGIN}/mcp`);
			expect(m.authorization_servers).toEqual(['http://localhost:5173']);
			expect(m.scopes_supported).toEqual(['read', 'write']);
		});
	}
	it('404s other suffixes', async () => {
		const res = await PRM({ url: new URL(`${ORIGIN}/x`), params: { rest: 'other' } } as never);
		expect(res.status).toBe(404);
	});
});

describe('GET /.well-known/oauth-authorization-server (compat shim)', () => {
	it('relays the auth server metadata', async () => {
		const { GET } = await import('../../src/routes/.well-known/oauth-authorization-server/+server.js');
		const meta = { issuer: 'http://localhost:5173', token_endpoint: 'http://localhost:5173/oauth/token' };
		const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(meta)));
		const res = await GET({ fetch } as never);
		expect(fetch).toHaveBeenCalledWith('http://localhost:5173/.well-known/oauth-authorization-server');
		expect(await res.json()).toEqual(meta);
	});
});
