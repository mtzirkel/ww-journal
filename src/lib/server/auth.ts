import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '$env/dynamic/private';

let jwks: ReturnType<typeof createRemoteJWKSet>;

function getJwks() {
	if (!jwks) {
		const authUrl = env.AUTH_URL || 'http://localhost:5173';
		jwks = createRemoteJWKSet(new URL(`${authUrl}/api/jwks`));
	}
	return jwks;
}

export async function verifyAuthToken(token: string) {
	try {
		const { payload, protectedHeader } = await jwtVerify(token, getJwks());
		// OAuth access tokens (agents/MCP) are signed with the same key but are
		// scoped and audience-bound — never accept one as a browser session.
		if (protectedHeader.typ === 'at+jwt' || payload.aud !== undefined) return null;
		const user = payload as unknown as {
			sub: string;
			username: string;
			admin: boolean;
			apps: Array<{ slug: string; name: string; role: string }>;
		};

		// Check if user has access to this app
		const appSlug = env.AUTH_APP_SLUG || 'ww-journal';
		const hasAccess = user.admin || user.apps.some((a) => a.slug === appSlug);
		if (!hasAccess) return null;

		return {
			id: user.sub,
			username: user.username,
			isAdmin: user.admin,
			apps: user.apps
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
