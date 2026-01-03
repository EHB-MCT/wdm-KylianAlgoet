import React, { useEffect, useMemo, useState } from "react";
import {
  adminGetEvents,
  adminGetProfile,
  adminListUsers,
  adminSetInterventions
} from "../lib/api";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

function formatMs(ms) {
  if (ms == null) return "—";
  const s = Math.round(ms / 100) / 10;
  return `${s}s`;
}

function fmtDate(d) {
  try {
    return new Date(d).toLocaleString();
  } catch {
    return String(d ?? "");
  }
}

function oneLine(obj, max = 160) {
  try {
    const s = JSON.stringify(obj);
    if (s.length <= max) return s;
    return s.slice(0, max) + "…";
  } catch {
    return String(obj);
  }
}

export default function Admin() {
  const [adminPassword, setAdminPassword] = useState(
    localStorage.getItem("cm_admin_pw") || ""
  );
  const [loggedIn, setLoggedIn] = useState(!!adminPassword);

  const [users, setUsers] = useState([]);
  const [selectedUid, setSelectedUid] = useState(null);
  const [profile, setProfile] = useState(null);
  const [events, setEvents] = useState([]);
  const [err, setErr] = useState("");

  const [confirmMoves, setConfirmMoves] = useState(false);
  const [nudgeTakeASecond, setNudgeTakeASecond] = useState(true);

  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [saving, setSaving] = useState(false);

  const [query, setQuery] = useState("");
  const [eventsTake, setEventsTake] = useState(120);

  async function login() {
    setErr("");
    setLoadingUsers(true);
    try {
      const list = await adminListUsers(adminPassword);
      localStorage.setItem("cm_admin_pw", adminPassword);
      setLoggedIn(true);
      setUsers(Array.isArray(list) ? list : []);
    } catch (e) {
      setErr("Admin login failed. Check ADMIN_PASSWORD in .env");
      setLoggedIn(false);
    } finally {
      setLoadingUsers(false);
    }
  }

  // Load user list (after login)
  useEffect(() => {
    if (!loggedIn) return;
    let alive = true;

    (async () => {
      setLoadingUsers(true);
      try {
        const list = await adminListUsers(adminPassword);
        if (!alive) return;
        setUsers(Array.isArray(list) ? list : []);
      } catch (e) {
        // silent
      } finally {
        if (alive) setLoadingUsers(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [loggedIn, adminPassword]);

  async function selectUser(uid, take = eventsTake) {
    setSelectedUid(uid);
    setLoadingProfile(true);
    setErr("");

    try {
      const p = await adminGetProfile(uid, adminPassword);
      setProfile(p);

      // Prefer recentEvents if backend provides them inside profile
      if (Array.isArray(p?.recentEvents)) {
        setEvents(p.recentEvents);
      } else {
        const ev = await adminGetEvents(uid, adminPassword, take);
        setEvents(Array.isArray(ev) ? ev : []);
      }

      // reset toggles to defaults (admin can change)
      setConfirmMoves(false);
      setNudgeTakeASecond(true);
    } catch (e) {
      setErr("Failed to load profile/events. Check API + ADMIN_PASSWORD.");
    } finally {
      setLoadingProfile(false);
    }
  }

  async function refreshUsers() {
    if (!loggedIn) return;
    setLoadingUsers(true);
    try {
      const list = await adminListUsers(adminPassword);
      setUsers(Array.isArray(list) ? list : []);
    } catch (e) {
      // ignore
    } finally {
      setLoadingUsers(false);
    }
  }

  async function refreshSelected() {
    if (!selectedUid) return;
    await selectUser(selectedUid, eventsTake);
  }

  async function saveInterventions() {
    if (!selectedUid) return;
    setSaving(true);
    setErr("");
    try {
      await adminSetInterventions(selectedUid, adminPassword, {
        confirmMoves,
        nudgeTakeASecond
      });
      await refreshSelected();
      setErr("✅ Saved. User app will pick this up on refresh.");
      setTimeout(() => setErr(""), 2200);
    } catch (e) {
      setErr("Failed to save interventions.");
    } finally {
      setSaving(false);
    }
  }

  // Chart series
const moveSeries = useMemo(() => {
  return (profile?.moves || []).map((m, i) => ({
    i,
    thinkTimeSec: ((m.thinkTimeMs ?? 0) / 1000),
    blunder: m.quality === "blunder" ? 1 : 0,
    isBot: !!m.isBot
  }));
}, [profile]);


  // Stats/insight (backend preferred)
  const stats = profile?.stats || null;
  const insight = profile?.insight || null;

  // Segment: prefer new segment
  const segment = profile?.segment || profile?.profile?.segment || "unknown";

  const blunderRate = useMemo(() => {
    if (typeof stats?.blunderRate === "number") return stats.blunderRate;

    const moveCount = profile?.profile?.moveCount ?? 0;
    const blunderCount = profile?.profile?.blunderCount ?? 0;
    if (!moveCount) return 0;
    return Math.round((blunderCount / moveCount) * 100);
  }, [stats, profile]);

  const avgThinkDisplay = useMemo(() => {
    if (typeof stats?.avgThinkTime === "number") return `${stats.avgThinkTime}s`;
    return formatMs(profile?.profile?.avgThinkTimeMs ?? 0);
  }, [stats, profile]);

  const hoverCount =
    typeof stats?.hoverCount === "number" ? stats.hoverCount : null;

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => String(u.uid).toLowerCase().includes(q));
  }, [users, query]);

  // LOGIN SCREEN
  if (!loggedIn) {
    return (
      <div className="card adminShell">
        <div className="adminHeader">
          <div>
            <h3 style={{ margin: 0 }}>Admin</h3>
            <p className="small" style={{ margin: "6px 0 0 0" }}>
              Enter the admin password from your <code>.env</code> (ADMIN_PASSWORD).
            </p>
          </div>
          <span className="badge">secure</span>
        </div>

        <div className="adminLogin">
          <input
            className="input"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            placeholder="ADMIN_PASSWORD"
            type="password"
          />
          <button
            className="btn btn-primary"
            onClick={login}
            disabled={loadingUsers}
          >
            {loadingUsers ? "Logging in..." : "Login"}
          </button>
        </div>

        {err && (
          <div className="alert alert-danger" style={{ marginTop: 12 }}>
            {err}
          </div>
        )}
      </div>
    );
  }

  // DASHBOARD
  return (
    <div className="adminGrid">
      {/* LEFT: USERS */}
      <div className="card adminUsers">
        <div className="adminHeader">
          <div>
            <h3 style={{ margin: 0 }}>Users</h3>
            <p className="small" style={{ margin: "6px 0 0 0" }}>
              Select a UID to view profile + events.
            </p>
          </div>
          <button
            className="btn"
            onClick={refreshUsers}
            disabled={loadingUsers}
            title="Refresh users list"
          >
            {loadingUsers ? "…" : "Refresh"}
          </button>
        </div>

        <div className="adminSearch">
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search UID…"
          />
        </div>

        <div className="adminUserList">
          {filteredUsers.map((u) => {
            const active = u.uid === selectedUid;
            return (
              <button
                key={u.uid}
                className={`userItem ${active ? "active" : ""}`}
                onClick={() => selectUser(u.uid)}
                title="Open user"
              >
                <div className="userTop">
                  <span className="badge">{u.uid}</span>
                  <span className="badge">{u.segment}</span>
                </div>
                <div className="userMeta">
                  moves: <b>{u.moveCount}</b> • blunders: <b>{u.blunderCount}</b>{" "}
                  • avg: <b>{formatMs(u.avgThinkTimeMs)}</b> • hints:{" "}
                  <b>{u.hintCount}</b>
                </div>
              </button>
            );
          })}

          {!loadingUsers && filteredUsers.length === 0 && (
            <p className="small">No users found.</p>
          )}

          {!loadingUsers && users.length === 0 && (
            <p className="small">No users yet. Play a game first.</p>
          )}
        </div>
      </div>

      {/* RIGHT: PROFILE */}
      <div className="card adminProfile">
        {!selectedUid ? (
          <div className="emptyState">
            <h3 style={{ marginTop: 0 }}>Pick a user</h3>
            <p className="small">
              Select a UID on the left to see data → profile → influence.
            </p>
          </div>
        ) : loadingProfile ? (
          <div className="emptyState">
            <h3 style={{ marginTop: 0 }}>Loading…</h3>
            <p className="small">Fetching profile, moves and events.</p>
          </div>
        ) : (
          <>
            <div className="adminHeader">
              <div>
                <h3 style={{ margin: 0 }}>Profile</h3>
                <p className="small" style={{ margin: "6px 0 0 0" }}>
                  UID: <span className="badge">{selectedUid}</span>
                </p>
              </div>
              <span className="badge">segment: {segment}</span>
            </div>

            {/* QUICK STATS */}
            <div className="statGrid" style={{ marginTop: 12 }}>
              <div className="statCard">
                <div className="statLabel">Moves</div>
                <div className="statValue">{profile?.profile?.moveCount ?? 0}</div>
              </div>

              <div className="statCard">
                <div className="statLabel">Blunder rate</div>
                <div className="statValue">{blunderRate}%</div>
              </div>

              <div className="statCard">
                <div className="statLabel">Avg think</div>
                <div className="statValue">{avgThinkDisplay}</div>
              </div>

              <div className="statCard">
                <div className="statLabel">Hints</div>
                <div className="statValue">{profile?.profile?.hintCount ?? 0}</div>
              </div>

              {hoverCount != null && (
                <div className="statCard">
                  <div className="statLabel">Hovers</div>
                  <div className="statValue">{hoverCount}</div>
                </div>
              )}
            </div>

            {/* INSIGHT */}
            <div className="card" style={{ marginTop: 14 }}>
              <div className="adminHeader" style={{ marginBottom: 8 }}>
                <h4 style={{ margin: 0 }}>Conclusion</h4>
                <span className="badge">{insight?.label ?? "—"}</span>
              </div>

              <p className="small" style={{ margin: 0, opacity: 0.9 }}>
                {insight?.text ??
                  "No insight yet. Play a few moves and interact (hover / hints) to generate signals."}
              </p>

              {stats && (
                <p className="small" style={{ marginTop: 10, opacity: 0.7 }}>
                  Signals: avgThink={stats.avgThinkTime ?? "—"}s · blunderRate=
                  {stats.blunderRate ?? "—"}% · hovers={stats.hoverCount ?? "—"} ·
                  hovers/move={stats.hoversPerMove ?? "—"} · hints=
                  {stats.hintsUsed ?? "—"}
                </p>
              )}
            </div>

            <hr />

            {/* CHART */}
            <div className="adminHeader" style={{ marginBottom: 8 }}>
              <h4 style={{ margin: 0 }}>Think time trend (last moves)</h4>
              <span className="badge">{(profile?.moves || []).length} samples</span>
            </div>

            <div className="chartBox">
              <ResponsiveContainer>
           <LineChart data={moveSeries}>
  <XAxis dataKey="i" />
  <YAxis tickFormatter={(v) => `${v}s`} />
  <Tooltip
    formatter={(value, name) => {
      if (name === "thinkTimeSec") return [`${Math.round(value * 10) / 10}s`, "Think time"];
      return [value, name];
    }}
    labelFormatter={(label) => `Move #${label}`}
  />
  <Line type="monotone" dataKey="thinkTimeSec" />
</LineChart>

              </ResponsiveContainer>
            </div>

            <hr />

            {/* INTERVENTIONS */}
            <div className="adminHeader" style={{ marginBottom: 8 }}>
              <h4 style={{ margin: 0 }}>Interventions</h4>
              <span className="badge">influence</span>
            </div>

            <p className="small" style={{ marginTop: 0 }}>
              These toggles change the user-facing UI for this UID.
            </p>

            <div className="toggleGrid">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={confirmMoves}
                  onChange={(e) => setConfirmMoves(e.target.checked)}
                />
                <div>
                  <div className="toggleTitle">confirmMoves</div>
                  <div className="toggleDesc">
                    Adds a confirm prompt before committing a move.
                  </div>
                </div>
              </label>

              <label className="toggle">
                <input
                  type="checkbox"
                  checked={nudgeTakeASecond}
                  onChange={(e) => setNudgeTakeASecond(e.target.checked)}
                />
                <div>
                  <div className="toggleTitle">nudgeTakeASecond</div>
                  <div className="toggleDesc">
                    Shows subtle nudges (default on).
                  </div>
                </div>
              </label>
            </div>

            <div
              className="row"
              style={{ marginTop: 10, justifyContent: "space-between" }}
            >
              <div className="row">
                <button
                  className="btn btn-primary"
                  onClick={saveInterventions}
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Save interventions"}
                </button>
                <button className="btn" onClick={refreshSelected}>
                  Reload
                </button>
              </div>

              {err && (
                <div
                  className={`alert ${
                    err.startsWith("✅") ? "" : "alert-danger"
                  }`}
                >
                  {err}
                </div>
              )}
            </div>

            <hr />

            {/* EVENTS */}
            <div className="adminHeader" style={{ marginBottom: 8 }}>
              <h4 style={{ margin: 0 }}>Recent events</h4>
              <div className="row" style={{ gap: 10 }}>
                <span className="badge">{events?.length ?? 0} shown</span>
                <select
                  className="input"
                  style={{ width: 120, padding: "8px 10px" }}
                  value={eventsTake}
                  onChange={async (e) => {
                    const v = parseInt(e.target.value, 10);
                    setEventsTake(v);
                    if (!selectedUid) return;
                    try {
                      const ev = await adminGetEvents(selectedUid, adminPassword, v);
                      setEvents(Array.isArray(ev) ? ev : []);
                    } catch {}
                  }}
                >
                  <option value={50}>50</option>
                  <option value={120}>120</option>
                  <option value={200}>200</option>
                </select>
              </div>
            </div>

            {/* ✅ FIX: events are visible + compact list */}
            <div className="eventsList">
              {Array.isArray(events) &&
                events.map((ev) => (
                  <details key={ev.id} className="eventItem">
                    <summary className="eventTop">
                      <span className="badge">{ev.type}</span>
                      <span className="small">{fmtDate(ev.ts)}</span>
                      <span className="small" style={{ opacity: 0.75 }}>
                        {oneLine(ev.payload)}
                      </span>
                    </summary>
                    <pre style={{ marginTop: 10 }}>
                      {JSON.stringify(ev.payload ?? {}, null, 2)}
                    </pre>
                  </details>
                ))}

              {(!events || events.length === 0) && (
                <p className="small">No recent events to show.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
