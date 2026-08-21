import cron from 'node-cron';
import { env } from '$env/dynamic/private';
import { db } from '../db';
import { listActiveTasks } from '../tasks/service';
import { buildDueSoonContent, findTasksNeedingDueAlert } from '../notifications/due-alerts';
import { sendPushToUser } from '../notifications/push';
import { logNotification } from '../notifications/log';
import { syncLmsAssignments } from '../lms/sync';
import { syncGoogleTasks } from '../gtasks/sync';

let started = false;

export function startScheduler() {
	if (started) return;
	started = true;

	// node-cron schedules run in the process/container's local timezone, not necessarily the
	// user's timezone — Fly machines default to UTC unless TZ is set in fly.toml, so
	// "0 * * * *" fires on the container's clock, not on whatever clock the user is reading.
	const dueCheckCron = env.DUE_CHECK_CRON ?? '0 * * * *';
	const lmsSyncCron = env.LMS_SYNC_CRON ?? env.CANVAS_SYNC_CRON ?? '0 */6 * * *';
	const gtasksSyncCron = env.GTASKS_SYNC_CRON ?? '*/5 * * * *';
	const leadHours = Number(env.DUE_ALERT_LEAD_HOURS ?? '24');

	cron.schedule(dueCheckCron, () =>
		runDueAlertCheck(leadHours).catch((err) => console.error('Due-alert job failed', err))
	);
	cron.schedule(lmsSyncCron, () =>
		syncLmsAssignments().catch((err) => console.error('LMS sync job failed', err))
	);
	// syncGoogleTasks() already swallows its own failures and reports ok:false;
	// the catch is a belt for anything unexpected, so one bad round never kills
	// the scheduled job.
	cron.schedule(gtasksSyncCron, () =>
		syncGoogleTasks().catch((err) => console.error('Google Tasks sync job failed', err))
	);
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
