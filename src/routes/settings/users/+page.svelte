<script lang="ts">
	import { ArrowLeft, Plus, Trash2, ShieldCheck, User, AlertCircle, Loader2 } from 'lucide-svelte';

	let { data } = $props();

	let users = $state([...data.users]);
	let showAddForm = $state(false);
	let addForm = $state({ name: '', username: '', password: '', role: 'user' });
	let addError = $state('');
	let addLoading = $state(false);

	async function addUser(e: SubmitEvent) {
		e.preventDefault();
		addError = '';
		addLoading = true;

		const res = await fetch('/api/users', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(addForm)
		});

		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			addError = err.message ?? 'Failed to create user';
			addLoading = false;
			return;
		}

		const created = await res.json();
		users = [...users, created.user ?? created];
		addForm = { name: '', email: '', password: '', role: 'user' };
		showAddForm = false;
		addLoading = false;
	}

	async function deleteUser(id: string) {
		if (!confirm('Delete this user? All their playlists will also be deleted.')) return;
		await fetch(`/api/users/${id}`, { method: 'DELETE' });
		users = users.filter((u) => u.id !== id);
	}

	async function toggleRole(u: (typeof users)[number]) {
		const newRole = u.role === 'admin' ? 'user' : 'admin';
		const res = await fetch(`/api/users/${u.id}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ role: newRole })
		});
		if (res.ok) {
			users = users.map((x) => (x.id === u.id ? { ...x, role: newRole } : x));
		}
	}
</script>

<svelte:head>
	<title>Users — IPTV Player</title>
</svelte:head>

<div class="min-h-screen bg-gray-950 text-gray-100">
	<header class="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center gap-4">
		<a
			href="/settings"
			class="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition"
		>
			<ArrowLeft class="w-5 h-5" />
		</a>
		<h1 class="text-lg font-semibold flex items-center gap-2">
			<ShieldCheck class="w-5 h-5 text-indigo-400" />
			User Management
		</h1>
		<button
			onclick={() => (showAddForm = !showAddForm)}
			class="ml-auto flex items-center gap-1.5 text-sm bg-indigo-600 hover:bg-indigo-500
			       text-white px-3 py-1.5 rounded-lg transition"
		>
			<Plus class="w-4 h-4" />
			Add User
		</button>
	</header>

	<div class="max-w-2xl mx-auto px-6 py-8 space-y-6">
		{#if showAddForm}
			<form
				onsubmit={addUser}
				class="bg-gray-800 border border-gray-700 rounded-xl p-5 space-y-4"
			>
				<h3 class="text-sm font-medium text-gray-300">New User</h3>

				{#if addError}
					<div
						class="flex items-center gap-2 text-red-300 bg-red-900/30 border border-red-700 rounded-lg px-3 py-2 text-sm"
					>
						<AlertCircle class="w-4 h-4 shrink-0" />
						{addError}
					</div>
				{/if}

				<div class="grid grid-cols-2 gap-4">
					<div>
						<label for="new-name" class="block text-xs text-gray-400 mb-1">Display Name</label>
						<input
							id="new-name"
							type="text"
							bind:value={addForm.name}
							required
							class="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white
							       focus:outline-none focus:ring-2 focus:ring-indigo-500"
						/>
					</div>
					<div>
						<label for="new-username" class="block text-xs text-gray-400 mb-1">Username</label>
						<input
							id="new-username"
							type="text"
							bind:value={addForm.username}
							required
							autocomplete="off"
							class="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white
							       focus:outline-none focus:ring-2 focus:ring-indigo-500"
						/>
					</div>
					<div>
						<label for="new-password" class="block text-xs text-gray-400 mb-1">Password</label>
						<input
							id="new-password"
							type="password"
							bind:value={addForm.password}
							required
							minlength="8"
							class="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white
							       focus:outline-none focus:ring-2 focus:ring-indigo-500"
						/>
					</div>
					<div>
						<label for="new-role" class="block text-xs text-gray-400 mb-1">Role</label>
						<select
							id="new-role"
							bind:value={addForm.role}
							class="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white
							       focus:outline-none focus:ring-2 focus:ring-indigo-500"
						>
							<option value="user">Viewer</option>
							<option value="admin">Admin</option>
						</select>
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
						{addLoading ? 'Creating…' : 'Create User'}
					</button>
				</div>
			</form>
		{/if}

		<ul class="space-y-2">
			{#each users as u}
				<li
					class="flex items-center gap-3 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3"
				>
					<div
						class="rounded-full w-9 h-9 flex items-center justify-center text-sm font-bold shrink-0
						       {u.role === 'admin' ? 'bg-indigo-700 text-indigo-100' : 'bg-gray-700 text-gray-300'}"
					>
						{u.name?.[0]?.toUpperCase() ?? '?'}
					</div>
					<div class="min-w-0 flex-1">
						<p class="text-white text-sm font-medium truncate">
							{u.name}
							{#if u.id === data.currentUserId}
								<span class="text-gray-500 text-xs font-normal">(you)</span>
							{/if}
						</p>
						<p class="text-gray-500 text-xs truncate">@{u.username ?? u.email}</p>
					</div>

					<!-- Role badge / toggle -->
					<button
						onclick={() => toggleRole(u)}
						disabled={u.id === data.currentUserId}
						class="flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition shrink-0
						       {u.role === 'admin'
							? 'bg-indigo-900/50 text-indigo-300 hover:bg-indigo-900'
							: 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white'}
						       disabled:cursor-default"
						title={u.id === data.currentUserId ? '' : 'Toggle role'}
					>
						{#if u.role === 'admin'}
							<ShieldCheck class="w-3 h-3" />
							Admin
						{:else}
							<User class="w-3 h-3" />
							Viewer
						{/if}
					</button>

					{#if u.id !== data.currentUserId}
						<button
							onclick={() => deleteUser(u.id)}
							class="p-2 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-900/20 transition shrink-0"
						>
							<Trash2 class="w-4 h-4" />
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	</div>
</div>
