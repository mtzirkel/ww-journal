import { error } from '@sveltejs/kit';
import { getRiverById, getRiverEntriesForUser, fetchGaugeData } from '$lib/server/rivers.js';

export const load = async ({ params, locals }: { params: { id: string }; locals: App.Locals }) => {
	if (!locals.user) error(401, 'Unauthorized');

	const id = parseInt(params.id, 10);
	if (isNaN(id)) error(404, 'River not found');

	const river = await getRiverById(id);
	if (!river) error(404, 'River not found');

	// Load user's journal entries for this river
	const entries = await getRiverEntriesForUser(locals.user.id, id);

	// Load gauge data if the river has a USGS gauge
	const gauge =
		river.externalGaugeSource && river.externalGaugeId
			? await fetchGaugeData(
					river.externalGaugeSource,
					river.externalGaugeId,
					river.gaugeMin,
					river.gaugeMax
				)
			: null;

	// Location coordinates (for map display)
	const location =
		river.lat !== null && river.lon !== null ? { lat: river.lat, lon: river.lon } : null;

	return {
		river,
		entries,
		gauge,
		location
	};
};
