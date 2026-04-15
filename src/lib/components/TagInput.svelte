<script lang="ts">
	import { db, seedTagCategories } from '$lib/db/index.js';
	import type { EntryTag, TagCategory } from '$lib/types.js';
	import { onMount } from 'svelte';

	let {
		value = $bindable<EntryTag[]>([])
	}: {
		value?: EntryTag[];
	} = $props();

	let categories = $state<TagCategory[]>([]);
	let expanded = $state(false);
	let newCategory = $state('');
	let newValue = $state('');
	let selectedCategory = $state('');

	onMount(async () => {
		await seedTagCategories();
		categories = await db.tagCategories.toArray();
	});

	function addTag() {
		if (!selectedCategory || !newValue.trim()) return;
		const tag: EntryTag = { category: selectedCategory, value: newValue.trim() };
		if (!value.some(t => t.category === tag.category && t.value === tag.value)) {
			value = [...value, tag];

			// Remember this value for autocomplete
			const cat = categories.find(c => c.name === selectedCategory);
			if (cat && !cat.values.includes(tag.value)) {
				cat.values = [...cat.values, tag.value];
				db.tagCategories.update(cat.id, { values: cat.values, updatedAt: new Date().toISOString(), dirty: true });
			}
		}
		newValue = '';
	}

	function removeTag(index: number) {
		value = value.filter((_, i) => i !== index);
	}

	async function addCategory() {
		if (!newCategory.trim()) return;
		const existing = categories.find(c => c.name.toLowerCase() === newCategory.trim().toLowerCase());
		if (existing) return;

		const now = new Date().toISOString();
		await db.tagCategories.add({
			id: crypto.randomUUID(),
			name: newCategory.trim(),
			icon: '🏷',
			values: [],
			createdAt: now,
			updatedAt: now,
			deletedAt: null,
			dirty: true
		});
		categories = await db.tagCategories.toArray();
		selectedCategory = newCategory.trim();
		newCategory = '';
	}

	let suggestions = $derived(() => {
		if (!selectedCategory || newValue.length < 1) return [];
		const cat = categories.find(c => c.name === selectedCategory);
		if (!cat) return [];
		const lower = newValue.toLowerCase();
		return cat.values.filter(v =>
			v.toLowerCase().includes(lower) &&
			!value.some(t => t.category === selectedCategory && t.value === v)
		).slice(0, 5);
	});
</script>

<div class="form-control">
	<button
		type="button"
		class="btn btn-sm btn-ghost justify-start gap-2"
		onclick={() => expanded = !expanded}
	>
		<span class="text-xs">{expanded ? '▾' : '▸'}</span>
		Tags ({value.length})
	</button>

	<!-- Show existing tags -->
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
			<div class="flex gap-2">
				<select class="select select-bordered select-sm flex-1" bind:value={selectedCategory}>
					<option value="">Category...</option>
					{#each categories as cat}
						<option value={cat.name}>{cat.icon} {cat.name}</option>
					{/each}
				</select>
				<div class="relative flex-1">
					<input
						type="text"
						class="input input-bordered input-sm w-full"
						placeholder="Value..."
						bind:value={newValue}
						onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
					/>
					{#if suggestions().length > 0}
						<ul class="absolute z-50 top-full left-0 right-0 mt-1 bg-base-100 border border-base-300 rounded shadow-lg">
							{#each suggestions() as sug}
								<li>
									<button type="button" class="w-full text-left px-3 py-1 text-sm hover:bg-base-200"
										onmousedown={() => { newValue = sug; addTag(); }}>
										{sug}
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
				<button type="button" class="btn btn-sm btn-primary" onclick={addTag} disabled={!selectedCategory || !newValue.trim()}>+</button>
			</div>

			<!-- Add new category -->
			<div class="flex gap-2 items-center">
				<input type="text" class="input input-bordered input-xs flex-1" placeholder="New category..." bind:value={newCategory}
					onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCategory(); } }} />
				<button type="button" class="btn btn-xs btn-ghost" onclick={addCategory} disabled={!newCategory.trim()}>Add category</button>
			</div>
		</div>
	{/if}
</div>
