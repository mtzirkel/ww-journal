import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '$env/dynamic/private';
import { createHash } from 'node:crypto';

let jwks: ReturnType<typeof createRemoteJWKSet>;

function getJwks() {
	if (!jwks) {
		const authUrl = env.AUTH_URL || 'http://localhost:5173';
		jwks = createRemoteJWKSet(new URL(`${authUrl}/api/jwks`));
	}
	return jwks;
}

/**
 * Revocation check against noegos-auth.
 *
 * A session JWT is valid for up to 90 days, but noegos-auth revokes sessions
 * server-side on logout, user deletion, app-access changes and TOTP resets.
 * Local signature checks can't see that, so we also ask /api/verify (which
 * checks the sessions table and the current admin flag) and cache the answer
 * briefly per token.
 *
 * If noegos-auth is unreachable or erroring, we fall back to the local check
 * (fail open, not cached) so an auth-service outage doesn't lock everyone out
 * of their journal. A definite 401 always wins.
 */
export const REVOCATION_CACHE_MS = 60_000;
type RemoteVerdict = { ok: true; isAdmin: boolean; apps: AppAccess[] } | { ok: false };
const verdictCache = new Map<string, { verdict: RemoteVerdict; expires: number }>();

export function _clearVerdictCache() {
	verdictCache.clear();
}

async function checkWithAuthServer(token: string, now = Date.now()): Promise<RemoteVerdict | 'unavailable'> {
	const key = createHash('sha256').update(token).digest('hex');
	const hit = verdictCache.get(key);
	if (hit && hit.expires > now) return hit.verdict;

	const authUrl = env.AUTH_URL || 'http://localhost:5173';
	let verdict: RemoteVerdict;
	try {
		const res = await fetch(`${authUrl}/api/verify`, {
			headers: { authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(3000)
		});
		if (res.status === 401 || res.status === 403) {
			verdict = { ok: false };
		} else if (res.ok) {
			const body = (await res.json()) as { authenticated?: boolean; user?: { isAdmin?: boolean; apps?: AppAccess[] } };
			verdict = body.authenticated
				? { ok: true, isAdmin: body.user?.isAdmin === true, apps: body.user?.apps ?? [] }
				: { ok: false };
		} else {
			return 'unavailable';
		}
	} catch {
		return 'unavailable';
	}

	if (verdictCache.size > 5000) {
		for (const [k, v] of verdictCache) if (v.expires <= now) verdictCache.delete(k);
	}
	verdictCache.set(key, { verdict, expires: now + REVOCATION_CACHE_MS });
	return verdict;
}

interface AppAccess {
	slug: string;
	name: string;
	role: string;
}

export async function verifyAuthToken(token: string) {
	try {
		const authUrl = env.AUTH_URL || 'http://localhost:5173';
		const { payload, protectedHeader } = await jwtVerify(token, getJwks(), {
			issuer: authUrl,
			algorithms: ['EdDSA']
		});
		// OAuth access tokens (agents/MCP) are signed with the same key but are
		// scoped and audience-bound — never accept one as a browser session.
		if (protectedHeader.typ === 'at+jwt' || payload.aud !== undefined) return null;
		const user = payload as unknown as {
			sub: string;
			username: string;
			admin: boolean;
			apps: AppAccess[];
		};

		// Has the session been revoked (logout, user removed, access changed)?
		// Prefer the auth server's current view of admin/app access when we have it.
		let isAdmin = user.admin === true;
		let apps = user.apps ?? [];
		const remote = await checkWithAuthServer(token);
		if (remote !== 'unavailable') {
			if (!remote.ok) return null;
			isAdmin = remote.isAdmin;
			apps = remote.apps;
		}

		// Check if user has access to this app
		const appSlug = env.AUTH_APP_SLUG || 'ww-journal';
		const hasAccess = isAdmin || apps.some((a) => a.slug === appSlug);
		if (!hasAccess) return null;

		return {
			id: user.sub,
			username: user.username,
			isAdmin,
			apps
		};
	} catch {
		return null;
	}
}

export interface McpPrincipal {
	userId: string;
	username: string;
	clientId: string | null;
	scopes: string[];
}

/**
 * Verify an OAuth 2.1 access token issued by noegos-auth for this app's MCP
 * endpoint: EdDSA signature via JWKS, issuer, audience (= resource URL),
 * `typ: at+jwt`, and app membership.
 */
export async function verifyAccessToken(token: string, resource: string): Promise<McpPrincipal | null> {
	try {
		const authUrl = env.AUTH_URL || 'http://localhost:5173';
		const { payload } = await jwtVerify(token, getJwks(), {
			issuer: authUrl,
			audience: resource,
			typ: 'at+jwt',
			algorithms: ['EdDSA']
		});
		const appSlug = env.AUTH_APP_SLUG || 'ww-journal';
		const apps = (payload.apps as Array<{ slug: string }> | undefined) ?? [];
		if (!apps.some((a) => a.slug === appSlug)) return null;
		if (typeof payload.sub !== 'string') return null;
		return {
			userId: payload.sub,
			username: String(payload.username ?? ''),
			clientId: typeof payload.client_id === 'string' ? payload.client_id : null,
			scopes: typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : []
		};
	} catch {
		return null;
	}
}

/** Canonical resource identifier for the MCP endpoint (what tokens must be issued for). */
export function mcpResourceUrl(requestOrigin: string): string {
	const origin = (env.MCP_ORIGIN || env.ORIGIN || requestOrigin).replace(/\/$/, '');
	return `${origin}/mcp`;
}
