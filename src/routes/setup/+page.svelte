<script lang="ts">
	import { authClient } from '$lib/auth-client';
	import { goto } from '$app/navigation';
	import { Tv, ShieldCheck } from 'lucide-svelte';

	let name = $state('');
	let usernameVal = $state('');
	let password = $state('');
	let confirm = $state('');
	let error = $state('');
	let loading = $state(false);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		error = '';

		if (password !== confirm) {
			error = 'Passwords do not match';
			return;
		}
		if (password.length < 8) {
			error = 'Password must be at least 8 characters';
			return;
		}

		loading = true;

		// Email is not shown to the user — derived from username for internal use
		const result = await authClient.signUp.email({
			name,
			email: `${usernameVal.toLowerCase()}@iptv.local`,
			password,
			// @ts-expect-error — username field added by username plugin
			username: usernameVal
		});

		if (result.error) {
			error = result.error.message ?? 'Setup failed';
			loading = false;
			return;
		}

		// Promote the first user to admin
		await fetch('/api/setup/promote', { method: 'POST' });

		goto('/watch');
	}
</script>

<svelte:head>
	<title>Setup — IPTV Player</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-gray-950 px-4">
	<div class="w-full max-w-sm">
		<div class="flex flex-col items-center mb-8">
			<div class="bg-indigo-600 rounded-2xl p-4 mb-4">
				<Tv class="w-8 h-8 text-white" />
			</div>
			<h1 class="text-2xl font-bold text-white">First-time Setup</h1>
			<p class="text-gray-400 text-sm mt-1 flex items-center gap-1.5">
				<ShieldCheck class="w-4 h-4 text-indigo-400" />
				Creating the admin account
			</p>
		</div>

		<form onsubmit={handleSubmit} class="space-y-4">
			{#if error}
				<div class="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
					{error}
				</div>
			{/if}

			<div>
				<label for="name" class="block text-sm font-medium text-gray-300 mb-1.5">Display Name</label>
				<input
					id="name"
					type="text"
					bind:value={name}
					required
					class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500
					       focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
					placeholder="Admin"
				/>
			</div>

			<div>
				<label for="username" class="block text-sm font-medium text-gray-300 mb-1.5">Username</label>
				<input
					id="username"
					type="text"
					bind:value={usernameVal}
					required
					autocomplete="username"
					class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500
					       focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
					placeholder="admin"
				/>
			</div>

			<div>
				<label for="password" class="block text-sm font-medium text-gray-300 mb-1.5">Password</label>
				<input
					id="password"
					type="password"
					bind:value={password}
					required
					minlength="8"
					autocomplete="new-password"
					class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500
					       focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
					placeholder="••••••••"
				/>
			</div>

			<div>
				<label for="confirm" class="block text-sm font-medium text-gray-300 mb-1.5"
					>Confirm Password</label
				>
				<input
					id="confirm"
					type="password"
					bind:value={confirm}
					required
					autocomplete="new-password"
					class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500
					       focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
					placeholder="••••••••"
				/>
			</div>

			<button
				type="submit"
				disabled={loading}
				class="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed
				       text-white font-semibold py-2.5 rounded-lg transition"
			>
				{loading ? 'Creating account…' : 'Create Admin Account'}
			</button>
		</form>
	</div>
</div>
