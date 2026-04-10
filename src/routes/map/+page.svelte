<script lang="ts">
	import { db, seedRivers, seedEntries } from '$lib/db/index.js';
	import type { River } from '$lib/types.js';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';

	let mapEl: HTMLDivElement;
	let paddledRivers = $state<River[]>([]);

	onMount(async () => {
		await seedRivers();
		await seedEntries();

		// Get river IDs from entries
		const entries = await db.entries.toArray();
		const riverIds = [...new Set(entries.map((e) => e.riverId))];

		// Get rivers with coords
		const rivers = await db.rivers.bulkGet(riverIds);
		paddledRivers = rivers.filter((r): r is River => r !== undefined && r.lat !== null && r.lon !== null);

		if (!browser || !mapEl) return;

		const L = await import('leaflet');
		await import('leaflet/dist/leaflet.css');

		const map = L.map(mapEl).setView([46.8, -114.0], 6);

		L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
			attribution: '&copy; OpenStreetMap contributors',
			maxZoom: 18
		}).addTo(map);

		const classColors: Record<string, string> = {
			'I': '#22c55e',
			'II': '#3b82f6',
			'II-III': '#6366f1',
			'III': '#8b5cf6',
			'III-IV': '#a855f7',
			'IV': '#f59e0b',
			'IV-V': '#ef4444',
			'V': '#dc2626',
			'V+': '#991b1b'
		};

		const bounds: [number, number][] = [];

		for (const river of paddledRivers) {
			if (!river.lat || !river.lon) continue;
			const pos: [number, number] = [river.lat, river.lon];
			bounds.push(pos);

			const color = classColors[river.classRating ?? ''] ?? '#238c91';

			const entryCount = entries.filter((e) => e.riverId === river.id).length;

			const marker = L.circleMarker(pos, {
				radius: Math.min(6 + entryCount * 2, 14),
				fillColor: color,
				color: '#fff',
				weight: 2,
				fillOpacity: 0.8
			}).addTo(map);

			marker.bindPopup(`
				<strong>${river.riverName}</strong>
				${river.section ? `<br><em>${river.section}</em>` : ''}
				<br>${river.state}${river.classRating ? ` · Class ${river.classRating}` : ''}
				<br>${entryCount} day${entryCount !== 1 ? 's' : ''}
			`);
		}

		if (bounds.length > 0) {
			map.fitBounds(bounds, { padding: [30, 30] });
		}
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
	<div bind:this={mapEl} class="h-[500px] w-full"></div>
</div>

<style>
	:global(.leaflet-container) {
		font-family: inherit;
	}
</style>
