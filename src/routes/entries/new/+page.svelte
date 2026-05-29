<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { db, seedRivers } from '$lib/db/index.js';
	import { fetchUsgsFlow } from '$lib/api/usgs.js';
	import RiverAutocomplete from '$lib/components/RiverAutocomplete.svelte';
	import TagInput from '$lib/components/TagInput.svelte';
	import type { River, JournalEntry, Trip, EntryTag } from '$lib/types.js';
	import { sync, syncStore } from '$lib/sync.svelte.js';
	import { onMount } from 'svelte';

	let selectedRiver = $state<River | null>(null);
	let date = $state(new Date().toISOString().slice(0, 10)); // just the date, time assigned on save
	let flow = $state<number | null>(null);
	let description = $state('');
	let tripId = $state<string | null>(null);
	let trips = $state<Trip[]>([]);
	let tags = $state<EntryTag[]>([]);
	let fetchingFlow = $state(false);
	let saving = $state(false);

	// If navigated from a trip page, pre-select that trip
	let fromTripId = $derived(page.url.searchParams.get('trip'));

	onMount(async () => {
		await seedRivers();
		trips = await db.trips.orderBy('name').toArray();
		if (fromTripId) {
			tripId = fromTripId;
		}
	});

	async function fetchFlow() {
		if (!selectedRiver?.externalGaugeId || !date || selectedRiver.externalGaugeSource !== 'usgs') return;
		fetchingFlow = true;
		const result = await fetchUsgsFlow(selectedRiver.externalGaugeId, date);
		if (result !== null) flow = Math.round(result);
		fetchingFlow = false;
	}

	// Auto-fetch flow when both river and date are set
	$effect(() => {
		if (selectedRiver?.externalGaugeId && selectedRiver.externalGaugeSource === 'usgs' && date) {
			fetchFlow();
		}
	});

	let saveError = $state<string | null>(null);

	async function save() {
		if (!selectedRiver || !date) return;
		saving = true;
		saveError = null;

		try {
			// Assign time based on how many entries already exist for this date
			// First entry = noon, second = 2pm, third = 4pm, etc. (capped at 10pm)
			const existingCount = await db.entries
				.filter((e) => !e.deletedAt && e.datetime.startsWith(date))
				.count();
			const hour = Math.min(12 + existingCount * 2, 22);
			const datetime = `${date}T${String(hour).padStart(2, '0')}:00:00.000Z`;

			const now = new Date().toISOString();
			const entry: JournalEntry = {
				id: crypto.randomUUID(),
				datetime,
				riverId: selectedRiver.id,
				flow: flow ?? 0,
				description,
				tripId,
				tags: $state.snapshot(tags) as EntryTag[],
				createdAt: now,
				updatedAt: now,
				deletedAt: null,
				dirty: true
			};

			await db.entries.put(entry);
			await syncStore.refreshPendingCount();
			try {
				await sync();
			} catch {
				// swallow — entry is dirty locally, next sync will retry
			}
			// If launched from a trip page, go back to it
			goto(fromTripId ? `/trips/${fromTripId}` : '/entries');
		} catch (err) {
			console.error('[save] failed:', err);
			saveError = err instanceof Error ? err.message : String(err);
		} finally {
			saving = false;
		}
	}

	let canFetchFlow = $derived(
		selectedRiver?.externalGaugeId &&
		selectedRiver?.externalGaugeSource === 'usgs' &&
		date
	);
</script>

<h1 class="text-3xl font-bold mb-6">Log a River Day</h1>

<div class="card bg-base-100 shadow">
	<div class="card-body">
		<div class="form-control mb-4">
			<label class="label" for="river">
				<span class="label-text">River</span>
			</label>
			<RiverAutocomplete bind:value={selectedRiver} />
			{#if selectedRiver}
				<label class="label">
					<span class="label-text-alt text-base-content/50">
						{selectedRiver.state}
						{#if selectedRiver.classRating}· Class {selectedRiver.classRating}{/if}
						{#if selectedRiver.externalGaugeId}· Has gauge ({selectedRiver.externalGaugeSource}){/if}
					</span>
				</label>
			{/if}
		</div>

		<div class="grid grid-cols-2 gap-4 mb-4">
			<div class="form-control">
				<label class="label" for="date">
						<span class="label-text">Date</span>
					</label>
					<input type="date" id="date" class="input input-bordered" bind:value={date} />
			</div>
			<div class="form-control">
				<label class="label" for="flow">
					<span class="label-text">Flow (CFS)</span>
				</label>
				<div class="join w-full">
					<input
						type="number"
						id="flow"
						class="input input-bordered join-item w-full"
						placeholder="0"
						bind:value={flow}
					/>
					{#if canFetchFlow}
						<button
							type="button"
							class="btn join-item btn-outline"
							class:loading={fetchingFlow}
							disabled={fetchingFlow}
							onclick={fetchFlow}
						>
							{fetchingFlow ? '' : '⟳'}
						</button>
					{/if}
				</div>
				{#if fetchingFlow}
					<label class="label">
						<span class="label-text-alt">Fetching from USGS...</span>
					</label>
				{/if}
			</div>
		</div>

		<div class="form-control mb-4 w-full">
			<label class="label" for="description">
				<span class="label-text">Notes</span>
			</label>
			<textarea
				id="description"
				class="textarea textarea-bordered w-full"
				rows="4"
				placeholder="How was the run?"
				bind:value={description}
			></textarea>
		</div>

		{#if trips.length > 0}
			<div class="form-control mb-4">
				<label class="label" for="trip">
					<span class="label-text">Trip (optional)</span>
				</label>
				<select id="trip" class="select select-bordered w-full" bind:value={tripId}>
					<option value={null}>No trip</option>
					{#each trips as t}
						<option value={t.id}>{t.name}</option>
					{/each}
				</select>
			</div>
		{/if}

		<div class="mb-6">
			<TagInput bind:value={tags} />
		</div>

		{#if saveError}
			<div class="alert alert-error mb-4">
				<span>Save failed: {saveError}</span>
			</div>
		{/if}

		<button
			class="btn btn-primary w-full"
			disabled={!selectedRiver || !date || saving}
			onclick={save}
		>
			{saving ? 'Saving...' : 'Save Entry'}
		</button>
	</div>
</div>
