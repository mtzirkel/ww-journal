<script lang="ts">
	import { ACTIVITIES } from '$lib/activity.js';
	import { getFavoriteActivities, activityUsage } from '$lib/db/index.js';
	import type { ActivityType } from '$lib/types.js';
	import { onMount } from 'svelte';

	let { value = $bindable() }: { value: ActivityType } = $props();

	let favorites = $state<string[] | null>(null);
	let expanded = $state(false);

	onMount(async () => {
		const chosen = await getFavoriteActivities();
		if (chosen && chosen.length > 0) {
			favorites = chosen;
			return;
		}
		// Never chosen — fall back to what the user actually logs, so the picker
		// is useful before anyone visits Settings. Paddle is the last resort so
		// a brand-new journal still shows something.
		const used = await activityUsage();
		favorites = used.length > 0 ? used : ['paddle'];
	});

	// The selected activity is always reachable, even when it is not a favourite
	// (e.g. editing an old hunt entry after un-favouriting hunt).
	let pinned = $derived(
		ACTIVITIES.filter((a) => favorites?.includes(a.type) || a.type === value)
	);
	let rest = $derived(ACTIVITIES.filter((a) => !pinned.some((p) => p.type === a.type)));
</script>

<div class="form-control mb-4">
	<span class="label-text mb-2 block">Activity</span>

	{#if favorites === null}
		<div class="skeleton h-8 w-64"></div>
	{:else}
		<div class="flex flex-wrap items-center gap-2">
			{#each pinned as activity (activity.type)}
				<button
					type="button"
					class="btn btn-sm {value === activity.type ? 'btn-primary' : 'btn-outline'}"
					aria-pressed={value === activity.type}
					onclick={() => (value = activity.type)}
				>
					{activity.icon}
					{activity.label}
				</button>
			{/each}

			{#if rest.length > 0}
				<button
					type="button"
					class="btn btn-sm btn-ghost"
					aria-expanded={expanded}
					onclick={() => (expanded = !expanded)}
				>
					{expanded ? 'Less' : `More (${rest.length})`}
					<span class="text-xs">{expanded ? '▲' : '▼'}</span>
				</button>
			{/if}
		</div>

		{#if expanded && rest.length > 0}
			<div class="flex flex-wrap gap-2 mt-2 pt-2 border-t border-base-300">
				{#each rest as activity (activity.type)}
					<button
						type="button"
						class="btn btn-sm btn-outline"
						onclick={() => {
							value = activity.type;
							expanded = false;
						}}
					>
						{activity.icon}
						{activity.label}
					</button>
				{/each}
			</div>
		{/if}
	{/if}
</div>
