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

	const res = await fetch('/api/push-subscriptions', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(subscription.toJSON())
	});
	// An expired session redirects to the login page, which answers 200 with
	// HTML — so a bare res.ok would report success for a subscription that was
	// never stored. Demand JSON as well.
	if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) {
		throw new Error('Could not save the subscription');
	}
}
