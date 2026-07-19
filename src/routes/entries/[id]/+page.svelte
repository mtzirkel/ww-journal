<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { db, seedRivers } from '$lib/db/index.js';
	import {
		activityMeta,
		isRiverBased,
		riverIdOf,
		flowOf,
		toMiles,
		toFeet,
		fromMiles,
		fromFeet,
		formatDuration
	} from '$lib/activity.js';
	import { fetchUsgsFlow } from '$lib/api/usgs.js';
	import RiverAutocomplete from '$lib/components/RiverAutocomplete.svelte';
	import ActivityPicker from '$lib/components/ActivityPicker.svelte';
	import type { River, JournalEntry, Trip, ActivityType } from '$lib/types.js';
	import { onMount } from 'svelte';
	import { sync, syncStore } from '$lib/sync.svelte.js';

	let entry = $state<JournalEntry | null>(null);
	let river = $state<River | null>(null);
	let trip = $state<Trip | null>(null);
	let trips = $state<Trip[]>([]);
	let editing = $state(false);

	// Edit state
	let editActivityType = $state<ActivityType>('paddle');
	let editRiver = $state<River | null>(null);
	let editPlace = $state('');
	let editDatetime = $state('');
	let editFlow = $state<number | null>(null);
	let editDistanceMi = $state<number | null>(null);
	let editElevationFt = $state<number | null>(null);
	let editDurationHrs = $state<number | null>(null);
	let editDescription = $state('');
	let editTripId = $state<string | null>(null);
	let fetchingFlow = $state(false);
	let saving = $state(false);

	onMount(async () => {
		await seedRivers();
		const id = page.params.id ?? '';
		entry = await db.entries.get(id) ?? null;
		if (entry) {
			const rid = riverIdOf(entry);
			river = rid === null ? null : (await db.rivers.get(rid)) ?? null;
			trip = entry.tripId ? (await db.trips.get(entry.tripId)) ?? null : null;
		}
		trips = (await db.trips.toArray()).filter((t) => !t.deletedAt).sort((a, b) => a.name.localeCompare(b.name));
	});

	/** Headline: the river for river days, otherwise whatever names this outing. */
	let heading = $derived.by(() => {
		if (!entry) return '';
		if (river) return river.riverName;
		return entry.title || entry.place || activityMeta(entry.activityType).label;
	});

	function startEdit() {
		if (!entry) return;
		editActivityType = entry.activityType;
		editRiver = river;
		editPlace = entry.place ?? '';
		editDatetime = new Date(entry.datetime).toISOString().slice(0, 16);
		editFlow = flowOf(entry);
		editDistanceMi = entry.distance === null ? null : Number(toMiles(entry.distance).toFixed(2));
		editElevationFt = entry.elevationGain === null ? null : Math.round(toFeet(entry.elevationGain));
		editDurationHrs = entry.durationSeconds === null ? null : Number((entry.durationSeconds / 3600).toFixed(2));
		editDescription = entry.description;
		editTripId = entry.tripId ?? null;
		editing = true;
	}

	async function saveEdit() {
		if (!entry?.id) return;
		// A river is only required for river-based activities.
		if (isRiverBased(editActivityType) && !editRiver) return;
		saving = true;

		const details =
			isRiverBased(editActivityType) && editRiver
				? { riverId: editRiver.id, flow: editFlow ?? null }
				: {};

		await db.entries.update(entry.id, {
			activityType: editActivityType,
			place: editPlace.trim() || null,
			details,
			distance: editDistanceMi === null ? null : fromMiles(editDistanceMi),
			elevationGain: editElevationFt === null ? null : fromFeet(editElevationFt),
			durationSeconds: editDurationHrs === null ? null : Math.round(editDurationHrs * 3600),
			datetime: new Date(editDatetime).toISOString(),
			description: editDescription,
			tripId: editTripId,
			updatedAt: new Date().toISOString(),
			dirty: true
		});
		entry = await db.entries.get(entry.id) ?? null;
		river = isRiverBased(editActivityType) ? editRiver : null;
		trip = editTripId ? (await db.trips.get(editTripId)) ?? null : null;
		editing = false;
		saving = false;
		await syncStore.refreshPendingCount();
		sync();
	}

	async function deleteEntry() {
		if (!entry?.id || !confirm('Delete this entry?')) return;
		// Soft delete — set deletedAt and dirty so sync propagates the deletion
		await db.entries.update(entry.id, {
			deletedAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			dirty: true
		});
		await syncStore.refreshPendingCount();
		try {
			await sync();
		} catch {
			// swallow — entry is dirty locally, next sync will retry
		}
		goto('/entries');
	}

	async function fetchFlow() {
		if (!editRiver?.externalGaugeId || !editDatetime || editRiver.externalGaugeSource !== 'usgs') return;
		fetchingFlow = true;
		const result = await fetchUsgsFlow(editRiver.externalGaugeId, editDatetime.slice(0, 10));
		if (result !== null) editFlow = Math.round(result);
		fetchingFlow = false;
	}
</script>

{#if !entry}
	<div class="text-center py-12">
		<span class="loading loading-spinner loading-lg"></span>
	</div>
{:else if editing}
	<div class="flex justify-between items-center mb-6">
		<h1 class="text-3xl font-bold">Edit Entry</h1>
		<button class="btn btn-ghost btn-sm" onclick={() => editing = false}>Cancel</button>
	</div>

	<div class="card bg-base-100 shadow">
		<div class="card-body">
			<ActivityPicker bind:value={editActivityType} />


			{#if isRiverBased(editActivityType)}
				<div class="form-control mb-4">
					<label class="label"><span class="label-text">River</span></label>
					<RiverAutocomplete bind:value={editRiver} />
				</div>
			{:else}
				<div class="form-control mb-4">
					<label class="label" for="edit-place"><span class="label-text">Place</span></label>
					<input
						type="text"
						id="edit-place"
						class="input input-bordered"
						placeholder="Trail, route, or location"
						bind:value={editPlace}
					/>
				</div>
			{/if}

			<div class="grid {isRiverBased(editActivityType) ? 'grid-cols-2' : 'grid-cols-1'} gap-4 mb-4">
				<div class="form-control">
					<label class="label" for="edit-datetime"><span class="label-text">Date & Time</span></label>
					<input type="datetime-local" id="edit-datetime" class="input input-bordered" bind:value={editDatetime} />
				</div>
				{#if isRiverBased(editActivityType)}
					<div class="form-control">
						<label class="label" for="edit-flow"><span class="label-text">Flow (CFS)</span></label>
						<div class="join w-full">
							<input type="number" id="edit-flow" class="input input-bordered join-item w-full" bind:value={editFlow} />
							{#if editRiver?.externalGaugeId && editRiver.externalGaugeSource === 'usgs'}
								<button type="button" class="btn join-item btn-outline" disabled={fetchingFlow} onclick={fetchFlow}>
									{fetchingFlow ? '...' : '⟳'}
								</button>
							{/if}
						</div>
					</div>
				{/if}
			</div>

			<div class="grid grid-cols-3 gap-4 mb-4">
				<div class="form-control">
					<label class="label" for="edit-distance"><span class="label-text">Distance (mi)</span></label>
					<input type="number" step="0.1" id="edit-distance" class="input input-bordered" placeholder="—" bind:value={editDistanceMi} />
				</div>
				<div class="form-control">
					<label class="label" for="edit-elevation"><span class="label-text">Elevation (ft)</span></label>
					<input type="number" step="10" id="edit-elevation" class="input input-bordered" placeholder="—" bind:value={editElevationFt} />
				</div>
				<div class="form-control">
					<label class="label" for="edit-duration"><span class="label-text">Duration (hrs)</span></label>
					<input type="number" step="0.25" id="edit-duration" class="input input-bordered" placeholder="—" bind:value={editDurationHrs} />
				</div>
			</div>

			{#if trips.length > 0}
				<div class="form-control mb-4">
					<label class="label" for="edit-trip"><span class="label-text">Trip (optional)</span></label>
					<select id="edit-trip" class="select select-bordered w-full" bind:value={editTripId}>
						<option value={null}>No trip</option>
						{#each trips as t}
							<option value={t.id}>{t.name}</option>
						{/each}
					</select>
				</div>
			{/if}

			<div class="form-control mb-6">
				<label class="label" for="edit-desc"><span class="label-text">Notes</span></label>
				<textarea id="edit-desc" class="textarea textarea-bordered" rows="4" bind:value={editDescription}></textarea>
			</div>

			<button
				class="btn btn-primary w-full"
				disabled={(isRiverBased(editActivityType) && !editRiver) || saving}
				onclick={saveEdit}
			>
				{saving ? 'Saving...' : 'Save Changes'}
			</button>
		</div>
	</div>
{:else}
	<div class="flex justify-between items-center mb-6">
		<a href="/entries" class="btn btn-ghost btn-sm">&larr; Back</a>
		<div class="flex gap-2">
			<button class="btn btn-sm btn-outline" onclick={startEdit}>Edit</button>
			<button class="btn btn-sm btn-error btn-outline" onclick={deleteEntry}>Delete</button>
		</div>
	</div>

	<div class="card bg-base-100 shadow">
		<div class="card-body">
			<h2 class="card-title text-2xl">
				<span title={activityMeta(entry.activityType).label}>
					{activityMeta(entry.activityType).icon}
				</span>
				{heading}
				{#if river?.section}
					<span class="font-normal text-base-content/50 text-lg"> — {river.section}</span>
				{/if}
			</h2>

			<div class="flex flex-wrap gap-x-10 gap-y-4 mt-4">
				<div>
					<p class="text-sm text-base-content/50">Date</p>
					<p class="font-medium">{new Date(entry.datetime).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
				</div>
				{#if flowOf(entry) !== null}
					<div>
						<p class="text-sm text-base-content/50">Flow</p>
						<p class="font-mono text-lg">{flowOf(entry)?.toLocaleString()} <span class="text-sm text-base-content/50">CFS</span></p>
					</div>
				{/if}
				{#if river && entry.place}
					<div>
						<p class="text-sm text-base-content/50">Place</p>
						<p class="font-medium">{entry.place}</p>
					</div>
				{/if}
				{#if entry.distance !== null}
					<div>
						<p class="text-sm text-base-content/50">Distance</p>
						<p class="font-mono text-lg">{toMiles(entry.distance).toFixed(1)} <span class="text-sm text-base-content/50">mi</span></p>
					</div>
				{/if}
				{#if entry.elevationGain !== null}
					<div>
						<p class="text-sm text-base-content/50">Elevation</p>
						<p class="font-mono text-lg">{Math.round(toFeet(entry.elevationGain)).toLocaleString()} <span class="text-sm text-base-content/50">ft</span></p>
					</div>
				{/if}
				{#if entry.durationSeconds !== null}
					<div>
						<p class="text-sm text-base-content/50">Duration</p>
						<p class="font-mono text-lg">{formatDuration(entry.durationSeconds)}</p>
					</div>
				{/if}
			</div>

			{#if river}
				<div class="mt-2">
					<p class="text-sm text-base-content/50">
						{river.state}
						{#if river.classRating}· Class {river.classRating}{/if}
					</p>
				</div>
			{/if}

			{#if trip}
				<div class="mt-3">
					<a href="/trips/{trip.id}" class="badge badge-outline gap-1">⛰ {trip.name}</a>
				</div>
			{/if}

			{#if entry.tags && entry.tags.length > 0}
				<div class="mt-4 flex flex-wrap gap-2">
					{#each entry.tags as tag}
						<span class="badge badge-outline gap-1">
							<span class="text-base-content/50">{tag.category}:</span> {tag.value}
						</span>
					{/each}
				</div>
			{/if}

			{#if entry.description}
				<div class="mt-4 pt-4 border-t border-base-300">
					<p class="whitespace-pre-wrap">{entry.description}</p>
				</div>
			{/if}
		</div>
	</div>
{/if}
