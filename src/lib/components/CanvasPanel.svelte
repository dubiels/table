<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Mascot from './Mascot.svelte';
	import RefreshButton from './RefreshButton.svelte';
	import { localDateString, CANVAS_SOURCE } from '$lib/listView';
	import { courseColor } from '$lib/courseColor';
	import { zoneColorVars } from '$lib/zones';
	import { toast } from '$lib/toast.svelte';

	type PanelTask = {
		id: string;
		title: string;
		done: boolean;
		dueDate: string | null;
		source: string;
		courseName: string | null;
	};

	let {
		tasks,
		lmsConfigured
	}: {
		tasks: PanelTask[];
		lmsConfigured: boolean;
	} = $props();

	const today = localDateString();

	const OTHER = 'Other';

	type Assignment = PanelTask & { course: string; fill: string; border: string };

	// One list ordered by when the work is due, not by which class set it.
	// Course headings answered "what does BIO want?", but the question this
	// panel is open to answer is "what is next" — and a heading per class
	// buried Friday's deadline under an unrelated Monday one. The class
	// survives as the colored chip on each row.
	let assignments = $derived.by(() => {
		const out: Assignment[] = [];
		for (const task of tasks) {
			if (task.source !== CANVAS_SOURCE) continue;
			const course = task.courseName?.trim() || OTHER;
			out.push({ ...task, course, ...zoneColorVars(courseColor(course)) });
		}
		// Soonest first; undated assignments sink to the bottom. Ties break on
		// course then title so two things due the same day hold a stable order
		// instead of following whatever sequence the feed happened to hand us.
		return out.sort((a, b) => {
			if (a.dueDate !== b.dueDate) {
				if (!a.dueDate) return 1;
				if (!b.dueDate) return -1;
				return a.dueDate < b.dueDate ? -1 : 1;
			}
			if (a.course !== b.course) return a.course.localeCompare(b.course);
			return a.title.localeCompare(b.title);
		});
	});

	let assignmentCount = $derived(assignments.length);

	let syncing = $state(false);

	/**
	 * A due date as "Mon, Aug 17".
	 *
	 * Split and rebuilt field by field rather than handed to `new Date(str)`:
	 * a bare `YYYY-MM-DD` parses as UTC midnight, so west of Greenwich every
	 * assignment would render as the day before the one it is due.
	 */
	function formatDue(dueDate: string): string {
		const [year, month, day] = dueDate.split('-').map(Number);
		if (!year || !month || !day) return dueDate;
		return new Date(year, month - 1, day).toLocaleDateString(undefined, {
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		});
	}

	type SyncBody = {
		error?: string;
		created?: number;
		updated?: number;
		placedLoose?: boolean;
	};

	// A proxy error or a crashed route answers with an HTML page; res.json() would
	// throw and lose the status we could have reported instead.
	async function readJson(res: Response): Promise<SyncBody | null> {
		if (!res.headers.get('content-type')?.includes('application/json')) return null;
		try {
			return (await res.json()) as SyncBody;
		} catch {
			return null;
		}
	}

	async function syncNow() {
		syncing = true;
		toast('Syncing assignments…');
		try {
			const res = await fetch('/api/lms/sync', { method: 'POST' });
			const body = await readJson(res);
			if (!res.ok) {
				toast(body?.error ?? `Sync failed (HTTP ${res.status})`, 'error');
			} else if (!body) {
				toast('Sync failed — unexpected response', 'error');
			} else {
				toast(
					`Synced — ${body.created} new, ${body.updated} updated${body.placedLoose ? ' (placed loose)' : ''}`,
					'success'
				);
				await invalidateAll();
			}
		} catch {
			toast('Sync failed', 'error');
		} finally {
			syncing = false;
		}
	}
</script>

{#if lmsConfigured}
	<!-- The same control the Today panel puts against its date, in the same place
	     and at the same size: both panels re-pull an upstream feed, and a primary
	     button here made the two read as different kinds of action. -->
	<div class="sync-row">
		<RefreshButton label="Sync assignments" spinning={syncing} onclick={syncNow} />
	</div>

	{#if assignmentCount === 0}
		<div class="empty">
			<Mascot mood="sleepy" />
			<p>No assignments synced yet.</p>
		</div>
	{:else}
		<ul>
			{#each assignments as task (task.id)}
				<li class="row" class:done={task.done}>
					<span class="row-title">{task.title}</span>
					<span class="row-meta">
						<span class="chip" style="background:{task.fill}; border-color:{task.border};"
							>{task.course}</span
						>
						{#if task.dueDate}
							<span class="row-due" class:overdue={!task.done && task.dueDate < today}>
								Due {formatDue(task.dueDate)}
							</span>
						{:else}
							<span class="row-due">No due date</span>
						{/if}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
{:else}
	<ol class="setup">
		<li>
			In Canvas, open <strong>Calendar → Calendar Feed</strong> and copy the .ics URL.
		</li>
		<li>
			Add <code>LMS_ICAL_URL=&lt;url&gt;</code> to <code>.env</code>, or
			<code>flyctl secrets set LMS_ICAL_URL=…</code> on a deployed app. Restart to pick it up.
		</li>
		<li>Assignments due in the next two weeks show up here and in the list view.</li>
	</ol>
{/if}

<style>
	/* Right-aligned so it sits under the panel head's fold arrow, the way the
	   calendar's refresh sits under Today's. */
	.sync-row {
		display: flex;
		justify-content: flex-end;
		/* The panel body's 1rem gap is sized for blocks of content; against a
		   28px icon it opens a hole above the first assignment. */
		margin-bottom: -0.5rem;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		padding: 1rem 0;
	}

	.empty p {
		margin: 0;
		color: var(--muted);
		font-size: 0.88rem;
	}

	.row-meta {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	/* A filled chip rather than a bare dot: past seven classes two of them share
	   a color, so the name is what identifies the class and the color only
	   groups it at a glance. Fill and border come from the zone palette's CSS
	   vars, so the chip follows the active theme without re-rendering. */
	.chip {
		flex: none;
		padding: 0.05rem 0.4rem;
		border: 1px solid;
		border-radius: var(--radius-s);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--ink);
		overflow-wrap: anywhere;
	}

	ul,
	ol {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.row {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		padding: 0.4rem 0;
		border-top: 1px solid var(--border);
		font-size: 0.88rem;
	}

	.row-title {
		overflow-wrap: anywhere;
	}

	.row-due {
		font-size: 0.78rem;
		color: var(--muted);
	}

	.row-due.overdue {
		color: var(--danger);
		font-weight: 600;
	}

	.row.done .row-title {
		color: var(--muted);
		text-decoration: line-through;
	}

	/* Struck-through rows keep their chip so the class is still readable, but
	   dimmed — a finished assignment should not pull the eye like a live one. */
	.row.done .chip {
		opacity: 0.55;
	}

	.setup {
		margin: 0;
		padding-left: 1.1rem;
		list-style: decimal;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		color: var(--muted);
		font-size: 0.88rem;
		line-height: 1.5;
	}

	.setup strong {
		color: var(--ink);
		font-weight: 600;
	}

	code {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.8rem;
		padding: 0.05rem 0.3rem;
		border-radius: var(--radius-s);
		background: var(--surface-2);
		color: var(--ink);
		overflow-wrap: anywhere;
	}
</style>
