<script lang="ts">
	import { goto } from '$app/navigation';
	import { db, seedRivers } from '$lib/db/index.js';
	import { fetchUsgsFlow } from '$lib/api/usgs.js';
	import RiverAutocomplete from '$lib/components/RiverAutocomplete.svelte';
	import TagInput from '$lib/components/TagInput.svelte';
	import type { River, JournalEntry, Trip, EntryTag } from '$lib/types.js';
	import { sync, syncStore } from '$lib/sync.svelte.js';
	import { onMount } from 'svelte';

	let selectedRiver = $state<River | null>(null);
	let datetime = $state(new Date().toISOString().slice(0, 16)); // datetime-local: "YYYY-MM-DDTHH:MM"
	// Default to noon so same-day laps are distinct even if time isn't changed
	$effect.pre(() => {
		if (datetime.endsWith('T00:00')) {
			datetime = datetime.slice(0, 10) + 'T12:00';
		}
	});
	let flow = $state<number | null>(null);
	let description = $state('');
	let tripId = $state<string | null>(null);
	let trips = $state<Trip[]>([]);
	let tags = $state<EntryTag[]>([]);
	let fetchingFlow = $state(false);
	let saving = $state(false);

	onMount(async () => {
		await seedRivers();
		trips = await db.trips.orderBy('name').toArray();
	});

	async function fetchFlow() {
		if (!selectedRiver?.externalGaugeId || !datetime || selectedRiver.externalGaugeSource !== 'usgs') return;
		fetchingFlow = true;
		const dateOnly = datetime.slice(0, 10);
		const result = await fetchUsgsFlow(selectedRiver.externalGaugeId, dateOnly);
		if (result !== null) flow = Math.round(result);
		fetchingFlow = false;
	}

	// Auto-fetch flow when both river and datetime are set
	$effect(() => {
		if (selectedRiver?.externalGaugeId && selectedRiver.externalGaugeSource === 'usgs' && datetime) {
			fetchFlow();
		}
	});

	let saveError = $state<string | null>(null);

	async function save() {
		if (!selectedRiver || !datetime) return;
		saving = true;
		saveError = null;

		try {
			const now = new Date().toISOString();
			const entry: JournalEntry = {
				id: crypto.randomUUID(),
				datetime: new Date(datetime).toISOString(),
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
			goto('/entries');
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
		datetime
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
				<label class="label" for="datetime">
						<span class="label-text">Date & Time</span>
					</label>
					<input type="datetime-local" id="datetime" class="input input-bordered" bind:value={datetime} />
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
			disabled={!selectedRiver || !datetime || saving}
			onclick={save}
		>
			{saving ? 'Saving...' : 'Save Entry'}
		</button>
	</div>
</div>
