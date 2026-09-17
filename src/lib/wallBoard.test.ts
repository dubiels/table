import { describe, it, expect } from 'vitest';
import { buildWallBoxes, canvasGroups, CANVAS_BOX_ID, type WallTask } from './wallBoard';

const TODAY = '2026-09-16';

let next = 0;
const task = (partial: Partial<WallTask>): WallTask => ({
	id: `t${next++}`,
	title: 'Something',
	done: false,
	priority: null,
	dueDate: null,
	plannedDate: null,
	notes: null,
	x: 20,
	y: 20,
	source: 'manual',
	courseName: null,
	...partial
});

const assignment = (title: string, dueDate: string) =>
	task({ title, dueDate, source: 'canvas', courseName: 'CS 3235' });

const zone = (id: string, name: string, x: number): import('./bento').BentoZone => ({
	id,
	name,
	color: 'sage',
	x,
	y: 0,
	width: 400,
	height: 400
});

describe('canvasGroups', () => {
	it('splits assignments into today and the next three days', () => {
		const groups = canvasGroups(
			[
				assignment('Quiz 2', TODAY),
				assignment('Pop quiz', '2026-09-18'),
				assignment('Milestone 1', '2026-09-24')
			],
			TODAY
		);

		expect(groups.map((g) => (g.kind === 'group' ? [g.label, g.tasks.length] : null))).toEqual([
			['Due today', 1],
			['Due in the next 3 days', 1]
		]);
	});

	it('counts a missed deadline as today, not as gone', () => {
		const groups = canvasGroups([assignment('Homework 02', '2026-09-10')], TODAY);
		expect(groups).toHaveLength(1);
		expect(groups[0].kind === 'group' && groups[0].tasks[0].title).toBe('Homework 02');
	});

	it('drops empty groups, finished work, and undated assignments', () => {
		expect(canvasGroups([], TODAY)).toEqual([]);
		expect(canvasGroups([{ ...assignment('Done already', TODAY), done: true }], TODAY)).toEqual([]);
		expect(canvasGroups([task({ source: 'canvas', dueDate: null })], TODAY)).toEqual([]);
	});

	it('leaves tasks that are not assignments alone', () => {
		expect(canvasGroups([task({ title: 'Fix drone', dueDate: TODAY })], TODAY)).toEqual([]);
	});
});

describe('buildWallBoxes', () => {
	const zones = [zone('z1', 'Personal', 0), zone('z2', 'School', 500)];

	it('makes one box per category, with a task item each', () => {
		const boxes = buildWallBoxes(
			[task({ title: 'Start a Substack', x: 20 }), task({ title: 'Stats catch-up', x: 520 })],
			zones,
			TODAY
		);

		expect(boxes.map((b) => [b.name, b.count])).toEqual([
			['Personal', 1],
			['School', 1]
		]);
		expect(boxes[0].items[0].kind).toBe('task');
		expect(boxes[0].color).toBe('var(--zone-sage-border)');
	});

	it('puts Canvas last, with its groups and a total count', () => {
		const boxes = buildWallBoxes(
			[
				task({ title: 'Start a Substack', x: 20 }),
				assignment('Quiz 2', TODAY),
				assignment('Pop quiz', '2026-09-17')
			],
			zones,
			TODAY
		);

		const canvas = boxes.at(-1)!;
		expect(canvas.id).toBe(CANVAS_BOX_ID);
		expect(canvas.canvas).toBe(true);
		expect(canvas.count).toBe(2);
		expect(canvas.items).toHaveLength(2);
	});

	it('keeps assignments out of the categories', () => {
		const boxes = buildWallBoxes([assignment('Quiz 2', TODAY)], zones, TODAY);
		expect(boxes.map((b) => b.id)).toEqual([CANVAS_BOX_ID]);
	});

	it('shows no Canvas box when nothing is due soon', () => {
		const boxes = buildWallBoxes(
			[task({ title: 'Start a Substack', x: 20 }), assignment('Later', '2026-10-30')],
			zones,
			TODAY
		);
		expect(boxes.map((b) => b.id)).not.toContain(CANVAS_BOX_ID);
	});

	it('leaves out finished work and empty categories', () => {
		const boxes = buildWallBoxes(
			[task({ title: 'Done', done: true, x: 20 }), task({ title: 'Open', x: 520 })],
			zones,
			TODAY
		);
		expect(boxes.map((b) => b.name)).toEqual(['School']);
	});
});
