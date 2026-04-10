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
		const { payload } = await jwtVerify(token, getJwks());
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
