<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Mascot from './Mascot.svelte';
	import { localDateString, CANVAS_SOURCE } from '$lib/listView';
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

	type CourseGroup = { course: string; tasks: PanelTask[] };

	// Grouped with a plain array rather than a Map: nothing here is reactive
	// state, and prefer-svelte-reactivity is right that a bare Map in a component
	// is usually a mistake. Courses keep first-seen order, "Other" always last.
	let groups = $derived.by(() => {
		const out: CourseGroup[] = [];
		for (const task of tasks) {
			if (task.source !== CANVAS_SOURCE) continue;
			const course = task.courseName?.trim() || OTHER;
			let group = out.find((g) => g.course === course);
			if (!group) {
				group = { course, tasks: [] };
				out.push(group);
			}
			group.tasks.push(task);
		}
		for (const group of out) {
			// Soonest first; undated assignments sink to the bottom of their course.
			group.tasks.sort((a, b) => {
				if (a.dueDate === b.dueDate) return a.title.localeCompare(b.title);
				if (!a.dueDate) return 1;
				if (!b.dueDate) return -1;
				return a.dueDate < b.dueDate ? -1 : 1;
			});
		}
		return out.sort((a, b) => {
			if (a.course === OTHER) return 1;
			if (b.course === OTHER) return -1;
			return a.course.localeCompare(b.course);
		});
	});

	let assignmentCount = $derived(groups.reduce((n, g) => n + g.tasks.length, 0));

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
	<button type="button" class="btn btn-primary sync-btn" disabled={syncing} onclick={syncNow}>
		{syncing ? 'Syncing…' : 'Sync now'}
	</button>

	{#if assignmentCount === 0}
		<div class="empty">
			<Mascot mood="sleepy" />
			<p>No assignments synced yet.</p>
		</div>
	{:else}
		{#each groups as group (group.course)}
			<div class="course">
				<h3>{group.course}</h3>
				<ul>
					{#each group.tasks as task (task.id)}
						<li class="row" class:done={task.done}>
							<span class="row-title">{task.title}</span>
							{#if task.dueDate}
								<span class="row-due" class:overdue={!task.done && task.dueDate < today}>
									Due {formatDue(task.dueDate)}
								</span>
							{:else}
								<span class="row-due">No due date</span>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/each}
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
	.sync-btn {
		align-self: flex-start;
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

	.course h3 {
		margin: 0 0 0.4rem;
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--muted);
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
