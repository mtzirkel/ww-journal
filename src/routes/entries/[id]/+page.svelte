<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { db, seedRivers } from '$lib/db/index.js';
	import { fetchUsgsFlow } from '$lib/api/usgs.js';
	import RiverAutocomplete from '$lib/components/RiverAutocomplete.svelte';
	import type { River, JournalEntry } from '$lib/types.js';
	import { onMount } from 'svelte';
	import { sync, syncStore } from '$lib/sync.svelte.js';

	let entry = $state<JournalEntry | null>(null);
	let river = $state<River | null>(null);
	let editing = $state(false);

	// Edit state
	let editRiver = $state<River | null>(null);
	let editDate = $state('');
	let editFlow = $state<number | null>(null);
	let editDescription = $state('');
	let fetchingFlow = $state(false);
	let saving = $state(false);

	onMount(async () => {
		await seedRivers();
		const id = page.params.id ?? '';
		entry = await db.entries.get(id) ?? null;
		if (entry) {
			river = await db.rivers.get(entry.riverId) ?? null;
		}
	});

	function startEdit() {
		if (!entry) return;
		editRiver = river;
		editDate = entry.date;
		editFlow = entry.flow;
		editDescription = entry.description;
		editing = true;
	}

	async function saveEdit() {
		if (!entry?.id || !editRiver) return;
		saving = true;
		await db.entries.update(entry.id, {
			riverId: editRiver.id,
			date: editDate,
			flow: editFlow ?? 0,
			description: editDescription,
			updatedAt: new Date().toISOString(),
			dirty: true
		});
		entry = await db.entries.get(entry.id) ?? null;
		river = editRiver;
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
		sync();
		goto('/entries');
	}

	async function fetchFlow() {
		if (!editRiver?.externalGaugeId || !editDate || editRiver.externalGaugeSource !== 'usgs') return;
		fetchingFlow = true;
		const result = await fetchUsgsFlow(editRiver.externalGaugeId, editDate);
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
			<div class="form-control mb-4">
				<label class="label"><span class="label-text">River</span></label>
				<RiverAutocomplete bind:value={editRiver} />
			</div>

			<div class="grid grid-cols-2 gap-4 mb-4">
				<div class="form-control">
					<label class="label" for="edit-date"><span class="label-text">Date</span></label>
					<input type="date" id="edit-date" class="input input-bordered" bind:value={editDate} />
				</div>
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
			</div>

			<div class="form-control mb-6">
				<label class="label" for="edit-desc"><span class="label-text">Notes</span></label>
				<textarea id="edit-desc" class="textarea textarea-bordered" rows="4" bind:value={editDescription}></textarea>
			</div>

			<button class="btn btn-primary w-full" disabled={!editRiver || saving} onclick={saveEdit}>
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
				{river?.riverName ?? 'Unknown River'}
				{#if river?.section}
					<span class="font-normal text-base-content/50 text-lg"> — {river.section}</span>
				{/if}
			</h2>

			<div class="grid grid-cols-2 gap-4 mt-4">
				<div>
					<p class="text-sm text-base-content/50">Date</p>
					<p class="font-medium">{new Date(entry.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
				</div>
				<div>
					<p class="text-sm text-base-content/50">Flow</p>
					<p class="font-mono text-lg">{entry.flow} <span class="text-sm text-base-content/50">CFS</span></p>
				</div>
			</div>

			{#if river}
				<div class="mt-2">
					<p class="text-sm text-base-content/50">
						{river.state}
						{#if river.classRating}· Class {river.classRating}{/if}
					</p>
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
