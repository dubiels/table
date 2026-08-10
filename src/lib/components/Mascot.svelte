<script lang="ts">
	type Mood = 'happy' | 'sleepy' | 'wave' | 'worried';

	let {
		mood = 'happy',
		compact = false
	}: {
		mood?: Mood;
		/** Just the face, on one line — for places with no room for the body. */
		compact?: boolean;
	} = $props();

	// Kept as line arrays rather than one template literal so the art survives
	// formatting: nothing here depends on the file's own indentation. Each '\\'
	// is a single backslash — one of the robot's arms.
	const ART: Record<Mood, string[]> = {
		happy: ['   ___', '  [o_o]', ' /|___|\\', '  d   b'],
		sleepy: ['   ___  z', '  [-_-]z', ' /|___|\\', '  d   b'],
		wave: ['   ___', '  [o_o]', ' \\|___|/', '  d   b'],
		// The squint alone is a two-character change and too easy to miss at this
		// size, so it gets a marker beside the head the way sleepy gets its z.
		worried: ['   ___  !', '  [>_<]', ' /|___|\\', '  d   b']
	};

	// The face on its own, with the markers dropped: a leading `!` or a trailing
	// `z` next to nothing reads as a typo rather than as mood, and the compact
	// robot has to sit on a single text line.
	const FACE: Record<Mood, string> = {
		happy: '[o_o]',
		sleepy: '[-_-]',
		wave: '[o_o]',
		worried: '[>_<]'
	};

	let art = $derived(compact ? FACE[mood] : ART[mood].join('\n'));
</script>

<pre class="mascot" class:compact aria-hidden="true">{art}</pre>

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

	/* One line, so the leading of the four-line art would only pad a row it is
	   sharing with buttons taller than itself. */
	.mascot.compact {
		line-height: 1;
	}
</style>
