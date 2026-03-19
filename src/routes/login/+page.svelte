<script lang="ts">
	import { authClient } from '$lib/auth-client';
	import { goto } from '$app/navigation';
	import { Tv } from 'lucide-svelte';

	let usernameVal = $state('');
	let password = $state('');
	let error = $state('');
	let loading = $state(false);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		loading = true;

		const result = await authClient.signIn.username({
			username: usernameVal,
			password
		});

		if (result.error) {
			error = result.error.message ?? 'Invalid username or password';
			loading = false;
		} else {
			goto('/watch');
		}
	}
</script>

<svelte:head>
	<title>Sign In — IPTV Player</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-gray-950 px-4">
	<div class="w-full max-w-sm">
		<div class="flex flex-col items-center mb-8">
			<div class="bg-indigo-600 rounded-2xl p-4 mb-4">
				<Tv class="w-8 h-8 text-white" />
			</div>
			<h1 class="text-2xl font-bold text-white">IPTV Player</h1>
			<p class="text-gray-400 text-sm mt-1">Sign in to continue</p>
		</div>

		<form onsubmit={handleSubmit} class="space-y-4">
			{#if error}
				<div class="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
					{error}
				</div>
			{/if}

			<div>
				<label for="username" class="block text-sm font-medium text-gray-300 mb-1.5"
					>Username</label
				>
				<input
					id="username"
					type="text"
					bind:value={usernameVal}
					required
					autocomplete="username"
					class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500
					       focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
					placeholder="your_username"
				/>
			</div>

			<div>
				<label for="password" class="block text-sm font-medium text-gray-300 mb-1.5"
					>Password</label
				>
				<input
					id="password"
					type="password"
					bind:value={password}
					required
					autocomplete="current-password"
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
				{loading ? 'Signing in…' : 'Sign In'}
			</button>
		</form>
	</div>
</div>
