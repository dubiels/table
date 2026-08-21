import { zoneForTask, taskCenter } from '$lib/zones';
import type { Task } from '../tasks/service';
import type { PersonWithFlags } from '../people/service';
import type { Flag } from '../people/flags';
import type { Zone } from '../zones/service';
import type { Touchpoint } from '../people/touchpoints';

export interface AgentZoneRef {
	id: string;
	name: string;
	color: string;
}

export interface AgentTask {
	id: string;
	title: string;
	notes: string | null;
	dueDate: string | null;
	plannedDate: string | null;
	priority: string | null;
	done: boolean;
	completedAt: string | null;
	/** The category. Derived from position, not stored — see `zoneForTask`. */
	zone: AgentZoneRef | null;
	source: string;
	courseName: string | null;
	externalId: string | null;
	personId: string | null;
	position: { x: number; y: number };
	google: {
		sync: boolean;
		taskId: string | null;
		syncedAt: string | null;
		updatedAt: string | null;
		error: string | null;
	};
	createdAt: string;
	updatedAt: string;
}

export interface AgentFlag {
	id: string;
	name: string;
	color: string;
}

export interface AgentTouchpoint {
	id: string;
	occurredOn: string;
	note: string | null;
	createdAt: string;
}

export interface AgentPerson {
	id: string;
	name: string;
	status: string;
	archived: boolean;
	archivedAt: string | null;
	linkedinUrl: string | null;
	email: string | null;
	phone: string | null;
	company: string | null;
	role: string | null;
	city: string | null;
	cityId: number | null;
	metAt: string | null;
	metOn: string | null;
	lastSpokeAt: string | null;
	notes: string | null;
	flags: AgentFlag[];
	touchpoints: AgentTouchpoint[];
	createdAt: string;
	updatedAt: string;
}

const zoneRef = (zone: { id: string; name: string; color: string }): AgentZoneRef => ({
	id: zone.id,
	name: zone.name,
	color: zone.color
});

export function serializeTask(task: Task, zones: Zone[]): AgentTask {
	const hit = zoneForTask(taskCenter({ x: task.x, y: task.y }), zones);
	const zone = hit ? zones.find((z) => z.id === hit.id) : undefined;
	return {
		id: task.id,
		title: task.title,
		notes: task.notes,
		dueDate: task.dueDate,
		plannedDate: task.plannedDate,
		priority: task.priority,
		done: task.done,
		completedAt: task.completedAt,
		zone: zone ? zoneRef(zone) : null,
		source: task.source,
		courseName: task.courseName,
		externalId: task.externalId,
		personId: task.personId,
		// Nested rather than loose x/y: they are the storage of the category above,
		// not two more fields, and burying them says an agent should set `zoneId`.
		position: { x: task.x, y: task.y },
		google: {
			sync: task.googleSync,
			taskId: task.googleTaskId,
			syncedAt: task.googleSyncedAt,
			updatedAt: task.googleUpdatedAt,
			error: task.googleError
		},
		createdAt: task.createdAt,
		updatedAt: task.updatedAt
	};
}

/**
 * The most recent stamp a task carries.
 *
 * `updatedAt` alone is the wrong clock for `?since=`: it deliberately does not
 * move for priority, position or person-link edits, because dirtiness against
 * Google is defined as `updatedAt !== googleSyncedAt` and a drag must not win a
 * conflict against a real edit made on the phone. Taking the max with the other
 * two stamps recovers creation and completion at least, and `updatedAt` defaults
 * to the empty string on rows predating it, which sorts below every real date.
 */
function latestStamp(task: Task): string {
	return [task.updatedAt, task.createdAt, task.completedAt ?? ''].reduce((a, b) => (a > b ? a : b));
}

export interface TaskQuery {
	includeCompleted?: boolean;
	since?: string;
}

/**
 * Tasks narrowed by the query, newest activity first.
 *
 * Both filters default to off — the client is a machine that would page through
 * everything anyway, so completeness costs it nothing and a wrong default costs
 * it a silently missing task.
 */
export function selectTasks(tasks: Task[], query: TaskQuery = {}): Task[] {
	const includeCompleted = query.includeCompleted ?? true;
	return tasks
		.filter((t) => (includeCompleted || !t.done) && (!query.since || latestStamp(t) >= query.since))
		.sort((a, b) => (latestStamp(a) < latestStamp(b) ? 1 : -1));
}

export function serializePerson(
	person: PersonWithFlags,
	flagsById: Map<string, Flag>,
	touchpoints: Touchpoint[]
): AgentPerson {
	return {
		id: person.id,
		name: person.name,
		status: person.status,
		// The boolean beside the timestamp, because "is this person archived" is
		// the question every caller actually has, and deriving it from a nullable
		// date is a step each of them would otherwise get to skip or get wrong.
		archived: person.archivedAt !== null,
		archivedAt: person.archivedAt,
		linkedinUrl: person.linkedinUrl,
		email: person.email,
		phone: person.phone,
		company: person.company,
		role: person.role,
		city: person.city,
		cityId: person.cityId,
		metAt: person.metAt,
		metOn: person.metOn,
		lastSpokeAt: person.lastSpokeAt,
		notes: person.notes,
		// Resolved, not ids: an agent asking "who is in SF" should not have to
		// join against /meta to find out what a flag id means.
		flags: person.flagIds
			.map((id) => flagsById.get(id))
			.filter((f): f is Flag => f !== undefined)
			.map((f) => ({ id: f.id, name: f.name, color: f.color })),
		touchpoints: touchpoints.map((t) => ({
			id: t.id,
			occurredOn: t.occurredOn,
			note: t.note,
			createdAt: t.createdAt
		})),
		createdAt: person.createdAt,
		updatedAt: person.updatedAt
	};
}

export function serializePeople(
	people: PersonWithFlags[],
	flags: Flag[],
	touchpoints: Touchpoint[],
	options: { includeArchived?: boolean } = {}
): AgentPerson[] {
	const includeArchived = options.includeArchived ?? true;
	const flagsById = new Map(flags.map((f) => [f.id, f]));

	const byPerson = new Map<string, Touchpoint[]>();
	for (const t of touchpoints) {
		const existing = byPerson.get(t.personId);
		if (existing) existing.push(t);
		else byPerson.set(t.personId, [t]);
	}

	return people
		.filter((p) => includeArchived || p.archivedAt === null)
		.map((p) => serializePerson(p, flagsById, byPerson.get(p.id) ?? []));
}

export function serializeMeta(zones: Zone[], flags: Flag[]) {
	return {
		zones: zones.map((z) => ({
			...zoneRef(z),
			// The rectangle is the category's definition, so an agent that wants to
			// reason about placement can, even though `zoneId` means it need not.
			bounds: { x: z.x, y: z.y, width: z.width, height: z.height }
		})),
		flags: flags.map((f) => ({ id: f.id, name: f.name, color: f.color }))
	};
}
