import React, { useEffect, useMemo, useState } from "react";
import { adminGetEvents, adminGetProfile, adminListUsers, adminSetInterventions } from "../lib/api";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

function formatMs(ms) {
  if (ms == null) return "";
  const s = Math.round(ms / 100) / 10;
  return `${s}s`;
}

export default function Admin() {
  const [adminPassword, setAdminPassword] = useState(localStorage.getItem("cm_admin_pw") || "");
  const [loggedIn, setLoggedIn] = useState(!!adminPassword);
  const [users, setUsers] = useState([]);
  const [selectedUid, setSelectedUid] = useState(null);
  const [profile, setProfile] = useState(null);
  const [events, setEvents] = useState([]);
  const [err, setErr] = useState("");

  const [confirmMoves, setConfirmMoves] = useState(false);
  const [nudgeTakeASecond, setNudgeTakeASecond] = useState(true);

  async function login() {
    setErr("");
    try {
      const list = await adminListUsers(adminPassword);
      if (list?.error) throw new Error(list.error);
      localStorage.setItem("cm_admin_pw", adminPassword);
      setLoggedIn(true);
      setUsers(list);
    } catch (e) {
      setErr("Admin login failed. Check ADMIN_PASSWORD in .env");
      setLoggedIn(false);
    }
  }

  useEffect(() => {
    if (!loggedIn) return;
    (async () => {
      try {
        const list = await adminListUsers(adminPassword);
        setUsers(Array.isArray(list) ? list : []);
      } catch (e) {}
    })();
  }, [loggedIn]);

  async function selectUser(uid) {
    setSelectedUid(uid);
    const p = await adminGetProfile(uid, adminPassword);
    setProfile(p);
    const ev = await adminGetEvents(uid, adminPassword, 120);
    setEvents(ev);

    // reset toggles to defaults (admin can change)
    setConfirmMoves(false);
    setNudgeTakeASecond(true);
  }

  async function saveInterventions() {
    if (!selectedUid) return;
    await adminSetInterventions(selectedUid, adminPassword, {
      confirmMoves,
      nudgeTakeASecond
    });
    alert("Saved. User app will pick this up on refresh.");
  }

  if (!loggedIn) {
    return (
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Admin login</h3>
        <p className="small">Enter the admin password from your `.env` (ADMIN_PASSWORD).</p>
        <input
          className="input"
          value={adminPassword}
          onChange={(e) => setAdminPassword(e.target.value)}
          placeholder="ADMIN_PASSWORD"
          type="password"
        />
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={login}>Login</button>
        </div>
        {err && <p className="small" style={{ color: "#ff7b7b" }}>{err}</p>}
      </div>
    );
  }

  const moveSeries = (profile?.moves || []).map((m, i) => ({
    i,
    thinkTimeMs: m.thinkTimeMs,
    blunder: m.quality === "blunder" ? 1 : 0
  }));

  const blunderRate = profile?.profile?.moveCount
    ? Math.round((profile.profile.blunderCount / profile.profile.moveCount) * 100)
    : 0;

  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      <div className="card" style={{ flex: "0 0 360px" }}>
        <h3 style={{ marginTop: 0 }}>Users</h3>
        <p className="small">Select a UID to view their profile and events.</p>
        <div style={{ maxHeight: 520, overflow: "auto" }}>
          {users.map(u => (
            <div key={u.uid} style={{ padding: "10px 0", borderBottom: "1px solid #242532" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="badge">{u.uid}</span>
                <span className="badge">{u.segment}</span>
              </div>
              <div className="small" style={{ marginTop: 6, opacity: 0.85 }}>
                moves: {u.moveCount} • blunders: {u.blunderCount} • avg think: {formatMs(u.avgThinkTimeMs)} • hints: {u.hintCount}
              </div>
              <button className="btn" style={{ marginTop: 8 }} onClick={() => selectUser(u.uid)}>
                Open
              </button>
            </div>
          ))}
          {users.length === 0 && <p className="small">No users yet. Play a game first.</p>}
        </div>
      </div>

      <div className="card" style={{ flex: "1 1 520px" }}>
        {!selectedUid ? (
          <p className="small">Pick a user on the left.</p>
        ) : (
          <>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Profile: {selectedUid}</h3>
              <span className="badge">segment: {profile?.profile?.segment || "unknown"}</span>
            </div>

            <div className="row" style={{ marginTop: 10 }}>
              <span className="badge">moves: {profile?.profile?.moveCount ?? 0}</span>
              <span className="badge">blunder rate: {blunderRate}%</span>
              <span className="badge">avg think: {formatMs(profile?.profile?.avgThinkTimeMs ?? 0)}</span>
              <span className="badge">hints: {profile?.profile?.hintCount ?? 0}</span>
            </div>

            <hr />

            <h4 style={{ margin: "0 0 8px 0" }}>Think time trend (last moves)</h4>
            <div style={{ width: "100%", height: 220 }}>
              <ResponsiveContainer>
                <LineChart data={moveSeries}>
                  <XAxis dataKey="i" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="thinkTimeMs" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <hr />

            <h4 style={{ margin: "0 0 8px 0" }}>Interventions (influence)</h4>
            <p className="small">These toggles change the user-facing UI for this UID.</p>
            <div className="row">
              <label className="small">
                <input type="checkbox" checked={confirmMoves} onChange={(e) => setConfirmMoves(e.target.checked)} />
                {" "}confirmMoves (adds confirm prompt)
              </label>
              <label className="small">
                <input type="checkbox" checked={nudgeTakeASecond} onChange={(e) => setNudgeTakeASecond(e.target.checked)} />
                {" "}nudgeTakeASecond (shows nudge text)
              </label>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn" onClick={saveInterventions}>Save interventions</button>
            </div>

            <hr />

            <h4 style={{ margin: "0 0 8px 0" }}>Recent events (sample)</h4>
            <div style={{ maxHeight: 220, overflow: "auto", fontSize: 12 }}>
              {Array.isArray(events) && events.map(ev => (
                <div key={ev.id} style={{ padding: "8px 0", borderBottom: "1px solid #242532" }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="badge">{ev.type}</span>
                    <span className="small">{new Date(ev.ts).toLocaleString()}</span>
                  </div>
                  <pre style={{ whiteSpace: "pre-wrap", margin: "6px 0 0 0", opacity: 0.9 }}>
{JSON.stringify(ev.payload, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
