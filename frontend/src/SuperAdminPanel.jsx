import { useState, useEffect, useRef } from "react";
import { useAuth } from "./ProtectedRoute";
import { getDeptTheme, DEPT_THEMES } from "./DeptTheme.js";
import { DeptLogo, PCCLogo } from "./LogoMap.jsx";

/* ─── PCC Brand tokens ─── */
const PCC = {
  skyBlue:    "#0EA5E9",
  skyLight:   "#E0F2FE",
  skyMid:     "#38BDF8",
  skyDark:    "#0369A1",
  skyDeep:    "#0C4A6E",
  white:      "#FFFFFF",
  offWhite:   "#F0F9FF",
  border:     "#BAE6FD",
  borderMid:  "#7DD3FC",
  text:       "#0C4A6E",
  textMuted:  "#0369A1",
  textLight:  "#38BDF8",
  surface:    "#FFFFFF",
  surfaceAlt: "#F0F9FF",
  danger:     "#EF4444",
  dangerBg:   "#FEF2F2",
  dangerBdr:  "#FECACA",
  warn:       "#F59E0B",
  warnBg:     "#FFFBEB",
  warnBdr:    "#FDE68A",
  success:    "#10B981",
  successBg:  "#ECFDF5",
  successBdr: "#A7F3D0",
};

const card = {
  background: PCC.white,
  border: `1px solid ${PCC.border}`,
  borderRadius: 12,
  padding: "18px 20px",
};

const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

function fmtH(h) {
  const hr  = Math.floor(h);
  const min = h % 1 === 0.5 ? "30" : "00";
  if (hr === 0)  return `12:${min} AM`;
  if (hr === 12) return `12:${min} PM`;
  if (hr < 12)   return `${hr}:${min} AM`;
  return `${hr - 12}:${min} PM`;
}
function fmtRange(s, e) { return `${fmtH(s)}–${fmtH(e)}`; }
function normName(s) { return (s || "").trim().replace(/\s+/g, " ").toLowerCase(); }
function flash(set, text, type = "ok") {
  set({ text, type });
  setTimeout(() => set({ text: "", type: "ok" }), 4000);
}

/* ── Shared tiny components ── */
function Spinner() {
  return <div style={{ textAlign: "center", padding: 32, color: PCC.textMuted, fontSize: 14 }}>⏳ Loading…</div>;
}
function Empty({ children }) {
  return <div style={{ textAlign: "center", padding: "32px 0", color: PCC.textMuted, fontSize: 14 }}>{children}</div>;
}
function FlashMsg({ msg }) {
  if (!msg.text) return null;
  const ok = msg.type !== "err";
  return (
    <div style={{
      padding: "10px 16px", borderRadius: 8, fontSize: 13, fontWeight: 500,
      background: ok ? PCC.successBg : PCC.dangerBg,
      color:      ok ? PCC.success   : PCC.danger,
      border: `1px solid ${ok ? PCC.successBdr : PCC.dangerBdr}`,
    }}>{msg.text}</div>
  );
}

/* ══════════════════════════════════════════
   OVERVIEW TAB
══════════════════════════════════════════ */
function OverviewTab() {
  const [overview, setOverview] = useState([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    fetch("/api/overview", { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(d => { setOverview(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  const totalDept  = overview.length;
  const totalInst  = overview.reduce((s, d) => s + d.instructors, 0);
  const totalSec   = overview.reduce((s, d) => s + d.sections, 0);
  const totalSched = overview.reduce((s, d) => s + d.schedBlocks, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
        {[
          { n: totalDept,  label: "Departments",   icon: "🏛", color: PCC.skyBlue },
          { n: totalInst,  label: "Instructors",   icon: "👨‍🏫", color: "#7C3AED"  },
          { n: totalSec,   label: "Sections",      icon: "📁", color: PCC.success  },
          { n: totalSched, label: "Sched Blocks",  icon: "📋", color: PCC.warn     },
        ].map(({ n, label, icon, color }) => (
          <div key={label} style={{ ...card, textAlign: "center", borderTop: `3px solid ${color}` }}>
            <div style={{ fontSize: 11, color: PCC.textMuted, fontWeight: 600, marginBottom: 4 }}>{icon} {label}</div>
            <div style={{ fontSize: 30, fontWeight: 800, color }}>{n}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
        {overview.map(d => {
          const t = getDeptTheme(d.code);
          return (
            <div key={d.id} style={{ ...card, borderTop: `3px solid ${PCC.skyBlue}`, position: "relative", overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <DeptLogo code={t.code} style={{ width: 36, height: 36, objectFit: "contain", borderRadius: 6, background: PCC.offWhite, padding: 4 }} alt={d.code} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: PCC.text }}>{t.emoji} {d.code}</div>
                  <div style={{ fontSize: 10, color: PCC.textMuted, maxWidth: 150 }}>{d.name}</div>
                </div>
              </div>
              {[
                { label: "Instructors",  val: d.instructors  },
                { label: "Sched Blocks", val: d.schedBlocks  },
                { label: "Sections",     val: d.sections     },
              ].map(({ label, val }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: `1px solid ${PCC.border}`, fontSize: 12 }}>
                  <span style={{ color: PCC.textMuted }}>{label}</span>
                  <strong style={{ color: PCC.text }}>{val}</strong>
                </div>
              ))}
              <div style={{ marginTop: 10, fontSize: 11 }}>
                {d.adminAccount
                  ? <span style={{ color: PCC.skyDark, fontWeight: 600 }}>👤 {d.adminAccount.name}</span>
                  : <span style={{ color: PCC.warn, fontWeight: 600 }}>⚠ No admin assigned</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <a href="/api/backup" style={{ padding: "10px 22px", background: PCC.skyBlue, color: PCC.white, border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
          💾 Download Database Backup
        </a>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   DATABASE VIEWER TAB
══════════════════════════════════════════ */
function DatabaseViewerTab() {
  const [activeTable, setActiveTable] = useState("schedules");
  const [schedules,   setSchedules]   = useState([]);
  const [instructors, setInstructors] = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [search,      setSearch]      = useState("");
  const [deptFilter,  setDeptFilter]  = useState("ALL");
  const deptCodes = Object.keys(DEPT_THEMES);

  async function loadData(table) {
    setLoading(true); setSearch("");
    try {
      if (table === "schedules" || table === "all") {
        const r = await fetch("/api/superadmin/schedules", { credentials: "include" });
        if (r.ok) setSchedules(await r.json());
      }
      if (table === "instructors" || table === "all") {
        const r = await fetch("/api/superadmin/instructors", { credentials: "include" });
        if (r.ok) setInstructors(await r.json());
      }
    } catch {}
    setLoading(false);
  }
  useEffect(() => { loadData("all"); }, []);

  const tables = [
    { key: "schedules",   label: "📋 Schedules",   data: schedules   },
    { key: "instructors", label: "👨‍🏫 Instructors", data: instructors },
  ];
  const activeData = tables.find(t => t.key === activeTable)?.data || [];
  const filtered = activeData.filter(row => {
    const matchDept = deptFilter === "ALL" || row.dept_code === deptFilter || row.department === deptFilter;
    if (!matchDept) return false;
    if (!search) return true;
    return Object.values(row).some(v => String(v || "").toLowerCase().includes(search.toLowerCase()));
  });
  const grouped = {};
  for (const row of filtered) {
    const code = row.dept_code || row.department || "Unknown";
    if (!grouped[code]) grouped[code] = [];
    grouped[code].push(row);
  }

  const thS = { padding: "8px 12px", textAlign: "left", color: PCC.textMuted, fontWeight: 700, borderBottom: `2px solid ${PCC.border}`, fontSize: 11, background: PCC.offWhite, whiteSpace: "nowrap" };
  const tdS = { padding: "8px 12px", fontSize: 12, borderBottom: `1px solid ${PCC.border}`, color: PCC.text };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 0, borderBottom: `2px solid ${PCC.border}` }}>
        {tables.map(({ key, label }) => (
          <button key={key} onClick={() => setActiveTable(key)} style={{
            padding: "10px 22px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
            background: "transparent",
            borderBottom: activeTable === key ? `3px solid ${PCC.skyBlue}` : "3px solid transparent",
            color: activeTable === key ? PCC.skyBlue : PCC.textMuted, marginBottom: -2,
          }}>
            {label} <span style={{ marginLeft: 4, background: activeTable === key ? PCC.skyLight : PCC.offWhite, color: activeTable === key ? PCC.skyDark : PCC.textMuted, borderRadius: 20, padding: "1px 8px", fontSize: 10 }}>
              {tables.find(t => t.key === key)?.data?.length || 0}
            </span>
          </button>
        ))}
        <button onClick={() => loadData("all")} style={{ marginLeft: "auto", padding: "8px 16px", background: PCC.offWhite, color: PCC.textMuted, border: `1px solid ${PCC.border}`, borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
          ↻ Refresh
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search any field…"
          style={{ flex: 1, minWidth: 200, padding: "8px 12px", background: PCC.white, border: `1px solid ${PCC.border}`, borderRadius: 8, color: PCC.text, fontSize: 13, outline: "none" }} />
        <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
          style={{ padding: "8px 12px", background: PCC.white, border: `1px solid ${PCC.border}`, borderRadius: 8, color: PCC.text, fontSize: 13, outline: "none" }}>
          <option value="ALL">All Departments</option>
          {deptCodes.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <span style={{ fontSize: 12, color: PCC.textMuted }}>{filtered.length} record{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {loading && <Spinner />}
      {!loading && Object.keys(grouped).length === 0 && <Empty>No records found.</Empty>}

      {!loading && Object.entries(grouped).map(([deptCode, rows]) => {
        const t = getDeptTheme(deptCode);
        return (
          <div key={deptCode} style={{ border: `1px solid ${PCC.border}`, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ background: PCC.skyLight, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, borderBottom: `1px solid ${PCC.border}` }}>
              <DeptLogo code={t.code} style={{ width: 26, height: 26, objectFit: "contain" }} alt={deptCode} />
              <span style={{ color: PCC.skyDeep, fontWeight: 700, fontSize: 13 }}>{t.emoji} {deptCode} — {t.shortName || t.name}</span>
              <span style={{ marginLeft: "auto", background: PCC.skyBlue, color: PCC.white, borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>{rows.length} records</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              {activeTable === "instructors" && (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>{["ID","Name","Department","Email","Subjects"].map(h => <th key={h} style={thS}>{h}</th>)}</tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.id} style={{ background: i % 2 === 0 ? PCC.white : PCC.offWhite }}>
                        <td style={{ ...tdS, color: PCC.textMuted }}>{r.id}</td>
                        <td style={{ ...tdS, fontWeight: 700 }}>{r.name}</td>
                        <td style={tdS}><span style={{ background: PCC.skyLight, color: PCC.skyDark, borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{r.department}</span></td>
                        <td style={{ ...tdS, color: PCC.textMuted }}>{r.email || "—"}</td>
                        <td style={{ ...tdS, color: PCC.textMuted }}>{r.subject_count || 0} subjects</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {activeTable === "schedules" && (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>{["ID","Instructor","Subject","Section","Day","Time","Room","Type"].map(h => <th key={h} style={thS}>{h}</th>)}</tr></thead>
                  <tbody>
                    {rows.filter(r => !r.is_break).map((r, i) => (
                      <tr key={r.id} style={{ background: i % 2 === 0 ? PCC.white : PCC.offWhite }}>
                        <td style={{ ...tdS, color: PCC.textMuted }}>{r.id}</td>
                        <td style={{ ...tdS, fontWeight: 700 }}>{r.instructor}</td>
                        <td style={{ ...tdS, color: PCC.skyDark, fontWeight: 600 }}>{r.subject}</td>
                        <td style={tdS}>{r.section || "—"}</td>
                        <td style={tdS}>{r.day}</td>
                        <td style={{ ...tdS, whiteSpace: "nowrap" }}>{fmtRange(r.start, r.end)}</td>
                        <td style={tdS}>{r.room}</td>
                        <td style={tdS}>
                          <span style={{ background: r.roomType === "Laboratory" ? "#EDE9FE" : "#ECFDF5", color: r.roomType === "Laboratory" ? "#7C3AED" : "#065F46", borderRadius: 20, padding: "2px 8px", fontSize: 10, fontWeight: 700 }}>
                            {r.roomType === "Laboratory" ? "🔬 Lab" : "📖 Lec"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════════
   CONFLICT DETECTOR TAB  (SA Exclusive)
══════════════════════════════════════════ */
function ConflictDetectorTab() {
  const [conflicts, setConflicts] = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [scanned,   setScanned]   = useState(false);
  const [filter,    setFilter]    = useState("all");

  async function runScan() {
    setLoading(true); setConflicts([]); setScanned(false);
    try {
      const r   = await fetch("/api/superadmin/schedules", { credentials: "include" });
      const all = (r.ok ? await r.json() : []).filter(b => !b.is_break && b.room && b.day);
      const found = [];

      const byRoomDay = {};
      for (const b of all) {
        const key = `${normName(b.room)}::${b.day}`;
        if (!byRoomDay[key]) byRoomDay[key] = [];
        byRoomDay[key].push(b);
      }
      for (const [, blocks] of Object.entries(byRoomDay)) {
        for (let i = 0; i < blocks.length; i++) {
          for (let j = i + 1; j < blocks.length; j++) {
            const a = blocks[i], b = blocks[j];
            if (a.start < b.end && b.start < a.end)
              found.push({ type: "room", severity: a.dept_code !== b.dept_code ? "critical" : "warning", blockA: a, blockB: b, crossDept: a.dept_code !== b.dept_code, label: `Room "${a.room}" double-booked on ${a.day}`, detail: `${fmtRange(a.start, a.end)} vs ${fmtRange(b.start, b.end)}` });
          }
        }
      }

      const byInstDay = {};
      for (const b of all) {
        if (!b.instructor) continue;
        const key = `${normName(b.instructor)}::${b.day}`;
        if (!byInstDay[key]) byInstDay[key] = [];
        byInstDay[key].push(b);
      }
      for (const [, blocks] of Object.entries(byInstDay)) {
        for (let i = 0; i < blocks.length; i++) {
          for (let j = i + 1; j < blocks.length; j++) {
            const a = blocks[i], b = blocks[j];
            if (normName(a.subject) === normName(b.subject) && normName(a.room) === normName(b.room)) continue;
            if (a.start < b.end && b.start < a.end)
              found.push({ type: "instructor", severity: a.dept_code !== b.dept_code ? "critical" : "warning", blockA: a, blockB: b, crossDept: a.dept_code !== b.dept_code, label: `"${a.instructor}" scheduled twice on ${a.day}`, detail: `${fmtRange(a.start, a.end)} (${a.subject} @ ${a.room}) vs ${fmtRange(b.start, b.end)} (${b.subject} @ ${b.room})` });
          }
        }
      }
      setConflicts(found);
    } catch (e) { console.error(e); }
    setScanned(true); setLoading(false);
  }

  const displayed = conflicts.filter(c => filter === "all" || c.type === filter);
  const criticals = conflicts.filter(c => c.severity === "critical").length;
  const warnings  = conflicts.filter(c => c.severity === "warning").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ ...card, display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap", borderTop: `3px solid ${PCC.skyBlue}` }}>
        <div style={{ fontSize: 36 }}>🔍</div>
        <div style={{ flex: 1 }}>
          <div style={{ color: PCC.text, fontWeight: 800, fontSize: 15 }}>College-Wide Conflict Detector</div>
          <div style={{ color: PCC.textMuted, fontSize: 12, marginTop: 3 }}>Scans ALL departments' instructor schedules for room double-bookings and time overlaps — including cross-department conflicts.</div>
        </div>
        <button onClick={runScan} disabled={loading} style={{ padding: "12px 28px", background: loading ? "#CBD5E1" : PCC.skyBlue, color: PCC.white, border: "none", borderRadius: 10, cursor: loading ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 700, whiteSpace: "nowrap" }}>
          {loading ? "⏳ Scanning…" : "▶ Run Full Scan"}
        </button>
      </div>

      {scanned && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
          {[
            { n: conflicts.length, label: "Total Conflicts",      color: PCC.skyBlue },
            { n: criticals,        label: "Critical Cross-Dept",  color: PCC.danger  },
            { n: warnings,         label: "Same-Dept Warnings",   color: PCC.warn    },
          ].map(({ n, label, color }) => (
            <div key={label} style={{ ...card, textAlign: "center", borderTop: `3px solid ${color}` }}>
              <div style={{ fontSize: 28, fontWeight: 800, color }}>{n}</div>
              <div style={{ fontSize: 11, color: PCC.textMuted, marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {scanned && conflicts.length > 0 && (
        <div style={{ display: "flex", gap: 8 }}>
          {[{ k: "all", l: "All" }, { k: "room", l: "🏫 Room" }, { k: "instructor", l: "👨‍🏫 Instructor" }].map(({ k, l }) => (
            <button key={k} onClick={() => setFilter(k)} style={{ padding: "7px 16px", border: `1px solid ${filter === k ? PCC.skyBlue : PCC.border}`, background: filter === k ? PCC.skyLight : PCC.white, color: filter === k ? PCC.skyDark : PCC.textMuted, borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>{l}</button>
          ))}
        </div>
      )}

      {scanned && conflicts.length === 0 && (
        <div style={{ background: PCC.successBg, border: `1px solid ${PCC.successBdr}`, borderRadius: 12, padding: 28, textAlign: "center" }}>
          <div style={{ fontSize: 36 }}>✅</div>
          <div style={{ color: PCC.success, fontWeight: 700, fontSize: 16, marginTop: 8 }}>No Conflicts Found!</div>
          <div style={{ color: PCC.textMuted, fontSize: 13, marginTop: 4 }}>All instructor schedules are conflict-free.</div>
        </div>
      )}

      {scanned && displayed.map((c, i) => {
        const isCrit = c.severity === "critical";
        const tA = getDeptTheme(c.blockA.dept_code || "");
        const tB = getDeptTheme(c.blockB.dept_code || "");
        return (
          <div key={i} style={{ background: isCrit ? PCC.dangerBg : PCC.warnBg, border: `1px solid ${isCrit ? PCC.dangerBdr : PCC.warnBdr}`, borderRadius: 10, padding: "14px 18px", borderLeft: `4px solid ${isCrit ? PCC.danger : PCC.warn}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
              <span style={{ background: isCrit ? PCC.danger : PCC.warn, color: PCC.white, borderRadius: 20, padding: "2px 10px", fontSize: 10, fontWeight: 800 }}>{isCrit ? "🚨 CRITICAL" : "⚠ WARNING"}</span>
              {c.crossDept && <span style={{ background: "#EDE9FE", color: "#7C3AED", border: "1px solid #C4B5FD", borderRadius: 20, padding: "2px 10px", fontSize: 10, fontWeight: 700 }}>🌐 CROSS-DEPT</span>}
              <span style={{ color: PCC.text, fontWeight: 700, fontSize: 13 }}>{c.label}</span>
            </div>
            <div style={{ color: PCC.textMuted, fontSize: 12, marginBottom: 10 }}>{c.detail}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 10, alignItems: "center" }}>
              <ConflictBlock block={c.blockA} theme={tA} />
              <div style={{ color: PCC.danger, fontWeight: 900, fontSize: 18, textAlign: "center" }}>⟷</div>
              <ConflictBlock block={c.blockB} theme={tB} />
            </div>
          </div>
        );
      })}

      {!scanned && !loading && <Empty>Press ▶ Run Full Scan to detect conflicts across all departments.</Empty>}
    </div>
  );
}

function ConflictBlock({ block, theme }) {
  return (
    <div style={{ background: PCC.white, border: `1px solid ${PCC.border}`, borderRadius: 8, padding: "10px 14px", fontSize: 11 }}>
      {theme && <div style={{ marginBottom: 4 }}><span style={{ background: PCC.skyLight, color: PCC.skyDark, borderRadius: 20, padding: "1px 8px", fontSize: 10, fontWeight: 700 }}>{theme.emoji} {block.dept_code}</span></div>}
      <div style={{ color: PCC.text, fontWeight: 700 }}>{block.subject || "—"}</div>
      <div style={{ color: PCC.textMuted, marginTop: 2 }}>{block.instructor || "—"}</div>
      <div style={{ color: PCC.skyDark, marginTop: 2 }}>🏫 {block.room}</div>
      <div style={{ color: PCC.textMuted, marginTop: 2 }}>⏰ {fmtRange(block.start, block.end)}</div>
    </div>
  );
}

/* ══════════════════════════════════════════
   ANALYTICS TAB  (SA Exclusive)
══════════════════════════════════════════ */
function AnalyticsTab() {
  const [schedules, setSchedules] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [selDept,   setSelDept]   = useState("ALL");

  useEffect(() => {
    fetch("/api/superadmin/schedules", { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(d => { setSchedules(Array.isArray(d) ? d.filter(b => !b.is_break) : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  const src = selDept === "ALL" ? schedules : schedules.filter(b => b.dept_code === selDept || b.department === selDept);
  const displayHours = Array.from({ length: 12 }, (_, i) => 8 + i);

  const heatmap = {};
  for (const day of DAYS) { heatmap[day] = {}; for (const h of displayHours) heatmap[day][h] = 0; }
  for (const b of src) {
    if (!b.day || b.start == null || b.end == null) continue;
    for (let h = Math.floor(b.start); h < b.end; h += 0.5) {
      const slot = Math.floor(h);
      if (heatmap[b.day] && heatmap[b.day][slot] !== undefined) heatmap[b.day][slot] += 0.5;
    }
  }
  const maxHeat = Math.max(1, ...DAYS.flatMap(d => displayHours.map(h => heatmap[d][h])));

  const deptLoad = {};
  for (const b of src) { const code = b.dept_code || b.department || "Unknown"; deptLoad[code] = (deptLoad[code] || 0) + (b.end - b.start); }
  const deptLoadSorted = Object.entries(deptLoad).sort((a, b) => b[1] - a[1]);
  const maxLoad = Math.max(1, ...deptLoadSorted.map(([, v]) => v));

  const roomLoad = {};
  for (const b of src) { if (!b.room) continue; roomLoad[b.room] = (roomLoad[b.room] || 0) + (b.end - b.start); }
  const topRooms = Object.entries(roomLoad).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const hourTotals = {};
  for (const h of displayHours) hourTotals[h] = DAYS.reduce((s, d) => s + (heatmap[d][h] || 0), 0);
  const peakHour = displayHours.reduce((best, h) => hourTotals[h] > hourTotals[best] ? h : best, displayHours[0]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div style={{ fontWeight: 700, color: PCC.text, fontSize: 13 }}>📊 Analytics — Instructor Schedule Data</div>
        <select value={selDept} onChange={e => setSelDept(e.target.value)}
          style={{ padding: "7px 12px", background: PCC.white, border: `1px solid ${PCC.border}`, borderRadius: 8, color: PCC.text, fontSize: 13, outline: "none", marginLeft: "auto" }}>
          <option value="ALL">All Departments</option>
          {Object.keys(DEPT_THEMES).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
        {[
          { icon: "⏰", label: "Peak Hour",    val: fmtH(peakHour),                                       color: PCC.skyBlue },
          { icon: "🏫", label: "Rooms Used",   val: Object.keys(roomLoad).length,                          color: "#7C3AED"   },
          { icon: "📋", label: "Total Blocks", val: src.length,                                            color: PCC.success  },
          { icon: "⏱",  label: "Total Hours",  val: `${src.reduce((s, b) => s + (b.end - b.start), 0)}h`, color: PCC.warn     },
        ].map(({ icon, label, val, color }) => (
          <div key={label} style={{ ...card, textAlign: "center", borderTop: `3px solid ${color}` }}>
            <div style={{ fontSize: 20, fontWeight: 800, color }}>{icon} {val}</div>
            <div style={{ fontSize: 11, color: PCC.textMuted, marginTop: 3 }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ ...card }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: PCC.text, marginBottom: 14 }}>🗓 Room Occupancy Heatmap</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "separate", borderSpacing: 3, fontSize: 10, minWidth: 500 }}>
            <thead>
              <tr>
                <th style={{ width: 60, color: PCC.textMuted, textAlign: "right", paddingRight: 8, fontWeight: 600 }}>Hour</th>
                {DAYS.map(d => <th key={d} style={{ color: PCC.textMuted, fontWeight: 700, textAlign: "center", minWidth: 62, padding: "4px 0" }}>{d.slice(0, 3)}</th>)}
              </tr>
            </thead>
            <tbody>
              {displayHours.map(h => (
                <tr key={h}>
                  <td style={{ color: PCC.textMuted, textAlign: "right", paddingRight: 8, fontWeight: 600, whiteSpace: "nowrap", verticalAlign: "middle" }}>{fmtH(h)}</td>
                  {DAYS.map(d => {
                    const val   = heatmap[d][h] || 0;
                    const ratio = val / maxHeat;
                    const bg    = val === 0 ? PCC.offWhite : `rgba(14,165,233,${0.15 + ratio * 0.85})`;
                    return (
                      <td key={d} title={`${d} ${fmtH(h)}: ${val}h`}
                        style={{ background: bg, borderRadius: 4, width: 62, height: 28, textAlign: "center", color: ratio > 0.5 ? PCC.white : PCC.skyDark, fontWeight: 700, cursor: "default" }}>
                        {val > 0 ? `${val}h` : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, fontSize: 11, color: PCC.textMuted }}>
          <span>Low</span>
          {[0.15, 0.35, 0.55, 0.75, 0.95].map(r => <div key={r} style={{ width: 20, height: 12, borderRadius: 2, background: `rgba(14,165,233,${r})` }} />)}
          <span>High</span>
        </div>
      </div>

      <div style={{ ...card }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: PCC.text, marginBottom: 14 }}>📊 Department Scheduling Load</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {deptLoadSorted.map(([code, hours]) => {
            const t = getDeptTheme(code);
            return (
              <div key={code} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 55, fontSize: 11, fontWeight: 700, color: PCC.skyDark, textAlign: "right", whiteSpace: "nowrap" }}>{t.emoji} {code}</div>
                <div style={{ flex: 1, background: PCC.offWhite, borderRadius: 20, height: 22, overflow: "hidden", border: `1px solid ${PCC.border}` }}>
                  <div style={{ height: "100%", width: `${(hours / maxLoad) * 100}%`, background: `linear-gradient(90deg,${PCC.skyBlue},${PCC.skyMid})`, borderRadius: 20, display: "flex", alignItems: "center", paddingLeft: 8, minWidth: 30 }}>
                    <span style={{ color: PCC.white, fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>{hours}h</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ ...card }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: PCC.text, marginBottom: 14 }}>🏆 Most-Used Rooms</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {topRooms.map(([room, hours], i) => (
            <div key={room} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 24, fontSize: 12, fontWeight: 800, color: i === 0 ? "#F59E0B" : i === 1 ? "#94A3B8" : i === 2 ? "#B45309" : PCC.textMuted, textAlign: "center" }}>
                {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}
              </div>
              <div style={{ width: 130, fontSize: 12, color: PCC.text, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{room}</div>
              <div style={{ flex: 1, background: PCC.offWhite, borderRadius: 20, height: 14, border: `1px solid ${PCC.border}` }}>
                <div style={{ height: "100%", width: `${(hours / topRooms[0][1]) * 100}%`, background: PCC.skyBlue, borderRadius: 20 }} />
              </div>
              <div style={{ width: 40, fontSize: 11, color: PCC.textMuted, textAlign: "right", fontWeight: 600 }}>{hours}h</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   ACCOUNTS TAB
══════════════════════════════════════════ */
function AccountsTab() {
  const [accounts, setAccounts] = useState([]);
  const [depts,    setDepts]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [msg,      setMsg]      = useState({ text: "", type: "ok" });
  const [showForm, setShowForm] = useState(false);
  const [editId,   setEditId]   = useState(null);
  const [fName,  setFName]  = useState("");
  const [fEmail, setFEmail] = useState("");
  const [fPin,   setFPin]   = useState("");
  const [fPass,  setFPass]  = useState("");
  const [fDept,  setFDept]  = useState("");
  const [fRole,  setFRole]  = useState("dept_admin");
  const [saving, setSaving] = useState(false);

  const inpStyle = { padding: "9px 12px", border: `1px solid ${PCC.border}`, borderRadius: 8, fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box", color: PCC.text, background: PCC.white };

  async function load() {
    setLoading(true);
    try {
      const [aRes, dRes] = await Promise.all([
        fetch("/api/admin-accounts", { credentials: "include" }),
        fetch("/api/departments",    { credentials: "include" }),
      ]);
      if (aRes.ok) setAccounts(await aRes.json());
      if (dRes.ok) setDepts(await dRes.json());
    } catch {}
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function resetForm() { setFName(""); setFEmail(""); setFPin(""); setFPass(""); setFDept(""); setFRole("dept_admin"); setEditId(null); setShowForm(false); }

  async function handleSave() {
    if (!editId && (!fName || !fEmail || !fPin || !fPass)) return flash(setMsg, "All fields required.", "err");
    if (fRole === "dept_admin" && !fDept) return flash(setMsg, "Select a department.", "err");
    setSaving(true);
    try {
      const url    = editId ? `/api/admin-accounts/${editId}` : "/api/admin-accounts";
      const method = editId ? "PUT" : "POST";
      const body   = editId
        ? { name: fName || undefined, pin: fPin || undefined, password: fPass || undefined, department_id: fDept || undefined }
        : { name: fName, email: fEmail, pin: fPin, password: fPass, department_id: fDept || null, role: fRole };
      const res  = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { flash(setMsg, data.error || "Failed.", "err"); setSaving(false); return; }
      flash(setMsg, editId ? "✓ Account updated." : "✓ Account created.");
      resetForm(); await load();
    } catch { flash(setMsg, "Network error.", "err"); }
    setSaving(false);
  }

  async function handleDelete(id, name) {
    if (!window.confirm(`Delete account for "${name}"?`)) return;
    const res = await fetch(`/api/admin-accounts/${id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) { flash(setMsg, `✓ "${name}" deleted.`); await load(); }
    else { const d = await res.json(); flash(setMsg, d.error || "Failed.", "err"); }
  }

  async function handleUnlock(id, name) {
    const res = await fetch(`/api/admin-accounts/${id}/unlock`, { method: "POST", credentials: "include" });
    if (res.ok) { flash(setMsg, `✓ "${name}" unlocked.`); await load(); }
  }

  function startEdit(acc) {
    setEditId(acc.id); setFName(acc.name); setFEmail(acc.email);
    setFPin(""); setFPass(""); setFDept(acc.department_id || ""); setFRole(acc.role);
    setShowForm(true);
  }

  if (loading) return <Spinner />;

  const superAdmins = accounts.filter(a => a.role === "superadmin");
  const deptAdmins  = accounts.filter(a => a.role === "dept_admin");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <FlashMsg msg={msg} />
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={() => showForm ? resetForm() : setShowForm(true)}
          style={{ padding: "10px 20px", background: showForm ? "#F1F5F9" : PCC.skyBlue, color: showForm ? PCC.textMuted : PCC.white, border: `1px solid ${PCC.border}`, borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
          {showForm ? "✕ Cancel" : "➕ Add Account"}
        </button>
      </div>

      {showForm && (
        <div style={{ ...card }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: PCC.skyDark, marginBottom: 14 }}>{editId ? "✏ Edit Account" : "➕ New Admin Account"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div><label style={{ fontSize: 12, fontWeight: 600, color: PCC.textMuted }}>Full Name *</label><input style={inpStyle} value={fName} onChange={e => setFName(e.target.value)} placeholder="e.g. Maria Santos" /></div>
            <div><label style={{ fontSize: 12, fontWeight: 600, color: PCC.textMuted }}>Email *</label><input style={inpStyle} value={fEmail} onChange={e => setFEmail(e.target.value)} placeholder="admin@pcc.edu.ph" disabled={!!editId} /></div>
            <div><label style={{ fontSize: 12, fontWeight: 600, color: PCC.textMuted }}>PIN *</label><input style={inpStyle} type="password" value={fPin} onChange={e => setFPin(e.target.value)} placeholder="System PIN" maxLength={12} /></div>
            <div><label style={{ fontSize: 12, fontWeight: 600, color: PCC.textMuted }}>Password *</label><input style={inpStyle} type="password" value={fPass} onChange={e => setFPass(e.target.value)} placeholder="Strong password" /></div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: PCC.textMuted }}>Role *</label>
              <select style={inpStyle} value={fRole} onChange={e => setFRole(e.target.value)}>
                <option value="dept_admin">Department Admin</option>
                <option value="superadmin">Super Admin</option>
              </select>
            </div>
            {fRole === "dept_admin" && (
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: PCC.textMuted }}>Department *</label>
                <select style={inpStyle} value={fDept} onChange={e => setFDept(e.target.value)}>
                  <option value="">— Select Department —</option>
                  {depts.map(d => { const t = getDeptTheme(d.code); return <option key={d.id} value={d.id}>{t.emoji} {d.code} — {d.name}</option>; })}
                </select>
              </div>
            )}
          </div>
          <button style={{ padding: "10px 20px", background: PCC.skyBlue, color: PCC.white, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 }} onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : editId ? "✓ Update Account" : "✓ Create Account"}
          </button>
        </div>
      )}

      {superAdmins.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: PCC.skyDark, marginBottom: 8 }}>🛡 Super Admins</div>
          {superAdmins.map(acc => <AccountRow key={acc.id} acc={acc} onEdit={startEdit} onDelete={handleDelete} onUnlock={handleUnlock} theme={null} />)}
        </div>
      )}

      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: PCC.textMuted, marginBottom: 8 }}>👤 Department Admins</div>
        {deptAdmins.length === 0
          ? <Empty>No department admins yet.</Empty>
          : deptAdmins.map(acc => {
              const t = getDeptTheme(acc.dept_code);
              return <AccountRow key={acc.id} acc={acc} onEdit={startEdit} onDelete={handleDelete} onUnlock={handleUnlock} theme={t} />;
            })}
      </div>

      {(() => {
        const assigned = new Set(deptAdmins.filter(a => a.department_id).map(a => a.department_id));
        const unassigned = depts.filter(d => !assigned.has(d.id));
        if (!unassigned.length) return null;
        return (
          <div style={{ background: PCC.warnBg, border: `1px solid ${PCC.warnBdr}`, borderRadius: 10, padding: "14px 18px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: PCC.warn, marginBottom: 8 }}>⚠ Departments Without Admin</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {unassigned.map(d => { const t = getDeptTheme(d.code); return <span key={d.id} style={{ background: PCC.skyLight, color: PCC.skyDark, borderRadius: 20, padding: "4px 14px", fontSize: 12, fontWeight: 700 }}>{t.emoji} {d.code}</span>; })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function AccountRow({ acc, onEdit, onDelete, onUnlock, theme }) {
  const isLocked = acc.locked_until > Math.floor(Date.now() / 1000);
  return (
    <div style={{ background: PCC.white, border: `1px solid ${PCC.border}`, borderRadius: 10, padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 8, borderLeft: `4px solid ${PCC.skyBlue}` }}>
      <div style={{ paddingLeft: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: PCC.text }}>{acc.name}</div>
        <div style={{ fontSize: 12, color: PCC.textMuted, marginTop: 2 }}>{acc.email}</div>
        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
          <span style={{ background: acc.role === "superadmin" ? "#FEF3C7" : PCC.skyLight, color: acc.role === "superadmin" ? "#92400E" : PCC.skyDark, borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>
            {acc.role === "superadmin" ? "🛡 Super Admin" : `${theme?.emoji || "👤"} ${acc.dept_code || "Dept"} Admin`}
          </span>
          {acc.dept_name && <span style={{ color: PCC.textMuted, fontSize: 11 }}>{acc.dept_name}</span>}
          {isLocked && <span style={{ background: PCC.dangerBg, color: PCC.danger, border: `1px solid ${PCC.dangerBdr}`, borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>🔒 Locked</span>}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {isLocked && <button style={{ padding: "6px 14px", background: PCC.successBg, color: PCC.success, border: `1px solid ${PCC.successBdr}`, borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }} onClick={() => onUnlock(acc.id, acc.name)}>🔓 Unlock</button>}
        <button style={{ padding: "6px 14px", background: PCC.offWhite, color: PCC.textMuted, border: `1px solid ${PCC.border}`, borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }} onClick={() => onEdit(acc)}>✏ Edit</button>
        <button style={{ padding: "6px 14px", background: PCC.dangerBg, color: PCC.danger, border: `1px solid ${PCC.dangerBdr}`, borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }} onClick={() => onDelete(acc.id, acc.name)}>🗑</button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   MAIN EXPORT
══════════════════════════════════════════ */
export default function SuperAdminPanel() {
  const auth = useAuth();
  const [tab, setTab] = useState("overview");

  if (!auth?.isSuperAdmin) {
    return <div style={{ padding: 32, color: PCC.danger, fontWeight: 700 }}>⛔ Super admin access required.</div>;
  }

  const tabs = [
    { key: "overview",  label: "📊 Overview",         exclusive: false },
    { key: "database",  label: "🗄 Database",          exclusive: false },
    { key: "accounts",  label: "👤 Accounts",          exclusive: false },
    { key: "conflicts", label: "🔍 Conflict Detector", exclusive: true  },
    { key: "analytics", label: "📈 Analytics",         exclusive: true  },
  ];

  return (
    <div style={{ background: PCC.offWhite, padding: 24, width: "100vw", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 20, minHeight: "100%" }}>

      {/* ── HEADER ── */}
      <div style={{
        background: `linear-gradient(135deg, ${PCC.skyDeep} 0%, ${PCC.skyDark} 60%, ${PCC.skyBlue} 100%)`,
        borderRadius: 12,
        padding: "20px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        width: "100%",
        boxSizing: "border-box",
      }}>
        {/* Top row: logo + title + admin badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <img src={PCCLogo} style={{ width: 52, height: 52, objectFit: "contain", background: PCC.white, borderRadius: 10, padding: 4, flexShrink: 0 }} alt="PCC" />
          <div style={{ flex: 1 }}>
            <div style={{ color: PCC.white, fontWeight: 900, fontSize: 20, letterSpacing: -0.5 }}>
              SmartSched
              <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 600, background: "rgba(255,255,255,0.18)", borderRadius: 20, padding: "3px 12px", letterSpacing: 0 }}>Centralized Dashboard</span>
            </div>
            <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 3 }}>Passi City College — College-Wide Scheduling System · All Departments</div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ background: "rgba(255,255,255,0.15)", color: PCC.white, borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 700 }}>🛡 {auth.name}</div>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, marginTop: 4 }}>Super Administrator</div>
          </div>
        </div>

        {/* Bottom row: dept logos — full width, evenly spaced */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.15)", paddingTop: 14 }}>
          <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
            Centralized Access — All Departments
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Object.values(DEPT_THEMES).length}, 1fr)`,
            gap: 8,
          }}>
            {Object.values(DEPT_THEMES).map(t => (
              <div key={t.code} title={t.name} style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                background: "rgba(255,255,255,0.12)",
                borderRadius: 10,
                padding: "10px 8px",
                border: "1px solid rgba(255,255,255,0.18)",
                cursor: "default",
              }}>
                <DeptLogo code={t.code} style={{ width: 34, height: 34, objectFit: "contain" }} alt={t.code} />
                <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.9)", textAlign: "center", lineHeight: 1.2 }}>{t.code}</span>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.55)", textAlign: "center", lineHeight: 1.2, maxWidth: 80 }}>{t.shortName || t.name?.split(" ").slice(0, 2).join(" ")}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── TABS ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        <div style={{ display: "flex", gap: 0, borderBottom: `2px solid ${PCC.border}`, flexWrap: "wrap" }}>
          {tabs.filter(t => !t.exclusive).map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)} style={{ padding: "10px 20px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: "transparent", borderBottom: tab === key ? `3px solid ${PCC.skyBlue}` : "3px solid transparent", color: tab === key ? PCC.skyBlue : PCC.textMuted, marginBottom: -2 }}>
              {label}
            </button>
          ))}
          <div style={{ width: 1, background: PCC.border, margin: "6px 4px" }} />
          {tabs.filter(t => t.exclusive).map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)} style={{ padding: "10px 16px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: "transparent", borderBottom: tab === key ? `3px solid ${PCC.skyBlue}` : "3px solid transparent", color: tab === key ? PCC.skyBlue : PCC.textMuted, marginBottom: -2, display: "flex", alignItems: "center", gap: 5 }}>
              {label}
              <span style={{ fontSize: 9, background: PCC.skyLight, color: PCC.skyDark, border: `1px solid ${PCC.border}`, borderRadius: 20, padding: "1px 6px", fontWeight: 800 }}>SA</span>
            </button>
          ))}
        </div>
        {tabs.find(t => t.key === tab)?.exclusive && (
          <div style={{ background: PCC.skyLight, border: `1px solid ${PCC.border}`, borderTop: "none", borderRadius: "0 0 8px 8px", padding: "5px 14px", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: PCC.skyDark, fontWeight: 700 }}>🛡 SuperAdmin Exclusive Feature</span>
            <span style={{ fontSize: 11, color: PCC.textMuted }}>— Only accessible by Super Admins</span>
          </div>
        )}
      </div>

      {/* ── CONTENT ── */}
      {tab === "overview"  && <OverviewTab />}
      {tab === "database"  && <DatabaseViewerTab />}
      {tab === "accounts"  && <AccountsTab />}
      {tab === "conflicts" && <ConflictDetectorTab />}
      {tab === "analytics" && <AnalyticsTab />}
    </div>
  );
}