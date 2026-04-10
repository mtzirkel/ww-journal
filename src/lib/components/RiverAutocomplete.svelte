<script lang="ts">
	import { db } from '$lib/db/index.js';
	import type { River } from '$lib/types.js';

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
	let inputEl: HTMLInputElement;

	async function search(q: string) {
		if (q.length < 2) {
			results = [];
			return;
		}
		const lower = q.toLowerCase();
		results = await db.rivers
			.filter((r) => r.riverName.toLowerCase().includes(lower) ||
				(r.section?.toLowerCase().includes(lower) ?? false) ||
				(r.altName?.toLowerCase().includes(lower) ?? false))
			.limit(10)
			.toArray();
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
		if (!open || results.length === 0) return;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			selectedIndex = Math.min(selectedIndex + 1, results.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIndex = Math.max(selectedIndex - 1, 0);
		} else if (e.key === 'Enter' && selectedIndex >= 0) {
			e.preventDefault();
			select(results[selectedIndex]);
		} else if (e.key === 'Escape') {
			open = false;
		}
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
		oninput={() => { open = true; selectedIndex = -1; search(query); }}
		onfocus={() => { if (query.length >= 2) { open = true; search(query); } }}
		onblur={() => setTimeout(() => { open = false; }, 200)}
		onkeydown={handleKeydown}
		autocomplete="off"
	/>

	{#if open && results.length > 0}
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
		</ul>
	{/if}
</div>
