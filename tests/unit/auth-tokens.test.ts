/**
 * Token verification in src/lib/server/auth.ts against a real local keypair.
 * - verifyAccessToken: OAuth access tokens for /mcp (aud, iss, typ, app slug)
 * - verifyAuthToken: browser session cookies must NOT accept access tokens
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet, type JWK } from 'jose';

const keys: { jwks?: ReturnType<typeof createLocalJWKSet> } = {};

vi.mock('jose', async () => {
	const actual = await vi.importActual<typeof import('jose')>('jose');
	return { ...actual, createRemoteJWKSet: () => (...args: unknown[]) => (keys.jwks as any)(...args) };
});

import { verifyAccessToken, verifyAuthToken, _clearVerdictCache } from '$lib/server/auth.js';

const ISS = 'http://localhost:5173';
const RES = 'https://ww-journal.example.com/mcp';
let priv: CryptoKey;

beforeAll(async () => {
	const pair = await generateKeyPair('EdDSA', { extractable: true });
	priv = pair.privateKey;
	const pub = (await exportJWK(pair.publicKey)) as JWK;
	keys.jwks = createLocalJWKSet({ keys: [{ ...pub, kid: 'noegos-auth-signing', alg: 'EdDSA', use: 'sig' }] });
});

async function sign(claims: Record<string, unknown>, opts: { typ?: string; aud?: string | null; iss?: string; exp?: string } = {}) {
	let j = new SignJWT(claims)
		.setProtectedHeader({ alg: 'EdDSA', kid: 'noegos-auth-signing', ...(opts.typ ? { typ: opts.typ } : {}) })
		.setIssuer(opts.iss ?? ISS)
		.setIssuedAt()
		.setExpirationTime(opts.exp ?? '1h')
		.setSubject('user-1');
	if (opts.aud !== null) j = j.setAudience(opts.aud ?? RES);
	return j.sign(priv);
}

const access = { username: 'alice', client_id: 'nec_x', scope: 'read write', apps: [{ slug: 'ww-journal', name: 'J', role: 'user' }] };

describe('verifyAccessToken', () => {
	it('accepts a valid access token and returns scopes', async () => {
		const p = await verifyAccessToken(await sign(access, { typ: 'at+jwt' }), RES);
		expect(p).toEqual({ userId: 'user-1', username: 'alice', clientId: 'nec_x', scopes: ['read', 'write'] });
	});
	it('rejects a token for another audience', async () => {
		expect(await verifyAccessToken(await sign(access, { typ: 'at+jwt', aud: 'https://coop.example.com/mcp' }), RES)).toBeNull();
	});
	it('rejects a session JWT (no typ/aud)', async () => {
		expect(await verifyAccessToken(await sign(access, { aud: null }), RES)).toBeNull();
	});
	it('rejects a wrong issuer', async () => {
		expect(await verifyAccessToken(await sign(access, { typ: 'at+jwt', iss: 'https://evil.example' }), RES)).toBeNull();
	});
	it('rejects when the user has no access to this app', async () => {
		expect(await verifyAccessToken(await sign({ ...access, apps: [{ slug: 'coop' }] }, { typ: 'at+jwt' }), RES)).toBeNull();
	});
	it('rejects expired tokens', async () => {
		expect(await verifyAccessToken(await sign(access, { typ: 'at+jwt', exp: '-1m' }), RES)).toBeNull();
	});
});

// Default: noegos-auth /api/verify unreachable → local check only (fail open).
const fetchMock = vi.fn();
beforeEach(() => {
	_clearVerdictCache();
	fetchMock.mockReset().mockRejectedValue(new Error('ECONNREFUSED'));
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function verifyResponse(status: number, body: unknown = {}) {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('verifyAuthToken (cookie)', () => {
	const session = { username: 'alice', admin: false, apps: [{ slug: 'ww-journal', name: 'J', role: 'user' }] };
	it('accepts a normal session token', async () => {
		expect((await verifyAuthToken(await sign(session, { aud: null })))?.id).toBe('user-1');
	});
	it('rejects an OAuth access token used as a cookie', async () => {
		expect(await verifyAuthToken(await sign({ ...session, scope: 'read' }, { typ: 'at+jwt' }))).toBeNull();
	});
});

describe('verifyAuthToken: server-side revocation via noegos-auth', () => {
	const session = { username: 'alice', admin: false, apps: [{ slug: 'ww-journal', name: 'J', role: 'user' }] };

	it('rejects a validly signed token whose session was revoked (401)', async () => {
		fetchMock.mockResolvedValue(verifyResponse(401, { authenticated: false }));
		expect(await verifyAuthToken(await sign(session, { aud: null }))).toBeNull();
	});

	it('sends the token to /api/verify as a bearer token', async () => {
		fetchMock.mockResolvedValue(verifyResponse(200, { authenticated: true, user: { isAdmin: false, apps: session.apps } }));
		const token = await sign(session, { aud: null });
		await verifyAuthToken(token);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('http://localhost:5173/api/verify');
		expect((init as RequestInit).headers).toEqual({ authorization: `Bearer ${token}` });
	});

	it('uses the auth server’s current app access, not the JWT’s', async () => {
		// JWT still lists ww-journal, but access was removed
		fetchMock.mockResolvedValue(verifyResponse(200, { authenticated: true, user: { isAdmin: false, apps: [] } }));
		expect(await verifyAuthToken(await sign(session, { aud: null }))).toBeNull();
	});

	it('uses the auth server’s current admin flag', async () => {
		const adminSession = { ...session, admin: true, apps: [] };
		fetchMock.mockResolvedValue(verifyResponse(200, { authenticated: true, user: { isAdmin: false, apps: [] } }));
		expect(await verifyAuthToken(await sign(adminSession, { aud: null }))).toBeNull();
	});

	it('accepts when the auth server confirms the session', async () => {
		fetchMock.mockResolvedValue(verifyResponse(200, { authenticated: true, user: { isAdmin: false, apps: session.apps } }));
		const u = await verifyAuthToken(await sign(session, { aud: null }));
		expect(u?.id).toBe('user-1');
		expect(u?.isAdmin).toBe(false);
	});

	it('falls back to the local check when the auth server errors (5xx)', async () => {
		fetchMock.mockResolvedValue(verifyResponse(502));
		expect((await verifyAuthToken(await sign(session, { aud: null })))?.id).toBe('user-1');
	});

	it('falls back to the local check when the auth server is unreachable', async () => {
		expect((await verifyAuthToken(await sign(session, { aud: null })))?.id).toBe('user-1');
	});

	it('caches the verdict per token so each request does not hit the auth server', async () => {
		fetchMock.mockResolvedValue(verifyResponse(200, { authenticated: true, user: { isAdmin: false, apps: session.apps } }));
		const token = await sign(session, { aud: null });
		await verifyAuthToken(token);
		await verifyAuthToken(token);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('caches revocations too', async () => {
		fetchMock.mockResolvedValue(verifyResponse(401));
		const token = await sign(session, { aud: null });
		expect(await verifyAuthToken(token)).toBeNull();
		expect(await verifyAuthToken(token)).toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('does not consult the auth server for tokens that fail local verification', async () => {
		expect(await verifyAuthToken(await sign(session, { aud: null, iss: 'https://evil.example' }))).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
