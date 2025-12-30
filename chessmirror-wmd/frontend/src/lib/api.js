const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3001";

export async function postEvent(event) {
  await fetch(`${API_BASE}/api/track/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
}

export async function startGame(uid) {
  const res = await fetch(`${API_BASE}/api/game/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid }),
  });
  return res.json();
}

export async function submitMove(payload) {
  const res = await fetch(`${API_BASE}/api/game/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function getInterventions(uid) {
  const res = await fetch(`${API_BASE}/api/interventions/${uid}`);
  return res.json();
}

export async function adminListUsers(adminPassword) {
  const res = await fetch(`${API_BASE}/api/admin/users`, {
    headers: { "x-admin-password": adminPassword }
  });
  return res.json();
}

export async function adminGetProfile(uid, adminPassword) {
  const res = await fetch(`${API_BASE}/api/admin/users/${uid}/profile`, {
    headers: { "x-admin-password": adminPassword }
  });
  return res.json();
}

export async function adminGetEvents(uid, adminPassword, take=200) {
  const res = await fetch(`${API_BASE}/api/admin/users/${uid}/events?take=${take}`, {
    headers: { "x-admin-password": adminPassword }
  });
  return res.json();
}

export async function adminSetInterventions(uid, adminPassword, interventions) {
  const res = await fetch(`${API_BASE}/api/admin/users/${uid}/interventions`, {
    method: "POST",
    headers: { "Content-Type":"application/json", "x-admin-password": adminPassword },
    body: JSON.stringify({ interventions })
  });
  return res.json();
}
