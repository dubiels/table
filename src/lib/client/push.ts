export async function subscribeToPush(vapidPublicKey: string): Promise<void> {
	if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
		throw new Error('Push not supported in this browser');
	}

	const permission = await Notification.requestPermission();
	if (permission !== 'granted') throw new Error('Notification permission denied');

	const registration = await navigator.serviceWorker.ready;
	const subscription = await registration.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: vapidPublicKey
	});

	await fetch('/api/push-subscriptions', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(subscription.toJSON())
	});
}
