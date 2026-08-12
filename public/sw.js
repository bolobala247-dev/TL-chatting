/* Talo Web Push worker. Deliberately handles push/click only; it does not
 * intercept fetches or cache application data. */

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {
      body: event.data ? event.data.text() : "Tin nhắn mới",
    };
  }

  const data = payload.data || {};
  const roomId = typeof data.roomId === "string" ? data.roomId : "";
  const messageId = typeof data.messageId === "string" ? data.messageId : "";
  const title = typeof payload.title === "string" ? payload.title : "Talo";
  const body =
    typeof payload.body === "string" ? payload.body : "Tin nhắn mới";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: messageId
        ? `message:${messageId}`
        : roomId
          ? `room:${roomId}`
          : "talo:message",
      renotify: false,
      data: {
        roomId,
        type: data.type,
        messageId: data.messageId,
        createdAt: data.createdAt,
      },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const roomId = typeof data.roomId === "string" ? data.roomId : "";
  const targetUrl = roomId
    ? new URL(`/chat/${encodeURIComponent(roomId)}`, self.location.origin).href
    : new URL("/", self.location.origin).href;

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of clients) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            await client.navigate(targetUrl);
          }
          return;
        }
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })()
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(
      (clients) => {
        for (const client of clients) {
          client.postMessage({ type: "WEB_PUSH_SUBSCRIPTION_CHANGED" });
        }
      }
    )
  );
});
