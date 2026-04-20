<script lang="ts">
	import { liveQuery } from 'dexie';
	import { db, seedRivers } from '$lib/db/index.js';
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
	let selectedEntryId = $state<string | null>(null);

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
	let chartSorted = $derived([...selectedGroupEntries].sort((a, b) => a.datetime.localeCompare(b.datetime)));

	// Fixed Y-axis: nice round ticks that stay stable regardless of data
	function niceScale(min: number, max: number, ticks = 4): number[] {
		if (min === max) { min = 0; max = max || 1; }
		const range = max - min;
		const step = Math.pow(10, Math.floor(Math.log10(range / ticks)));
		const niceStep = [1, 2, 5, 10].map(f => f * step).find(s => range / s <= ticks + 1) ?? step;
		const niceMin = Math.floor(min / niceStep) * niceStep;
		const niceMax = Math.ceil(max / niceStep) * niceStep;
		const result = [];
		for (let v = niceMin; v <= niceMax + niceStep * 0.01; v += niceStep) result.push(Math.round(v));
		return result;
	}

	let chartRawMin = $derived(chartSorted.length > 0 ? Math.min(...chartSorted.map(e => e.flow)) : 0);
	let chartRawMax = $derived(chartSorted.length > 0 ? Math.max(...chartSorted.map(e => e.flow)) : 1000);
	let chartTicks = $derived(niceScale(chartRawMin, chartRawMax));
	let chartMinFlow = $derived(chartTicks[0]);
	let chartMaxFlow = $derived(chartTicks[chartTicks.length - 1]);
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

	let selectedEntry = $derived(selectedEntryId ? allEntries.find((e) => e.id === selectedEntryId) ?? null : null);
	let selectedEntryRiver = $derived(selectedEntry ? allRivers.get(selectedEntry.riverId) ?? null : null);

	// Year in review stats
	let yearEntries = $derived(allEntries.filter((e) => e.datetime.startsWith(new Date().getFullYear().toString())));
	let yearRiverCount = $derived(new Set(yearEntries.map((e) => e.riverId)).size);
	let yearTopRiver = $derived(() => {
		if (yearEntries.length === 0) return null;
		const counts = new Map<number, number>();
		for (const e of yearEntries) counts.set(e.riverId, (counts.get(e.riverId) ?? 0) + 1);
		const topId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
		const r = topId ? allRivers.get(topId) : null;
		return r ? (r.section ? `${r.riverName} — ${r.section}` : r.riverName) : null;
	});

	// Month in review stats
	let monthStr = $derived(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`);
	let monthEntries = $derived(allEntries.filter((e) => e.datetime.startsWith(monthStr)));
	let monthRiverCount = $derived(new Set(monthEntries.map((e) => e.riverId)).size);
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
							<div class="text-lg font-bold">{Math.round(yearEntries.reduce((s, e) => s + e.flow, 0) / yearEntries.length)}</div>
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
							<div class="text-lg font-bold">{Math.round(monthEntries.reduce((s, e) => s + e.flow, 0) / monthEntries.length)}</div>
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
								{#each chartTicks as tick}
									<text x={PAD_L - 8} y={chartY(tick)}
										text-anchor="end" dominant-baseline="middle" class="fill-base-content/40 text-[10px]"
									>{tick >= 1000 ? (tick/1000).toFixed(1) + 'k' : tick}</text>
									<line x1={PAD_L} x2={PAD_L + PLOT_W}
										y1={chartY(tick)} y2={chartY(tick)}
										class="stroke-base-content/10" stroke-dasharray="4 4" />
								{/each}
							<text x={PAD_L - 8} y={PAD_T - 8} text-anchor="end" class="fill-base-content/40 text-[9px]">CFS</text>

								<!-- Data points by section -->
								{#each chartSorted as entry, i}
									<!-- Hit target -->
									<circle cx={chartX(i)} cy={chartY(entry.flow)} r="14"
										fill="transparent" class="cursor-pointer"
										onclick={() => selectedEntryId = selectedEntryId === entry.id ? null : entry.id}
									/>
									<!-- Visible dot -->
									<circle cx={chartX(i)} cy={chartY(entry.flow)}
										r={selectedEntryId === entry.id ? 8 : 6}
										fill={selectedEntryId === entry.id ? '#f59e0b' : (selectedGroup?.sections.find(s => s.riverId === entry.riverId)?.color ?? 'var(--color-river)')}
										stroke={selectedEntryId === entry.id ? '#d97706' : 'white'}
										stroke-width="1.5"
										class="cursor-pointer"
										onclick={() => selectedEntryId = selectedEntryId === entry.id ? null : entry.id}
									/>
									<!-- Date label — only show if this date hasn't appeared yet -->
									{#if i === 0 || chartSorted[i - 1].datetime.slice(0,10) !== entry.datetime.slice(0,10)}
									<text x={chartX(i)} y={CHART_H - 8} text-anchor="middle"
										class="fill-base-content/50 text-[8px]"
										transform="rotate(-35 {chartX(i)} {CHART_H - 8})"
									>{new Date(entry.datetime).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}</text>
									{/if}
									<!-- Flow label above dot -->
									<text x={chartX(i)} y={chartY(entry.flow) - 10} text-anchor="middle"
										class="fill-base-content/70 text-[10px] font-bold"
									>{Math.round(entry.flow)}</text>
								{/each}
						</svg>
					</div>

					<!-- Selected entry detail -->
					{#if selectedEntry}
						<div class="bg-base-200 rounded-lg p-4 mt-4">
							<div class="flex justify-between items-start">
								<div>
									<p class="font-bold">
										{selectedEntryRiver?.riverName ?? 'Unknown'}
										{#if selectedEntryRiver?.section}
											<span class="font-normal text-base-content/50"> — {selectedEntryRiver.section}</span>
										{/if}
									</p>
									<p class="text-sm text-base-content/50">
										{new Date(selectedEntry.datetime).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
										&middot; {Math.round(selectedEntry.flow)} CFS
									</p>
								</div>
								<a href="/entries/{selectedEntry.id}" class="btn btn-ghost btn-xs">View &rarr;</a>
							</div>
							{#if selectedEntry.description}
								<p class="mt-3 text-sm whitespace-pre-wrap">{selectedEntry.description}</p>
							{:else}
								<p class="mt-3 text-sm text-base-content/40 italic">No notes for this day.</p>
							{/if}
						</div>
					{/if}
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
