const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3001";

async function safeJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

async function request(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    mode: "cors",
    credentials: "omit",
    ...opts,
  });

  const data = await safeJson(res);

  if (!res.ok) {
    const msg =
      data?.error ||
      data?.message ||
      `HTTP ${res.status} ${res.statusText} on ${path}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

export async function postEvent(event) {
  return request("/api/track/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(event),
  });
}

// ✅ helper: collect meta once (safe + trimmed)
function collectMeta() {
  try {
    return {
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      lang: navigator.language,
      userAgent: navigator.userAgent?.slice(0, 256),
      screenW: window.screen?.width,
      screenH: window.screen?.height,
    };
  } catch {
    return {};
  }
}

export async function startGame(uid) {
  // ✅ now sends meta (backend supports it)
  return request("/api/game/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ uid, meta: collectMeta() }),
  });
}

export async function submitMove(payload) {
  // ✅ normalize payload (backend expects isBot optionally)
  const body = {
    ...payload,
    isBot: !!payload?.isBot,
  };

  return request("/api/game/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body),
  });
}

export async function getInterventions(uid) {
  const t = Date.now();
  return request(`/api/interventions/${encodeURIComponent(uid)}?t=${t}`, {
    method: "GET",
    cache: "no-store",
    headers: { "Cache-Control": "no-store" },
  });
}

export async function getProfile(uid) {
  const t = Date.now();
  return request(`/api/profile/${encodeURIComponent(uid)}?t=${t}`, {
    method: "GET",
    cache: "no-store",
    headers: { "Cache-Control": "no-store" },
  });
}


export async function adminListUsers(adminPassword) {
  const t = Date.now();
  return request(`/api/admin/users?t=${t}`, {
    method: "GET",
    cache: "no-store",
    headers: {
      "x-admin-password": adminPassword,
      "Cache-Control": "no-store",
    },
  });
}

export async function adminGetProfile(uid, adminPassword) {
  const t = Date.now();
  return request(`/api/admin/users/${encodeURIComponent(uid)}/profile?t=${t}`, {
    method: "GET",
    cache: "no-store",
    headers: {
      "x-admin-password": adminPassword,
      "Cache-Control": "no-store",
    },
  });
}

export async function adminGetEvents(uid, adminPassword, take = 200) {
  const t = Date.now();
  return request(
    `/api/admin/users/${encodeURIComponent(uid)}/events?take=${take}&t=${t}`,
    {
      method: "GET",
      cache: "no-store",
      headers: {
        "x-admin-password": adminPassword,
        "Cache-Control": "no-store",
      },
    }
  );
}

export async function adminSetInterventions(uid, adminPassword, interventions) {
  return request(`/api/admin/users/${encodeURIComponent(uid)}/interventions`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "x-admin-password": adminPassword,
    },
    body: JSON.stringify({ interventions }),
  });
}
