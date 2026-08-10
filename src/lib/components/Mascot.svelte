<script lang="ts">
	type Mood = 'happy' | 'sleepy' | 'wave';

	let { mood = 'happy' }: { mood?: Mood } = $props();

	// Kept as line arrays rather than one template literal so the art survives
	// formatting: nothing here depends on the file's own indentation. Each '\\'
	// is a single backslash — one of the robot's arms.
	const ART: Record<Mood, string[]> = {
		happy: ['   ___', '  [o_o]', ' /|___|\\', '  d   b'],
		sleepy: ['   ___  z', '  [-_-]z', ' /|___|\\', '  d   b'],
		wave: ['   ___', '  [o_o]', ' \\|___|/', '  d   b']
	};

	let art = $derived(ART[mood].join('\n'));
</script>

<pre class="mascot" aria-hidden="true">{art}</pre>

<style>
	.mascot {
		margin: 0;
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.7rem;
		line-height: 1.15;
		color: var(--muted);
		user-select: none;
		-webkit-user-select: none;
	}
</style>
