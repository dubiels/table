import * as tasksService from '../tasks/service';
import * as peopleService from '../people/service';
import * as flagsService from '../people/flags';
import type { Task } from '../tasks/service';
import type { PersonWithFlags } from '../people/service';
import type { Flag } from '../people/flags';
import { notFound } from './respond';

/**
 * Existence checks that speak in 404s.
 *
 * The services throw a bare `Error` for a missing row, which would surface as a
 * 500 — "you asked for a task that is not here" is the agent's mistake to fix,
 * not a server fault, and it must be told apart from one so a retry loop does
 * not treat it as transient.
 */
export async function requireTask(id: string): Promise<Task> {
	const task = await tasksService.getTask(id).catch(() => null);
	if (!task) throw notFound(`Task ${id}`);
	return task;
}

/**
 * A person by id.
 *
 * Scans `listPeople()` rather than adding a `getPerson` to the service: at a
 * few hundred rows the cost is nothing, and the read already carries the flag
 * ids every caller here needs anyway.
 */
export async function requirePerson(id: string): Promise<PersonWithFlags> {
	const person = (await peopleService.listPeople()).find((p) => p.id === id);
	if (!person) throw notFound(`Person ${id}`);
	return person;
}

export async function requireFlag(id: string): Promise<Flag> {
	const flag = (await flagsService.listFlags()).find((f) => f.id === id);
	if (!flag) throw notFound(`Flag ${id}`);
	return flag;
}
