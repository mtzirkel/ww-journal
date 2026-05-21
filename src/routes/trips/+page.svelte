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

	// Inline edit state
	let editingId = $state<string | null>(null);
	let editName = $state('');
	let editDescription = $state('');
	let editSaving = $state(false);
	let editError = $state<string | null>(null);

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

	function startEdit(trip: Trip & { entryCount: number }, event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		editingId = trip.id;
		editName = trip.name;
		editDescription = trip.description ?? '';
		editError = null;
	}

	function cancelEdit(event?: MouseEvent) {
		event?.stopPropagation();
		editingId = null;
		editName = '';
		editDescription = '';
		editError = null;
	}

	async function saveEdit(event?: MouseEvent) {
		event?.stopPropagation();
		if (!editName.trim()) return;
		if (!editingId) return;
		editSaving = true;
		editError = null;
		try {
			const now = new Date().toISOString();
			await db.trips.update(editingId, {
				name: editName.trim(),
				description: editDescription.trim(),
				updatedAt: now,
				dirty: true
			});
			editingId = null;
			await syncStore.refreshPendingCount();
			sync();
		} catch (err) {
			editError = err instanceof Error ? err.message : 'Failed to save. Please try again.';
		} finally {
			editSaving = false;
		}
	}

	function handleEditKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			saveEdit();
		} else if (event.key === 'Escape') {
			cancelEdit();
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
			{#if editingId === trip.id}
				<!-- Edit mode: non-navigable card with inline form -->
				<div class="card bg-base-100 shadow border border-primary/40">
					<div class="card-body py-4">
						<div class="form-control mb-2">
							<input
								type="text"
								class="input input-bordered w-full font-bold text-lg"
								bind:value={editName}
								placeholder="Trip name"
								disabled={editSaving}
								onkeydown={handleEditKeydown}
								autofocus
							/>
						</div>
						<div class="form-control mb-3">
							<textarea
								class="textarea textarea-bordered w-full text-sm"
								rows="2"
								bind:value={editDescription}
								placeholder="Description (optional)"
								disabled={editSaving}
								onkeydown={handleEditKeydown}
							></textarea>
						</div>
						{#if editError}
							<p class="text-error text-sm mb-2">{editError}</p>
						{/if}
						<div class="flex gap-2 justify-end">
							<button
								class="btn btn-ghost btn-sm"
								disabled={editSaving}
								onclick={cancelEdit}
							>
								Cancel
							</button>
							<button
								class="btn btn-primary btn-sm"
								disabled={!editName.trim() || editSaving}
								onclick={saveEdit}
							>
								{#if editSaving}
									<span class="loading loading-spinner loading-xs"></span>
									Saving…
								{:else}
									Save
								{/if}
							</button>
						</div>
					</div>
				</div>
			{:else}
				<!-- View mode: navigable card with edit button -->
				<a href="/trips/{trip.id}" class="card bg-base-100 shadow hover:shadow-md transition-shadow block group">
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
									class="btn btn-ghost btn-xs opacity-0 group-hover:opacity-100 transition-opacity"
									title="Edit trip"
									onclick={(e) => startEdit(trip, e)}
									aria-label="Edit trip"
								>
									<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2a2 2 0 01.586-1.414z" />
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
			{/if}
		{/each}
	</div>
{/if}
