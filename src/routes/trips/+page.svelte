<script lang="ts">
	import { liveQuery } from 'dexie';
	import { db } from '$lib/db/index.js';
	import type { Trip } from '$lib/types.js';
	import { onMount } from 'svelte';
	import { sync, syncStore } from '$lib/sync.svelte.js';

	let trips = $state<(Trip & { entryCount: number })[]>([]);
	let loaded = $state(false);
	let showCreate = $state(false);

	let newName = $state('');
	let newDescription = $state('');
	let saving = $state(false);

	onMount(() => {
		let subscription: { unsubscribe: () => void } | undefined;

		(async () => {
			const observable = liveQuery(async () => {
				const allTrips = (await db.trips.toArray()).filter((t) => !t.deletedAt);
				allTrips.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
				const withCounts = await Promise.all(
					allTrips.map(async (t) => {
						const matching = await db.entries.where('tripId').equals(t.id).filter((e) => !e.deletedAt).count();
						return { ...t, entryCount: matching };
					})
				);
				return withCounts;
			});

			subscription = observable.subscribe((value) => {
				trips = value;
				loaded = true;
			});
		})();

		return () => { subscription?.unsubscribe(); };
	});

	async function createTrip() {
		if (!newName.trim()) return;
		saving = true;
		const now = new Date().toISOString();
		await db.trips.add({
			id: crypto.randomUUID(),
			name: newName.trim(),
			description: newDescription.trim(),
			startDate: null,
			endDate: null,
			createdAt: now,
			updatedAt: now,
			deletedAt: null,
			dirty: true
		});
		newName = '';
		newDescription = '';
		showCreate = false;
		saving = false;
		await syncStore.refreshPendingCount();
		sync();
	}

	async function deleteTrip(id: string) {
		if (!confirm('Delete this trip? Entries will be unlinked, not deleted.')) return;
		const now = new Date().toISOString();
		// Unlink entries
		await db.entries.where('tripId').equals(id).modify({ tripId: null, dirty: true, updatedAt: now });
		// Soft delete trip
		await db.trips.update(id, { deletedAt: now, updatedAt: now, dirty: true });
		await syncStore.refreshPendingCount();
		sync();
	}
</script>

<div class="flex justify-between items-center mb-6">
	<h1 class="text-3xl font-bold">Trips</h1>
	<button class="btn btn-primary btn-sm" onclick={() => showCreate = !showCreate}>
		{showCreate ? 'Cancel' : '+ New Trip'}
	</button>
</div>

{#if showCreate}
	<div class="card bg-base-100 shadow mb-6">
		<div class="card-body">
			<div class="form-control mb-3">
				<label class="label" for="trip-name"><span class="label-text">Trip Name</span></label>
				<input type="text" id="trip-name" class="input input-bordered w-full" bind:value={newName} placeholder="e.g. Main Salmon Spring 2026" />
			</div>
			<div class="form-control mb-4">
				<label class="label" for="trip-desc"><span class="label-text">Description (optional)</span></label>
				<textarea id="trip-desc" class="textarea textarea-bordered w-full" rows="2" bind:value={newDescription} placeholder="5 day permit trip..."></textarea>
			</div>
			<button class="btn btn-primary w-full" disabled={!newName.trim() || saving} onclick={createTrip}>
				{saving ? 'Creating...' : 'Create Trip'}
			</button>
		</div>
	</div>
{/if}

{#if !loaded}
	<div class="text-center py-12"><span class="loading loading-spinner loading-lg"></span></div>
{:else if trips.length === 0 && !showCreate}
	<div class="text-center py-12 text-base-content/50">
		<p class="text-lg mb-2">No trips yet</p>
		<p class="text-sm">Create a trip to group river days together.</p>
	</div>
{:else}
	<div class="space-y-3">
		{#each trips as trip}
			<a href="/trips/{trip.id}" class="card bg-base-100 shadow hover:shadow-md transition-shadow block">
				<div class="card-body py-4">
					<div class="flex justify-between items-start">
						<div>
							<h3 class="font-bold text-lg">{trip.name}</h3>
							{#if trip.description}
								<p class="text-sm text-base-content/60 mt-1 line-clamp-1">{trip.description}</p>
							{/if}
						</div>
						<div class="text-right shrink-0 ml-4">
							<div class="badge badge-outline">{trip.entryCount} day{trip.entryCount !== 1 ? 's' : ''}</div>
						</div>
					</div>
					{#if trip.startDate}
						<p class="text-xs text-base-content/40 mt-2">
							{new Date(trip.startDate).toLocaleDateString()}
							{#if trip.endDate}— {new Date(trip.endDate).toLocaleDateString()}{/if}
						</p>
					{/if}
				</div>
			</a>
		{/each}
	</div>
{/if}
