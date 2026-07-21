<script lang="ts">
	import { enhance } from '$app/forms';
	import TaskDetailModal from './TaskDetailModal.svelte';
	import {
		categoryNameFor,
		sortTasks,
		type ListTask,
		type ListZone,
		type SortField,
		type SortDirection
	} from '$lib/listView';

	let { tasks, zones }: { tasks: ListTask[]; zones: ListZone[] } = $props();

	let sortField = $state<SortField>('dueDate');
	let sortDirection = $state<SortDirection>('asc');

	let sorted = $derived(sortTasks(tasks, zones, sortField, sortDirection));

	let openTaskId = $state<string | null>(null);
	let openTask = $derived(tasks.find((t) => t.id === openTaskId) ?? null);

	let today = new Date().toISOString().slice(0, 10);

	function toggleSort(field: SortField) {
		if (sortField === field) {
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
		} else {
			sortField = field;
			sortDirection = 'asc';
		}
	}

	function sortIndicator(field: SortField): string {
		if (sortField !== field) return '';
		return sortDirection === 'asc' ? ' ▲' : ' ▼';
	}

	function priorityLabel(priority: string): string {
		return priority === 'high' ? 'High' : priority === 'med' ? 'Med' : 'Low';
	}

	function handleRowKeydown(e: KeyboardEvent, id: string) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			openTaskId = id;
		}
	}

	const COLUMNS: { field: SortField; label: string }[] = [
		{ field: 'done', label: 'Done' },
		{ field: 'title', label: 'Title' },
		{ field: 'category', label: 'Category' },
		{ field: 'dueDate', label: 'Due date' },
		{ field: 'priority', label: 'Priority' },
		{ field: 'notes', label: 'Notes' }
	];
</script>

<div class="list-view">
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					{#each COLUMNS as col (col.field)}
						<th>
							<button type="button" class="sort-btn" onclick={() => toggleSort(col.field)}>
								{col.label}{sortIndicator(col.field)}
							</button>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each sorted as task (task.id)}
					{@const overdue = !!task.dueDate && task.dueDate < today}
					<tr
						class:done={task.done}
						role="button"
						tabindex="0"
						onclick={() => (openTaskId = task.id)}
						onkeydown={(e) => handleRowKeydown(e, task.id)}
					>
						<td class="done-cell" onclick={(e) => e.stopPropagation()}>
							<form method="POST" action="?/toggleTaskDone" use:enhance>
								<input type="hidden" name="id" value={task.id} />
								<button
									class="done-toggle"
									class:checked={task.done}
									type="submit"
									aria-label="Toggle done"
								>
									{#if task.done}✓{/if}
								</button>
							</form>
						</td>
						<td class="title-cell">{task.title}</td>
						<td>{categoryNameFor(task, zones)}</td>
						<td class="due-cell" class:overdue>{task.dueDate ?? ''}</td>
						<td>
							{#if task.priority}
								<span class="pill pill-{task.priority}">{priorityLabel(task.priority)}</span>
							{/if}
						</td>
						<td class="notes-cell">{task.notes ?? ''}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

{#if openTask}
	<TaskDetailModal task={openTask} onclose={() => (openTaskId = null)} />
{/if}

<style>
	.table-wrap {
		overflow-x: auto;
		width: 100%;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}
	th {
		text-align: left;
		border-bottom: 1px solid var(--border-strong);
		padding: 0.4rem 0.6rem;
		white-space: nowrap;
	}
	.sort-btn {
		background: transparent;
		border: none;
		padding: 0;
		font: inherit;
		font-weight: 600;
		color: inherit;
		cursor: pointer;
	}
	td {
		border-bottom: 1px solid var(--border);
		padding: 0.45rem 0.6rem;
		vertical-align: middle;
	}
	tr[role='button'] {
		cursor: pointer;
	}
	tr[role='button']:hover td {
		background: var(--surface-2);
	}
	tr.done .title-cell {
		text-decoration: line-through;
		color: var(--muted);
	}
	.done-cell {
		width: 2rem;
	}
	.done-toggle {
		width: 1.05rem;
		height: 1.05rem;
		border: 1.5px solid var(--border-strong);
		border-radius: 50%;
		background: transparent;
		padding: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.7rem;
		line-height: 1;
		cursor: pointer;
	}
	.done-toggle.checked {
		color: var(--ok);
		border-color: var(--ok);
	}
	.due-cell.overdue {
		color: var(--danger);
		font-weight: 600;
	}
	.notes-cell {
		max-width: 220px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
