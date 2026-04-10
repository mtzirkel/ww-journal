<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	let { children, data } = $props();

	const navItems = [
		{ href: '/', label: 'Dashboard', icon: '◩' },
		{ href: '/entries', label: 'Entries', icon: '☰' },
		{ href: '/entries/new', label: 'Log', icon: '＋' },
		{ href: '/map', label: 'Map', icon: '◎' },
		{ href: '/settings', label: 'Settings', icon: '⚙' }
	];

	let dark = $state(false);

	$effect(() => {
		if (browser) {
			const saved = localStorage.getItem('theme');
			dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
		}
	});

	$effect(() => {
		if (browser) {
			document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
			localStorage.setItem('theme', dark ? 'dark' : 'light');
		}
	});

	function isActive(href: string) {
		if (href === '/') return page.url.pathname === '/';
		return page.url.pathname.startsWith(href);
	}
</script>

<svelte:head>
	<title>Whitewater Journal</title>
</svelte:head>

<div class="min-h-screen bg-base-200 pb-20 md:pb-0 md:pl-56">
	<!-- Desktop sidebar -->
	<aside class="hidden md:flex fixed left-0 top-0 h-full w-56 flex-col bg-base-100 shadow-lg z-40">
		<div class="p-4 border-b border-base-300">
			<h1 class="text-xl font-bold" style="color: var(--color-river)">WW Journal</h1>
			{#if data.user}
				<p class="text-xs text-base-content/50 mt-1">{data.user.username}</p>
			{/if}
		</div>
		<nav class="flex-1 p-2">
			{#each navItems as item}
				<a
					href={item.href}
					class="flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-colors"
					class:bg-primary={isActive(item.href)}
					class:text-primary-content={isActive(item.href)}
					class:hover:bg-base-200={!isActive(item.href)}
				>
					<span class="text-lg">{item.icon}</span>
					{item.label}
				</a>
			{/each}
		</nav>
		<div class="p-4 border-t border-base-300">
			<label class="flex items-center gap-2 cursor-pointer">
				<span class="text-xs">☀</span>
				<input type="checkbox" class="toggle toggle-sm" bind:checked={dark} />
				<span class="text-xs">☾</span>
			</label>
		</div>
	</aside>

	<!-- Mobile top bar -->
	<header class="md:hidden sticky top-0 z-40 bg-base-100 shadow-sm px-4 py-3 flex items-center justify-between">
		<h1 class="text-lg font-bold" style="color: var(--color-river)">WW Journal</h1>
		<div class="flex items-center gap-3">
			<label class="flex items-center gap-1 cursor-pointer">
				<span class="text-xs">☀</span>
				<input type="checkbox" class="toggle toggle-xs" bind:checked={dark} />
				<span class="text-xs">☾</span>
			</label>
			{#if data.user}
				<span class="text-xs text-base-content/50">{data.user.username}</span>
			{/if}
		</div>
	</header>

	<!-- Main content -->
	<main class="container mx-auto px-4 py-6 max-w-3xl">
		{@render children()}
	</main>

	<!-- Mobile bottom nav -->
	<nav class="md:hidden fixed bottom-0 left-0 right-0 bg-base-100 border-t border-base-300 z-40">
		<div class="flex justify-around">
			{#each navItems as item}
				<a
					href={item.href}
					class="flex flex-col items-center py-2 px-3 text-xs transition-colors"
					class:text-primary={isActive(item.href)}
					class:opacity-50={!isActive(item.href)}
				>
					<span class="text-xl mb-0.5">{item.icon}</span>
					{item.label}
				</a>
			{/each}
		</div>
	</nav>
</div>
