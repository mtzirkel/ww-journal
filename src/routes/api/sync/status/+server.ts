import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSyncStatus } from '$lib/server/sync.js';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Unauthorized');
	const result = await getSyncStatus(locals.user.id);
	return json(result);
};
