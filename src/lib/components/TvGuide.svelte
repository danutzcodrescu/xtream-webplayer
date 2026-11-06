<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { get } from 'svelte/store';
	import { createVirtualizer } from '@tanstack/svelte-virtual';
	import { GuideData, type Channel, type EpgEntry, type CatchupProgramme } from '$lib/guide-data';

	// ── Props ──────────────────────────────────────────────────────────────────
	let {
		playlistId,
		selectedChannel = null,
		onSelect,
		searchQuery = $bindable(''),
	}: {
		playlistId: string;
		selectedChannel: Channel | null;
		onSelect: (ch: Channel, catchupProgramme?: CatchupProgramme) => void;
		searchQuery?: string;
	} = $props();

	// ── Layout constants ───────────────────────────────────────────────────────
	const PPM = 5; // pixels per minute
	const CH_W = 188; // channel column width
	const ROW_H = 68; // row height
	const RULER_H = 40; // time ruler height
	const BUFFER = 5; // virtual scroll row buffer
	const MINS_BACK = 7 * 24 * 60; // 7 days of history for catchup scrolling
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
	const guide = new GuideData();
	const categories = $derived($guide.categories);
	const channels = $derived($guide.channels);
	const activeCatId = $derived($guide.activeCatId);
	const epg = $derived($guide.epg);
	const loadingChannels = $derived($guide.loadingChannels || $guide.loadingCategories);

	const filteredChannels = $derived(channels);

	const catMap = $derived(new Map(categories.map((c) => [c.category_id, c.category_name])));

	const searchResults = $derived($guide.searchResults);
	$effect(() => guide.setSearch(searchQuery, nowMs));

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
		guide.setVisibleChannels(searchQuery.trim() ? [] : visibleChs.map((ch) => ch.stream_id), nowMs);
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

	/** True if this past programme can be replayed via catchup */
	function isCatchupAvailable(ch: Channel, prog: EpgEntry): boolean {
		if (!isPast(prog)) return false;
		// Per-programme flag from get_simple_data_table takes precedence
		if (prog.has_archive !== undefined) return prog.has_archive === 1;
		// Fall back to channel-level flag + age check
		if (!ch.tv_archive) return false;
		const maxDays = ch.tv_archive_duration ?? 7;
		const ageDays = (nowMs / 1000 - prog.start_timestamp) / 86400;
		return ageDays <= maxDays;
	}

	function formatTime(d: Date): string {
		return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
	}

	async function selectFromSearch(ch: Channel) {
		const pid = playlistId;
		searchQuery = '';
		onSelect(ch);
		const current = await guide.selectCategory(ch.category_id);
		await tick(); // wait for guide to re-render before scrolling
		if (!current || playlistId !== pid || activeCatId !== ch.category_id) return;
		const idx = channels.findIndex((c) => c.stream_id === ch.stream_id);
		if (idx >= 0 && guideEl) {
			const target = Math.max(0, idx * ROW_H - viewH / 2 + ROW_H / 2);
			guideEl.scrollTop = target;
			scrollTop = target;
		}
	}

	function handleProgrammeClick(ch: Channel, prog: EpgEntry) {
		if (isCatchupAvailable(ch, prog)) {
			onSelect(ch, {
				start_timestamp: prog.start_timestamp,
				stop_timestamp: prog.stop_timestamp,
				title: prog.title,
			});
		} else if (!isPast(prog) || isCurrent(prog)) {
			// Live or currently-airing — start the live stream
			onSelect(ch);
		}
		// Past programme without catchup: do nothing (button is visually disabled)
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
		searchQuery = '';
		void guide.setPlaylist(pid);
	});
	onDestroy(() => guide.dispose());
	$effect(() => {
		const el = guideEl;
		if (!el) return;
		viewH = el.clientHeight;
		scrollTop = el.scrollTop;
		const observer = new ResizeObserver(() => { viewH = el.clientHeight; });
		observer.observe(el);
		return () => observer.disconnect();
	});

	onMount(() => {
		const initialScroll = setTimeout(scrollToNow, 150);
		const timer = setInterval(() => {
			nowMs = Date.now();
		}, 30_000);
		return () => { clearInterval(timer); clearTimeout(initialScroll); };
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
					void guide.selectCategory(cat.category_id);
					if (guideEl) guideEl.scrollTop = 0;
					scrollTop = 0;
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
	{#if $guide.error}
		<div role="alert" class="px-3 py-2 text-sm text-red-300">
			{$guide.error} <button class="underline" onclick={() => guide.retry()}>Retry</button>
		</div>
	{/if}
	{#if $guide.providerRetryAt}
		<p role="status" class="px-3 py-2 text-sm text-amber-300">Provider busy or unavailable — retrying shortly. Previously loaded guide data may be out of date.</p>
	{/if}

	<!-- ── Search results (virtualized) ────────────────────────────────────── -->
	{#if searchQuery.trim()}
		<p class="px-3 py-2 text-xs text-gray-400">Searches all Channel names and currently airing Programmes in already-loaded EPG.</p>
		{#if $guide.searchError}
			<div role="alert" class="px-3 py-2 text-sm text-red-300">
				{$guide.searchError} <button class="underline" onclick={() => guide.ensureAllChannels()}>Retry</button>
			</div>
		{/if}
		<div bind:this={searchListEl} class="flex-1 overflow-y-auto min-h-0">
			{#if $guide.loadingSearch}
				<p class="px-3 py-8 text-sm text-gray-400">Loading Channels…</p>
			{:else if searchResults.length === 0}
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
		role="region"
		aria-label="TV guide"
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
				{@const programmes = epg[ch.stream_id]}
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
						<span class="min-w-0 flex flex-col">
							<span class="text-sm font-medium truncate leading-tight text-gray-200">{ch.name}</span>
							{#if $guide.epgStale[ch.stream_id] && programmes}
								<span class="text-xs text-amber-300">Out-of-date guide</span>
							{/if}
						</span>
					</button>

					<!-- Programmes area -->
					<div class="relative shrink-0 overflow-hidden" style="width:{TOTAL_W}px">
						<!-- Now line -->
						<div
							class="absolute inset-y-0 w-px bg-red-500/50 z-10 pointer-events-none"
							style="left:{nowPx}px"
						></div>

						{#if $guide.epgErrors[ch.stream_id] && programmes === undefined}
							<button class="absolute inset-0 px-4 text-left text-xs text-red-300" onclick={() => guide.loadEpg(ch.stream_id, nowMs, true)}>EPG unavailable — retry</button>
						{:else if programmes === undefined}
							<!-- Skeleton while loading EPG -->
							<div class="absolute inset-1 rounded-md bg-gray-800/60 animate-pulse"></div>

						{:else if programmes.length === 0}
							<div class="absolute inset-0 flex items-center px-4 text-xs text-gray-700 italic">
								No programme information
							</div>

						{:else}
							{#each programmes as prog (prog.id)}
								{@const cur = isCurrent(prog)}
								{@const past = isPast(prog)}
								{@const catchup = isCatchupAvailable(ch, prog)}
								{@const clickable = cur || !past || catchup}
							<button
									class="absolute top-1.5 bottom-1.5 overflow-hidden rounded-md text-left
									       text-xs transition-all group
									       {cur
										? 'bg-indigo-800/90 hover:bg-indigo-700 border border-indigo-500/70'
										: catchup
												? 'bg-amber-900/50 hover:bg-amber-800/60 border border-amber-700/50'
												: past
														? 'bg-gray-900/60 border border-gray-800/30 opacity-50 cursor-default'
														: 'bg-gray-800 hover:bg-gray-700 border border-gray-700/60'}"
									style={progStyle(prog)}
									onclick={() => handleProgrammeClick(ch, prog)}
									title={catchup ? `▶ Replay: ${prog.title}` : prog.title}
									disabled={!clickable}
								>
									<!-- Progress bar for current programme -->
									{#if cur}
										<div
											class="absolute bottom-0 left-0 h-0.5 bg-indigo-400
											       pointer-events-none"
											style="width:{progress(prog)}%"
										></div>
									{/if}

									<!-- Catchup indicator -->
									{#if catchup}
										<div class="absolute top-1 right-1 text-amber-400 pointer-events-none leading-none">
											↺
										</div>
									{/if}

									<div class="px-2 py-1 h-full flex flex-col justify-center gap-0.5 min-w-0">
										<span
											class="font-semibold truncate leading-tight
											       {cur ? 'text-white' : catchup ? 'text-amber-200' : past ? 'text-gray-500' : 'text-gray-200'}"
										>
											{prog.title}
										</span>
										<span class="truncate leading-tight text-[10px] {catchup ? 'text-amber-600' : 'text-gray-500'}">
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
