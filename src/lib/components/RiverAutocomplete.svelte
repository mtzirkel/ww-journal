<script lang="ts">
	import { db } from '$lib/db/index.js';
	import type { River } from '$lib/types.js';
	import AddRiverModal from './AddRiverModal.svelte';
	import Fuse from 'fuse.js';
	import { onMount } from 'svelte';

	let {
		value = $bindable<River | null>(null),
		onselect
	}: {
		value?: River | null;
		onselect?: (river: River) => void;
	} = $props();

	let query = $state('');
	let results = $state<River[]>([]);
	let open = $state(false);
	let selectedIndex = $state(-1);
	let showAddModal = $state(false);
	let inputEl: HTMLInputElement;

	let fuse: Fuse<River> | null = null;

	onMount(async () => {
		const all = await db.rivers.toArray();
		fuse = new Fuse(all, {
			keys: [
				{ name: 'riverName', weight: 2 },
				{ name: 'section', weight: 1 },
				{ name: 'state', weight: 0.5 }
			],
			threshold: 0.4,      // 0 = exact, 1 = match anything — 0.4 is forgiving but not noisy
			distance: 200,       // allow matches anywhere in the string
			minMatchCharLength: 2,
			includeScore: true
		});
	});

	function search(q: string) {
		if (!fuse || q.length < 2) {
			results = [];
			return;
		}
		results = fuse.search(q, { limit: 10 }).map(r => r.item);
	}

	function select(river: River) {
		value = river;
		query = river.section
			? `${river.riverName} — ${river.section}`
			: river.riverName;
		open = false;
		selectedIndex = -1;
		onselect?.(river);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!open) return;
		const total = results.length + 1; // +1 for "Add new" option
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			selectedIndex = Math.min(selectedIndex + 1, total - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIndex = Math.max(selectedIndex - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (selectedIndex === results.length) {
				showAddModal = true;
				open = false;
			} else if (selectedIndex >= 0 && selectedIndex < results.length) {
				select(results[selectedIndex]);
			}
		} else if (e.key === 'Escape') {
			open = false;
		}
	}

	function handleNewRiver(river: River) {
		showAddModal = false;
		select(river);
	}

	$effect(() => {
		if (value && !query) {
			query = value.section
				? `${value.riverName} — ${value.section}`
				: value.riverName;
		}
	});
</script>

<div class="relative">
	<input
		bind:this={inputEl}
		type="text"
		class="input input-bordered w-full"
		placeholder="Search rivers..."
		bind:value={query}
		oninput={() => { open = true; selectedIndex = -1; value = null; search(query); }}
		onfocus={() => { if (query.length >= 2) { open = true; search(query); } }}
		onblur={() => setTimeout(() => { open = false; }, 200)}
		onkeydown={handleKeydown}
		autocomplete="off"
	/>

	{#if open && query.length >= 2}
		<ul class="absolute z-50 top-full left-0 right-0 mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
			{#each results as river, i}
				<li>
					<button
						type="button"
						class="w-full text-left px-4 py-2 text-sm hover:bg-base-200 transition-colors"
						class:bg-base-200={i === selectedIndex}
						onmousedown={() => select(river)}
					>
						<span class="font-medium">{river.riverName}</span>
						{#if river.section}
							<span class="text-base-content/50"> — {river.section}</span>
						{/if}
						<span class="text-xs text-base-content/40 ml-2">
							{river.state}
							{#if river.classRating}· {river.classRating}{/if}
							{#if river.externalGaugeId}· ⊚{/if}
						</span>
					</button>
				</li>
			{/each}
			<li>
				<button
					type="button"
					class="w-full text-left px-4 py-2 text-sm hover:bg-base-200 transition-colors border-t border-base-300 font-medium"
					class:bg-base-200={selectedIndex === results.length}
					style="color: var(--color-river)"
					onmousedown={() => { showAddModal = true; open = false; }}
				>
					+ Add "{query}" as new river
				</button>
			</li>
		</ul>
	{/if}
</div>

{#if showAddModal}
	<AddRiverModal
		initialName={query}
		onclose={() => showAddModal = false}
		onsave={handleNewRiver}
	/>
{/if}
