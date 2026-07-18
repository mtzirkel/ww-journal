<script lang="ts">
	import { liveQuery } from 'dexie';
	import { db, seedRivers } from '$lib/db/index.js';
	import { riverIdOf, flowOf, riverIds, lookupRiver } from '$lib/activity.js';
	import type { River, JournalEntry, Trip } from '$lib/types.js';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	let { data } = $props();

	let entries = $state<(JournalEntry & { river?: River; trip?: Trip })[]>([]);
	let rivers = $state<Map<number, River>>(new Map());
	let trips = $state<Map<string, Trip>>(new Map());
	let loaded = $state(false);

	// URL params come from +page.ts load — reactive on every navigation
	let filterRiverId = $derived(data.filterRiverId);
	let filterYear = $derived(data.filterYear);
	let filterMonth = $derived(data.filterMonth);
	let viewRivers = $derived(data.viewRivers);

	let search = $state('');

	onMount(() => {
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
					.map((e) => ({
						...e,
						river: lookupRiver(rivers, e),
						trip: e.tripId ? trips.get(e.tripId) : undefined
					}));
			});

			subscription = observable.subscribe((value) => {
				entries = value;
				loaded = true;
			});
		})();

		return () => {
			subscription?.unsubscribe();
		};
	});

	let filteredEntries = $derived.by(() => {
		let result = entries;
		if (filterRiverId) result = result.filter((e) => riverIdOf(e) === filterRiverId);
		if (filterYear) result = result.filter((e) => e.datetime.startsWith(filterYear!));
		if (filterMonth) result = result.filter((e) => e.datetime.startsWith(filterMonth!));
		const q = search.trim().toLowerCase();
		if (q) {
			result = result.filter((e) => {
				if (e.river?.riverName?.toLowerCase().includes(q)) return true;
				if (e.river?.section?.toLowerCase().includes(q)) return true;
				if (e.description?.toLowerCase().includes(q)) return true;
				if (e.trip?.name?.toLowerCase().includes(q)) return true;
				if (e.tags?.some((t) => t.value.toLowerCase().includes(q) || t.category.toLowerCase().includes(q))) return true;
				return false;
			});
		}
		return result;
	});

	let filterLabel = $derived.by(() => {
		if (filterMonth)
			return new Date(filterMonth + '-15').toLocaleDateString('en-US', {
				month: 'long',
				year: 'numeric'
			});
		if (filterYear) return filterYear;
		if (filterRiverId) return rivers.get(filterRiverId)?.riverName ?? 'River';
		if (viewRivers) return 'Rivers';
		return null;
	});

	let riverSummary = $derived(
		[...new Set(riverIds(entries))]
			.map((id) => ({
				river: rivers.get(id),
				count: entries.filter((e) => riverIdOf(e) === id).length
			}))
			.filter((r) => r.river)
			.sort((a, b) => b.count - a.count)
	);

	let uniqueRivers = $derived(
		[...new Set(riverIds(entries))]
			.map((id) => rivers.get(id))
			.filter(Boolean)
			.sort((a, b) => a!.riverName.localeCompare(b!.riverName))
	);
</script>

<div class="flex justify-between items-center mb-6">
	<div>
		<h1 class="text-3xl font-bold">Entries</h1>
		{#if filterLabel}
			<p class="text-sm text-base-content/50 mt-1">
				Filtered: {filterLabel} ·
				<button class="underline" onclick={() => goto('/entries')}>Clear</button>
			</p>
		{/if}
	</div>
	<a href="/entries/new" class="btn btn-primary btn-sm">+ Log a Day</a>
</div>

{#if !viewRivers}
	<div class="mb-4 flex flex-col sm:flex-row gap-2">
		<input
			type="search"
			placeholder="Search river, notes, tag, trip..."
			bind:value={search}
			class="input input-bordered input-sm w-full sm:flex-1"
		/>
		{#if uniqueRivers.length > 1}
			<select
				class="select select-bordered select-sm w-full sm:w-auto"
				onchange={(e) => {
					const val = (e.target as HTMLSelectElement).value;
					goto(val ? `/entries?river=${val}` : '/entries');
				}}
			>
				<option value="">All Rivers ({entries.length})</option>
				{#each uniqueRivers as river}
					<option value={river?.id} selected={river?.id === filterRiverId}>
						{river?.riverName}{river?.section ? ` — ${river.section}` : ''} ({entries.filter(
							(e) => riverIdOf(e) === river?.id
						).length})
					</option>
				{/each}
			</select>
		{/if}
	</div>
{/if}

{#if !loaded}
	<div class="text-center py-12">
		<span class="loading loading-spinner loading-lg"></span>
	</div>
{:else if viewRivers}
	{#if riverSummary.length === 0}
		<div class="text-center py-12 text-base-content/50">
			<p class="text-lg mb-2">No rivers yet</p>
			<a href="/entries/new" class="btn btn-primary mt-4">Log a Day</a>
		</div>
	{:else}
		<div class="space-y-2">
			{#each riverSummary as { river, count }}
				<a
					href="/entries?river={river!.id}"
					class="card bg-base-100 shadow hover:shadow-md transition-shadow block"
				>
					<div class="card-body py-3">
						<div class="flex justify-between items-center">
							<div>
								<h3 class="font-bold">
									{river!.riverName}{#if river!.section}<span class="font-normal text-base-content/50">
											— {river!.section}</span
										>{/if}
								</h3>
								<p class="text-xs text-base-content/50">
									{river!.state}{river!.classRating ? ` · Class ${river!.classRating}` : ''}
								</p>
							</div>
							<div class="text-right shrink-0 ml-4">
								<div class="font-bold text-lg" style="color: var(--color-river)">{count}</div>
								<div class="text-xs text-base-content/50">day{count !== 1 ? 's' : ''}</div>
							</div>
						</div>
					</div>
				</a>
			{/each}
		</div>
	{/if}
{:else if filteredEntries.length === 0}
	<div class="text-center py-12 text-base-content/50">
		<p class="text-lg mb-2">No entries {filterLabel ? `for ${filterLabel}` : 'yet'}</p>
		{#if !filterLabel}
			<p class="text-sm">Log your first river day!</p>
			<a href="/entries/new" class="btn btn-primary mt-4">Log a Day</a>
		{/if}
	</div>
{:else}
	<div class="space-y-3">
		{#each filteredEntries as entry}
			<a
				href="/entries/{entry.id}"
				class="card bg-base-100 shadow hover:shadow-md transition-shadow block"
			>
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
							<div class="text-base-content/50">
								{new Date(entry.datetime).toLocaleDateString()}
							</div>
							{#if flowOf(entry)}
								<div class="font-mono">{flowOf(entry)} cfs</div>
							{/if}
						</div>
					</div>
				</div>
			</a>
		{/each}
	</div>
{/if}
