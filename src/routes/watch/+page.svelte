<script lang="ts">
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth-client';
	import VideoPlayer from '$lib/components/VideoPlayer.svelte';
	import TvGuide from '$lib/components/TvGuide.svelte';
	import { Settings, LogOut, Tv, X, ChevronDown, Check, ListVideo } from 'lucide-svelte';

	let { data } = $props();

	// ── State ──────────────────────────────────────────────────────────────────
	// null means "user hasn't picked one yet — use the first available"
	let userPlaylistId = $state<string | null>(null);
	let searchQuery = $state('');
	let playlistDropdownOpen = $state(false);

	let selectedChannel = $state<{
		stream_id: number;
		name: string;
		stream_icon: string;
		epg_channel_id: string;
	} | null>(null);

	let streamUrl = $state<string | null>(null);

	// ── Derived ────────────────────────────────────────────────────────────────
	// Always computed from data so it reacts to prop changes
	const selectedPlaylistId = $derived(
		(userPlaylistId !== null && data.playlists.some((p) => p.id === userPlaylistId))
			? userPlaylistId
			: (data.playlists[0]?.id ?? '')
	);

	const selectedPlaylist = $derived(
		data.playlists.find((p) => p.id === selectedPlaylistId) ?? data.playlists[0] ?? null
	);

	// ── Handlers ───────────────────────────────────────────────────────────────
	function handleChannelSelect(channel: typeof selectedChannel) {
		selectedChannel = channel;
		streamUrl = channel
			? `/api/stream?playlistId=${selectedPlaylistId}&streamId=${channel.stream_id}`
			: null;
	}

	function closePlayer() {
		streamUrl = null;
		selectedChannel = null;
	}

	function switchPlaylist(id: string) {
		userPlaylistId = id;
		selectedChannel = null;
		streamUrl = null;
		playlistDropdownOpen = false;
	}

	async function handleSignOut() {
		await authClient.signOut();
		goto('/login');
	}
</script>

<svelte:head>
	<title>{selectedChannel ? `${selectedChannel.name} — ` : ''}IPTV Player</title>
</svelte:head>

<div class="flex flex-col h-screen overflow-hidden bg-gray-950 text-white">

	<!-- ── Header ─────────────────────────────────────────────────────────── -->
	<header class="flex items-center gap-3 px-4 py-2 bg-gray-900 border-b border-gray-800 shrink-0 z-40">
		<!-- Logo -->
		<div class="flex items-center gap-2 shrink-0">
			<div class="bg-indigo-600 rounded-lg p-1">
				<Tv class="w-4 h-4 text-white" />
			</div>
			<span class="font-semibold text-sm hidden sm:block">IPTV Player</span>
		</div>

		<!-- Playlist switcher -->
		{#if data.playlists.length > 0}
			<div class="relative shrink-0">
				<button
					onclick={() => (playlistDropdownOpen = !playlistDropdownOpen)}
					class="flex items-center gap-1.5 bg-gray-800 border border-gray-700 rounded-lg
					       px-3 py-1.5 text-sm text-white hover:bg-gray-700 hover:border-gray-600
					       focus:outline-none focus:ring-2 focus:ring-indigo-500 transition max-w-48"
					title="Switch playlist"
				>
					<ListVideo class="w-3.5 h-3.5 text-indigo-400 shrink-0" />
					<span class="truncate max-w-32">{selectedPlaylist?.name ?? 'Select playlist'}</span>
					{#if data.playlists.length > 1}
						<ChevronDown class="w-3.5 h-3.5 text-gray-400 shrink-0 transition-transform {playlistDropdownOpen ? 'rotate-180' : ''}" />
					{/if}
				</button>

				{#if playlistDropdownOpen && data.playlists.length > 1}
					<!-- Backdrop -->
					<button
						class="fixed inset-0 z-40"
						onclick={() => (playlistDropdownOpen = false)}
						aria-label="Close playlist menu"
					></button>
					<!-- Dropdown -->
					<div class="absolute left-0 top-full mt-1 z-50 bg-gray-800 border border-gray-700
					            rounded-lg shadow-xl overflow-hidden min-w-48 max-w-64">
						{#each data.playlists as pl}
							<button
								onclick={() => switchPlaylist(pl.id)}
								class="w-full flex items-center gap-2 px-3 py-2 text-sm text-left
								       hover:bg-gray-700 transition
								       {pl.id === selectedPlaylistId ? 'text-white bg-gray-700/50' : 'text-gray-300'}"
							>
								<ListVideo class="w-3.5 h-3.5 shrink-0 {pl.id === selectedPlaylistId ? 'text-indigo-400' : 'text-gray-500'}" />
								<span class="truncate flex-1">{pl.name}</span>
								{#if pl.id === selectedPlaylistId}
									<Check class="w-3.5 h-3.5 text-indigo-400 shrink-0" />
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		<!-- Now-playing info -->
		{#if selectedChannel && streamUrl}
			<div class="flex items-center gap-2 min-w-0">
				{#if selectedChannel.stream_icon}
					<img
						src={selectedChannel.stream_icon}
						alt=""
						class="w-5 h-5 object-contain rounded shrink-0"
						onerror={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
					/>
				{/if}
				<span class="text-sm font-medium truncate text-white/90">
					{selectedChannel.name}
				</span>
				<span class="flex items-center gap-1 text-[10px] bg-red-600/80 text-red-100 px-1.5 py-0.5 rounded font-medium shrink-0">
					<span class="w-1.5 h-1.5 rounded-full bg-red-300 animate-pulse inline-block"></span>
					LIVE
				</span>
			</div>
		{/if}

		<span class="flex-1"></span>

		<!-- Search -->
		{#if selectedPlaylist}
			<input
				type="search"
				placeholder="Search channels…"
				bind:value={searchQuery}
				class="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white
				       placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-48"
			/>
		{/if}

		<!-- Close player button (shown when playing) -->
		{#if streamUrl}
			<button
				onclick={closePlayer}
				class="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition"
				title="Close player"
			>
				<X class="w-4 h-4" />
			</button>
		{/if}

		<a
			href="/settings"
			class="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition"
			title="Settings"
		>
			<Settings class="w-4 h-4" />
		</a>
		<button
			onclick={handleSignOut}
			class="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition"
			title="Sign out"
		>
			<LogOut class="w-4 h-4" />
		</button>
	</header>

	<!-- ── Main area: stacked — player top (50% wide, 16:9), guide fills rest ── -->
	<div class="flex-1 min-h-0 flex flex-col overflow-hidden">

		<!-- Video player — 40vh tall, 16:9 aspect ratio centered -->
		{#if streamUrl}
			<div class="shrink-0 bg-black flex justify-center" style="height: 40vh">
				<div class="h-full flex" style="aspect-ratio: 16/9">
					<VideoPlayer {streamUrl} />
				</div>
			</div>
		{/if}

		<!-- TV Guide — fills remaining space -->
		<div class="flex-1 min-h-0">
			{#if selectedPlaylist}
				<TvGuide
					playlistId={selectedPlaylist.id}
					{selectedChannel}
					onSelect={handleChannelSelect}
					bind:searchQuery
				/>
			{:else}
				<div class="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
					<Tv class="w-12 h-12 opacity-20" />
					<p class="text-sm">No playlists yet.</p>
					<a href="/settings" class="text-indigo-400 hover:underline text-sm">Add one in Settings</a>
				</div>
			{/if}
		</div>

	</div>

</div>
