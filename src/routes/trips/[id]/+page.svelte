<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { liveQuery } from 'dexie';
	import { db, seedRivers } from '$lib/db/index.js';
	import type { Trip, JournalEntry, River } from '$lib/types.js';
	import { onMount } from 'svelte';
	import { sync, syncStore } from '$lib/sync.svelte.js';

	let trip = $state<Trip | null>(null);
	let entries = $state<(JournalEntry & { river?: River })[]>([]);
	let rivers = $state<Map<number, River>>(new Map());
	let loaded = $state(false);
	let editing = $state(false);
	let editName = $state('');
	let editDescription = $state('');

	onMount(() => {
		let subscription: { unsubscribe: () => void } | undefined;

		(async () => {
			await seedRivers();
			const allRivers = await db.rivers.toArray();
			rivers = new Map(allRivers.map((r) => [r.id, r]));

			const tripId = page.params.id ?? '';
			trip = await db.trips.get(tripId) ?? null;

			const observable = liveQuery(async () => {
				const all = await db.entries.where('tripId').equals(tripId).sortBy('datetime');
				return all.filter((e) => !e.deletedAt);
			});

			subscription = observable.subscribe((value) => {
				entries = value.map((e) => ({ ...e, river: rivers.get(e.riverId) }));
				loaded = true;

				// Auto-compute trip dates from entries
				if (trip && value.length > 0) {
					const dates = value.map(e => e.datetime).sort();
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
		sync();
		goto('/trips');
	}

	async function removeEntry(entryId: string) {
		await db.entries.update(entryId, { tripId: null, dirty: true, updatedAt: new Date().toISOString() });
		await syncStore.refreshPendingCount();
		sync();
	}

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

	<!-- Entries in this trip -->
	{#if loaded && entries.length === 0}
		<div class="text-center py-8 text-base-content/50">
			<p>No entries in this trip yet.</p>
			<p class="text-sm mt-1">Tag entries with this trip from the Log or Edit page.</p>
		</div>
	{:else}
		<div class="space-y-3">
			{#each entries as entry}
				<div class="card bg-base-100 shadow">
					<div class="card-body py-4">
						<div class="flex justify-between items-start">
							<a href="/entries/{entry.id}" class="flex-1">
								<h3 class="font-bold">
									{entry.river?.riverName ?? 'Unknown'}
									{#if entry.river?.section}
										<span class="font-normal text-base-content/50"> — {entry.river.section}</span>
									{/if}
								</h3>
								{#if entry.description}
									<p class="text-sm text-base-content/60 mt-1 line-clamp-1">{entry.description}</p>
								{/if}
							</a>
							<div class="text-right shrink-0 ml-4">
								<div class="text-sm text-base-content/50">{new Date(entry.datetime).toLocaleDateString()}</div>
								<div class="font-mono text-sm">{entry.flow} cfs</div>
								<button class="btn btn-ghost btn-xs mt-1 text-error" onclick={() => entry.id && removeEntry(entry.id)}>
									Remove
								</button>
							</div>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
{/if}
