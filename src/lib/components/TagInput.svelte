<script lang="ts">
	import { db, seedTagCategories } from '$lib/db/index.js';
	import type { EntryTag, TagCategory } from '$lib/types.js';
	import Fuse from 'fuse.js';
	import { onMount } from 'svelte';

	let {
		value = $bindable<EntryTag[]>([])
	}: {
		value?: EntryTag[];
	} = $props();

	let categories = $state<TagCategory[]>([]);
	let expanded = $state(false);
	let selectedCategory = $state('');
	let query = $state('');
	let inputEl: HTMLInputElement | undefined = $state();

	onMount(async () => {
		await seedTagCategories();
		categories = await db.tagCategories.toArray();
		// Auto-select if only one category
		if (categories.length === 1) selectedCategory = categories[0].name;
	});

	// Build a fuse index for the active category's known values
	let fuse = $derived.by(() => {
		const cat = categories.find(c => c.name === selectedCategory);
		if (!cat || cat.values.length === 0) return null;
		return new Fuse(cat.values, { threshold: 0.4, minMatchCharLength: 1 });
	});

	// Suggestions: all known values when query is empty, fuzzy-filtered when typing
	// Excludes values already applied to this entry
	let suggestions = $derived.by(() => {
		const cat = categories.find(c => c.name === selectedCategory);
		if (!cat) return [] as string[];

		const already = new Set(
			value.filter(t => t.category === selectedCategory).map(t => t.value)
		);

		let pool: string[];
		if (query.trim().length === 0) {
			pool = cat.values;
		} else if (fuse) {
			pool = fuse.search(query, { limit: 8 }).map(r => r.item);
		} else {
			pool = [];
		}

		return pool.filter(v => !already.has(v));
	});

	function addTag(val: string) {
		const v = val.trim();
		if (!selectedCategory || !v) return;

		const tag: EntryTag = { category: selectedCategory, value: v };
		if (!value.some(t => t.category === tag.category && t.value === tag.value)) {
			value = [...value, tag];

			// Remember this value for future autocomplete
			const cat = categories.find(c => c.name === selectedCategory);
			if (cat && !cat.values.includes(tag.value)) {
				cat.values = [...cat.values, tag.value];
				db.tagCategories.update(cat.id, { values: cat.values, updatedAt: new Date().toISOString(), dirty: true });
			}
		}
		query = '';
		inputEl?.focus();
	}

	function removeTag(index: number) {
		value = value.filter((_, i) => i !== index);
	}

	function selectCategory(name: string) {
		selectedCategory = selectedCategory === name ? '' : name;
		query = '';
		// Focus input after tick
		setTimeout(() => inputEl?.focus(), 50);
	}

	async function addCategory() {
		const name = query.trim();
		if (!name) return;
		const existing = categories.find(c => c.name.toLowerCase() === name.toLowerCase());
		if (existing) { selectedCategory = existing.name; query = ''; return; }

		const now = new Date().toISOString();
		await db.tagCategories.add({
			id: crypto.randomUUID(),
			name,
			icon: '🏷',
			values: [],
			createdAt: now,
			updatedAt: now,
			deletedAt: null,
			dirty: true
		});
		categories = await db.tagCategories.toArray();
		selectedCategory = name;
		query = '';
	}

	// Is the typed query a genuinely new value (not in suggestions)?
	let isNew = $derived(
		query.trim().length > 0 &&
		!suggestions.some(s => s.toLowerCase() === query.trim().toLowerCase())
	);
</script>

<div class="form-control">
	<!-- Header row: toggle + current tags -->
	<button
		type="button"
		class="btn btn-sm btn-ghost justify-start gap-2"
		onclick={() => expanded = !expanded}
	>
		<span class="text-xs">{expanded ? '▾' : '▸'}</span>
		Tags ({value.length})
	</button>

	{#if value.length > 0}
		<div class="flex flex-wrap gap-1 mt-1 ml-2">
			{#each value as tag, i}
				<span class="badge badge-sm gap-1">
					<span class="text-base-content/50">{tag.category}:</span> {tag.value}
					<button type="button" class="text-error font-bold" onclick={() => removeTag(i)}>&times;</button>
				</span>
			{/each}
		</div>
	{/if}

	{#if expanded}
		<div class="bg-base-200 rounded-lg p-3 mt-2 space-y-3">

			<!-- Category selector tabs -->
			<div class="flex flex-wrap gap-1">
				{#each categories as cat}
					<button
						type="button"
						class="btn btn-xs"
						class:btn-primary={selectedCategory === cat.name}
						class:btn-ghost={selectedCategory !== cat.name}
						onclick={() => selectCategory(cat.name)}
					>
						{cat.icon} {cat.name}
					</button>
				{/each}
			</div>

			{#if selectedCategory}
				<!-- Value input + suggestions -->
				<div class="space-y-2">
					<div class="flex gap-2">
						<input
							bind:this={inputEl}
							type="text"
							class="input input-bordered input-sm flex-1"
							placeholder="Type to search or add new…"
							bind:value={query}
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									if (query.trim()) addTag(query);
								}
							}}
						/>
						{#if isNew}
							<button
								type="button"
								class="btn btn-sm btn-primary"
								onclick={() => addTag(query)}
							>+</button>
						{/if}
					</div>

					<!-- Suggestion chips — all past values when no query, fuzzy-filtered when typing -->
					{#if suggestions.length > 0}
						<div class="flex flex-wrap gap-1">
							{#each suggestions as sug}
								<button
									type="button"
									class="badge badge-outline cursor-pointer hover:badge-primary transition-colors"
									onmousedown={(e) => { e.preventDefault(); addTag(sug); }}
								>
									{sug}
								</button>
							{/each}
						</div>
					{:else if query.trim().length > 0}
						<p class="text-xs text-base-content/40">No matches — press Enter or + to add "{query.trim()}"</p>
					{/if}
				</div>
			{:else}
				<p class="text-xs text-base-content/40">Select a category above, or —</p>
			{/if}

			<!-- Add new category -->
			{#if !selectedCategory}
				<div class="flex gap-2 items-center">
					<input
						type="text"
						class="input input-bordered input-xs flex-1"
						placeholder="New category name…"
						bind:value={query}
						onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCategory(); } }}
					/>
					<button type="button" class="btn btn-xs btn-ghost" onclick={addCategory} disabled={!query.trim()}>
						Add category
					</button>
				</div>
			{/if}

		</div>
	{/if}
</div>
