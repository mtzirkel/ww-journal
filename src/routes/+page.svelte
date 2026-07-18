<script lang="ts">
	import { liveQuery } from 'dexie';
	import { db, seedRivers } from '$lib/db/index.js';
	import { riverIdOf, flowOf, riverIds, flows, mean } from '$lib/activity.js';
	import type { River, JournalEntry } from '$lib/types.js';
	import * as Plot from '@observablehq/plot';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	const BAR_COLORS = [
		'#238c91', '#e06c53', '#6366f1', '#22c55e', '#f59e0b',
		'#ec4899', '#8b5cf6', '#14b8a6', '#f97316', '#06b6d4',
		'#84cc16', '#ef4444', '#a855f7', '#0ea5e9', '#d946ef'
	];

	interface SectionStat {
		riverId: number;
		section: string | null;
		count: number;
		color: string;
	}

	interface GroupedRiver {
		riverName: string;
		totalCount: number;
		sections: SectionStat[];
	}

	let totalDays = $state(0);
	let thisYear = $state(0);
	let thisMonth = $state(0);
	let riverCount = $state(0);
	let groupedRivers = $state<GroupedRiver[]>([]);
	let allEntries = $state<JournalEntry[]>([]);
	let allRivers = $state<Map<number, River>>(new Map());
	let loaded = $state(false);

	let selectedRiverName = $state<string | null>(null);

	onMount(() => {
		let subscription: { unsubscribe: () => void } | undefined;

		(async () => {
			await seedRivers();

			const rivers = new Map<number, River>(
				(await db.rivers.toArray()).map((r) => [r.id, r])
			);
			allRivers = rivers;

			const observable = liveQuery(async () => {
				const entries = (await db.entries.toArray()).filter((e) => !e.deletedAt);
				const now = new Date();
				const yearStr = now.getFullYear().toString();
				const monthStr = `${yearStr}-${String(now.getMonth() + 1).padStart(2, '0')}`;

				const total = entries.length;
				const year = entries.filter((e) => e.datetime.startsWith(yearStr)).length;
				const month = entries.filter((e) => e.datetime.startsWith(monthStr)).length;

				// Group by river name, track sections
				const byName = new Map<string, Map<number, number>>();
				for (const e of entries) {
					const rid = riverIdOf(e);
					if (rid === null) continue; // non-river activity — not part of river stats
					const r = rivers.get(rid);
					const name = r?.riverName ?? 'Unknown';
					if (!byName.has(name)) byName.set(name, new Map());
					const sections = byName.get(name)!;
					sections.set(rid, (sections.get(rid) ?? 0) + 1);
				}

				let colorIdx = 0;
				const grouped: GroupedRiver[] = [...byName.entries()]
					.map(([riverName, sections]) => {
						const sectionStats: SectionStat[] = [...sections.entries()]
							.map(([riverId, count]) => {
								const r = rivers.get(riverId);
								return {
									riverId,
									section: r?.section ?? null,
									count,
									color: BAR_COLORS[colorIdx++ % BAR_COLORS.length]
								};
							})
							.sort((a, b) => b.count - a.count);
						return {
							riverName,
							totalCount: sectionStats.reduce((s, x) => s + x.count, 0),
							sections: sectionStats
						};
					})
					.sort((a, b) => b.totalCount - a.totalCount);

				const uniqueRiverIds = new Set(riverIds(entries));
				return { total, year, month, riverCount: uniqueRiverIds.size, grouped, entries };
			});

			subscription = observable.subscribe((value) => {
				totalDays = value.total;
				thisYear = value.year;
				thisMonth = value.month;
				riverCount = value.riverCount;
				groupedRivers = value.grouped;
				allEntries = value.entries;
				loaded = true;
			});
		})();

		return () => { subscription?.unsubscribe(); };
	});

	let maxCount = $derived(Math.max(...groupedRivers.map((r) => r.totalCount), 1));

	// For the timeline: get all rivers + entries for the selected river name group
	let selectedGroup = $derived(selectedRiverName ? groupedRivers.find((g) => g.riverName === selectedRiverName) ?? null : null);
	let selectedGroupEntries = $derived(
		selectedGroup ? allEntries.filter((e) => selectedGroup!.sections.some((s) => s.riverId === riverIdOf(e))) : []
	);

	// Chart calculations — Observable Plot
	let chartSorted = $derived([...selectedGroupEntries].sort((a, b) => a.datetime.localeCompare(b.datetime)));

	let chartContainer = $state<HTMLDivElement | undefined>(undefined);
	let tooltipText = $state<string | null>(null);
	let tooltipX = $state(0);
	let tooltipY = $state(0);

	// Build section color map for chart dots
	let sectionColorMap = $derived(() => {
		const map = new Map<number, string>();
		if (selectedGroup) {
			for (const sec of selectedGroup.sections) {
				map.set(sec.riverId, sec.color);
			}
		}
		return map;
	});

	$effect(() => {
		if (!chartContainer || chartSorted.length === 0) return;

		const colorMap = sectionColorMap();
		// Flow chart plots river days only — activities without a river or a
		// recorded flow have nothing to place on these axes.
		const data = chartSorted.flatMap(e => {
			const rid = riverIdOf(e);
			const fl = flowOf(e);
			if (rid === null || fl === null) return [];
			return [{
				date: new Date(e.datetime),
				flow: fl,
				id: e.id,
				riverId: rid,
				color: colorMap.get(rid) ?? '#238c91',
				label: `${Math.round(fl)} CFS — ${new Date(e.datetime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
				section: allRivers.get(rid)?.section ?? null
			}];
		});

		const plot = Plot.plot({
			width: 580,
			height: 220,
			marginLeft: 55,
			marginBottom: 35,
			marginTop: 15,
			marginRight: 15,
			style: {
				background: 'transparent',
				color: 'currentColor',
				fontSize: '11px'
			},
			x: {
				type: 'utc',
				label: null
			},
			y: {
				label: 'CFS',
				grid: true,
				tickFormat: (d: number) => d >= 1000 ? (d / 1000).toFixed(1) + 'k' : String(d)
			},
			marks: [
				Plot.ruleY([0], { stroke: 'currentColor', strokeOpacity: 0.1 }),
				Plot.dot(data, {
					x: 'date',
					y: 'flow',
					r: 6,
					fill: 'color',
					stroke: 'white',
					strokeWidth: 1.5
				})
			]
		});

		// Add click + hover handling on dots
		const dots = plot.querySelectorAll('g[aria-label="dot"] circle');
		dots.forEach((circle, i) => {
			if (i < data.length) {
				const el = circle as SVGCircleElement;
				el.style.cursor = 'pointer';
				el.addEventListener('click', () => {
					goto(`/entries/${data[i].id}`);
				});
				el.addEventListener('mouseenter', (ev: MouseEvent) => {
					tooltipX = ev.clientX;
					tooltipY = ev.clientY - 12;
					const sec = data[i].section ? ` · ${data[i].section}` : '';
					tooltipText = `${data[i].label}${sec}`;
				});
				el.addEventListener('mouseleave', () => {
					tooltipText = null;
				});
			}
		});

		chartContainer.replaceChildren(plot);

		return () => plot.remove();
	});


	// Year in review stats
	let yearEntries = $derived(allEntries.filter((e) => e.datetime.startsWith(new Date().getFullYear().toString())));
	let yearRiverCount = $derived(new Set(riverIds(yearEntries)).size);
	let yearTopRiver = $derived(() => {
		if (yearEntries.length === 0) return null;
		const counts = new Map<number, number>();
		for (const rid of riverIds(yearEntries)) counts.set(rid, (counts.get(rid) ?? 0) + 1);
		const topId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
		const r = topId ? allRivers.get(topId) : null;
		return r ? (r.section ? `${r.riverName} — ${r.section}` : r.riverName) : null;
	});

	// Month in review stats
	let monthStr = $derived(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`);
	let monthEntries = $derived(allEntries.filter((e) => e.datetime.startsWith(monthStr)));
	let monthRiverCount = $derived(new Set(riverIds(monthEntries)).size);
</script>

<h1 class="text-3xl font-bold mb-6">Dashboard</h1>

<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
	<a href="/entries" class="stat bg-base-100 rounded-xl shadow p-4 hover:shadow-md transition-shadow cursor-pointer">
		<div class="stat-title text-xs">Total Days</div>
		<div class="stat-value text-2xl" style="color: var(--color-river)">{loaded ? totalDays : '—'}</div>
	</a>
	<a href="/entries?year={new Date().getFullYear()}" class="stat bg-base-100 rounded-xl shadow p-4 hover:shadow-md transition-shadow cursor-pointer">
		<div class="stat-title text-xs">This Year</div>
		<div class="stat-value text-2xl">{loaded ? thisYear : '—'}</div>
	</a>
	<a href="/entries?month={new Date().getFullYear()}-{String(new Date().getMonth() + 1).padStart(2, '0')}" class="stat bg-base-100 rounded-xl shadow p-4 hover:shadow-md transition-shadow cursor-pointer">
		<div class="stat-title text-xs">This Month</div>
		<div class="stat-value text-2xl">{loaded ? thisMonth : '—'}</div>
	</a>
	<a href="/entries?view=rivers" class="stat bg-base-100 rounded-xl shadow p-4 hover:shadow-md transition-shadow cursor-pointer">
		<div class="stat-title text-xs">Rivers</div>
		<div class="stat-value text-2xl">{loaded ? riverCount : '—'}</div>
	</a>
</div>

{#if loaded && (yearEntries.length > 0 || monthEntries.length > 0)}
	<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
		<!-- Year in Review -->
		<div class="card bg-base-100 shadow">
			<div class="card-body py-4">
				<h3 class="card-title text-sm">{new Date().getFullYear()} Year in Review</h3>
				{#if yearEntries.length > 0}
					<div class="grid grid-cols-3 gap-2 mt-2">
						<div class="text-center">
							<div class="text-2xl font-bold" style="color: var(--color-river)">{yearEntries.length}</div>
							<div class="text-xs text-base-content/50">Days</div>
						</div>
						<div class="text-center">
							<div class="text-2xl font-bold">{yearRiverCount}</div>
							<div class="text-xs text-base-content/50">Rivers</div>
						</div>
						<div class="text-center">
							<div class="text-lg font-bold">{mean(flows(yearEntries))?.toFixed(0) ?? "—"}</div>
							<div class="text-xs text-base-content/50">Avg CFS</div>
						</div>
					</div>
					{#if yearTopRiver()}
						<p class="text-xs text-base-content/50 mt-2">Most paddled: <strong>{yearTopRiver()}</strong></p>
					{/if}
				{:else}
					<p class="text-sm text-base-content/40 mt-2">No entries this year yet. Get on the water!</p>
				{/if}
			</div>
		</div>

		<!-- Month in Review -->
		<div class="card bg-base-100 shadow">
			<div class="card-body py-4">
				<h3 class="card-title text-sm">{new Date().toLocaleDateString('en-US', { month: 'long' })} Review</h3>
				{#if monthEntries.length > 0}
					<div class="grid grid-cols-3 gap-2 mt-2">
						<div class="text-center">
							<div class="text-2xl font-bold" style="color: var(--color-river)">{monthEntries.length}</div>
							<div class="text-xs text-base-content/50">Days</div>
						</div>
						<div class="text-center">
							<div class="text-2xl font-bold">{monthRiverCount}</div>
							<div class="text-xs text-base-content/50">Rivers</div>
						</div>
						<div class="text-center">
							<div class="text-lg font-bold">{mean(flows(monthEntries))?.toFixed(0) ?? "—"}</div>
							<div class="text-xs text-base-content/50">Avg CFS</div>
						</div>
					</div>
				{:else}
					<p class="text-sm text-base-content/40 mt-2">No entries this month yet.</p>
				{/if}
			</div>
		</div>
	</div>
{/if}

{#if loaded && groupedRivers.length > 0}
	<!-- Flow timeline panel above the river list -->
	{#if selectedGroup && selectedGroupEntries.length > 0}
		<div class="timeline-panel mb-4">
			<div class="card bg-base-100 shadow-lg">
				<div class="card-body">
					<div class="flex justify-between items-start">
						<div>
							<h3 class="card-title text-lg">{selectedGroup.riverName}</h3>
							<p class="text-xs text-base-content/50 mt-1">
								{selectedGroup.totalCount} day{selectedGroup.totalCount !== 1 ? 's' : ''} across {selectedGroup.sections.length} section{selectedGroup.sections.length !== 1 ? 's' : ''}
							</p>
						</div>
						<button class="btn btn-ghost btn-sm" onclick={() => selectedRiverName = null}>&times;</button>
					</div>

					<!-- Section legend -->
					{#if selectedGroup.sections.length > 1}
						<div class="flex flex-wrap gap-2 mt-3">
							{#each selectedGroup.sections as sec}
								<span class="badge badge-sm gap-1" style="background-color: {sec.color}; color: white; border: none;">
									{sec.section ?? 'Main'} ({sec.count})
								</span>
							{/each}
						</div>
					{/if}

					<!-- Stats cards -->
					<div class="grid grid-cols-3 gap-3 mt-4">
						<div class="bg-base-200 rounded-lg p-3 text-center">
							<div class="text-xs text-base-content/50">Highest</div>
							<div class="font-mono font-bold text-lg">{flows(selectedGroupEntries).length ? Math.round(Math.max(...flows(selectedGroupEntries))) : "—"}</div>
							<div class="text-xs text-base-content/40">CFS</div>
						</div>
						<div class="bg-base-200 rounded-lg p-3 text-center">
							<div class="text-xs text-base-content/50">Lowest</div>
							<div class="font-mono font-bold text-lg">{flows(selectedGroupEntries).length ? Math.round(Math.min(...flows(selectedGroupEntries))) : "—"}</div>
							<div class="text-xs text-base-content/40">CFS</div>
						</div>
						<div class="bg-base-200 rounded-lg p-3 text-center">
							<div class="text-xs text-base-content/50">Total Days</div>
							<div class="font-bold text-lg" style="color: var(--color-river)">{selectedGroup.totalCount}</div>
						</div>
					</div>

					<!-- Observable Plot flow chart -->
					<div class="mt-4 overflow-x-auto">
						<div bind:this={chartContainer}></div>
					</div>
				</div>
			</div>
		</div>
	{/if}

	<div class="card bg-base-100 shadow">
		<div class="card-body">
			<button
				type="button"
				class="card-title text-lg mb-4 cursor-pointer hover:opacity-70 transition-opacity"
				onclick={() => selectedRiverName = null}
			>
				Days per River
			</button>
			<div class="space-y-3">
				{#each groupedRivers as group}
					<button
						type="button"
						class="flex items-center gap-3 w-full text-left cursor-pointer hover:opacity-80 transition-opacity"
						class:ring-2={selectedRiverName === group.riverName}
						class:ring-primary={selectedRiverName === group.riverName}
						class:rounded-lg={selectedRiverName === group.riverName}
						class:p-1={selectedRiverName === group.riverName}
						onclick={() => selectedRiverName = selectedRiverName === group.riverName ? null : group.riverName}
					>
						<span class="text-sm w-40 truncate shrink-0">{group.riverName}</span>
						<div class="flex-1 bg-base-200 rounded-full h-6 overflow-hidden flex">
							{#each group.sections as sec}
								<div
									class="h-full flex items-center justify-center text-xs font-bold text-white first:rounded-l-full last:rounded-r-full"
									style="width: {(sec.count / maxCount) * 100}%; background-color: {sec.color}; min-width: 1.5rem;"
								>
									{sec.count}
								</div>
							{/each}
						</div>
					</button>
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

{#if tooltipText}
	<div class="chart-tooltip" style="left: {tooltipX}px; top: {tooltipY}px;">
		{tooltipText}
	</div>
{/if}

<style>
	.timeline-panel {
		animation: panel-open 0.4s cubic-bezier(0.16, 1, 0.3, 1);
		transform-origin: top center;
	}

	@keyframes panel-open {
		0% {
			opacity: 0;
			transform: perspective(600px) rotateX(-90deg);
			max-height: 0;
		}
		40% {
			opacity: 0.6;
			transform: perspective(600px) rotateX(-20deg);
		}
		100% {
			opacity: 1;
			transform: perspective(600px) rotateX(0deg);
			max-height: 800px;
		}
	}

	.chart-tooltip {
		position: fixed;
		transform: translate(-50%, -100%);
		background: oklch(0.25 0.01 260);
		color: oklch(0.9 0 0);
		border: 1px solid oklch(0.35 0.01 260);
		border-radius: 6px;
		padding: 4px 10px;
		font-size: 12px;
		white-space: nowrap;
		pointer-events: none;
		z-index: 50;
		box-shadow: 0 4px 12px oklch(0 0 0 / 0.4);
	}
</style>
