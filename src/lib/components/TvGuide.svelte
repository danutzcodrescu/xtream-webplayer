<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { get } from 'svelte/store';
	import { createVirtualizer } from '@tanstack/svelte-virtual';

	// ── Types ──────────────────────────────────────────────────────────────────
	interface Category {
		category_id: string;
		category_name: string;
		hidden: boolean;
	}

	interface Channel {
		stream_id: number;
		name: string;
		stream_icon: string;
		category_id: string;
		epg_channel_id: string;
	}

	interface EpgEntry {
		id: string;
		title: string;
		description: string;
		start_timestamp: number;
		stop_timestamp: number;
	}

	// ── Props ──────────────────────────────────────────────────────────────────
	let {
		playlistId,
		selectedChannel = null,
		onSelect,
		searchQuery = $bindable(''),
	}: {
		playlistId: string;
		selectedChannel: Channel | null;
		onSelect: (ch: Channel) => void;
		searchQuery?: string;
	} = $props();

	// ── Layout constants ───────────────────────────────────────────────────────
	const PPM = 5; // pixels per minute
	const CH_W = 188; // channel column width
	const ROW_H = 68; // row height
	const RULER_H = 40; // time ruler height
	const BUFFER = 5; // virtual scroll row buffer
	const MINS_BACK = 60; // minutes before now visible
	const MINS_AHEAD = 11 * 60; // minutes after now visible
	const TOTAL_MINS = MINS_BACK + MINS_AHEAD;
	const TOTAL_W = TOTAL_MINS * PPM;

	// ── Reactive clock ─────────────────────────────────────────────────────────
	let nowMs = $state(Date.now());
	const winStartMs = $derived(nowMs - MINS_BACK * 60_000);
	const nowPx = $derived(MINS_BACK * PPM);

	const timeMarks = $derived.by(() => {
		const marks: { date: Date; px: number }[] = [];
		const step = 30 * 60_000;
		const first = Math.ceil(winStartMs / step) * step;
		for (let t = first; t < winStartMs + TOTAL_MINS * 60_000; t += step) {
			marks.push({ date: new Date(t), px: ((t - winStartMs) / 60_000) * PPM });
		}
		return marks;
	});

	// ── Data ───────────────────────────────────────────────────────────────────
	let categories = $state<Category[]>([]);
	let channels = $state<Channel[]>([]);
	let allChannels = $state<Channel[]>([]); // all channels across all categories, for global search
	let activeCatId = $state('');
	let epg = $state<Record<number, EpgEntry[]>>({});
	const loadedEpg = new Set<number>();
	let loadingChannels = $state(false);

	const filteredChannels = $derived(channels);

	const catMap = $derived(new Map(categories.map((c) => [c.category_id, c.category_name])));

	/** Returns true if every word in the query appears somewhere in text. */
	function matchesWords(text: string, words: string[]): boolean {
		const lower = text.toLowerCase();
		return words.every((w) => lower.includes(w));
	}

	const searchResults = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return [];
		const words = q.split(/\s+/);

		const results: { channel: Channel; matchedProgramme: string | null }[] = [];
		const seen = new Set<number>();

		// First pass: channel name matches
		for (const ch of allChannels) {
			if (matchesWords(ch.name, words)) {
				results.push({ channel: ch, matchedProgramme: null });
				seen.add(ch.stream_id);
			}
		}

		// Second pass: EPG programme title matches (already loaded in memory)
		for (const [streamIdStr, programmes] of Object.entries(epg)) {
			const streamId = Number(streamIdStr);
			if (seen.has(streamId)) continue;
			for (const prog of programmes) {
				if (matchesWords(prog.title, words)) {
					const ch = allChannels.find((c) => c.stream_id === streamId);
					if (ch) {
						results.push({ channel: ch, matchedProgramme: prog.title });
						seen.add(streamId);
					}
					break;
				}
			}
		}

		return results;
	});

	// ── Search results virtual list ─────────────────────────────────────────────
	const ITEM_H = 60; // px — fixed row height for the search list
	let searchListEl: HTMLDivElement | undefined = $state(undefined);

	const searchVirtualizer = createVirtualizer({
		count: 0,
		getScrollElement: () => searchListEl ?? null,
		estimateSize: () => ITEM_H,
		overscan: 5,
	});

	$effect(() => {
		// Read searchListEl explicitly so Svelte 5 tracks it as a dependency.
		// Reading it only inside the closure () => searchListEl would NOT be
		// tracked because closures are not executed during the effect body.
		const el = searchListEl ?? null;
		get(searchVirtualizer).setOptions({
			count: searchResults.length,
			getScrollElement: () => el,
		});
	});

	// ── Virtual scroll ─────────────────────────────────────────────────────────
	let guideEl: HTMLDivElement = $state()!;
	let scrollTop = $state(0);
	let viewH = $state(500);

	const firstRow = $derived(Math.max(0, Math.floor(scrollTop / ROW_H) - BUFFER));
	const lastRow = $derived(
		Math.min(filteredChannels.length, Math.ceil((scrollTop + viewH) / ROW_H) + BUFFER)
	);
	const visibleChs = $derived(
		filteredChannels
			.slice(firstRow, lastRow)
			.map((ch, i) => ({ ...ch, rowIdx: firstRow + i }))
	);
	const padTop = $derived(firstRow * ROW_H);
	const padBot = $derived(Math.max(0, (filteredChannels.length - lastRow) * ROW_H));

	// Load EPG for newly visible channels
	$effect(() => {
		for (const ch of visibleChs) maybeLoadEpg(ch.stream_id);
	});

	// ── Helpers ────────────────────────────────────────────────────────────────
	function tsToPx(ts: number): number {
		return ((ts * 1000 - winStartMs) / 60_000) * PPM;
	}

	function progStyle(prog: EpgEntry): string {
		const left = Math.max(0, tsToPx(prog.start_timestamp));
		const right = Math.min(TOTAL_W, tsToPx(prog.stop_timestamp));
		return `left:${left + 1}px;width:${Math.max(2, right - left - 2)}px`;
	}

	function isCurrent(prog: EpgEntry): boolean {
		const now = nowMs / 1000;
		return prog.start_timestamp <= now && prog.stop_timestamp > now;
	}

	function isPast(prog: EpgEntry): boolean {
		return prog.stop_timestamp * 1000 < nowMs;
	}

	function progress(prog: EpgEntry): number {
		const now = nowMs / 1000;
		const dur = prog.stop_timestamp - prog.start_timestamp;
		return dur > 0 ? Math.min(100, ((now - prog.start_timestamp) / dur) * 100) : 0;
	}

	function formatTime(d: Date): string {
		return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
	}

	// ── Data loading ───────────────────────────────────────────────────────────
	async function loadCategories(pid: string) {
		const r = await fetch(`/api/categories?playlistId=${pid}`);
		if (r.ok) {
			categories = (await r.json()).filter((c: Category) => !c.hidden);
			if (categories.length > 0 && activeCatId === '') {
				activeCatId = categories[0].category_id;
				loadChannels(pid, categories[0].category_id);
			}
		}
	}

	async function loadChannels(pid: string, catId: string) {
		loadingChannels = true;
		epg = {};
		loadedEpg.clear();
		const p = new URLSearchParams({ playlistId: pid });
		if (catId) p.set('categoryId', catId);
		const r = await fetch(`/api/channels?${p}`);
		if (r.ok) channels = await r.json();
		else channels = [];
		loadingChannels = false;
	}

	let allChannelsLoading = false;

	$effect(() => {
		if (searchQuery.trim().length > 0) ensureAllChannels();
	});

	async function ensureAllChannels() {
		if (allChannels.length > 0 || allChannelsLoading) return;
		allChannelsLoading = true;
		const r = await fetch(`/api/channels?playlistId=${playlistId}`);
		if (r.ok) allChannels = await r.json();
		allChannelsLoading = false;
	}

	async function selectFromSearch(ch: Channel) {
		searchQuery = '';
		activeCatId = ch.category_id;
		onSelect(ch);
		await loadChannels(playlistId, ch.category_id);
		await tick(); // wait for guide to re-render before scrolling
		const idx = channels.findIndex((c) => c.stream_id === ch.stream_id);
		if (idx >= 0 && guideEl) {
			const target = Math.max(0, idx * ROW_H - viewH / 2 + ROW_H / 2);
			guideEl.scrollTop = target;
			scrollTop = target;
		}
	}

	function maybeLoadEpg(streamId: number) {
		if (loadedEpg.has(streamId)) return;
		loadedEpg.add(streamId);
		// Use short EPG with limit=12 (~6-12h coverage) — more widely supported
		// than get_simple_data_table across Xtream providers
		fetch(`/api/epg?playlistId=${playlistId}&streamId=${streamId}&limit=12`)
			.then((r) => (r.ok ? r.json() : []))
			.then((data: EpgEntry[]) => {
				epg = { ...epg, [streamId]: data };
			})
			.catch(() => {
				epg = { ...epg, [streamId]: [] };
			});
	}

	function handleProgramClick(ch: Channel) {
		onSelect(ch);
	}

	function scrollToNow() {
		if (guideEl)
			guideEl.scrollLeft = Math.max(0, nowPx + CH_W - guideEl.clientWidth * 0.35);
	}

	function handleScroll() {
		scrollTop = guideEl.scrollTop;
	}

	// Reload everything when playlistId changes
	$effect(() => {
		const pid = playlistId;
		if (!pid) return;
		activeCatId = '';
		searchQuery = '';
		channels = [];
		allChannels = [];
		allChannelsLoading = false;
		categories = [];
		epg = {};
		loadedEpg.clear();
		loadCategories(pid);
	});

	onMount(() => {
		viewH = guideEl.clientHeight;
		setTimeout(scrollToNow, 150);
		const timer = setInterval(() => {
			nowMs = Date.now();
		}, 30_000);
		return () => clearInterval(timer);
	});
</script>

<div class="flex flex-col h-full bg-gray-950 text-white select-none">
	<!-- ── Toolbar ──────────────────────────────────────────────────────────── -->
	<div
		class="flex items-center gap-2 px-3 py-2 bg-gray-900 border-b border-gray-800 shrink-0 overflow-x-auto"
	>
		<!-- Category tabs -->
		{#each categories as cat}
			<button
				class="px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition
				       {activeCatId === cat.category_id
					? 'bg-indigo-600 text-white'
					: 'text-gray-400 hover:text-white hover:bg-gray-800'}"
				onclick={() => {
					searchQuery = '';
					activeCatId = cat.category_id;
					loadChannels(playlistId, cat.category_id);
				}}
			>{cat.category_name}</button>
		{/each}

		<span class="flex-1 min-w-4"></span>

		<!-- Now button -->
		<button
			onclick={scrollToNow}
			class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
			       bg-red-600/20 text-red-400 hover:bg-red-600/30 transition whitespace-nowrap"
		>
			<span class="w-2 h-2 rounded-full bg-red-500 animate-pulse inline-block"></span>
			Now
		</button>
	</div>

	<!-- ── Search results (virtualized) ────────────────────────────────────── -->
	{#if searchQuery.trim()}
		<div bind:this={searchListEl} class="flex-1 overflow-y-auto min-h-0">
			{#if searchResults.length === 0}
				<div class="flex items-center justify-center h-32 text-gray-500 text-sm">
					No channels found
				</div>
			{:else}
				<div style="height:{$searchVirtualizer.getTotalSize()}px;position:relative">
					{#each $searchVirtualizer.getVirtualItems() as item (item.key)}
						{@const { channel: ch, matchedProgramme } = searchResults[item.index]}
						<div
							style="position:absolute;top:0;left:0;width:100%;height:{item.size}px;transform:translateY({item.start}px)"
						>
							<button
								class="w-full h-full flex items-center gap-3 px-3 rounded-lg text-left
								       transition-colors
								       {selectedChannel?.stream_id === ch.stream_id
									? 'bg-indigo-900/50'
									: 'hover:bg-gray-800/80'}"
								onclick={() => selectFromSearch(ch)}
							>
								<div class="shrink-0">
									{#if ch.stream_icon}
										<img
											src={ch.stream_icon}
											alt=""
											class="w-9 h-9 object-contain rounded"
											onerror={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
										/>
									{:else}
										<div class="w-9 h-9 rounded bg-gray-800 flex items-center justify-center">
											<span class="text-xs text-gray-600 font-bold">
												{ch.name.slice(0, 2).toUpperCase()}
											</span>
										</div>
									{/if}
								</div>
								<div class="flex-1 min-w-0">
									<div class="text-sm font-medium text-gray-200 truncate">{ch.name}</div>
									{#if matchedProgramme}
										<div class="text-xs text-yellow-400/80 truncate mt-0.5">{matchedProgramme}</div>
									{:else if catMap.get(ch.category_id)}
										<div class="text-xs text-indigo-400 truncate mt-0.5">
											{catMap.get(ch.category_id)}
										</div>
									{/if}
								</div>
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{:else}

	<!-- ── Guide grid ──────────────────────────────────────────────────────── -->
	<div
		bind:this={guideEl}
		class="flex-1 overflow-auto min-h-0"
		onscroll={handleScroll}
	>
		<!-- Inner container sets the full scroll width -->
		<div style="min-width:{CH_W + TOTAL_W}px">

			<!-- Time ruler (sticky top) -->
			<div
				class="flex sticky top-0 z-20 bg-gray-950 border-b border-gray-800"
				style="height:{RULER_H}px"
			>
				<!-- Corner cell: sticky in both axes -->
				<div
					class="shrink-0 sticky left-0 z-30 bg-gray-900 border-r border-gray-800
					       flex items-center justify-center"
					style="width:{CH_W}px"
				>
					{#if loadingChannels}
						<span class="text-xs text-gray-500 animate-pulse">Loading…</span>
					{:else}
						<span class="text-xs text-gray-600 font-medium">
							{filteredChannels.length} channels
						</span>
					{/if}
				</div>

				<!-- Time marks -->
				<div class="relative shrink-0" style="width:{TOTAL_W}px">
					{#each timeMarks as m}
						<div
							class="absolute top-0 bottom-0 flex items-center pl-2 text-xs
							       text-gray-500 border-l border-gray-800/60"
							style="left:{m.px}px"
						>
							{formatTime(m.date)}
						</div>
					{/each}
					<!-- Now indicator in ruler -->
					<div
						class="absolute top-0 bottom-0 w-px bg-red-500 z-10"
						style="left:{nowPx}px"
					></div>
				</div>
			</div>

			<!-- Virtual scroll: top spacer -->
			<div style="height:{padTop}px" aria-hidden="true"></div>

			<!-- Channel rows -->
			{#each visibleChs as ch (ch.stream_id)}
				{@const programs = epg[ch.stream_id]}
				{@const isSelected = selectedChannel?.stream_id === ch.stream_id}

				<div
					class="flex border-b border-gray-800/40"
					style="height:{ROW_H}px"
				>
					<!-- Channel cell (sticky left) -->
					<button
						class="shrink-0 sticky left-0 z-10 flex items-center gap-2.5 px-3
						       border-r border-gray-800 text-left transition-colors cursor-pointer
						       {isSelected ? 'bg-indigo-900/50' : 'bg-gray-950 hover:bg-gray-900/80'}"
						style="width:{CH_W}px"
						onclick={() => onSelect(ch)}
						title={ch.name}
					>
						<!-- Channel logo -->
						<div class="shrink-0">
							{#if ch.stream_icon}
								<img
									src={ch.stream_icon}
									alt=""
									class="w-9 h-9 object-contain rounded"
									onerror={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
								/>
							{:else}
								<div class="w-9 h-9 rounded bg-gray-800 flex items-center justify-center">
									<span class="text-xs text-gray-600 font-bold">
										{ch.name.slice(0, 2).toUpperCase()}
									</span>
								</div>
							{/if}
						</div>
						<span class="text-sm font-medium truncate leading-tight text-gray-200">
							{ch.name}
						</span>
					</button>

					<!-- Programs area -->
					<div class="relative shrink-0 overflow-hidden" style="width:{TOTAL_W}px">
						<!-- Now line -->
						<div
							class="absolute inset-y-0 w-px bg-red-500/50 z-10 pointer-events-none"
							style="left:{nowPx}px"
						></div>

						{#if programs === undefined}
							<!-- Skeleton while loading EPG -->
							<div class="absolute inset-1 rounded-md bg-gray-800/60 animate-pulse"></div>

						{:else if programs.length === 0}
							<div class="absolute inset-0 flex items-center px-4 text-xs text-gray-700 italic">
								No programme information
							</div>

						{:else}
							{#each programs as prog (prog.id)}
								{@const cur = isCurrent(prog)}
								{@const past = isPast(prog)}
							<button
									class="absolute top-1.5 bottom-1.5 overflow-hidden rounded-md text-left
									       text-xs transition-all group
									       {cur
										? 'bg-indigo-800/90 hover:bg-indigo-700 border border-indigo-500/70'
										: past
												? 'bg-gray-900/60 border border-gray-800/30 opacity-60'
												: 'bg-gray-800 hover:bg-gray-700 border border-gray-700/60'}"
									style={progStyle(prog)}
									onclick={() => handleProgramClick(ch)}
									title={prog.title}
								>
									<!-- Progress bar for current programme -->
									{#if cur}
										<div
											class="absolute bottom-0 left-0 h-0.5 bg-indigo-400
											       pointer-events-none"
											style="width:{progress(prog)}%"
										></div>
									{/if}

									<div class="px-2 py-1 h-full flex flex-col justify-center gap-0.5 min-w-0">
										<span
											class="font-semibold truncate leading-tight
											       {cur ? 'text-white' : past ? 'text-gray-500' : 'text-gray-200'}"
										>
											{prog.title}
										</span>
										<span class="text-gray-500 truncate leading-tight text-[10px]">
											{formatTime(new Date(prog.start_timestamp * 1000))}
										</span>
									</div>
								</button>
							{/each}
						{/if}
					</div>
				</div>
			{/each}

			<!-- Virtual scroll: bottom spacer -->
			<div style="height:{padBot}px" aria-hidden="true"></div>
		</div>
	</div>
	{/if}
</div>
