import cron from 'node-cron';
import { env } from '$env/dynamic/private';
import { db } from '../db';
import { listActiveTasks } from '../tasks/service';
import { buildMorningDigestContent } from '../notifications/digest';
import { buildDueSoonContent, findTasksNeedingDueAlert } from '../notifications/due-alerts';
import { sendPushToUser } from '../notifications/push';
import { logNotification } from '../notifications/log';
import { syncLmsAssignments } from '../lms/sync';

let started = false;

export function startScheduler() {
	if (started) return;
	started = true;

	// node-cron schedules run in the process/container's local timezone, not necessarily the
	// user's timezone — Fly machines default to UTC unless TZ is set in fly.toml, so
	// "0 8 * * *" means 8am UTC there, not 8am wherever the user actually is.
	const digestCron = env.DIGEST_CRON ?? '0 8 * * *';
	const dueCheckCron = env.DUE_CHECK_CRON ?? '0 * * * *';
	const lmsSyncCron = env.LMS_SYNC_CRON ?? env.CANVAS_SYNC_CRON ?? '0 */6 * * *';
	const leadHours = Number(env.DUE_ALERT_LEAD_HOURS ?? '24');

	cron.schedule(digestCron, () =>
		runMorningDigest().catch((err) => console.error('Digest job failed', err))
	);
	cron.schedule(dueCheckCron, () =>
		runDueAlertCheck(leadHours).catch((err) => console.error('Due-alert job failed', err))
	);
	cron.schedule(lmsSyncCron, () =>
		syncLmsAssignments().catch((err) => console.error('LMS sync job failed', err))
	);
}

export async function runMorningDigest() {
	const allUsers = await db.query.users.findMany();
	const tasks = await listActiveTasks();
	const digest = buildMorningDigestContent(tasks, new Date());

	for (const user of allUsers) {
		// Push is the optional half of a digest and the inbox is the durable one:
		// no VAPID keys, a dead subscription endpoint, a push service having a bad
		// morning — none of that is a reason for the user to find no digest waiting
		// in the app. Send first, log regardless.
		try {
			// The summary keeps the push short; the full task list lives in the inbox.
			await sendPushToUser(user.id, {
				title: 'Table — morning digest',
				body: digest.summary,
				url: '/'
			});
		} catch (err) {
			console.warn('Digest push failed; logging to the inbox anyway', err);
		}
		await logNotification({
			userId: user.id,
			type: 'morning_digest',
			content: { text: digest.text, taskIds: digest.taskIds }
		});
	}
}

export async function runDueAlertCheck(leadHours: number) {
	const allUsers = await db.query.users.findMany();
	const tasks = await listActiveTasks();

	for (const user of allUsers) {
		const priorNotifications = await db.query.notifications.findMany({
			where: (n, { eq }) => eq(n.userId, user.id)
		});
		const due = findTasksNeedingDueAlert(tasks, priorNotifications, new Date(), leadHours);
		if (due.length === 0) continue;

		const alert = buildDueSoonContent(due);
		// Guarded like the digest, and for a sharper reason: the inbox entry is
		// what findTasksNeedingDueAlert reads to decide a task has already been
		// alerted about, so losing the write to a push failure would re-alert the
		// same task every hour until its due date passed.
		try {
			await sendPushToUser(user.id, { title: 'Table — due soon', body: alert.summary, url: '/' });
		} catch (err) {
			console.warn('Due-alert push failed; logging to the inbox anyway', err);
		}
		await logNotification({
			userId: user.id,
			type: 'due_alert',
			content: { text: alert.text, taskIds: alert.taskIds }
		});
	}
}
