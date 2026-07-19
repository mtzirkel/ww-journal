<script lang="ts">
	import { liveQuery } from 'dexie';
	import { db, seedRivers } from '$lib/db/index.js';
	import { riverIdOf, flowOf, riverIds, lookupRiver } from '$lib/activity.js';
	import type { Trip, JournalEntry, River } from '$lib/types.js';
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

	// Entry assignment state
	let assignTrip = $state<(Trip & { entryCount: number }) | null>(null);
	let assignEntries = $state<(JournalEntry & { river?: River })[]>([]);
	let assignLoaded = $state(false);
	let assignSearch = $state('');
	let assignError = $state<string | null>(null);
	let rivers = $state<Map<number, River>>(new Map());
	let assignSubscription: { unsubscribe: () => void } | undefined;

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

		return () => {
			subscription?.unsubscribe();
			assignSubscription?.unsubscribe();
		};
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

	async function openAssign(trip: Trip & { entryCount: number }, e: Event) {
		e.preventDefault();
		e.stopPropagation();
		assignTrip = trip;
		assignSearch = '';
		assignError = null;
		assignLoaded = false;

		// Load rivers lazily (first open)
		if (rivers.size === 0) {
			await seedRivers();
			const allRivers = await db.rivers.toArray();
			rivers = new Map(allRivers.map((r) => [r.id, r]));
		}

		// Live subscription to all non-deleted entries
		assignSubscription?.unsubscribe();
		const observable = liveQuery(async () => {
			const all = await db.entries.orderBy('datetime').reverse().toArray();
			return all.filter((e) => !e.deletedAt);
		});
		assignSubscription = observable.subscribe((value) => {
			assignEntries = value.map((e) => ({ ...e, river: lookupRiver(rivers, e) }));
			assignLoaded = true;
		});
	}

	function closeAssign() {
		assignSubscription?.unsubscribe();
		assignSubscription = undefined;
		assignTrip = null;
		assignEntries = [];
		assignLoaded = false;
		assignError = null;
	}

	async function toggleEntry(entry: JournalEntry & { river?: River }) {
		if (!assignTrip || !entry.id) return;
		assignError = null;
		try {
			const now = new Date().toISOString();
			if (entry.tripId === assignTrip.id) {
				await db.entries.update(entry.id, { tripId: null, dirty: true, updatedAt: now });
			} else {
				await db.entries.update(entry.id, { tripId: assignTrip.id, dirty: true, updatedAt: now });
			}
			await syncStore.refreshPendingCount();
			sync();
		} catch (err) {
			assignError = err instanceof Error ? err.message : String(err);
		}
	}

	let filteredAssignEntries = $derived.by(() => {
		const q = assignSearch.trim().toLowerCase();
		if (!q) return assignEntries;
		return assignEntries.filter((e) => {
			if (e.river?.riverName?.toLowerCase().includes(q)) return true;
			if (e.river?.section?.toLowerCase().includes(q)) return true;
			if (e.description?.toLowerCase().includes(q)) return true;
			if (e.datetime.toLowerCase().includes(q)) return true;
			return false;
		});
	});

	let assignedCount = $derived(
		assignEntries.filter((e) => assignTrip && e.tripId === assignTrip.id).length
	);
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
							<!-- Assign entries button -->
							<button
								class="btn btn-ghost btn-xs"
								onclick={(e) => openAssign(trip, e)}
								title="Assign entries"
								aria-label="Assign entries to {trip.name}"
							>
								<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
								</svg>
							</button>
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

<!-- Assign Entries Modal -->
{#if assignTrip}
	<div class="modal modal-open" role="dialog" aria-modal="true" aria-label="Assign entries to trip">
		<div class="modal-box max-w-2xl">
			<div class="flex justify-between items-center mb-1">
				<h3 class="font-bold text-lg">Assign entries</h3>
				<button class="btn btn-ghost btn-sm" onclick={closeAssign} aria-label="Close">✕</button>
			</div>
			<p class="text-sm text-base-content/60 mb-3">
				<span class="font-medium text-base-content">{assignTrip.name}</span>
				{#if assignLoaded}
					— {assignedCount} {assignedCount === 1 ? 'entry' : 'entries'} assigned
				{/if}
			</p>

			<input
				type="search"
				placeholder="Search river, section, notes, date..."
				bind:value={assignSearch}
				class="input input-bordered input-sm w-full mb-3"
			/>

			{#if assignError}
				<div class="alert alert-error mb-3 py-2">
					<span class="text-sm">{assignError}</span>
				</div>
			{/if}

			{#if !assignLoaded}
				<div class="text-center py-10">
					<span class="loading loading-spinner loading-md"></span>
				</div>
			{:else if filteredAssignEntries.length === 0}
				<p class="text-center text-base-content/50 py-8">
					{assignSearch ? 'No matching entries' : 'No entries yet'}
				</p>
			{:else}
				<div class="space-y-1 max-h-[26rem] overflow-y-auto pr-1">
					{#each filteredAssignEntries as entry}
						{@const inTrip = entry.tripId === assignTrip.id}
						{@const otherTrip = entry.tripId && entry.tripId !== assignTrip.id}
						<label
							class="flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors {inTrip ? 'bg-primary/10' : 'hover:bg-base-200'} {otherTrip ? 'opacity-60' : ''}"
						>
							<input
								type="checkbox"
								class="checkbox checkbox-primary checkbox-sm shrink-0"
								checked={inTrip}
								onchange={() => toggleEntry(entry)}
								disabled={!!otherTrip}
								title={otherTrip ? 'Assigned to another trip' : ''}
							/>
							<div class="flex-1 min-w-0">
								<div class="font-semibold text-sm truncate">
									{entry.river?.riverName ?? 'Unknown'}
									{#if entry.river?.section}
										<span class="font-normal text-base-content/50"> — {entry.river.section}</span>
									{/if}
								</div>
								{#if entry.description}
									<p class="text-xs text-base-content/60 truncate">{entry.description}</p>
								{/if}
							</div>
							<div class="text-right text-xs shrink-0">
								<div class="text-base-content/50">{new Date(entry.datetime).toLocaleDateString()}</div>
								<div class="font-mono">{flowOf(entry)} cfs</div>
							</div>
						</label>
					{/each}
				</div>
			{/if}

			<div class="modal-action">
				<button class="btn btn-primary" onclick={closeAssign}>Done</button>
			</div>
		</div>
		<button class="modal-backdrop" onclick={closeAssign} aria-label="Close"></button>
	</div>
{/if}
