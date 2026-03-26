<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		Play,
		Pause,
		Volume2,
		VolumeX,
		Maximize,
		Minimize,
		PictureInPicture2,
		Loader2,
		AlertTriangle
	} from 'lucide-svelte';

	let { streamUrl }: { streamUrl: string | null } = $props();

	// ── Refs ──────────────────────────────────────────────────────────────
	let videoEl: HTMLVideoElement = $state()!;
	let containerEl: HTMLDivElement = $state()!;

	// ── State ─────────────────────────────────────────────────────────────
	const VOLUME_KEY = 'iptv_volume';
	function savedVolume(): number {
		try {
			const v = parseFloat(sessionStorage.getItem(VOLUME_KEY) ?? '');
			return isNaN(v) ? 1 : Math.min(1, Math.max(0, v));
		} catch { return 1; }
	}

	let playing = $state(false);
	let loading = $state(false);
	let error = $state('');
	let volume = $state(savedVolume());
	let muted = $state(false);
	let fullscreen = $state(false);
	let showControls = $state(true);
	let controlsTimer: ReturnType<typeof setTimeout> | null = null;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let hlsInstance: any = null;
	let mediaErrorRecovering = false;

	// ── Load stream on URL change ─────────────────────────────────────────
	$effect(() => {
		if (!streamUrl) {
			destroyHls();
			return;
		}
		loadStream(streamUrl);
	});

	async function loadStream(url: string) {
		error = '';
		loading = true;
		playing = false;
		mediaErrorRecovering = false;
		destroyHls();

		const { default: Hls } = await import('hls.js');

		if (!videoEl) return;

		// Apply persisted volume immediately
		videoEl.volume = volume;

		if (Hls.isSupported()) {
			hlsInstance = new Hls({
				maxBufferLength: 30,
				maxMaxBufferLength: 60,
				liveSyncDurationCount: 3,
				liveMaxLatencyDurationCount: 10,
				enableWorker: true,
				lowLatencyMode: false
			});

			hlsInstance.loadSource(url);
			hlsInstance.attachMedia(videoEl);

			hlsInstance.on(Hls.Events.MANIFEST_PARSED, async () => {
				loading = false;
				try {
					await videoEl.play();
				} catch {
					// Autoplay blocked — user must click play
				}
			});

			hlsInstance.on(Hls.Events.ERROR, (_: unknown, data: { fatal: boolean; details: string; type: string }) => {
				if (data.fatal) {
					loading = false;
					switch (data.type) {
						case Hls.ErrorTypes.NETWORK_ERROR:
							error = 'Network error — stream unavailable';
							break;
						case Hls.ErrorTypes.MEDIA_ERROR:
							if (!mediaErrorRecovering) {
								mediaErrorRecovering = true;
								hlsInstance?.recoverMediaError();
							} else {
								// Recovery failed — give up
								mediaErrorRecovering = false;
								error = 'Media error — stream cannot be decoded';
							}
							break;
						default:
							error = `Playback error: ${data.details}`;
					}
				}
			});
		} else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
			// Safari native HLS
			videoEl.src = url;
			loading = false;
			try {
				await videoEl.play();
			} catch {
				// Autoplay blocked
			}
		} else {
			error = 'HLS not supported in this browser';
			loading = false;
		}
	}

	function destroyHls() {
		if (hlsInstance) {
			hlsInstance.destroy();
			hlsInstance = null;
		}
		if (videoEl) {
			videoEl.removeAttribute('src');
			videoEl.load();
		}
	}

	onDestroy(() => destroyHls());

	// ── Controls ──────────────────────────────────────────────────────────
	function togglePlay() {
		if (!videoEl) return;
		if (videoEl.paused) {
			videoEl.play();
		} else {
			videoEl.pause();
		}
	}

	function setVolume(v: number) {
		volume = v;
		if (videoEl) videoEl.volume = v;
		muted = v === 0;
		try { sessionStorage.setItem(VOLUME_KEY, String(v)); } catch { /* ignore */ }
	}

	function toggleMute() {
		if (!videoEl) return;
		muted = !muted;
		videoEl.muted = muted;
	}

	async function toggleFullscreen() {
		if (!document.fullscreenElement) {
			await containerEl.requestFullscreen?.();
		} else {
			await document.exitFullscreen?.();
		}
	}

	async function togglePip() {
		if (!videoEl) return;
		if (document.pictureInPictureElement) {
			await document.exitPictureInPicture?.();
		} else {
			await videoEl.requestPictureInPicture?.();
		}
	}

	// Show controls briefly on mouse move
	function handleMouseMove() {
		showControls = true;
		if (controlsTimer) clearTimeout(controlsTimer);
		controlsTimer = setTimeout(() => {
			if (playing) showControls = false;
		}, 3000);
	}

	// Keyboard shortcuts
	function handleKeyDown(e: KeyboardEvent) {
		if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;
		switch (e.key) {
			case ' ':
			case 'k':
				e.preventDefault();
				togglePlay();
				break;
			case 'm':
				toggleMute();
				break;
			case 'f':
				toggleFullscreen();
				break;
		}
	}

	function onPlay() { playing = true; loading = false; }
	function onPause() { playing = false; }
	function onWaiting() { loading = true; }
	function onCanPlay() { loading = false; }
	function onFullscreenChange() {
		fullscreen = !!document.fullscreenElement;
	}

	$effect(() => {
		document.addEventListener('fullscreenchange', onFullscreenChange);
		return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
	});
</script>

<svelte:window onkeydown={handleKeyDown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	bind:this={containerEl}
	class="relative flex-1 bg-black flex items-center justify-center group overflow-hidden"
	onmousemove={handleMouseMove}
	onmouseleave={() => { if (playing) showControls = false; }}
>
	<!-- Video element -->
	<video
		bind:this={videoEl}
		class="w-full h-full object-contain"
		playsinline
		onplay={onPlay}
		onpause={onPause}
		onwaiting={onWaiting}
		oncanplay={onCanPlay}
	></video>

	<!-- Empty state -->
	{#if !streamUrl}
		<div class="absolute inset-0 flex flex-col items-center justify-center text-gray-600">
			<svg class="w-20 h-20 mb-4 opacity-30" fill="currentColor" viewBox="0 0 24 24">
				<path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z"/>
			</svg>
			<p class="text-sm">Select a channel to start watching</p>
		</div>
	{/if}

	<!-- Loading spinner -->
	{#if loading && streamUrl}
		<div class="absolute inset-0 flex items-center justify-center pointer-events-none">
			<Loader2 class="w-12 h-12 text-white/60 animate-spin" />
		</div>
	{/if}

	<!-- Error state -->
	{#if error}
		<div class="absolute inset-0 flex flex-col items-center justify-center bg-black/70 gap-3">
			<AlertTriangle class="w-10 h-10 text-red-400" />
			<p class="text-red-300 text-sm max-w-xs text-center">{error}</p>
			<button
				onclick={() => streamUrl && loadStream(streamUrl)}
				class="text-sm text-white bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition"
			>
				Retry
			</button>
		</div>
	{/if}

	<!-- Click to play/pause (behind controls) -->
	{#if streamUrl && !error}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="absolute inset-0"
			role="button"
			tabindex="-1"
			onclick={togglePlay}
			aria-label={playing ? 'Pause' : 'Play'}
		></div>
	{/if}

	<!-- Controls overlay (rendered after click zone so it sits on top) -->
	{#if streamUrl && !error}
		<div
			class="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/80 to-transparent
			       transition-opacity duration-300 {showControls || !playing ? 'opacity-100' : 'opacity-0'}"
		>
			<div class="flex items-center gap-3">
				<!-- Play/pause -->
				<button
					onclick={togglePlay}
					class="text-white hover:text-gray-300 transition"
					title={playing ? 'Pause (k)' : 'Play (k)'}
				>
					{#if playing}
						<Pause class="w-6 h-6" />
					{:else}
						<Play class="w-6 h-6" />
					{/if}
				</button>

				<!-- Volume -->
				<button onclick={toggleMute} class="text-white hover:text-gray-300 transition" title="Mute (m)">
					{#if muted || volume === 0}
						<VolumeX class="w-5 h-5" />
					{:else}
						<Volume2 class="w-5 h-5" />
					{/if}
				</button>
				<input
					type="range"
					min="0"
					max="1"
					step="0.05"
					value={muted ? 0 : volume}
					oninput={(e) => setVolume(parseFloat((e.target as HTMLInputElement).value))}
					class="w-20 accent-indigo-500 cursor-pointer"
					title="Volume"
				/>

				<span class="flex-1"></span>

				<!-- PiP -->
				<button
					onclick={togglePip}
					class="text-white hover:text-gray-300 transition"
					title="Picture-in-Picture"
				>
					<PictureInPicture2 class="w-5 h-5" />
				</button>

				<!-- Fullscreen -->
				<button
					onclick={toggleFullscreen}
					class="text-white hover:text-gray-300 transition"
					title="Fullscreen (f)"
				>
					{#if fullscreen}
						<Minimize class="w-5 h-5" />
					{:else}
						<Maximize class="w-5 h-5" />
					{/if}
				</button>
			</div>
		</div>
	{/if}
</div>
