<script lang="ts">
	import { liveQuery } from 'dexie';
	import { db, seedRivers, seedEntries } from '$lib/db/index.js';
	import type { River } from '$lib/types.js';
	import { onMount } from 'svelte';

	let totalDays = $state(0);
	let thisYear = $state(0);
	let thisMonth = $state(0);
	let riverCount = $state(0);
	let riverStats = $state<{ name: string; count: number }[]>([]);
	let loaded = $state(false);

	onMount(() => {
		let subscription: { unsubscribe: () => void } | undefined;

		(async () => {
			await seedRivers();
			await seedEntries();

			const rivers = new Map<number, River>(
				(await db.rivers.toArray()).map((r) => [r.id, r])
			);

			const observable = liveQuery(async () => {
				const entries = await db.entries.toArray();
				const now = new Date();
				const yearStr = now.getFullYear().toString();
				const monthStr = `${yearStr}-${String(now.getMonth() + 1).padStart(2, '0')}`;

				const total = entries.length;
				const year = entries.filter((e) => e.date.startsWith(yearStr)).length;
				const month = entries.filter((e) => e.date.startsWith(monthStr)).length;

				const byRiver = new Map<number, number>();
				for (const e of entries) {
					byRiver.set(e.riverId, (byRiver.get(e.riverId) ?? 0) + 1);
				}

				const stats = [...byRiver.entries()]
					.map(([id, count]) => ({
						name: rivers.get(id)?.riverName ?? 'Unknown',
						count
					}))
					.sort((a, b) => b.count - a.count);

				return { total, year, month, riverCount: byRiver.size, stats };
			});

			subscription = observable.subscribe((value) => {
				totalDays = value.total;
				thisYear = value.year;
				thisMonth = value.month;
				riverCount = value.riverCount;
				riverStats = value.stats;
				loaded = true;
			});
		})();

		return () => { subscription?.unsubscribe(); };
	});

	let maxCount = $derived(Math.max(...riverStats.map((r) => r.count), 1));
</script>

<h1 class="text-3xl font-bold mb-6">Dashboard</h1>

<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
	<div class="stat bg-base-100 rounded-xl shadow p-4">
		<div class="stat-title text-xs">Total Days</div>
		<div class="stat-value text-2xl" style="color: var(--color-river)">{loaded ? totalDays : '—'}</div>
	</div>
	<div class="stat bg-base-100 rounded-xl shadow p-4">
		<div class="stat-title text-xs">This Year</div>
		<div class="stat-value text-2xl">{loaded ? thisYear : '—'}</div>
	</div>
	<div class="stat bg-base-100 rounded-xl shadow p-4">
		<div class="stat-title text-xs">This Month</div>
		<div class="stat-value text-2xl">{loaded ? thisMonth : '—'}</div>
	</div>
	<div class="stat bg-base-100 rounded-xl shadow p-4">
		<div class="stat-title text-xs">Rivers</div>
		<div class="stat-value text-2xl">{loaded ? riverCount : '—'}</div>
	</div>
</div>

{#if loaded && riverStats.length > 0}
	<div class="card bg-base-100 shadow">
		<div class="card-body">
			<h2 class="card-title text-lg mb-4">Days per River</h2>
			<div class="space-y-3">
				{#each riverStats as stat}
					<div class="flex items-center gap-3">
						<span class="text-sm w-32 truncate shrink-0">{stat.name}</span>
						<div class="flex-1 bg-base-200 rounded-full h-6 overflow-hidden">
							<div
								class="h-full rounded-full flex items-center pl-2 text-xs font-bold text-white"
								style="width: {(stat.count / maxCount) * 100}%; background-color: var(--color-river); min-width: 2rem;"
							>
								{stat.count}
							</div>
						</div>
					</div>
				{/each}
			</div>
		</div>
	</div>
{:else if loaded}
	<div class="card bg-base-100 shadow">
		<div class="card-body text-center text-base-content/50">
			<p>No entries yet. <a href="/entries/new" class="link">Log your first day!</a></p>
		</div>
	</div>
{/if}
