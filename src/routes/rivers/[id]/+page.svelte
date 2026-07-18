<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const { river, entries, gauge, location } = $derived(data);
</script>

<div class="container mx-auto px-4 py-8 max-w-4xl">
	<!-- River header -->
	<div class="mb-6">
		<div class="flex items-start justify-between gap-4">
			<div>
				<h1 class="text-3xl font-bold">{river.riverName}</h1>
				{#if river.section}
					<p class="text-lg text-base-content/70 mt-1">{river.section}</p>
				{/if}
			</div>
			{#if river.classRating}
				<div class="badge badge-lg badge-primary font-bold shrink-0">
					Class {river.classRating}
				</div>
			{/if}
		</div>

		<div class="flex flex-wrap gap-2 mt-3 text-sm text-base-content/60">
			<span>{river.state}</span>
			{#if river.altName}
				<span>·</span>
				<span>aka {river.altName}</span>
			{/if}
			{#if river.externalGaugeId}
				<span>·</span>
				<span>{river.externalGaugeSource?.toUpperCase()} gauge {river.externalGaugeId}</span>
			{/if}
		</div>

		{#if river.abstract}
			<p class="mt-3 text-base-content/80">{river.abstract}</p>
		{/if}
	</div>

	<!-- Gauge / flow summary -->
	{#if gauge}
		<div class="card bg-base-200 mb-6">
			<div class="card-body py-4">
				<div class="flex items-center gap-4 flex-wrap">
					<div>
						<div class="text-sm text-base-content/60 uppercase tracking-wide">Current Flow</div>
						<div class="text-2xl font-bold">
							{#if gauge.currentFlow !== null}
								{gauge.currentFlow.toLocaleString()} CFS
							{:else}
								— CFS
							{/if}
						</div>
					</div>
					{#if gauge.gaugeMin !== null || gauge.gaugeMax !== null}
						<div class="text-sm text-base-content/50">
							Runnable: {gauge.gaugeMin ?? '?'} – {gauge.gaugeMax ?? '?'} CFS
						</div>
					{/if}
					{#if gauge.siteName}
						<div class="text-xs text-base-content/40 ml-auto">{gauge.siteName}</div>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	<!-- Location coordinates (for downstream map component) -->
	{#if location}
		<div class="text-xs text-base-content/30 mb-4" aria-label="coordinates">
			{location.lat.toFixed(4)}, {location.lon.toFixed(4)}
		</div>
	{/if}

	<!-- Journal entries -->
	<div class="mb-4 flex items-center justify-between">
		<h2 class="text-xl font-semibold">
			{entries.length} {entries.length === 1 ? 'Entry' : 'Entries'}
		</h2>
		<a href="/entries/new" class="btn btn-sm btn-primary">Log a run</a>
	</div>

	{#if entries.length > 0}
		<div class="space-y-3">
			{#each entries as entry (entry.id)}
				<a
					href="/entries/{entry.id}"
					class="card bg-base-200 hover:bg-base-300 transition-colors block"
				>
					<div class="card-body py-3 px-4">
						<div class="flex items-center justify-between gap-2">
							<div class="font-medium">
								{new Date(entry.datetime).toLocaleDateString('en-US', {
									year: 'numeric',
									month: 'short',
									day: 'numeric'
								})}
							</div>
							{#if entry.details?.flow}
								<div class="text-sm text-base-content/60">{entry.details.flow.toLocaleString()} CFS</div>
							{/if}
						</div>
						{#if entry.description}
							<p class="text-sm text-base-content/70 line-clamp-2">{entry.description}</p>
						{/if}
					</div>
				</a>
			{/each}
		</div>
	{:else}
		<div class="text-center py-10 text-base-content/40">
			<p>No entries yet for this river.</p>
			<a href="/entries/new" class="btn btn-sm btn-ghost mt-3">Log your first run</a>
		</div>
	{/if}
</div>
