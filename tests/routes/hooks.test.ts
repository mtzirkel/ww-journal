/**
 * Tests for src/hooks.server.ts — the authentication middleware
 *
 * Strategy: import the handle function and call it directly with mock event
 * objects. We test:
 *   1. Public paths bypass auth entirely
 *   2. DEV_BYPASS_AUTH=true sets a dev user and continues
 *   3. No cookie and no bypass → redirect to auth service
 *   4. Invalid/garbage cookie → redirect to auth service
 *
 * The $lib/server/auth.js module (which calls out to the noegos-auth JWKS
 * endpoint) is mocked so we can control verifyAuthToken's return value
 * without needing a running auth service.
 *
 * Note on IndexedDB / Dexie: the hooks.server.ts file does NOT use Dexie —
 * that's client-side only. Server-side auth is purely JWT-based.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { redirect } from '@sveltejs/kit';

// Mock the server-side auth module (verifyAuthToken calls remote JWKS)
vi.mock('$lib/server/auth.js', () => ({
	verifyAuthToken: vi.fn().mockResolvedValue(null)
}));

// Mock $env/dynamic/private — the handle function reads env.DEV_BYPASS_AUTH
// Default: bypass is OFF (normal auth required)
vi.mock('$env/dynamic/private', () => ({
	env: {
		DEV_BYPASS_AUTH: 'false',
		AUTH_URL: 'http://localhost:5173'
	}
}));

import { handle } from '../../src/hooks.server.js';
import { verifyAuthToken } from '$lib/server/auth.js';

// ---------------------------------------------------------------------------
// Helper: build a minimal SvelteKit Handle event
// ---------------------------------------------------------------------------

function makeEvent(overrides: {
	pathname?: string;
	cookieToken?: string | undefined;
} = {}): Parameters<typeof handle>[0]['event'] {
	return {
		url: new URL(`http://localhost${overrides.pathname ?? '/'}`),
		cookies: {
			get: (name: string) =>
				name === 'noegos_auth' ? overrides.cookieToken : undefined
		},
		locals: {},
		request: new Request('http://localhost/')
	} as unknown as Parameters<typeof handle>[0]['event'];
}

const mockResolve = vi.fn(async (event: unknown) =>
	new Response('page content', { status: 200 })
);

beforeEach(() => {
	vi.clearAllMocks();
	mockResolve.mockResolvedValue(new Response('page content', { status: 200 }));
});

// ---------------------------------------------------------------------------
// Public paths
// ---------------------------------------------------------------------------

describe('auth hook — public paths', () => {
	it('passes through /api/health without checking auth', async () => {
		// Requirement: /api/health must be accessible without authentication so
		// monitoring systems can check liveness without credentials
		const event = makeEvent({ pathname: '/api/health' });
		const response = await handle({ event, resolve: mockResolve });

		expect(response.status).toBe(200);
		expect(mockResolve).toHaveBeenCalledWith(event);
		// verifyAuthToken must not be called — no token lookup for public paths
		expect(vi.mocked(verifyAuthToken)).not.toHaveBeenCalled();
	});

	it('passes through /api/health/subpath', async () => {
		// Requirement: the PUBLIC_PATHS check uses startsWith, so sub-paths of
		// public routes also pass through (covers future /api/health/ready etc.)
		const event = makeEvent({ pathname: '/api/health/ready' });
		const response = await handle({ event, resolve: mockResolve });

		expect(response.status).toBe(200);
		expect(vi.mocked(verifyAuthToken)).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// DEV_BYPASS_AUTH
// ---------------------------------------------------------------------------

describe('auth hook — DEV_BYPASS_AUTH', () => {
	it('sets a dev user on locals and resolves when DEV_BYPASS_AUTH=true', async () => {
		// Requirement: developers must be able to run the app locally without
		// standing up the noegos-auth service. DEV_BYPASS_AUTH=true skips all
		// token verification and injects a hardcoded dev user.
		const envMod = await import('$env/dynamic/private');
		(envMod.env as Record<string, string>).DEV_BYPASS_AUTH = 'true';

		const event = makeEvent({ pathname: '/entries' });
		const response = await handle({ event, resolve: mockResolve });

		expect(response.status).toBe(200);
		expect(mockResolve).toHaveBeenCalled();

		// The dev user should be set on locals
		expect(event.locals.user).toBeTruthy();
		expect(event.locals.user!.username).toBe('dev');
		expect(event.locals.user!.isAdmin).toBe(true);

		// Restore
		(envMod.env as Record<string, string>).DEV_BYPASS_AUTH = 'false';
	});
});

// ---------------------------------------------------------------------------
// Unauthenticated requests — redirect to auth service
// ---------------------------------------------------------------------------

describe('auth hook — unauthenticated requests', () => {
	it('redirects to auth service when no cookie is present', async () => {
		// Requirement: unauthenticated visitors to any non-public URL must be sent
		// to the noegos-auth login page, not shown a 401 or blank page
		const event = makeEvent({ pathname: '/entries', cookieToken: undefined });

		let thrown: unknown;
		try {
			await handle({ event, resolve: mockResolve });
		} catch (e) {
			thrown = e;
		}

		// SvelteKit redirect() throws a Response-like object
		expect(thrown).toBeDefined();
		// Check that the redirect goes to the auth service login
		const location = (thrown as { location?: string; headers?: Headers }).location
			?? (thrown as Response).headers?.get('location')
			?? '';
		expect(location).toContain('localhost:5173/login');
		expect(location).toContain('return_to=');
	});

	it('redirects to auth service when the cookie token is invalid', async () => {
		// Requirement: a corrupted or expired cookie must trigger re-authentication,
		// not pass through with a null user (which would cause crashes downstream)
		vi.mocked(verifyAuthToken).mockResolvedValueOnce(null);

		const event = makeEvent({ pathname: '/rivers', cookieToken: 'bad-token' });

		let thrown: unknown;
		try {
			await handle({ event, resolve: mockResolve });
		} catch (e) {
			thrown = e;
		}

		expect(thrown).toBeDefined();
		const location = (thrown as { location?: string; headers?: Headers }).location
			?? (thrown as Response).headers?.get('location')
			?? '';
		expect(location).toContain('localhost:5173/login');
	});
});

// ---------------------------------------------------------------------------
// Authenticated requests — token accepted
// ---------------------------------------------------------------------------

describe('auth hook — authenticated requests', () => {
	it('sets locals.user and resolves when token verifies', async () => {
		// Requirement: valid JWT cookie must result in event.locals.user being set
		// so downstream routes/layouts can access the user without re-verifying
		const mockUser = {
			id: 'user-1',
			username: 'travis',
			isAdmin: false,
			apps: [{ slug: 'ww-journal', name: 'WW Journal', role: 'user' }]
		};
		vi.mocked(verifyAuthToken).mockResolvedValueOnce(mockUser);

		const event = makeEvent({ pathname: '/entries', cookieToken: 'valid-jwt-token' });
		const response = await handle({ event, resolve: mockResolve });

		expect(response.status).toBe(200);
		expect(event.locals.user).toEqual(mockUser);
		expect(mockResolve).toHaveBeenCalled();
	});

	it('the return URL includes the full original URL for post-login redirect', async () => {
		// Requirement: after logging in, users should land back on the page they
		// originally requested — the return= param must be the full URL
		const event = makeEvent({ pathname: '/entries/42', cookieToken: undefined });

		let thrown: unknown;
		try {
			await handle({ event, resolve: mockResolve });
		} catch (e) {
			thrown = e;
		}

		const location = (thrown as { location?: string; headers?: Headers }).location
			?? (thrown as Response).headers?.get('location')
			?? '';

		// The return URL must be URL-encoded in the redirect
		expect(location).toContain(encodeURIComponent('http://localhost/entries/42'));
	});
});
