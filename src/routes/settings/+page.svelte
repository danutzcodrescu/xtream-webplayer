<script lang="ts">
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth-client';
	import { invalidateAll } from '$app/navigation';
	import {
		Tv,
		ArrowLeft,
		Plus,
		Trash2,
		GripVertical,
		Eye,
		EyeOff,
		Users,
		Loader2,
		Check,
		AlertCircle,
		Pencil
	} from 'lucide-svelte';

	let { data } = $props();

	// ── Playlist management ────────────────────────────────────────────────
	let playlists = $state([...data.playlists]);
	let showAddForm = $state(false);
	let addForm = $state({ name: '', serverUrl: '', xtreamUsername: '', xtreamPassword: '' });
	let addError = $state('');
	let addLoading = $state(false);

	async function addPlaylist(e: SubmitEvent) {
		e.preventDefault();
		addError = '';
		addLoading = true;

		const res = await fetch('/api/playlists', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(addForm)
		});

		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			addError = err.message ?? 'Failed to add playlist';
			addLoading = false;
			return;
		}

		const newPlaylist = await res.json();
		playlists = [...playlists, newPlaylist];
		addForm = { name: '', serverUrl: '', xtreamUsername: '', xtreamPassword: '' };
		showAddForm = false;
		addLoading = false;
		// Load categories for the new playlist
		selectedPlaylistId = newPlaylist.id;
	}

	async function deletePlaylist(id: string) {
		if (!confirm('Delete this playlist? All category ordering will also be removed.')) return;

		await fetch(`/api/playlists/${id}`, { method: 'DELETE' });
		playlists = playlists.filter((p) => p.id !== id);
		if (selectedPlaylistId === id) {
			selectedPlaylistId = playlists[0]?.id ?? '';
			categories = [];
		}
	}

	// ── Category ordering ──────────────────────────────────────────────────
	let selectedPlaylistId = $state([...data.playlists][0]?.id ?? '');
	let categories = $state<
		{ category_id: string; category_name: string; position: number; hidden: boolean }[]
	>([]);
	let catLoading = $state(false);
	let catSaving = $state(false);
	let catSaved = $state(false);
	let catError = $state('');

	async function loadCategories(playlistId: string) {
		if (!playlistId) return;
		catLoading = true;
		catError = '';
		const res = await fetch(`/api/categories?playlistId=${playlistId}`);
		if (res.ok) {
			categories = await res.json();
		} else {
			catError = 'Failed to load categories';
		}
		catLoading = false;
	}

	$effect(() => {
		loadCategories(selectedPlaylistId);
	});

	async function saveOrder() {
		catSaving = true;
		catSaved = false;
		const res = await fetch('/api/categories', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				playlistId: selectedPlaylistId,
				categories: categories.map((c, i) => ({
					categoryId: c.category_id,
					position: i,
					hidden: c.hidden
				}))
			})
		});
		catSaving = false;
		if (res.ok) {
			catSaved = true;
			setTimeout(() => (catSaved = false), 2000);
		}
	}

	// ── Drag and drop ──────────────────────────────────────────────────────
	let dragIndex = $state(-1);
	let dragOverIndex = $state(-1);

	function onDragStart(e: DragEvent, index: number) {
		dragIndex = index;
		e.dataTransfer!.effectAllowed = 'move';
	}

	function onDragOver(e: DragEvent, index: number) {
		e.preventDefault();
		e.dataTransfer!.dropEffect = 'move';
		dragOverIndex = index;
	}

	function onDrop(e: DragEvent, index: number) {
		e.preventDefault();
		if (dragIndex < 0 || dragIndex === index) {
			dragIndex = -1;
			dragOverIndex = -1;
			return;
		}
		const updated = [...categories];
		const [moved] = updated.splice(dragIndex, 1);
		updated.splice(index, 0, moved);
		categories = updated;
		dragIndex = -1;
		dragOverIndex = -1;
	}

	function onDragEnd() {
		dragIndex = -1;
		dragOverIndex = -1;
	}

	function toggleHidden(index: number) {
		categories = categories.map((c, i) =>
			i === index ? { ...c, hidden: !c.hidden } : c
		);
	}
</script>

<svelte:head>
	<title>Settings — IPTV Player</title>
</svelte:head>

<div class="min-h-screen bg-gray-950 text-gray-100">
	<!-- Top bar -->
	<header class="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center gap-4">
		<a
			href="/watch"
			class="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition"
		>
			<ArrowLeft class="w-5 h-5" />
		</a>
		<div class="flex items-center gap-2">
			<Tv class="w-5 h-5 text-indigo-400" />
			<h1 class="text-lg font-semibold">Settings</h1>
		</div>

		{#if data.user.role === 'admin'}
			<a
				href="/settings/users"
				class="ml-auto flex items-center gap-2 text-sm text-gray-400 hover:text-white
				       bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg transition"
			>
				<Users class="w-4 h-4" />
				Manage Users
			</a>
		{/if}
	</header>

	<div class="max-w-3xl mx-auto px-6 py-8 space-y-10">
		<!-- ── Playlists section ─────────────────────────────────────────── -->
		<section>
			<div class="flex items-center justify-between mb-4">
				<h2 class="text-base font-semibold text-white">Playlists</h2>
				<button
					onclick={() => (showAddForm = !showAddForm)}
					class="flex items-center gap-1.5 text-sm bg-indigo-600 hover:bg-indigo-500
					       text-white px-3 py-1.5 rounded-lg transition"
				>
					<Plus class="w-4 h-4" />
					Add Playlist
				</button>
			</div>

			<!-- Add form -->
			{#if showAddForm}
				<form
					onsubmit={addPlaylist}
					class="bg-gray-800 border border-gray-700 rounded-xl p-5 mb-4 space-y-4"
				>
					<h3 class="text-sm font-medium text-gray-300">New Playlist</h3>

					{#if addError}
						<div
							class="flex items-center gap-2 text-red-300 bg-red-900/30 border border-red-700 rounded-lg px-3 py-2 text-sm"
						>
							<AlertCircle class="w-4 h-4 shrink-0" />
							{addError}
						</div>
					{/if}

					<div class="grid grid-cols-2 gap-4">
						<div class="col-span-2">
							<label for="pl-name" class="block text-xs text-gray-400 mb-1">Display Name</label>
							<input
								id="pl-name"
								type="text"
								bind:value={addForm.name}
								required
								placeholder="My Playlist"
								class="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white
								       focus:outline-none focus:ring-2 focus:ring-indigo-500"
							/>
						</div>
						<div class="col-span-2">
							<label for="pl-server" class="block text-xs text-gray-400 mb-1">Server URL</label>
							<input
								id="pl-server"
								type="url"
								bind:value={addForm.serverUrl}
								required
								placeholder="http://provider.example.com:8080"
								class="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white
								       focus:outline-none focus:ring-2 focus:ring-indigo-500"
							/>
						</div>
						<div>
							<label for="pl-user" class="block text-xs text-gray-400 mb-1">Xtream Username</label>
							<input
								id="pl-user"
								type="text"
								bind:value={addForm.xtreamUsername}
								required
								autocomplete="off"
								class="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white
								       focus:outline-none focus:ring-2 focus:ring-indigo-500"
							/>
						</div>
						<div>
							<label for="pl-pass" class="block text-xs text-gray-400 mb-1">Xtream Password</label>
							<input
								id="pl-pass"
								type="password"
								bind:value={addForm.xtreamPassword}
								required
								autocomplete="off"
								class="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white
								       focus:outline-none focus:ring-2 focus:ring-indigo-500"
							/>
						</div>
					</div>

					<div class="flex justify-end gap-2">
						<button
							type="button"
							onclick={() => (showAddForm = false)}
							class="text-sm text-gray-400 hover:text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={addLoading}
							class="text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white
							       px-4 py-2 rounded-lg transition"
						>
							{addLoading ? 'Verifying…' : 'Add'}
						</button>
					</div>
				</form>
			{/if}

			<!-- Playlist list -->
			{#if playlists.length === 0}
				<p class="text-gray-500 text-sm">No playlists yet.</p>
			{:else}
				<ul class="space-y-2">
					{#each playlists as pl}
						<li
							class="flex items-center gap-3 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3"
						>
							<div class="bg-indigo-900/50 rounded-lg p-2 shrink-0">
								<Tv class="w-4 h-4 text-indigo-400" />
							</div>
							<div class="min-w-0 flex-1">
								<p class="text-white text-sm font-medium truncate">{pl.name}</p>
								<p class="text-gray-500 text-xs truncate">{pl.serverUrl}</p>
							</div>
							<button
								onclick={() => deletePlaylist(pl.id)}
								class="p-2 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-900/20 transition shrink-0"
								title="Delete playlist"
							>
								<Trash2 class="w-4 h-4" />
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<!-- ── Category ordering section ────────────────────────────────── -->
		{#if playlists.length > 0}
			<section>
				<div class="flex items-center justify-between mb-4">
					<h2 class="text-base font-semibold text-white">Category Order</h2>
					<div class="flex items-center gap-2">
						{#if playlists.length > 1}
							<select
								bind:value={selectedPlaylistId}
								class="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white
								       focus:outline-none focus:ring-2 focus:ring-indigo-500"
							>
								{#each playlists as pl}
									<option value={pl.id}>{pl.name}</option>
								{/each}
							</select>
						{/if}

						<button
							onclick={saveOrder}
							disabled={catSaving || categories.length === 0}
							class="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition
							       {catSaved
								? 'bg-green-700 text-white'
								: 'bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white'}"
						>
							{#if catSaving}
								<Loader2 class="w-4 h-4 animate-spin" />
								Saving…
							{:else if catSaved}
								<Check class="w-4 h-4" />
								Saved
							{:else}
								Save Order
							{/if}
						</button>
					</div>
				</div>

				<p class="text-gray-500 text-xs mb-3">
					Drag to reorder. Toggle the eye icon to show/hide categories in the channel browser.
				</p>

				{#if catLoading}
					<div class="flex items-center gap-2 text-gray-400 text-sm py-4">
						<Loader2 class="w-4 h-4 animate-spin" />
						Loading categories…
					</div>
				{:else if catError}
					<p class="text-red-400 text-sm">{catError}</p>
				{:else if categories.length === 0}
					<p class="text-gray-500 text-sm">No categories found.</p>
				{:else}
					<ul class="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
						{#each categories as cat, i}
							<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
							<li
								draggable="true"
								ondragstart={(e) => onDragStart(e, i)}
								ondragover={(e) => onDragOver(e, i)}
								ondrop={(e) => onDrop(e, i)}
								ondragend={onDragEnd}
								class="flex items-center gap-3 bg-gray-800 border rounded-lg px-3 py-2.5 cursor-grab
								       select-none transition
								       {dragOverIndex === i ? 'border-indigo-500 bg-indigo-900/20' : 'border-gray-700'}
								       {cat.hidden ? 'opacity-50' : ''}"
							>
								<GripVertical class="w-4 h-4 text-gray-600 shrink-0" />
								<span class="flex-1 text-sm text-white truncate">{cat.category_name}</span>
								<button
									onclick={() => toggleHidden(i)}
									class="p-1 rounded text-gray-500 hover:text-white transition shrink-0"
									title={cat.hidden ? 'Show category' : 'Hide category'}
								>
									{#if cat.hidden}
										<EyeOff class="w-4 h-4" />
									{:else}
										<Eye class="w-4 h-4" />
									{/if}
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}
	</div>
</div>
