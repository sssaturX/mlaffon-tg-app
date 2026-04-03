/* eslint-disable no-undef */
self.addEventListener("push", function (event) {
  var payload = {
    title: "Стрим начался 🔴",
    body: "Заходи смотреть прямо сейчас!",
    url: "/stream",
  };
  if (event.data) {
    try {
      var parsed = event.data.json();
      if (parsed && typeof parsed === "object") {
        if (parsed.title) payload.title = parsed.title;
        if (parsed.body) payload.body = parsed.body;
        if (parsed.url) payload.url = parsed.url;
      }
    } catch (_e) {
      /* ignore */
    }
  }
  var openUrl = typeof payload.url === "string" ? payload.url : "/stream";
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: { url: openUrl },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  var raw =
    event.notification.data && event.notification.data.url
      ? event.notification.data.url
      : "/stream";
  var full = new URL(raw, self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url.indexOf(self.location.origin) === 0 && "focus" in c) {
          if ("navigate" in c && typeof c.navigate === "function") {
            return c.navigate(full).then(function () {
              return c.focus();
            });
          }
          return c.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(full);
      }
    })
  );
});
