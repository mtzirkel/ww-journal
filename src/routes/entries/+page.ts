import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
	return {
		filterRiverId: url.searchParams.get('river') ? parseInt(url.searchParams.get('river')!) : null,
		filterYear: url.searchParams.get('year') ?? null,
		filterMonth: url.searchParams.get('month') ?? null,
		viewRivers: url.searchParams.get('view') === 'rivers'
	};
};
