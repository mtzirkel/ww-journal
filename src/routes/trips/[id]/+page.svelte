<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { liveQuery } from 'dexie';
	import { db, seedRivers } from '$lib/db/index.js';
	import type { Trip, JournalEntry, River } from '$lib/types.js';
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { PUBLIC_MAPTILER_KEY } from '$env/static/public';
	import { sync, syncStore } from '$lib/sync.svelte.js';

	let trip = $state<Trip | null>(null);
	let entries = $state<(JournalEntry & { river?: River })[]>([]);
	let allEntries = $state<JournalEntry[]>([]);
	let rivers = $state<Map<number, River>>(new Map());
	let loaded = $state(false);
	let editing = $state(false);
	let editName = $state('');
	let editDescription = $state('');
	let picking = $state(false);
	let pickSearch = $state('');

	// Map state
	let mapEl = $state<HTMLDivElement | undefined>(undefined);
	let mapInstance: import('maplibre-gl').Map | null = null;
	let mapMounted = false; // plain var — not reactive, just a guard
	let highlightedRiverId = $state<number | null>(null);

	// Unique geo-located rivers in this trip, with their entry dates
	let geoRivers = $derived.by(() => {
		const riverMap = new Map<number, { river: River; entryDates: string[] }>();
		for (const e of entries) {
			const r = e.river;
			if (r?.lat != null && r?.lon != null) {
				if (!riverMap.has(e.riverId)) {
					riverMap.set(e.riverId, { river: r, entryDates: [] });
				}
				riverMap.get(e.riverId)!.entryDates.push(e.datetime);
			}
		}
		return [...riverMap.values()];
	});

	// Initialize map when mapEl becomes available (after {#if} renders the container)
	$effect(() => {
		if (!mapEl || mapMounted) return;
		initMap(mapEl);
	});

	// Update GeoJSON source when entries change after map is mounted
	$effect(() => {
		// Reactive on geoRivers — reads it to track changes
		const data = buildGeoJSON(geoRivers);
		if (!mapMounted || !mapInstance) return;
		const source = mapInstance.getSource('trip-rivers') as import('maplibre-gl').GeoJSONSource | undefined;
		source?.setData(data);
	});

	function buildGeoJSON(items: { river: River; entryDates: string[] }[]) {
		return {
			type: 'FeatureCollection' as const,
			features: items.map(({ river, entryDates }) => {
				const sorted = [...entryDates].sort();
				const fmt = (d: string) =>
					new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
				const datesStr =
					sorted.length <= 2
						? sorted.map(fmt).join(', ')
						: `${fmt(sorted[0])} – ${fmt(sorted[sorted.length - 1])}`;
				return {
					type: 'Feature' as const,
					geometry: { type: 'Point' as const, coordinates: [river.lon!, river.lat!] },
					properties: {
						riverId: river.id,
						riverName: river.riverName,
						section: river.section ?? '',
						entryCount: entryDates.length,
						dates: datesStr
					}
				};
			})
		};
	}

	async function initMap(el: HTMLDivElement) {
		if (!browser) return;
		mapMounted = true; // set immediately to prevent double-init

		const maplibre = await import('maplibre-gl');
		await import('maplibre-gl/dist/maplibre-gl.css');

		const map = new maplibre.Map({
			container: el,
			style: `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${PUBLIC_MAPTILER_KEY}`,
			center: [-114.0, 46.8],
			zoom: 5
		});
		mapInstance = map;

		map.on('load', () => {
			const geojson = buildGeoJSON(geoRivers);
			map.addSource('trip-rivers', { type: 'geojson', data: geojson });

			// Outer halo
			map.addLayer({
				id: 'trip-rivers-halo',
				type: 'circle',
				source: 'trip-rivers',
				paint: {
					'circle-radius': 14,
					'circle-color': '#238c91',
					'circle-opacity': 0.25
				}
			});

			// Main dot
			map.addLayer({
				id: 'trip-rivers-dot',
				type: 'circle',
				source: 'trip-rivers',
				paint: {
					'circle-radius': 8,
					'circle-color': '#238c91',
					'circle-stroke-color': '#fff',
					'circle-stroke-width': 2,
					'circle-opacity': 0.9
				}
			});

			// Click → popup + scroll timeline
			map.on('click', 'trip-rivers-dot', (e) => {
				const f = e.features?.[0];
				if (!f) return;
				const p = f.properties;
				const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
				new maplibre.Popup({ offset: 12, maxWidth: '260px' })
					.setLngLat(coords)
					.setHTML(`
						<div style="font-family: inherit; line-height: 1.5; color: #1a1a1a;">
							<strong style="font-size: 14px; color: #1a1a1a;">${p.riverName}</strong>
							${p.section ? `<div style="font-size: 12px; color: #555;">${p.section}</div>` : ''}
							<div style="font-size: 12px; margin-top: 4px; color: #444;">${p.entryCount} day${p.entryCount !== 1 ? 's' : ''}</div>
							<div style="font-size: 12px; color: #444;">${p.dates}</div>
						</div>
					`)
					.addTo(map);

				// Scroll to and highlight the first entry for this river in the timeline
				scrollToRiver(p.riverId);
			});

			map.on('mouseenter', 'trip-rivers-dot', () => { map.getCanvas().style.cursor = 'pointer'; });
			map.on('mouseleave', 'trip-rivers-dot', () => { map.getCanvas().style.cursor = ''; });

			// Auto-fit bounds
			if (geoRivers.length === 1) {
				map.setCenter([geoRivers[0].river.lon!, geoRivers[0].river.lat!]);
				map.setZoom(8);
			} else if (geoRivers.length > 1) {
				const lons = geoRivers.map((g) => g.river.lon!);
				const lats = geoRivers.map((g) => g.river.lat!);
				map.fitBounds(
					[[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
					{ padding: 60, maxZoom: 10, duration: 0 }
				);
			}
		});
	}

	onMount(() => {
		let subscription: { unsubscribe: () => void } | undefined;

		(async () => {
			await seedRivers();
			const allRivers = await db.rivers.toArray();
			rivers = new Map(allRivers.map((r) => [r.id, r]));

			const tripId = page.params.id ?? '';
			trip = await db.trips.get(tripId) ?? null;

			const observable = liveQuery(async () => {
				const inTrip = await db.entries.where('tripId').equals(tripId).sortBy('datetime');
				const all = await db.entries.orderBy('datetime').reverse().toArray();
				return { inTrip: inTrip.filter((e) => !e.deletedAt), all: all.filter((e) => !e.deletedAt) };
			});

			subscription = observable.subscribe((value) => {
				entries = value.inTrip.map((e) => ({ ...e, river: rivers.get(e.riverId) }));
				allEntries = value.all;
				loaded = true;

				// Auto-compute trip dates from entries
				if (trip && value.inTrip.length > 0) {
					const dates = value.inTrip.map(e => e.datetime).sort();
					const startDate = dates[0];
					const endDate = dates[dates.length - 1];
					if (trip.startDate !== startDate || trip.endDate !== endDate) {
						db.trips.update(tripId, { startDate, endDate, updatedAt: new Date().toISOString(), dirty: true });
					}
				}
			});
		})();

		return () => { subscription?.unsubscribe(); };
	});

	onDestroy(() => {
		mapInstance?.remove();
	});

	let highlightTimer: ReturnType<typeof setTimeout> | null = null;

	function scrollToRiver(riverId: number) {
		// Find the first entry in the timeline for this river
		const firstEntry = entries.find(e => e.riverId === riverId);
		if (!firstEntry?.id) return;

		// Scroll the entry into view
		const el = document.getElementById(`entry-row-${firstEntry.id}`);
		if (el) {
			el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
		}

		// Flash highlight: set for 1.5s, then clear
		if (highlightTimer) clearTimeout(highlightTimer);
		highlightedRiverId = riverId;
		highlightTimer = setTimeout(() => {
			highlightedRiverId = null;
		}, 1500);
	}

	function startEdit() {
		if (!trip) return;
		editName = trip.name;
		editDescription = trip.description;
		editing = true;
	}

	async function saveEdit() {
		if (!trip?.id) return;
		await db.trips.update(trip.id, {
			name: editName.trim(),
			description: editDescription.trim(),
			updatedAt: new Date().toISOString(),
			dirty: true
		});
		trip = await db.trips.get(trip.id) ?? null;
		editing = false;
		await syncStore.refreshPendingCount();
		sync();
	}

	async function deleteTrip() {
		if (!trip?.id || !confirm('Delete this trip? Entries will be unlinked, not deleted.')) return;
		const now = new Date().toISOString();
		await db.entries.where('tripId').equals(trip.id).modify({ tripId: null, dirty: true, updatedAt: now });
		await db.trips.update(trip.id, { deletedAt: now, updatedAt: now, dirty: true });
		await syncStore.refreshPendingCount();
		try {
			await sync();
		} catch {
			// swallow — trip is dirty locally, next sync will retry
		}
		goto('/trips');
	}

	async function removeEntry(entryId: string) {
		await db.entries.update(entryId, { tripId: null, dirty: true, updatedAt: new Date().toISOString() });
		await syncStore.refreshPendingCount();
		sync();
	}

	async function addEntry(entryId: string) {
		if (!trip?.id) return;
		await db.entries.update(entryId, { tripId: trip.id, dirty: true, updatedAt: new Date().toISOString() });
		await syncStore.refreshPendingCount();
		sync();
	}

	let addableEntries = $derived.by(() => {
		if (!trip) return [] as (JournalEntry & { river?: River })[];
		const q = pickSearch.trim().toLowerCase();
		return allEntries
			.filter((e) => e.tripId !== trip!.id)
			.map((e) => ({ ...e, river: rivers.get(e.riverId) }))
			.filter((e) => {
				if (!q) return true;
				if (e.river?.riverName?.toLowerCase().includes(q)) return true;
				if (e.river?.section?.toLowerCase().includes(q)) return true;
				if (e.description?.toLowerCase().includes(q)) return true;
				if (e.datetime.toLowerCase().includes(q)) return true;
				return false;
			});
	});

	// Stats
	let totalDays = $derived(entries.length);
	let uniqueRivers = $derived(new Set(entries.map(e => e.riverId)).size);
	let dateRange = $derived(() => {
		if (entries.length === 0) return '';
		const dates = entries.map(e => e.datetime).sort();
		const start = new Date(dates[0]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
		const end = new Date(dates[dates.length - 1]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
		return dates.length === 1 ? start : `${start} — ${end}`;
	});
</script>

{#if !trip}
	<div class="text-center py-12"><span class="loading loading-spinner loading-lg"></span></div>
{:else}
	<div class="flex justify-between items-center mb-6">
		<a href="/trips" class="btn btn-ghost btn-sm">&larr; Trips</a>
		<div class="flex gap-2">
			<button class="btn btn-sm btn-outline" onclick={startEdit}>Edit</button>
			<button class="btn btn-sm btn-error btn-outline" onclick={deleteTrip}>Delete</button>
		</div>
	</div>

	{#if editing}
		<div class="card bg-base-100 shadow mb-6">
			<div class="card-body">
				<div class="form-control mb-3">
					<label class="label" for="edit-name"><span class="label-text">Trip Name</span></label>
					<input type="text" id="edit-name" class="input input-bordered w-full" bind:value={editName} />
				</div>
				<div class="form-control mb-4">
					<label class="label" for="edit-desc"><span class="label-text">Description</span></label>
					<textarea id="edit-desc" class="textarea textarea-bordered w-full" rows="2" bind:value={editDescription}></textarea>
				</div>
				<div class="flex gap-2">
					<button class="btn btn-primary flex-1" onclick={saveEdit}>Save</button>
					<button class="btn btn-ghost flex-1" onclick={() => editing = false}>Cancel</button>
				</div>
			</div>
		</div>
	{:else}
		<h1 class="text-3xl font-bold mb-2">{trip.name}</h1>
		{#if trip.description}
			<p class="text-base-content/60 mb-4">{trip.description}</p>
		{/if}
	{/if}

	<!-- Trip stats -->
	<div class="grid grid-cols-3 gap-4 mb-6">
		<div class="stat bg-base-100 rounded-xl shadow p-4">
			<div class="stat-title text-xs">Days</div>
			<div class="stat-value text-2xl" style="color: var(--color-river)">{totalDays}</div>
		</div>
		<div class="stat bg-base-100 rounded-xl shadow p-4">
			<div class="stat-title text-xs">Rivers</div>
			<div class="stat-value text-2xl">{uniqueRivers}</div>
		</div>
		<div class="stat bg-base-100 rounded-xl shadow p-4">
			<div class="stat-title text-xs">Dates</div>
			<div class="stat-value text-sm">{dateRange()}</div>
		</div>
	</div>

	<!-- Map section — hidden if no geo-located rivers -->
	{#if loaded && geoRivers.length > 0}
		<div class="card bg-base-100 shadow overflow-hidden mb-6">
			<div bind:this={mapEl} class="h-[280px] sm:h-[320px] w-full"></div>
		</div>
	{/if}

	<!-- Entries in this trip -->
	<div class="flex justify-between items-center mb-3">
		<h2 class="font-bold">Entries</h2>
		<div class="flex gap-2">
			<a href="/entries/new?trip={trip.id}" class="btn btn-sm btn-outline">+ New entry</a>
			<button class="btn btn-sm btn-primary" onclick={() => { picking = true; pickSearch = ''; }}>+ Add existing</button>
		</div>
	</div>

	{#if loaded && entries.length === 0}
		<div class="text-center py-8 text-base-content/50">
			<p>No entries in this trip yet.</p>
			<p class="text-sm mt-1">Tag entries with this trip from the Log or Edit page.</p>
		</div>
	{:else}
		<!-- Timeline layout -->
		<div class="timeline-list relative">
			<!-- Vertical connecting line -->
			<div class="timeline-line"></div>

			{#each entries as entry}
				{@const entryDate = new Date(entry.datetime)}
				{@const monthStr = entryDate.toLocaleDateString('en-US', { month: 'short' })}
				{@const dayNum = entryDate.getDate()}

				<div
					id="entry-row-{entry.id}"
					class="timeline-row flex gap-3 sm:gap-4 mb-4 relative items-start transition-all duration-500"
					class:ring-2={highlightedRiverId === entry.riverId}
					class:ring-primary={highlightedRiverId === entry.riverId}
					class:ring-offset-2={highlightedRiverId === entry.riverId}
					class:rounded-xl={highlightedRiverId === entry.riverId}
				>
					<!-- Date badge -->
					<div class="timeline-badge shrink-0 flex flex-col items-center justify-center bg-base-100 border border-base-300 rounded-xl shadow-sm w-14 sm:w-16 py-2 z-10">
						<span class="text-[10px] uppercase tracking-wide text-base-content/50 leading-none">{monthStr}</span>
						<span class="text-xl font-bold leading-tight">{dayNum}</span>
					</div>

					<!-- Entry card -->
					<div class="flex-1 card bg-base-100 shadow">
						<div class="card-body py-3 px-4">
							<div class="flex justify-between items-start gap-2">
								<a href="/entries/{entry.id}" class="flex-1 min-w-0">
									<h3 class="font-bold text-sm leading-snug">
										{entry.river?.riverName ?? 'Unknown'}
										{#if entry.river?.section}
											<span class="font-normal text-base-content/50"> — {entry.river.section}</span>
										{/if}
									</h3>
									<div class="flex items-center gap-2 mt-1 flex-wrap">
										<span class="badge badge-sm font-mono">{entry.flow} cfs</span>
									</div>
									{#if entry.description}
										<p class="text-xs text-base-content/60 mt-1 line-clamp-2">{entry.description}</p>
									{/if}
								</a>
								<button
									class="btn btn-ghost btn-xs text-error shrink-0 mt-0.5"
									onclick={() => entry.id && removeEntry(entry.id)}
								>
									Remove
								</button>
							</div>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	{#if picking}
		<div class="modal modal-open" role="dialog">
			<div class="modal-box max-w-2xl">
				<div class="flex justify-between items-center mb-3">
					<h3 class="font-bold text-lg">Add entries to {trip.name}</h3>
					<button class="btn btn-ghost btn-sm" onclick={() => picking = false}>✕</button>
				</div>
				<input
					type="search"
					placeholder="Search river, notes, date..."
					bind:value={pickSearch}
					class="input input-bordered input-sm w-full mb-3"
				/>
				{#if addableEntries.length === 0}
					<p class="text-center text-base-content/50 py-8">No matching entries</p>
				{:else}
					<div class="space-y-2 max-h-96 overflow-y-auto">
						{#each addableEntries as entry}
							<button
								class="w-full text-left card bg-base-200 hover:bg-base-300 transition"
								onclick={() => entry.id && addEntry(entry.id)}
							>
								<div class="card-body py-2 px-3">
									<div class="flex justify-between items-start gap-3">
										<div class="min-w-0 flex-1">
											<div class="font-bold text-sm truncate">
												{entry.river?.riverName ?? 'Unknown'}
												{#if entry.river?.section}
													<span class="font-normal text-base-content/50">— {entry.river.section}</span>
												{/if}
											</div>
											{#if entry.description}
												<p class="text-xs text-base-content/60 truncate">{entry.description}</p>
											{/if}
										</div>
										<div class="text-right text-xs shrink-0">
											<div class="text-base-content/50">{new Date(entry.datetime).toLocaleDateString()}</div>
											<div class="font-mono">{entry.flow} cfs</div>
										</div>
									</div>
								</div>
							</button>
						{/each}
					</div>
				{/if}
				<div class="modal-action">
					<button class="btn btn-ghost" onclick={() => picking = false}>Done</button>
				</div>
			</div>
			<button class="modal-backdrop" onclick={() => picking = false} aria-label="Close"></button>
		</div>
	{/if}
{/if}

<style>
	/* Timeline layout */
	.timeline-list {
		padding-left: 0;
	}

	/* Vertical line — positioned to run through the date badge center */
	.timeline-line {
		position: absolute;
		left: 27px; /* center of 56px (w-14) badge */
		top: 0;
		bottom: 0;
		width: 2px;
		background: oklch(var(--b3, 0.2 0 0));
		z-index: 0;
	}

	@media (min-width: 640px) {
		.timeline-line {
			left: 31px; /* center of 64px (w-16) badge */
		}
	}

	/* Popup styles — dark theme fix */
	:global(.maplibregl-popup-content) {
		background: oklch(var(--b1));
		color: oklch(var(--bc));
		border-radius: 8px;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
		padding: 12px 14px;
	}
	:global(.maplibregl-popup-tip) {
		border-top-color: oklch(var(--b1));
	}
</style>
