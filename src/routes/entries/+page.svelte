<script lang="ts">
	import { liveQuery } from 'dexie';
	import { db, seedRivers } from '$lib/db/index.js';
	import type { River, JournalEntry, Trip } from '$lib/types.js';
	import { onMount } from 'svelte';
	import { page } from '$app/state';

	let entries = $state<(JournalEntry & { river?: River; trip?: Trip })[]>([]);
	let rivers = $state<Map<number, River>>(new Map());
	let trips = $state<Map<string, Trip>>(new Map());
	let filterRiverId = $state<number | null>(null);
	let loaded = $state(false);

	onMount(() => {
		// Read ?river= param from URL
		const riverParam = page.url.searchParams.get('river');
		if (riverParam) filterRiverId = parseInt(riverParam);
		let subscription: { unsubscribe: () => void } | undefined;

		(async () => {
			await seedRivers();

			const allRivers = await db.rivers.toArray();
			rivers = new Map(allRivers.map((r) => [r.id, r]));
			const allTrips = await db.trips.toArray();
			trips = new Map(allTrips.map((t) => [t.id, t]));

			const observable = liveQuery(async () => {
				const all = await db.entries.orderBy('datetime').reverse().toArray();
				return all
					.filter((e) => !e.deletedAt)
					.map((e) => ({ ...e, river: rivers.get(e.riverId), trip: e.tripId ? trips.get(e.tripId) : undefined }));
			});

			subscription = observable.subscribe((value) => {
				entries = value;
				loaded = true;
			});
		})();

		return () => { subscription?.unsubscribe(); };
	});

	let filteredEntries = $derived(
		filterRiverId ? entries.filter((e) => e.riverId === filterRiverId) : entries
	);

	let uniqueRivers = $derived(
		[...new Set(entries.map((e) => e.riverId))]
			.map((id) => rivers.get(id))
			.filter(Boolean)
			.sort((a, b) => a!.riverName.localeCompare(b!.riverName))
	);
</script>

<div class="flex justify-between items-center mb-6">
	<h1 class="text-3xl font-bold">Entries</h1>
	<a href="/entries/new" class="btn btn-primary btn-sm">+ Log a Day</a>
</div>

{#if uniqueRivers.length > 1}
	<div class="mb-4">
		<select class="select select-bordered select-sm" onchange={(e) => {
			const val = (e.target as HTMLSelectElement).value;
			filterRiverId = val ? parseInt(val) : null;
		}}>
			<option value="">All Rivers ({entries.length})</option>
			{#each uniqueRivers as river}
				<option value={river?.id}>
					{river?.riverName}{river?.section ? ` — ${river.section}` : ''} ({entries.filter(e => e.riverId === river?.id).length})
				</option>
			{/each}
		</select>
	</div>
{/if}

{#if !loaded}
	<div class="text-center py-12">
		<span class="loading loading-spinner loading-lg"></span>
	</div>
{:else if filteredEntries.length === 0}
	<div class="text-center py-12 text-base-content/50">
		<p class="text-lg mb-2">No entries yet</p>
		<p class="text-sm">Log your first river day!</p>
		<a href="/entries/new" class="btn btn-primary mt-4">Log a Day</a>
	</div>
{:else}
	<div class="space-y-3">
		{#each filteredEntries as entry}
			<a href="/entries/{entry.id}" class="card bg-base-100 shadow hover:shadow-md transition-shadow block">
				<div class="card-body py-4">
					<div class="flex justify-between items-start">
						<div>
							<h3 class="font-bold">
								{entry.river?.riverName ?? 'Unknown River'}
								{#if entry.river?.section}
									<span class="font-normal text-base-content/50"> — {entry.river.section}</span>
								{/if}
							</h3>
							{#if entry.trip}
								<span class="badge badge-sm badge-outline mt-1">⛰ {entry.trip.name}</span>
							{/if}
							{#if entry.tags && entry.tags.length > 0}
								<div class="flex flex-wrap gap-1 mt-1">
									{#each entry.tags.slice(0, 3) as tag}
										<span class="badge badge-xs badge-ghost">{tag.value}</span>
									{/each}
									{#if entry.tags.length > 3}
										<span class="badge badge-xs badge-ghost">+{entry.tags.length - 3}</span>
									{/if}
								</div>
							{/if}
							{#if entry.description}
								<p class="text-sm text-base-content/60 mt-1 line-clamp-1">{entry.description}</p>
							{/if}
						</div>
			<div class="text-right text-sm shrink-0 ml-4">
					<div class="text-base-content/50">{new Date(entry.datetime).toLocaleDateString()}</div>
					{#if entry.flow}
						<div class="font-mono">{entry.flow} cfs</div>
					{/if}
				</div>
					</div>
				</div>
			</a>
		{/each}
	</div>
{/if}
