<script lang="ts">
	import { liveQuery } from 'dexie';
	import { db, seedRivers, seedEntries } from '$lib/db/index.js';
	import type { River, JournalEntry } from '$lib/types.js';
	import FlowTimeline from '$lib/components/FlowTimeline.svelte';
	import { onMount } from 'svelte';

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
			await seedEntries();

			const rivers = new Map<number, River>(
				(await db.rivers.toArray()).map((r) => [r.id, r])
			);
			allRivers = rivers;

			const observable = liveQuery(async () => {
				const entries = await db.entries.toArray();
				const now = new Date();
				const yearStr = now.getFullYear().toString();
				const monthStr = `${yearStr}-${String(now.getMonth() + 1).padStart(2, '0')}`;

				const total = entries.length;
				const year = entries.filter((e) => e.date.startsWith(yearStr)).length;
				const month = entries.filter((e) => e.date.startsWith(monthStr)).length;

				// Group by river name, track sections
				const byName = new Map<string, Map<number, number>>();
				for (const e of entries) {
					const r = rivers.get(e.riverId);
					const name = r?.riverName ?? 'Unknown';
					if (!byName.has(name)) byName.set(name, new Map());
					const sections = byName.get(name)!;
					sections.set(e.riverId, (sections.get(e.riverId) ?? 0) + 1);
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

				const uniqueRiverIds = new Set(entries.map((e) => e.riverId));
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
		selectedGroup ? allEntries.filter((e) => selectedGroup!.sections.some((s) => s.riverId === e.riverId)) : []
	);

	// Chart calculations
	let chartSorted = $derived([...selectedGroupEntries].sort((a, b) => a.date.localeCompare(b.date)));
	let chartMinFlow = $derived(chartSorted.length > 0 ? Math.min(...chartSorted.map(e => e.flow)) : 0);
	let chartMaxFlow = $derived(chartSorted.length > 0 ? Math.max(...chartSorted.map(e => e.flow)) : 1);
	let chartFlowRange = $derived(chartMaxFlow - chartMinFlow || 1);

	const CHART_W = 600, CHART_H = 220, PAD_L = 60, PAD_R = 20, PAD_T = 20, PAD_B = 40;
	const PLOT_W = CHART_W - PAD_L - PAD_R;
	const PLOT_H = CHART_H - PAD_T - PAD_B;

	function chartX(i: number) {
		if (chartSorted.length <= 1) return PAD_L + PLOT_W / 2;
		return PAD_L + (i / (chartSorted.length - 1)) * PLOT_W;
	}
	function chartY(flow: number) {
		return PAD_T + PLOT_H - ((flow - chartMinFlow) / chartFlowRange) * PLOT_H;
	}
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
							<div class="font-mono font-bold text-lg">{Math.round(Math.max(...selectedGroupEntries.map(e => e.flow)))}</div>
							<div class="text-xs text-base-content/40">CFS</div>
						</div>
						<div class="bg-base-200 rounded-lg p-3 text-center">
							<div class="text-xs text-base-content/50">Lowest</div>
							<div class="font-mono font-bold text-lg">{Math.round(Math.min(...selectedGroupEntries.map(e => e.flow)))}</div>
							<div class="text-xs text-base-content/40">CFS</div>
						</div>
						<div class="bg-base-200 rounded-lg p-3 text-center">
							<div class="text-xs text-base-content/50">Total Days</div>
							<div class="font-bold text-lg" style="color: var(--color-river)">{selectedGroup.totalCount}</div>
						</div>
					</div>

					<!-- Multi-section flow chart -->
					<div class="mt-4 overflow-x-auto">
						<svg viewBox="0 0 {CHART_W} {CHART_H}" class="w-full max-w-[600px]">
							<!-- Y axis -->
							{#each [chartMinFlow, chartMinFlow + chartFlowRange / 2, chartMaxFlow] as tick}
								<text x={PAD_L - 8} y={chartY(tick)}
									text-anchor="end" dominant-baseline="middle" class="fill-base-content/40 text-[10px]"
								>{Math.round(tick)}</text>
								<line x1={PAD_L} x2={PAD_L + PLOT_W}
									y1={chartY(tick)} y2={chartY(tick)}
									class="stroke-base-content/10" stroke-dasharray="4 4" />
							{/each}
							<text x={PAD_L - 8} y={PAD_T - 8} text-anchor="end" class="fill-base-content/40 text-[9px]">CFS</text>

							<!-- Data points by section -->
							{#each chartSorted as entry, i}
								<circle cx={chartX(i)} cy={chartY(entry.flow)} r="6"
									fill={selectedGroup?.sections.find(s => s.riverId === entry.riverId)?.color ?? 'var(--color-river)'}
									stroke="white" stroke-width="1.5"
									class="cursor-pointer"
								/>
								<text x={chartX(i)} y={CHART_H - 8} text-anchor="middle"
									class="fill-base-content/50 text-[8px]"
									transform="rotate(-35 {chartX(i)} {CHART_H - 8})"
								>{new Date(entry.date).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}</text>
								<text x={chartX(i)} y={chartY(entry.flow) - 10} text-anchor="middle"
									class="fill-base-content/70 text-[10px] font-bold"
								>{Math.round(entry.flow)}</text>
							{/each}
						</svg>
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
</style>
