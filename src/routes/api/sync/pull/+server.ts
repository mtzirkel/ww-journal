import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { pullChanges } from '$lib/server/sync.js';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) error(401, 'Unauthorized');

	const since = url.searchParams.get('since');
	const result = await pullChanges(locals.user.id, since);
	return json(result);
};
