import cron from 'node-cron';
import { env } from '$env/dynamic/private';
import { db } from '../db';
import { users, notifications } from '../db/schema';
import { listActiveTasks } from '../tasks/service';
import { buildMorningDigestContent } from '../notifications/digest';
import { findTasksNeedingDueAlert } from '../notifications/due-alerts';
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

	cron.schedule(digestCron, () => runMorningDigest().catch((err) => console.error('Digest job failed', err)));
	cron.schedule(dueCheckCron, () => runDueAlertCheck(leadHours).catch((err) => console.error('Due-alert job failed', err)));
	cron.schedule(lmsSyncCron, () => syncLmsAssignments().catch((err) => console.error('LMS sync job failed', err)));
}

export async function runMorningDigest() {
	const allUsers = await db.query.users.findMany();
	const tasks = await listActiveTasks();
	const digest = buildMorningDigestContent(tasks, new Date());

	for (const user of allUsers) {
		await sendPushToUser(user.id, { title: 'Table — morning digest', body: digest.text, url: '/' });
		await logNotification({ userId: user.id, type: 'morning_digest', content: digest });
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

		const text = `${due.length} task${due.length === 1 ? '' : 's'} due soon.`;
		const content = { text, taskIds: due.map((t) => t.id) };
		await sendPushToUser(user.id, { title: 'Table — due soon', body: text, url: '/' });
		await logNotification({ userId: user.id, type: 'due_alert', content });
	}
}
