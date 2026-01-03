import React, { useEffect } from "react";
import { Routes, Route, Link, useLocation } from "react-router-dom";
import Home from "./pages/Home.jsx";
import Admin from "./pages/Admin.jsx";
import { attachGlobalTracking, track } from "./lib/tracker";

export default function App() {
  const location = useLocation();

  useEffect(() => {
    attachGlobalTracking();
  }, []);

  useEffect(() => {
    track("nav", { path: location.pathname });
  }, [location.pathname]);

  return (
    <div className="container">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>♟️ ChessMirror WMD</h2>
        <div className="row">
          <Link className="btn" to="/">Play</Link>
          <Link className="btn" to="/admin">Admin</Link>
        </div>
      </div>
      <p className="small">Local-only demo: collect → profile → influence (subtle UX). Everything stored per UID.</p>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </div>
  );
}
