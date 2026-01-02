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
    // important defaults
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
  // events can be fire-and-forget, but still avoid caching weirdness
  return request("/api/track/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(event),
  });
}

export async function startGame(uid) {
  // IMPORTANT: no-store so dev caching can't cause weirdness
  return request("/api/game/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ uid }),
  });
}

export async function submitMove(payload) {
  return request("/api/game/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(payload),
  });
}

export async function getInterventions(uid) {
  // cache-bust (some browsers keep GET cached aggressively in dev)
  const t = Date.now();
  return request(`/api/interventions/${encodeURIComponent(uid)}?t=${t}`, {
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
