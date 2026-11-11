/**
 * Token verification in src/lib/server/auth.ts against a real local keypair.
 * - verifyAccessToken: OAuth access tokens for /mcp (aud, iss, typ, app slug)
 * - verifyAuthToken: browser session cookies must NOT accept access tokens
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet, type JWK } from 'jose';

const keys: { jwks?: ReturnType<typeof createLocalJWKSet> } = {};

vi.mock('jose', async () => {
	const actual = await vi.importActual<typeof import('jose')>('jose');
	return { ...actual, createRemoteJWKSet: () => (...args: unknown[]) => (keys.jwks as any)(...args) };
});

import { verifyAccessToken, verifyAuthToken } from '$lib/server/auth.js';

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

describe('verifyAuthToken (cookie)', () => {
	const session = { username: 'alice', admin: false, apps: [{ slug: 'ww-journal', name: 'J', role: 'user' }] };
	it('accepts a normal session token', async () => {
		expect((await verifyAuthToken(await sign(session, { aud: null })))?.id).toBe('user-1');
	});
	it('rejects an OAuth access token used as a cookie', async () => {
		expect(await verifyAuthToken(await sign({ ...session, scope: 'read' }, { typ: 'at+jwt' }))).toBeNull();
	});
});
