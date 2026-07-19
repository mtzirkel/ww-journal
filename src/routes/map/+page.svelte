<script lang="ts">
	import { db, seedRivers } from '$lib/db/index.js';
	import { riverIdOf, flowOf, riverIds, lookupRiver } from '$lib/activity.js';
	import type { River, JournalEntry } from '$lib/types.js';
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { PUBLIC_MAPTILER_KEY } from '$env/static/public';

	let mapEl: HTMLDivElement;
	let paddledRivers = $state<River[]>([]);
	let mapInstance: import('maplibre-gl').Map | null = $state(null);

	// Filter state
	let filterYear = $state<number | null>(null);
	let filterClass = $state<string | null>(null);
	let filterName = $state('');
	let showHeatmap = $state(false);

	// Available options (set after data loads)
	let availableYears = $state<number[]>([]);
	let availableClasses = $state<string[]>([]);

	// Raw data — set once in onMount, not reactive
	let allEntries: JournalEntry[] = [];
	let allRivers: River[] = [];

	const classColors: Record<string, string> = {
		'I':     '#22c55e',
		'II':    '#3b82f6',
		'II-III':'#6366f1',
		'III':   '#8b5cf6',
		'III-IV':'#a855f7',
		'IV':    '#f59e0b',
		'IV-V':  '#ef4444',
		'V':     '#dc2626',
		'V+':    '#991b1b'
	};

	const classOrder = ['I', 'II', 'II-III', 'III', 'III-IV', 'IV', 'IV-V', 'V', 'V+'];

	function buildGeojson(
		entries: JournalEntry[],
		rivers: River[],
		year: number | null,
		cls: string | null,
		nameSearch: string
	): GeoJSON.FeatureCollection {
		// Filter entries by year
		const filteredEntries = year
			? entries.filter((e) => new Date(e.datetime).getFullYear() === year)
			: entries;

		// River IDs that have at least one entry in the filtered period
		const riverIdsWithEntries = new Set(filteredEntries.map((e) => riverIdOf(e)));

		const features = rivers
			.filter((r) => {
				// Must have entries in filtered period
				if (!riverIdsWithEntries.has(r.id)) return false;
				// Class filter
				if (cls && r.classRating !== cls) return false;
				// Name/section search
				if (nameSearch) {
					const q = nameSearch.toLowerCase();
					const nameMatch = r.riverName.toLowerCase().includes(q);
					const sectionMatch = (r.section ?? '').toLowerCase().includes(q);
					if (!nameMatch && !sectionMatch) return false;
				}
				return true;
			})
			.map((r) => {
				const entryCount = filteredEntries.filter((e) => riverIdOf(e) === r.id).length;
				return {
					type: 'Feature' as const,
					geometry: { type: 'Point' as const, coordinates: [r.lon!, r.lat!] },
					properties: {
						id: r.id,
						riverName: r.riverName,
						section: r.section ?? '',
						state: r.state,
						classRating: r.classRating ?? '',
						entryCount,
						color: classColors[r.classRating ?? ''] ?? '#238c91',
						radius: Math.min(6 + entryCount * 2, 14)
					}
				};
			});

		return { type: 'FeatureCollection', features };
	}

	// Reactive effect: update source data whenever filters or map instance change
	$effect(() => {
		if (!mapInstance || !mapInstance.getSource('rivers')) return;
		const geojson = buildGeojson(allEntries, allRivers, filterYear, filterClass, filterName);
		(mapInstance.getSource('rivers') as import('maplibre-gl').GeoJSONSource).setData(geojson);
	});

	onMount(async () => {
		await seedRivers();

		const entries = await db.entries.toArray();
		const uniqueRiverIds = [...new Set(riverIds(entries))];
		const rivers = await db.rivers.bulkGet(uniqueRiverIds);
		const validRivers = rivers.filter((r): r is River => r !== undefined && r.lat !== null && r.lon !== null);

		paddledRivers = validRivers;
		allEntries = entries;
		allRivers = validRivers;

		// Compute available filter options
		availableYears = [...new Set(entries.map((e) => new Date(e.datetime).getFullYear()))]
			.sort((a, b) => b - a);

		const paddledClassSet = new Set(validRivers.map((r) => r.classRating).filter(Boolean) as string[]);
		availableClasses = classOrder.filter((c) => paddledClassSet.has(c));

		if (!browser || !mapEl) return;

		const maplibre = await import('maplibre-gl');
		await import('maplibre-gl/dist/maplibre-gl.css');

		const map = new maplibre.Map({
			container: mapEl,
			style: `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${PUBLIC_MAPTILER_KEY}`,
			center: [-114.0, 46.8],
			zoom: 5
		});
		mapInstance = map;

		map.on('load', () => {
			const geojson = buildGeojson(allEntries, allRivers, filterYear, filterClass, filterName);

			map.addSource('rivers', {
				type: 'geojson',
				data: geojson,
				cluster: true,
				clusterMaxZoom: 9,
				clusterRadius: 50
			});

			// Heatmap layer (hidden by default)
			map.addLayer({
				id: 'rivers-heat',
				type: 'heatmap',
				source: 'rivers',
				maxzoom: 14,
				paint: {
					'heatmap-weight': ['interpolate', ['linear'], ['get', 'entryCount'], 0, 0, 10, 1],
					'heatmap-intensity': 1,
					'heatmap-color': [
						'interpolate', ['linear'], ['heatmap-density'],
						0, 'rgba(0,0,0,0)',
						0.2, '#238c91',
						0.6, '#f59e0b',
						1, '#dc2626'
					],
					'heatmap-radius': 30,
					'heatmap-opacity': 0.8
				}
			});
			map.setLayoutProperty('rivers-heat', 'visibility', 'none');

			// Cluster circle layer
			map.addLayer({
				id: 'rivers-cluster',
				type: 'circle',
				source: 'rivers',
				filter: ['has', 'point_count'],
				paint: {
					'circle-color': '#238c91',
					'circle-radius': ['step', ['get', 'point_count'], 18, 5, 24, 20, 32],
					'circle-stroke-color': '#fff',
					'circle-stroke-width': 2,
					'circle-opacity': 0.9
				}
			});

			// Cluster count label
			map.addLayer({
				id: 'rivers-cluster-count',
				type: 'symbol',
				source: 'rivers',
				filter: ['has', 'point_count'],
				layout: {
					'text-field': '{point_count_abbreviated}',
					'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
					'text-size': 13,
					'text-anchor': 'center'
				},
				paint: {
					'text-color': '#ffffff'
				}
			});

			// Outer glow / halo — unclustered points only
			map.addLayer({
				id: 'rivers-halo',
				type: 'circle',
				source: 'rivers',
				filter: ['!', ['has', 'point_count']],
				paint: {
					'circle-radius': ['get', 'radius'],
					'circle-color': ['get', 'color'],
					'circle-opacity': 0.25,
					'circle-radius-transition': { duration: 200 }
				}
			});

			// Main dot — unclustered points only
			map.addLayer({
				id: 'rivers-dot',
				type: 'circle',
				source: 'rivers',
				filter: ['!', ['has', 'point_count']],
				paint: {
					'circle-radius': ['-', ['get', 'radius'], 4],
					'circle-color': ['get', 'color'],
					'circle-stroke-color': '#fff',
					'circle-stroke-width': 2,
					'circle-opacity': 0.9
				}
			});

			// Cluster click → zoom in
			map.on('click', 'rivers-cluster', (e) => {
				const f = e.features?.[0];
				if (!f) return;
				const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
				map.easeTo({ center: coords, zoom: map.getZoom() + 2 });
			});

			// Cluster cursor
			map.on('mouseenter', 'rivers-cluster', () => { map.getCanvas().style.cursor = 'pointer'; });
			map.on('mouseleave', 'rivers-cluster', () => { map.getCanvas().style.cursor = ''; });

			// Dot click → popup
			map.on('click', 'rivers-dot', (e) => {
				const f = e.features?.[0];
				if (!f) return;
				const p = f.properties;
				const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
				const activeYear = filterYear;
				const daysLabel = activeYear
					? `${p.entryCount} day${p.entryCount !== 1 ? 's' : ''} in ${activeYear}`
					: `${p.entryCount} day${p.entryCount !== 1 ? 's' : ''} total`;
				new maplibre.Popup({ offset: 12, maxWidth: '260px' })
					.setLngLat(coords)
					.setHTML(`
						<div style="font-family: inherit; line-height: 1.5; color: #1a1a1a;">
							<strong style="font-size: 14px; color: #1a1a1a;">${p.riverName}</strong>
							${p.section ? `<div style="color: #555; font-size: 12px;">${p.section}</div>` : ''}
							<div style="font-size: 12px; margin-top: 4px; color: #444;">${p.state}${p.classRating ? ` · Class ${p.classRating}` : ''}</div>
							<div style="font-size: 12px; color: #444;">${daysLabel}</div>
							<a href="/entries?river=${p.id}" style="display:inline-block; margin-top:6px; color:#238c91; font-weight:600; font-size:12px; text-decoration:underline;">View entries →</a>
						</div>
					`)
					.addTo(map);
			});

			// Pointer cursor on dot hover
			map.on('mouseenter', 'rivers-dot', () => { map.getCanvas().style.cursor = 'pointer'; });
			map.on('mouseleave', 'rivers-dot', () => { map.getCanvas().style.cursor = ''; });

			// Fit to markers
			if (validRivers.length > 0) {
				const lons = validRivers.map((r) => r.lon!);
				const lats = validRivers.map((r) => r.lat!);
				map.fitBounds(
					[[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
					{ padding: 60, maxZoom: 10, duration: 0 }
				);
			}
		});
	});

	onDestroy(() => {
		mapInstance?.remove();
	});

	function toggleHeatmap() {
		showHeatmap = !showHeatmap;
		if (!mapInstance) return;
		const show = showHeatmap;
		mapInstance.setLayoutProperty('rivers-heat', 'visibility', show ? 'visible' : 'none');
		mapInstance.setLayoutProperty('rivers-halo', 'visibility', show ? 'none' : 'visible');
		mapInstance.setLayoutProperty('rivers-dot', 'visibility', show ? 'none' : 'visible');
		mapInstance.setLayoutProperty('rivers-cluster', 'visibility', show ? 'none' : 'visible');
		mapInstance.setLayoutProperty('rivers-cluster-count', 'visibility', show ? 'none' : 'visible');
	}
</script>

<h1 class="text-3xl font-bold mb-6">River Map</h1>

{#if paddledRivers.length === 0}
	<div class="card bg-base-100 shadow">
		<div class="card-body text-center text-base-content/50">
			<p>Log some river days to see them on the map!</p>
		</div>
	</div>
{/if}

<!-- Filter controls -->
<div class="flex flex-wrap gap-2 mb-3 items-center">
	<select
		class="select select-sm select-bordered"
		bind:value={filterYear}
		onchange={(e) => { filterYear = (e.target as HTMLSelectElement).value ? Number((e.target as HTMLSelectElement).value) : null; }}
	>
		<option value="">All years</option>
		{#each availableYears as yr}
			<option value={yr}>{yr}</option>
		{/each}
	</select>

	<select
		class="select select-sm select-bordered"
		bind:value={filterClass}
		onchange={(e) => { filterClass = (e.target as HTMLSelectElement).value || null; }}
	>
		<option value="">All classes</option>
		{#each availableClasses as cls}
			<option value={cls}>Class {cls}</option>
		{/each}
	</select>

	<input
		type="text"
		class="input input-sm input-bordered"
		placeholder="Search river..."
		bind:value={filterName}
	/>

	<button
		class="btn btn-sm"
		class:btn-primary={showHeatmap}
		onclick={toggleHeatmap}
	>
		{showHeatmap ? 'Dots' : 'Heatmap'}
	</button>
</div>

<div class="card bg-base-100 shadow overflow-hidden">
	<div bind:this={mapEl} class="h-[600px] w-full"></div>
</div>

<style>
	:global(.maplibregl-popup-content) {
		background: oklch(var(--b1));
		color: oklch(var(--bc));
		border-radius: 8px;
		box-shadow: 0 4px 20px rgba(0,0,0,0.3);
		padding: 12px 14px;
	}
	:global(.maplibregl-popup-tip) {
		border-top-color: oklch(var(--b1));
	}
</style>
