import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { verifyAuthToken } from '$lib/server/auth.js';
import { env } from '$env/dynamic/private';

const PUBLIC_PATHS = ['/api/health'];

export const handle: Handle = async ({ event, resolve }) => {
	// Allow public paths
	if (PUBLIC_PATHS.some((p) => event.url.pathname.startsWith(p))) {
		return resolve(event);
	}

	// Dev bypass — skip auth entirely in development.
	// DEV_USER_ID lets a dev instance impersonate a real user id so it can be
	// pointed at a copy of production data; defaults to a synthetic id.
	if (env.DEV_BYPASS_AUTH === 'true') {
		event.locals.user = {
			id: env.DEV_USER_ID || 'dev-user',
			username: 'dev',
			isAdmin: true,
			apps: [{ slug: 'ww-journal', name: 'WW Journal', role: 'admin' }]
		};
		return resolve(event);
	}

	// Check auth cookie
	const token = event.cookies.get('noegos_auth');
	if (token) {
		const user = await verifyAuthToken(token);
		if (user) {
			event.locals.user = user;
			return resolve(event);
		}
	}

	// Not authenticated — redirect to auth service login
	const authUrl = env.AUTH_URL || 'http://localhost:5173';
	const returnUrl = event.url.href;
	redirect(302, `${authUrl}/login?return_to=${encodeURIComponent(returnUrl)}`);
};
