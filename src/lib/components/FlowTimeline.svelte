<script lang="ts">
	import type { River, JournalEntry } from '$lib/types.js';
	import { fetchUsgsFlow } from '$lib/api/usgs.js';
	import { onMount } from 'svelte';

	let {
		river,
		entries,
		onclose
	}: {
		river: River;
		entries: JournalEntry[];
		onclose: () => void;
	} = $props();

	let currentFlow = $state<number | null>(null);
	let fetchingCurrent = $state(false);
	let selectedEntry = $state<JournalEntry | null>(null);

	// Sort entries by datetime
	let sorted = $derived([...entries].sort((a, b) => a.datetime.localeCompare(b.datetime)));

	let highestFlow = $derived(Math.max(...sorted.map((e) => e.flow)));
	let lowestFlow = $derived(Math.min(...sorted.map((e) => e.flow)));
	let totalDays = $derived(sorted.length);

	let minFlow = $derived(lowestFlow);
	let maxFlow = $derived(Math.max(highestFlow, currentFlow ?? 0));
	let flowRange = $derived(maxFlow - minFlow || 1);

	// Time-proportional x-axis: gap between April 2018 and April 2019 is a year wide,
	// not one dot wide. Falls back to even spacing if all entries are on the same day.
	let timeMin = $derived(sorted.length ? new Date(sorted[0].datetime).getTime() : 0);
	let timeMax = $derived(sorted.length ? new Date(sorted[sorted.length - 1].datetime).getTime() : 1);
	let timeRange = $derived(timeMax - timeMin);

	// Chart dimensions
	const chartW = 600;
	const chartH = 200;
	const padL = 60;
	const padR = 20;
	const padT = 20;
	const padB = 40;
	const plotW = chartW - padL - padR;
	const plotH = chartH - padT - padB;

	function xPos(entry: JournalEntry, i: number) {
		if (sorted.length === 1) return padL + plotW / 2;
		if (timeRange === 0) return padL + (i / (sorted.length - 1)) * plotW;
		const t = new Date(entry.datetime).getTime();
		return padL + ((t - timeMin) / timeRange) * plotW;
	}

	function yPos(flow: number) {
		return padT + plotH - ((flow - minFlow) / flowRange) * plotH;
	}

	let linePath = $derived(
		sorted.map((e, i) => `${i === 0 ? 'M' : 'L'} ${xPos(e, i)} ${yPos(e.flow)}`).join(' ')
	);

	let currentFlowY = $derived(currentFlow !== null ? yPos(currentFlow) : null);

	onMount(async () => {
		if (river.externalGaugeId && river.externalGaugeSource === 'usgs') {
			fetchingCurrent = true;
			const today = new Date().toISOString().slice(0, 10);
			currentFlow = await fetchUsgsFlow(river.externalGaugeId, today);
			fetchingCurrent = false;
		}
	});
</script>

<div class="card bg-base-100 shadow-lg mt-4">
	<div class="card-body">
		<div class="flex justify-between items-start">
			<div>
				<h3 class="card-title text-lg">
					{river.riverName}
					{#if river.section}
						<span class="font-normal text-base-content/50 text-sm"> — {river.section}</span>
					{/if}
				</h3>
				<p class="text-xs text-base-content/50 mt-1">
					{river.state}
					{#if river.classRating}· Class {river.classRating}{/if}
					· {entries.length} day{entries.length !== 1 ? 's' : ''}
				</p>
			</div>
			<button class="btn btn-ghost btn-sm" onclick={onclose}>&times;</button>
		</div>

		<div class="grid grid-cols-3 gap-3 mt-4">
			<div class="bg-base-200 rounded-lg p-3 text-center">
				<div class="text-xs text-base-content/50">Highest</div>
				<div class="font-mono font-bold text-lg">{Math.round(highestFlow)}</div>
				<div class="text-xs text-base-content/40">CFS</div>
			</div>
			<div class="bg-base-200 rounded-lg p-3 text-center">
				<div class="text-xs text-base-content/50">Lowest</div>
				<div class="font-mono font-bold text-lg">{Math.round(lowestFlow)}</div>
				<div class="text-xs text-base-content/40">CFS</div>
			</div>
			<div class="bg-base-200 rounded-lg p-3 text-center">
				<div class="text-xs text-base-content/50">Total Days</div>
				<div class="font-bold text-lg" style="color: var(--color-river)">{totalDays}</div>
			</div>
		</div>

		<div class="mt-4 overflow-x-auto">
			<svg viewBox="0 0 {chartW} {chartH}" class="w-full max-w-[600px]">
				<!-- Y axis labels -->
				{#each [minFlow, minFlow + flowRange / 2, maxFlow] as tick}
					<text
						x={padL - 8}
						y={yPos(tick)}
						text-anchor="end"
						dominant-baseline="middle"
						class="fill-base-content/40 text-[10px]"
					>{Math.round(tick)}</text>
					<line
						x1={padL}
						x2={padL + plotW}
						y1={yPos(tick)}
						y2={yPos(tick)}
						class="stroke-base-content/10"
						stroke-dasharray="4 4"
					/>
				{/each}

				<!-- CFS label -->
				<text
					x={padL - 8}
					y={padT - 8}
					text-anchor="end"
					class="fill-base-content/40 text-[9px]"
				>CFS</text>

				<!-- Flow line -->
				{#if sorted.length > 1}
					<path
						d={linePath}
						fill="none"
						stroke="var(--color-river)"
						stroke-width="2.5"
						stroke-linejoin="round"
					/>
				{/if}

				<!-- Data points -->
				{#each sorted as entry, i}
					<!-- Larger invisible hit target -->
					<circle
						cx={xPos(entry, i)}
						cy={yPos(entry.flow)}
						r="14"
						fill="transparent"
						class="cursor-pointer"
						onclick={() => selectedEntry = selectedEntry?.id === entry.id ? null : entry}
					/>
					<!-- Visible dot -->
					<circle
						cx={xPos(entry, i)}
						cy={yPos(entry.flow)}
						r={selectedEntry?.id === entry.id ? 7 : 5}
						fill={selectedEntry?.id === entry.id ? '#f59e0b' : 'var(--color-river)'}
						stroke={selectedEntry?.id === entry.id ? '#d97706' : 'var(--color-river-dark)'}
						stroke-width="1.5"
						class="cursor-pointer transition-all"
						onclick={() => selectedEntry = selectedEntry?.id === entry.id ? null : entry}
					/>
					<!-- Date label -->
					<text
						x={xPos(entry, i)}
						y={chartH - 8}
						text-anchor="middle"
						class="fill-base-content/50 text-[9px]"
						transform="rotate(-30 {xPos(entry, i)} {chartH - 8})"
					>{new Date(entry.datetime).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}</text>
					<!-- Flow label on point -->
					<text
						x={xPos(entry, i)}
						y={yPos(entry.flow) - 10}
						text-anchor="middle"
						class="fill-base-content/70 text-[10px] font-bold"
					>{Math.round(entry.flow)}</text>
				{/each}

				<!-- Current flow dashed line -->
				{#if currentFlow !== null && currentFlowY !== null}
					<line
						x1={padL}
						x2={padL + plotW}
						y1={currentFlowY}
						y2={currentFlowY}
						stroke="#f59e0b"
						stroke-width="1.5"
						stroke-dasharray="6 4"
					/>
					<text
						x={padL + plotW + 4}
						y={currentFlowY}
						dominant-baseline="middle"
						class="text-[9px] font-bold"
						fill="#f59e0b"
					>Now: {Math.round(currentFlow)}</text>
				{/if}
			</svg>
		</div>

		{#if selectedEntry}
			<div class="bg-base-200 rounded-lg p-4 mt-4">
				<div class="flex justify-between items-start">
					<div>
					<p class="font-bold">
						{new Date(selectedEntry.datetime).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
						</p>
						<p class="font-mono text-sm mt-1">{Math.round(selectedEntry.flow)} CFS</p>
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

		{#if fetchingCurrent}
			<p class="text-xs text-base-content/40 mt-2">Fetching current flow from USGS...</p>
		{:else if currentFlow !== null}
			<p class="text-xs text-base-content/40 mt-2">
				Current flow: <span class="font-mono font-bold text-warning">{Math.round(currentFlow)} CFS</span> (USGS)
			</p>
		{:else if river.externalGaugeId}
			<p class="text-xs text-base-content/40 mt-2">Current flow unavailable</p>
		{/if}
	</div>
</div>
