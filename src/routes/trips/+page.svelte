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

	// Delete confirmation state
	let confirmDeleteTrip = $state<(Trip & { entryCount: number }) | null>(null);
	let deleting = $state(false);
	let deleteError = $state<string | null>(null);

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

	function openDeleteConfirm(trip: Trip & { entryCount: number }, e: Event) {
		e.preventDefault();
		e.stopPropagation();
		confirmDeleteTrip = trip;
		deleteError = null;
	}

	function cancelDelete() {
		if (deleting) return;
		confirmDeleteTrip = null;
		deleteError = null;
	}

	async function confirmDelete() {
		if (!confirmDeleteTrip) return;
		deleting = true;
		deleteError = null;
		try {
			const id = confirmDeleteTrip.id;
			const now = new Date().toISOString();
			// Unlink entries
			await db.entries.where('tripId').equals(id).modify({ tripId: null, dirty: true, updatedAt: now });
			// Soft delete trip
			await db.trips.update(id, { deletedAt: now, updatedAt: now, dirty: true });
			await syncStore.refreshPendingCount();
			sync();
			confirmDeleteTrip = null;
		} catch (err) {
			deleteError = err instanceof Error ? err.message : String(err);
		} finally {
			deleting = false;
		}
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
						<div class="min-w-0 flex-1">
							<h3 class="font-bold text-lg">{trip.name}</h3>
							{#if trip.description}
								<p class="text-sm text-base-content/60 mt-1 line-clamp-1">{trip.description}</p>
							{/if}
						</div>
						<div class="flex items-center gap-2 shrink-0 ml-4">
							<div class="badge badge-outline">{trip.entryCount} day{trip.entryCount !== 1 ? 's' : ''}</div>
							<button
								class="btn btn-ghost btn-xs text-error"
								onclick={(e) => openDeleteConfirm(trip, e)}
								title="Delete trip"
								aria-label="Delete {trip.name}"
							>
								<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
								</svg>
							</button>
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

<!-- Delete Confirmation Modal -->
{#if confirmDeleteTrip}
	<div class="modal modal-open" role="dialog" aria-modal="true" aria-label="Delete trip confirmation">
		<div class="modal-box">
			<h3 class="font-bold text-lg mb-2">Delete trip?</h3>
			<p class="mb-1">
				Are you sure you want to delete <span class="font-semibold">"{confirmDeleteTrip.name}"</span>?
			</p>
			<p class="text-sm text-base-content/60 mb-4">
				{confirmDeleteTrip.entryCount > 0
					? `${confirmDeleteTrip.entryCount} linked ${confirmDeleteTrip.entryCount === 1 ? 'entry' : 'entries'} will be unlinked but not deleted. `
					: ''}This action cannot be undone.
			</p>

			{#if deleteError}
				<div class="alert alert-error mb-4">
					<span>{deleteError}</span>
				</div>
			{/if}

			<div class="modal-action">
				<button class="btn btn-ghost" onclick={cancelDelete} disabled={deleting}>
					Cancel
				</button>
				<button class="btn btn-error" onclick={confirmDelete} disabled={deleting}>
					{#if deleting}
						<span class="loading loading-spinner loading-sm"></span>
						Deleting...
					{:else}
						Delete trip
					{/if}
				</button>
			</div>
		</div>
		<button class="modal-backdrop" onclick={cancelDelete} aria-label="Close"></button>
	</div>
{/if}
