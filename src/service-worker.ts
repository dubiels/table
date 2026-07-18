/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

const sw = self as unknown as ServiceWorkerGlobalScope;

sw.addEventListener('push', (event) => {
	const data = event.data?.json() ?? { title: 'Table', body: '' };
	event.waitUntil(sw.registration.showNotification(data.title, { body: data.body, data: { url: data.url ?? '/' } }));
});

sw.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = (event.notification.data as { url?: string })?.url ?? '/';
	event.waitUntil(sw.clients.openWindow(url));
});
