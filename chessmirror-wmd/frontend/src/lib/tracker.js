import { postEvent } from "./api";
import { getUid, getSessionId } from "./uid";

let lastHoverSent = 0;

function meta() {
  return {
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    lang: navigator.language,
    userAgent: navigator.userAgent,
    screenW: window.screen.width,
    screenH: window.screen.height,
  };
}

export function track(type, payload = {}) {
  const uid = getUid();
  const sessionId = getSessionId();
  const ts = Date.now();

  // very light client-side downsampling for hover
  if (type === "hover" && ts - lastHoverSent < 120) return;
  if (type === "hover") lastHoverSent = ts;

  postEvent({ uid, sessionId, ts, type, payload, meta: meta() }).catch(() => {});
}

export function attachGlobalTracking() {
  window.addEventListener("blur", () => track("window_blur", {}));
  window.addEventListener("focus", () => track("window_focus", {}));
  document.addEventListener("visibilitychange", () => {
    track("visibility", { state: document.visibilityState });
  });
}
