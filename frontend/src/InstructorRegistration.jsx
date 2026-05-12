import { useState, useEffect } from "react";

function normName(s) {
  return (s || "").trim().replace(/\s+/g, " ").toLowerCase();
}

const DEPT_DESIGNS = {
  BSIT: {
    accent: "#6366f1", accentDark: "#4f46e5", accentSoft: "#eef2ff", accentMid: "#c7d2fe",
    icon: "💻", label: "Information Technology", tagline: "Code the future",
    headerStyle: { background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%)", color: "#fff" },
    cardBorder: "2px solid #6366f1", inputFocus: "#6366f1", addBtnBg: "#4f46e5", addBtnHover: "#4338ca",
    pattern: "repeating-linear-gradient(45deg,transparent,transparent 10px,rgba(99,102,241,0.04) 10px,rgba(99,102,241,0.04) 20px)",
  },
  CRIM: {
    accent: "#0f172a", accentDark: "#1e293b", accentSoft: "#f8fafc", accentMid: "#cbd5e1",
    icon: "⚖️", label: "Criminology", tagline: "Justice. Order. Service.",
    headerStyle: { background: "linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #334155 100%)", color: "#e2e8f0" },
    cardBorder: "2px solid #334155", inputFocus: "#334155", addBtnBg: "#1e293b", addBtnHover: "#0f172a",
    pattern: "repeating-linear-gradient(90deg,transparent,transparent 20px,rgba(15,23,42,0.03) 20px,rgba(15,23,42,0.03) 21px)",
  },
  BSBA: {
    accent: "#047857", accentDark: "#065f46", accentSoft: "#ecfdf5", accentMid: "#a7f3d0",
    icon: "📈", label: "Business Administration", tagline: "Lead. Grow. Succeed.",
    headerStyle: { background: "linear-gradient(135deg, #022c22 0%, #065f46 50%, #047857 100%)", color: "#d1fae5" },
    cardBorder: "2px solid #059669", inputFocus: "#059669", addBtnBg: "#047857", addBtnHover: "#065f46",
    pattern: "radial-gradient(circle at 20px 20px, rgba(4,120,87,0.05) 1px, transparent 1px)",
    patternSize: "40px 40px",
  },
  BSHM: {
    accent: "#b45309", accentDark: "#92400e", accentSoft: "#fffbeb", accentMid: "#fde68a",
    icon: "🏨", label: "Hospitality Management", tagline: "Excellence in Service",
    headerStyle: { background: "linear-gradient(135deg, #451a03 0%, #92400e 50%, #b45309 100%)", color: "#fef3c7" },
    cardBorder: "2px solid #d97706", inputFocus: "#d97706", addBtnBg: "#b45309", addBtnHover: "#92400e",
    pattern: "repeating-linear-gradient(-45deg,transparent,transparent 8px,rgba(180,83,9,0.04) 8px,rgba(180,83,9,0.04) 16px)",
  },
  BSED: {
    accent: "#0284c7", accentDark: "#0369a1", accentSoft: "#f0f9ff", accentMid: "#bae6fd",
    icon: "🎓", label: "Secondary Education", tagline: "Inspire. Educate. Transform.",
    headerStyle: { background: "linear-gradient(135deg, #0c4a6e 0%, #0369a1 50%, #0284c7 100%)", color: "#e0f2fe" },
    cardBorder: "2px solid #0ea5e9", inputFocus: "#0ea5e9", addBtnBg: "#0284c7", addBtnHover: "#0369a1",
    pattern: "radial-gradient(circle at 15px 15px, rgba(2,132,199,0.06) 2px, transparent 2px)",
    patternSize: "30px 30px",
  },
  BEED: {
    accent: "#be185d", accentDark: "#9d174d", accentSoft: "#fdf2f8", accentMid: "#fbcfe8",
    icon: "🌟", label: "Elementary Education", tagline: "Every child, every future.",
    headerStyle: { background: "linear-gradient(135deg, #500724 0%, #9d174d 50%, #be185d 100%)", color: "#fce7f3" },
    cardBorder: "2px solid #db2777", inputFocus: "#db2777", addBtnBg: "#be185d", addBtnHover: "#9d174d",
    pattern: "radial-gradient(circle at 10px 10px, rgba(190,24,93,0.05) 2px, transparent 2px),radial-gradient(circle at 30px 30px, rgba(190,24,93,0.05) 2px, transparent 2px)",
    patternSize: "40px 40px",
  },
};

function getDeptDesign(code) {
  if (!code) return DEPT_DESIGNS.BSIT;
  return DEPT_DESIGNS[code.toUpperCase()] || DEPT_DESIGNS.BSIT;
}

export default function InstructorRegistration({ theme }) {
  const code = theme?.code || "BSIT";
  const D    = getDeptDesign(code);

  const [instructors,   setInstructors]   = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [msg,           setMsg]           = useState({ text: "", type: "ok" });
  const [newName,       setNewName]       = useState("");
  const [newDept,       setNewDept]       = useState(code);
  const [newEmail,      setNewEmail]      = useState("");
  const [subjectInputs, setSubjectInputs] = useState({});
  const [search,        setSearch]        = useState("");
  const [expandedId,    setExpandedId]    = useState(null);

  function flash(text, type = "ok") {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text: "", type: "ok" }), 4000);
  }

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/instructor-registration", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setInstructors(data);
      }
    } catch {}
    if (!silent) setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function addInstructor() {
    if (!newName.trim()) return flash("Please enter a name.", "err");
    const dupe = instructors.find(i => normName(i.name) === normName(newName));
    if (dupe) return flash(`"${dupe.name}" is already registered.`, "err");
    setSaving(true);
    try {
      const res = await fetch("/api/instructor-registration", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), department: newDept.trim(), email: newEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { flash(data.error || "Failed to add.", "err"); setSaving(false); return; }
      flash(`✓ "${data.name}" registered.`);
      setNewName(""); setNewEmail("");
      setExpandedId(data.id);
      await load(true);
    } catch { flash("Network error.", "err"); }
    setSaving(false);
  }

  async function addSubject(instructorId, instructorName) {
    const raw = (subjectInputs[instructorId] || "").trim();
    if (!raw) return flash("Type a subject name first.", "err");
    const inst = instructors.find(i => i.id === instructorId);
    if (inst?.subjects?.some(s => normName(s.subject_name) === normName(raw)))
      return flash(`"${raw}" is already assigned to ${instructorName}.`, "err");
    setSaving(true);
    try {
      const res = await fetch(`/api/instructor-registration/${instructorId}/subjects`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject_name: raw }),
      });
      const data = await res.json();
      if (!res.ok) { flash(data.error || "Failed.", "err"); setSaving(false); return; }
      flash(`✓ "${raw}" added to ${instructorName}.`);
      setSubjectInputs(prev => ({ ...prev, [instructorId]: "" }));
      await load(true);
    } catch { flash("Network error.", "err"); }
    setSaving(false);
  }

  async function removeSubject(subjectId, subjectName, instructorName) {
    if (!window.confirm(`Remove "${subjectName}" from ${instructorName}?`)) return;
    try {
      const res = await fetch(`/api/instructor-registration/subjects/${subjectId}`, {
        method: "DELETE", credentials: "include",
      });
      if (!res.ok) return flash("Failed to remove subject.", "err");
      flash(`✓ "${subjectName}" removed.`);
      await load(true);
    } catch { flash("Network error.", "err"); }
  }

  async function deleteInstructor(id, name) {
    if (!window.confirm(`Delete "${name}"?\nThis will fail if they have saved schedules.`)) return;
    try {
      const res  = await fetch(`/api/instructor-registration/${id}`, { method: "DELETE", credentials: "include" });
      const data = await res.json();
      if (!res.ok) return flash(data.error || "Cannot delete.", "err");
      flash(`✓ "${name}" deleted.`);
      if (expandedId === id) setExpandedId(null);
      await load(true);
    } catch { flash("Network error.", "err"); }
  }

  const filtered = instructors.filter(i =>
    normName(i.name).includes(normName(search)) ||
    (i.email || "").toLowerCase().includes(search.toLowerCase()) ||
    (i.subjects || []).some(s => normName(s.subject_name).includes(normName(search)))
  );

  const inputStyle = {
    padding: "10px 14px", border: "1.5px solid #e2e8f0", borderRadius: 8,
    fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box",
    color: "#0f172a", background: "#fff", transition: "border-color 0.2s",
  };

  return (
    <div style={{
      width: "100%", maxWidth: 1100, display: "flex", flexDirection: "column",
      alignSelf: "flex-start", background: "#f8fafc", borderRadius: 16,
      overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.08)", border: D.cardBorder,
    }}>

      {/* ═══ HEADER — capacity bars removed ═══ */}
      <div style={{ ...D.headerStyle, padding: "28px 32px", position: "relative", overflow: "hidden" }}>
        <div style={{
          position: "absolute", inset: 0, background: D.pattern,
          backgroundSize: D.patternSize || "auto", pointerEvents: "none",
        }} />
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{
            width: 64, height: 64, borderRadius: 16,
            background: "rgba(255,255,255,0.15)", backdropFilter: "blur(4px)",
            border: "1px solid rgba(255,255,255,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 28, flexShrink: 0,
          }}>
            {D.icon}
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5, marginBottom: 4 }}>
              Instructor Registry
            </div>
            <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 6 }}>
              {D.label} — {code}
            </div>
            <div style={{
              display: "inline-block", background: "rgba(255,255,255,0.15)",
              backdropFilter: "blur(4px)", border: "1px solid rgba(255,255,255,0.25)",
              borderRadius: 20, padding: "3px 14px", fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
            }}>
              {D.tagline}
            </div>
          </div>
          {/* Count only — no limit denominator */}
          <div style={{ marginLeft: "auto", textAlign: "right", opacity: 0.85 }}>
            <div style={{ fontSize: 40, fontWeight: 900, lineHeight: 1 }}>{instructors.length}</div>
            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>registered</div>
          </div>
        </div>
      </div>

      {/* ═══ BODY ═══ */}
      <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 20, background: "#fff" }}>

        {/* Flash message */}
        {msg.text && (
          <div style={{
            padding: "12px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600,
            background: msg.type === "err" ? "#fee2e2" : "#f0fdf4",
            color: msg.type === "err" ? "#dc2626" : "#16a34a",
            border: `1px solid ${msg.type === "err" ? "#fca5a5" : "#86efac"}`,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{ fontSize: 16 }}>{msg.type === "err" ? "⚠" : "✓"}</span>
            {msg.text}
          </div>
        )}

        {/* ── Add Form ── */}
        <div style={{ background: D.accentSoft, border: `1px solid ${D.accentMid}`, borderRadius: 12, padding: "20px 22px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: D.accentDark, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              width: 28, height: 28, borderRadius: 8, background: D.accent, color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0,
            }}>+</span>
            Register New Instructor
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 2fr auto", gap: 12, alignItems: "flex-end" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: D.accentDark, textTransform: "uppercase", letterSpacing: 0.5 }}>Full Name *</label>
              <input style={inputStyle} placeholder="e.g. Juan Dela Cruz" value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addInstructor()}
                onFocus={e => e.target.style.borderColor = D.inputFocus}
                onBlur={e => e.target.style.borderColor = "#e2e8f0"} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: D.accentDark, textTransform: "uppercase", letterSpacing: 0.5 }}>Department</label>
              <input style={inputStyle} value={newDept}
                onChange={e => setNewDept(e.target.value)}
                onFocus={e => e.target.style.borderColor = D.inputFocus}
                onBlur={e => e.target.style.borderColor = "#e2e8f0"} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: D.accentDark, textTransform: "uppercase", letterSpacing: 0.5 }}>Email (optional)</label>
              <input style={inputStyle} placeholder="instructor@pcc.edu.ph" value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                onFocus={e => e.target.style.borderColor = D.inputFocus}
                onBlur={e => e.target.style.borderColor = "#e2e8f0"} />
            </div>
            <button onClick={addInstructor} disabled={saving} style={{
              padding: "10px 20px", background: saving ? "#94a3b8" : D.addBtnBg,
              color: "#fff", border: "none", borderRadius: 8,
              cursor: saving ? "not-allowed" : "pointer",
              fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", transition: "background 0.2s",
            }}
              onMouseEnter={e => { if (!saving) e.target.style.background = D.addBtnHover; }}
              onMouseLeave={e => { if (!saving) e.target.style.background = D.addBtnBg; }}
            >
              {saving ? "Saving…" : "Register"}
            </button>
          </div>
          <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 10, marginBottom: 0 }}>
            Duplicate names (case-insensitive) are rejected. Subjects assigned here appear as dropdowns in the Student Load grid.
          </p>
        </div>

        {/* ── Search + Refresh ── */}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ flex: 1, position: "relative" }}>
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }}>🔍</span>
            <input style={{ ...inputStyle, paddingLeft: 36 }} placeholder="Search by name, email, or subject…"
              value={search} onChange={e => setSearch(e.target.value)}
              onFocus={e => e.target.style.borderColor = D.inputFocus}
              onBlur={e => e.target.style.borderColor = "#e2e8f0"} />
          </div>
          <button onClick={() => load(false)} style={{
            padding: "10px 16px", background: "#f1f5f9", color: "#475569",
            border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer",
            fontSize: 13, fontWeight: 600, whiteSpace: "nowrap",
          }}>↻ Refresh</button>
        </div>

        {/* ── Count divider ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ height: 1, flex: 1, background: "#e2e8f0" }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>
            {filtered.length} of {instructors.length} instructor{instructors.length !== 1 ? "s" : ""}
          </span>
          <div style={{ height: 1, flex: 1, background: "#e2e8f0" }} />
        </div>

        {/* ── Instructor list ── */}
        {loading ? (
          <div style={{ textAlign: "center", padding: "48px 0", color: "#94a3b8", fontSize: 14 }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>⏳</div>Loading instructors…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 0", color: "#94a3b8", fontSize: 14 }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>{instructors.length === 0 ? D.icon : "🔍"}</div>
            {instructors.length === 0 ? "No instructors registered yet. Add one above." : "No results match your search."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filtered.map(inst => {
              const isExpanded = expandedId === inst.id;
              const subCount   = (inst.subjects || []).length;
              return (
                <div key={inst.id} style={{
                  border: `1px solid ${isExpanded ? D.accentMid : "#e2e8f0"}`,
                  borderLeft: `4px solid ${isExpanded ? D.accent : "#e2e8f0"}`,
                  borderRadius: 10, background: isExpanded ? D.accentSoft : "#fff",
                  transition: "all 0.2s", overflow: "hidden",
                }}>
                  {/* Header row */}
                  <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", cursor: "pointer" }}
                    onClick={() => setExpandedId(isExpanded ? null : inst.id)}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 10, background: D.accent, color: "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 16, fontWeight: 800, flexShrink: 0, userSelect: "none",
                    }}>
                      {inst.name.charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: 2 }}>{inst.name}</div>
                      <div style={{ fontSize: 11, color: "#64748b", display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <span>{inst.department || code}</span>
                        {inst.email && <span>✉ {inst.email}</span>}
                      </div>
                    </div>
                    <span style={{
                      padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 700, flexShrink: 0,
                      background: subCount > 0 ? D.accentMid : "#f1f5f9",
                      color: subCount > 0 ? D.accentDark : "#94a3b8",
                      border: `1px solid ${subCount > 0 ? D.accent : "#e2e8f0"}`,
                    }}>
                      {subCount} subject{subCount !== 1 ? "s" : ""}
                    </span>
                    <span style={{
                      color: "#94a3b8", fontSize: 12, flexShrink: 0,
                      transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s",
                    }}>▼</span>
                  </div>

                  {/* Expanded panel */}
                  {isExpanded && (
                    <div style={{ padding: "0 18px 18px", borderTop: `1px solid ${D.accentMid}` }}>
                      <div style={{ paddingTop: 14, display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                        {subCount === 0
                          ? <span style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic" }}>No subjects assigned yet.</span>
                          : (inst.subjects || []).map(sub => (
                            <span key={sub.id} style={{
                              padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                              display: "inline-flex", alignItems: "center", gap: 8,
                              background: "#fff", color: D.accentDark, border: `1.5px solid ${D.accentMid}`,
                            }}>
                              {sub.subject_name}
                              <button
                                onClick={e => { e.stopPropagation(); removeSubject(sub.id, sub.subject_name, inst.name); }}
                                style={{ background: "none", border: "none", cursor: "pointer", color: "#cbd5e1", fontSize: 13, padding: 0, lineHeight: 1 }}
                                title="Remove"
                              >✕</button>
                            </span>
                          ))
                        }
                      </div>
                      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                        <input
                          style={{ ...inputStyle, flex: 1, maxWidth: 340 }}
                          placeholder="Add subject (e.g. SIA, Programming)"
                          value={subjectInputs[inst.id] || ""}
                          onChange={e => setSubjectInputs(prev => ({ ...prev, [inst.id]: e.target.value }))}
                          onKeyDown={e => e.key === "Enter" && addSubject(inst.id, inst.name)}
                          onFocus={e => e.target.style.borderColor = D.inputFocus}
                          onBlur={e => e.target.style.borderColor = "#e2e8f0"}
                          onClick={e => e.stopPropagation()}
                        />
                        <button
                          onClick={e => { e.stopPropagation(); addSubject(inst.id, inst.name); }}
                          disabled={saving}
                          style={{
                            padding: "10px 18px", background: saving ? "#94a3b8" : D.accent,
                            color: "#fff", border: "none", borderRadius: 8,
                            cursor: saving ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 700,
                          }}
                        >+ Add</button>
                      </div>
                      <div style={{ paddingTop: 10, borderTop: `1px solid ${D.accentMid}` }}>
                        <button
                          onClick={e => { e.stopPropagation(); deleteInstructor(inst.id, inst.name); }}
                          style={{
                            padding: "7px 16px", fontSize: 12, fontWeight: 600,
                            background: "#fff", color: "#dc2626",
                            border: "1px solid #fca5a5", borderRadius: 8, cursor: "pointer",
                          }}
                        >🗑 Delete Instructor</button>
                        <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 10 }}>
                          Cannot delete if they have saved schedule blocks.
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}