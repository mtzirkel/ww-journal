import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { pushChanges, type SyncPayload } from '$lib/server/sync.js';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'Unauthorized');

	let payload: SyncPayload;
	try {
		payload = await request.json();
	} catch {
		error(400, 'Invalid JSON');
	}

	const result = await pushChanges(locals.user.id, payload);
	return json(result);
};
