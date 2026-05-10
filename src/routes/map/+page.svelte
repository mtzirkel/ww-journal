<script lang="ts">
	import { db, seedRivers } from '$lib/db/index.js';
	import type { River } from '$lib/types.js';
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { PUBLIC_MAPTILER_KEY } from '$env/static/public';

	let mapEl: HTMLDivElement;
	let paddledRivers = $state<River[]>([]);
	let mapInstance: import('maplibre-gl').Map | null = null;

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

	onMount(async () => {
		await seedRivers();

		const entries = await db.entries.toArray();
		const riverIds = [...new Set(entries.map((e) => e.riverId))];
		const rivers = await db.rivers.bulkGet(riverIds);
		paddledRivers = rivers.filter((r): r is River => r !== undefined && r.lat !== null && r.lon !== null);

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
			// Build GeoJSON from paddled rivers
			const geojson: GeoJSON.FeatureCollection = {
				type: 'FeatureCollection',
				features: paddledRivers
					.filter((r) => r.lat && r.lon)
					.map((r) => {
						const entryCount = entries.filter((e) => e.riverId === r.id).length;
						return {
							type: 'Feature',
							geometry: { type: 'Point', coordinates: [r.lon!, r.lat!] },
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
					})
			};

			map.addSource('rivers', { type: 'geojson', data: geojson });

			// Outer glow / halo
			map.addLayer({
				id: 'rivers-halo',
				type: 'circle',
				source: 'rivers',
				paint: {
					'circle-radius': ['get', 'radius'],
					'circle-color': ['get', 'color'],
					'circle-opacity': 0.25,
					'circle-radius-transition': { duration: 200 }
				}
			});

			// Main dot
			map.addLayer({
				id: 'rivers-dot',
				type: 'circle',
				source: 'rivers',
				paint: {
					'circle-radius': ['-', ['get', 'radius'], 4],
					'circle-color': ['get', 'color'],
					'circle-stroke-color': '#fff',
					'circle-stroke-width': 2,
					'circle-opacity': 0.9
				}
			});

			// Click → popup
			map.on('click', 'rivers-dot', (e) => {
				const f = e.features?.[0];
				if (!f) return;
				const p = f.properties;
				const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
				new maplibre.Popup({ offset: 12, maxWidth: '260px' })
					.setLngLat(coords)
					.setHTML(`
						<div style="font-family: inherit; line-height: 1.5; color: #1a1a1a;">
							<strong style="font-size: 14px; color: #1a1a1a;">${p.riverName}</strong>
							${p.section ? `<div style="color: #555; font-size: 12px;">${p.section}</div>` : ''}
							<div style="font-size: 12px; margin-top: 4px; color: #444;">${p.state}${p.classRating ? ` · Class ${p.classRating}` : ''}</div>
							<div style="font-size: 12px; color: #444;">${p.entryCount} day${p.entryCount !== 1 ? 's' : ''}</div>
							<a href="/entries?river=${p.id}" style="display:inline-block; margin-top:6px; color:#238c91; font-weight:600; font-size:12px; text-decoration:underline;">View entries →</a>
						</div>
					`)
					.addTo(map);
			});

			// Pointer cursor on hover
			map.on('mouseenter', 'rivers-dot', () => { map.getCanvas().style.cursor = 'pointer'; });
			map.on('mouseleave', 'rivers-dot', () => { map.getCanvas().style.cursor = ''; });

			// Fit to markers
			if (paddledRivers.length > 0) {
				const lons = paddledRivers.map((r) => r.lon!);
				const lats = paddledRivers.map((r) => r.lat!);
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
</script>

<h1 class="text-3xl font-bold mb-6">River Map</h1>

{#if paddledRivers.length === 0}
	<div class="card bg-base-100 shadow">
		<div class="card-body text-center text-base-content/50">
			<p>Log some river days to see them on the map!</p>
		</div>
	</div>
{/if}

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
