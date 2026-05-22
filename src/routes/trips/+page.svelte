<script lang="ts">
	import { liveQuery } from 'dexie';
	import { db, seedRivers } from '$lib/db/index.js';
	import type { Trip, JournalEntry, River } from '$lib/types.js';
	import { onMount } from 'svelte';
	import { sync, syncStore } from '$lib/sync.svelte.js';

	let trips = $state<(Trip & { entryCount: number })[]>([]);
	let loaded = $state(false);
	let showCreate = $state(false);

	let newName = $state('');
	let newDescription = $state('');
	let saving = $state(false);

	// Entry assignment state
	let assigningTrip = $state<(Trip & { entryCount: number }) | null>(null);
	let assignEntries = $state<(JournalEntry & { river?: River })[]>([]);
	let assignSearch = $state('');
	let assignLoading = $state(false);
	let assignError = $state<string | null>(null);
	let rivers = $state<Map<number, River>>(new Map());
	let riversLoaded = $state(false);

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

	// --- Entry assignment ---

	async function openAssign(trip: Trip & { entryCount: number }, e: Event) {
		e.preventDefault();
		e.stopPropagation();
		assigningTrip = trip;
		assignSearch = '';
		assignError = null;
		assignLoading = true;

		try {
			if (!riversLoaded) {
				await seedRivers();
				const allRivers = await db.rivers.toArray();
				rivers = new Map(allRivers.map((r) => [r.id, r]));
				riversLoaded = true;
			}
			const all = await db.entries.orderBy('datetime').reverse().toArray();
			assignEntries = all
				.filter((e) => !e.deletedAt)
				.map((e) => ({ ...e, river: rivers.get(e.riverId) }));
		} catch (err) {
			assignError = err instanceof Error ? err.message : String(err);
		} finally {
			assignLoading = false;
		}
	}

	function closeAssign() {
		assigningTrip = null;
		assignEntries = [];
		assignSearch = '';
		assignError = null;
	}

	async function toggleEntry(entryId: string, currentlyAssigned: boolean) {
		if (!assigningTrip) return;
		const now = new Date().toISOString();
		if (currentlyAssigned) {
			await db.entries.update(entryId, { tripId: null, dirty: true, updatedAt: now });
		} else {
			await db.entries.update(entryId, { tripId: assigningTrip.id, dirty: true, updatedAt: now });
		}
		// Refresh local list so checkboxes update immediately
		const all = await db.entries.orderBy('datetime').reverse().toArray();
		assignEntries = all
			.filter((e) => !e.deletedAt)
			.map((e) => ({ ...e, river: rivers.get(e.riverId) }));
		await syncStore.refreshPendingCount();
		sync();
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
								class="btn btn-ghost btn-xs"
								onclick={(e) => openAssign(trip, e)}
								title="Assign entries to this trip"
							>
								Assign entries
							</button>
							<button
								class="btn btn-ghost btn-xs text-error"
								onclick={(e) => { e.preventDefault(); e.stopPropagation(); deleteTrip(trip.id); }}
								title="Delete trip"
							>
								Delete
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

<!-- Entry Assignment Modal -->
{#if assigningTrip}
	<div class="modal modal-open" role="dialog" aria-modal="true" aria-label="Assign entries to {assigningTrip.name}">
		<div class="modal-box max-w-2xl flex flex-col max-h-[80vh]">
			<div class="flex justify-between items-center mb-3 shrink-0">
				<h3 class="font-bold text-lg">Assign entries — {assigningTrip.name}</h3>
				<button class="btn btn-ghost btn-sm" onclick={closeAssign}>✕</button>
			</div>

			<input
				type="search"
				placeholder="Search river, notes, date..."
				bind:value={assignSearch}
				class="input input-bordered input-sm w-full mb-3 shrink-0"
			/>

			{#if assignLoading}
				<div class="flex justify-center py-8">
					<span class="loading loading-spinner loading-md"></span>
				</div>
			{:else if assignError}
				<div class="alert alert-error mb-3">
					<span>Error loading entries: {assignError}</span>
				</div>
			{:else if filteredAssignEntries.length === 0}
				<p class="text-center text-base-content/50 py-8">
					{assignSearch ? 'No matching entries' : 'No entries found'}
				</p>
			{:else}
				<div class="overflow-y-auto flex-1 space-y-1 pr-1">
					{#each filteredAssignEntries as entry}
						{@const assigned = entry.tripId === assigningTrip!.id}
						<label
							class="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors {assigned ? 'bg-primary/10 hover:bg-primary/15' : 'bg-base-200 hover:bg-base-300'}"
						>
							<input
								type="checkbox"
								class="checkbox checkbox-primary checkbox-sm shrink-0"
								checked={assigned}
								onchange={() => entry.id && toggleEntry(entry.id, assigned)}
							/>
							<div class="min-w-0 flex-1">
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
								<div class="font-mono">{entry.flow} cfs</div>
							</div>
						</label>
					{/each}
				</div>
			{/if}

			<div class="modal-action shrink-0 mt-3">
				<button class="btn btn-primary" onclick={closeAssign}>Done</button>
			</div>
		</div>
		<button class="modal-backdrop" onclick={closeAssign} aria-label="Close"></button>
	</div>
{/if}
