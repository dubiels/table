<script lang="ts">
	import { enhance } from '$app/forms';
	import TaskDetailModal from './TaskDetailModal.svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import {
		categoryNameFor,
		categoryColorFor,
		sortTasks,
		filterTasks,
		localDateString,
		NO_CATEGORY,
		CANVAS_CATEGORY,
		CANVAS_CATEGORY_NAME,
		CANVAS_SOURCE,
		type ListTask,
		type ListZone,
		type SortField,
		type SortDirection,
		type DueFilter,
		type PriorityFilter
	} from '$lib/listView';
	import { zoneColorVars } from '$lib/zones';
	import { taskMarks } from '$lib/taskMarks';

	function dotColor(color: string): string {
		return zoneColorVars(color).border;
	}

	let { tasks, zones }: { tasks: ListTask[]; zones: ListZone[] } = $props();

	let today = localDateString();

	let sortField = $state<SortField>('dueDate');
	let sortDirection = $state<SortDirection>('asc');

	let deselectedCategories = new SvelteSet<string>();
	let dueFilter = $state<DueFilter>('all');
	let priorityFilter = $state<PriorityFilter>('all');

	let filtered = $derived(
		filterTasks(
			tasks,
			zones,
			{ deselectedCategories, due: dueFilter, priority: priorityFilter },
			today
		)
	);
	let sorted = $derived(sortTasks(filtered, zones, sortField, sortDirection));

	// Offered only once there is something to filter: nobody who has not connected
	// Canvas needs a checkbox for it.
	let hasAssignments = $derived(tasks.some((t) => t.source === CANVAS_SOURCE));

	function toggleCategory(key: string) {
		if (deselectedCategories.has(key)) deselectedCategories.delete(key);
		else deselectedCategories.add(key);
	}

	let openTaskId = $state<string | null>(null);
	let openTask = $derived(tasks.find((t) => t.id === openTaskId) ?? null);

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
	<div class="filters">
		<fieldset class="filter-group">
			<legend>Category</legend>
			<label>
				<input
					type="checkbox"
					checked={!deselectedCategories.has(NO_CATEGORY)}
					onchange={() => toggleCategory(NO_CATEGORY)}
				/>
				No category
			</label>
			{#if hasAssignments}
				<label>
					<input
						type="checkbox"
						checked={!deselectedCategories.has(CANVAS_CATEGORY)}
						onchange={() => toggleCategory(CANVAS_CATEGORY)}
					/>
					{CANVAS_CATEGORY_NAME}
				</label>
			{/if}
			{#each zones as zone (zone.id)}
				<label>
					<input
						type="checkbox"
						checked={!deselectedCategories.has(zone.id)}
						onchange={() => toggleCategory(zone.id)}
					/>
					<span class="category-dot" style:background={dotColor(zone.color)}></span>
					{zone.name}
				</label>
			{/each}
		</fieldset>

		<label class="filter-select">
			<span>Due date</span>
			<select bind:value={dueFilter}>
				<option value="all">All</option>
				<option value="overdue">Overdue</option>
				<option value="today">Today</option>
				<option value="week">This week</option>
				<option value="none">No date</option>
			</select>
		</label>

		<label class="filter-select">
			<span>Priority</span>
			<select bind:value={priorityFilter}>
				<option value="all">All</option>
				<option value="low">Low</option>
				<option value="med">Med</option>
				<option value="high">High</option>
			</select>
		</label>
	</div>

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
					{@const marks = taskMarks(task, today)}
					{@const categoryColor = categoryColorFor(task, zones)}
					<tr
						class:done={task.done}
						role="button"
						tabindex="0"
						onclick={() => (openTaskId = task.id)}
						onkeydown={(e) => handleRowKeydown(e, task.id)}
					>
						<!-- Keydown is guarded alongside click: Enter on the submit button
						     would otherwise bubble to the row's role="button" handler, whose
						     preventDefault cancels the submit and opens the modal instead. -->
						<td
							class="done-cell"
							onclick={(e) => e.stopPropagation()}
							onkeydown={(e) => e.stopPropagation()}
						>
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
						<td class="category-cell">
							{#if categoryColor}
								<span class="category-dot" style:background={dotColor(categoryColor)}></span>
							{/if}
							{categoryNameFor(task, zones)}
						</td>
						<td class="due-cell" class:overdue={marks.overdue}>{task.dueDate ?? ''}</td>
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
	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 1.25rem;
		margin-bottom: 1rem;
	}
	.filter-group {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
		padding: 0.4rem 0.7rem;
	}
	.filter-group legend {
		font-size: 0.78rem;
		color: var(--muted);
		padding: 0 0.3rem;
	}
	.filter-group label {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.85rem;
		white-space: nowrap;
	}
	.filter-select {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.78rem;
		color: var(--muted);
	}
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
	.category-dot {
		display: inline-block;
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
		margin-right: 0.4rem;
		flex-shrink: 0;
	}
	.category-cell {
		white-space: nowrap;
	}
</style>
