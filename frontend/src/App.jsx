import { useState, useEffect, useRef } from "react";
import SuperAdminPanel        from "./SuperAdminPanel.jsx";
import { useAuth }            from "./ProtectedRoute.jsx";
import { getDeptTheme, DEPT_THEMES } from "./DeptTheme.js";
import { DeptLogo, PCCLogo } from "./LogoMap.jsx";

const DAY_START = 7;
const DAY_END   = 20;
const DAYS  = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const TIMES = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);
const LECTURE_ROOMS = ["Room 1","Room 2","Room 3","Room 4","Room 5"];
const LAB_ROOMS     = ["Lab A","Lab B","Lab C"];
const ALL_ROOMS     = [...LECTURE_ROOMS, ...LAB_ROOMS];

const LUNCH_START   = 12;
const LUNCH_END     = 13;
const BREAK_TRIGGER = 3;
const BREAK_DUR     = 1;

const SEMESTERS = ["1st Semester", "2nd Semester"];

const YEAR_LEVEL_LABELS = {
  1: "First Year",
  2: "Second Year",
  3: "Third Year",
  4: "Fourth Year",
};

// ── Random subject icons pool ──
const SUBJECT_ICONS = ["📐","📊","🔭","🧬","🖥️","📡","⚙️","🧮","📝","🔬","💡","🗂️","🌐","🎯","📈","🔢","🧩","📚","🛠️","🔐","💻","🏗️","🧪","📋","🗃️"];
function getSubjectIcon(subjectName) {
  let hash = 0;
  for (let i = 0; i < subjectName.length; i++) hash = subjectName.charCodeAt(i) + ((hash << 5) - hash);
  return SUBJECT_ICONS[Math.abs(hash) % SUBJECT_ICONS.length];
}

function hasGE(yearLevel, semester) {
  if (yearLevel === 1) return true;
  if (yearLevel === 2) return true;
  if (yearLevel === 3 && semester === "1st Semester") return true;
  return false;
}

function getRoomType(r) { return LAB_ROOMS.includes(r) ? "Laboratory" : "Lecture"; }
function fmtH(h) {
  const hr  = Math.floor(h);
  const min = h % 1 === 0.5 ? "30" : "00";
  if (hr === 0)  return `12:${min} AM`;
  if (hr === 12) return `12:${min} PM`;
  if (hr < 12)   return `${hr}:${min} AM`;
  return `${hr - 12}:${min} PM`;
}
function fmtRange(s,e) { return `${fmtH(s)} – ${fmtH(e)}`; }
function normName(s) { return (s || "").trim().replace(/\s+/g," ").toLowerCase(); }

function insertBreaks(blocks) {
  if (!blocks.length) return blocks;
  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  const withLunch = [];
  let lunchDone = false;
  for (const b of sorted) {
    if (b.is_break) { withLunch.push(b); continue; }
    const overlapsLunch = !lunchDone && b.start < LUNCH_END && b.end > LUNCH_START;
    if (overlapsLunch) {
      if (b.start < LUNCH_START) withLunch.push({ ...b, end: LUNCH_START });
      withLunch.push({ ...b, subject:"BREAK", room:"—", roomType:"Break", section:"", instructor:"", start:LUNCH_START, end:LUNCH_END, is_break:true });
      if (b.end > LUNCH_END) withLunch.push({ ...b, start: LUNCH_END });
      lunchDone = true;
    } else {
      if (!lunchDone && b.start >= LUNCH_END) {
        withLunch.push({ ...b, subject:"BREAK", room:"—", roomType:"Break", section:"", instructor:"", start:LUNCH_START, end:LUNCH_END, is_break:true });
        lunchDone = true;
      }
      withLunch.push(b);
    }
  }
  const result  = [];
  let teachRun  = 0;
  let prevEnd   = null;
  for (const b of withLunch) {
    if (b.is_break) { result.push(b); teachRun = 0; prevEnd = b.end; continue; }
    if (prevEnd !== null && b.start > prevEnd) teachRun = 0;
    let cur = { ...b };
    while (cur.start < cur.end) {
      const canTeach = +(BREAK_TRIGGER - teachRun).toFixed(1);
      const dur      = +(cur.end - cur.start).toFixed(1);
      if (dur <= canTeach) {
        result.push(cur); teachRun = +(teachRun + dur).toFixed(1); prevEnd = cur.end;
        if (teachRun >= BREAK_TRIGGER) {
          const bEnd = +(cur.end + BREAK_DUR).toFixed(1);
          result.push({ ...b, subject:"BREAK", room:"—", roomType:"Break", section:"", instructor:"", start:cur.end, end:bEnd, is_break:true });
          prevEnd = bEnd; teachRun = 0;
        }
        break;
      } else {
        const splitEnd = +(cur.start + canTeach).toFixed(1);
        const leftover = +(cur.end - splitEnd).toFixed(1);
        const breakEnd = +(splitEnd + BREAK_DUR).toFixed(1);
        result.push({ ...cur, end: splitEnd });
        result.push({ ...b, subject:"BREAK", room:"—", roomType:"Break", section:"", instructor:"", start:splitEnd, end:breakEnd, is_break:true });
        cur = { ...cur, start: breakEnd, end: +(breakEnd + leftover).toFixed(1) };
        prevEnd = breakEnd; teachRun = 0;
      }
    }
  }
  return result;
}

function detectConflicts(schedules) {
  const out = [];
  for (let i = 0; i < schedules.length; i++) {
    for (let j = i + 1; j < schedules.length; j++) {
      const a = schedules[i], b = schedules[j];
      if (a.is_break || b.is_break) continue;
      if (a.day !== b.day) continue;
      const overlaps = a.start < b.end && b.start < a.end;
      if (!overlaps) continue;
      const s = fmtH(Math.max(a.start, b.start));
      const e = fmtH(Math.min(a.end,   b.end));
      if (a.room && b.room && a.room === b.room) {
        const sameSection    = a.section && b.section && a.section === b.section;
        const sameInstructor = normName(a.instructor) === normName(b.instructor) && a.instructor;
        if (!sameSection || !sameInstructor)
          out.push({ type:"Room Conflict", day:a.day, room:a.room, detail:`"${a.room}" is double-booked on ${a.day} ${s}–${e}: ${a.instructor||a.section||"?"} (${a.subject}) vs ${b.instructor||b.section||"?"} (${b.subject})`, blockA:a, blockB:b });
      }
      const aInst = normName(a.instructor), bInst = normName(b.instructor);
      if (aInst && bInst && aInst === bInst) {
        const identical = normName(a.subject)===normName(b.subject) && a.section===b.section && a.room===b.room && a.start===b.start && a.end===b.end;
        if (!identical) out.push({ type:"Instructor Conflict", day:a.day, room:a.room||"", detail:`${a.instructor} is double-booked on ${a.day} ${s}–${e}: "${a.subject}"${a.section?" ("+a.section+")":""} in ${a.room||"?"} and "${b.subject}"${b.section?" ("+b.section+")":""} in ${b.room||"?"}`, blockA:a, blockB:b });
      }
      if (a.section && b.section && a.section === b.section) {
        if (normName(a.instructor||"") !== normName(b.instructor||""))
          out.push({ type:"Section Conflict", day:a.day, room:a.room||"", detail:`Section ${a.section} has two instructors on ${a.day} ${s}–${e}: ${a.instructor||"?"} (${a.subject}) and ${b.instructor||"?"} (${b.subject})`, blockA:a, blockB:b });
        if (a.room && b.room && a.room !== b.room)
          out.push({ type:"Section Room Conflict", day:a.day, room:a.room||"", detail:`Section ${a.section} is scheduled in two rooms on ${a.day} ${s}–${e}: ${a.room} (${a.subject}) and ${b.room} (${b.subject})`, blockA:a, blockB:b });
      }
    }
  }
  return out;
}

// ── MODIFIED: findSuggestions now branches by conflict type ──
// If Instructor Conflict → suggest vacant instructors
// If Room/Time/Section conflict → suggest vacant rooms (original logic)
function findSuggestions(conflict, allSchedules, instructorPool = []) {
  const { type, blockA } = conflict;
  if (!blockA) return [];
  const { day, start, end, room } = blockA;
  const dur = end - start;

  // ── Instructor Conflict: suggest a vacant instructor ──
  if (type === "Instructor Conflict") {
    const suggestions = [];
    for (const inst of instructorPool) {
      if (normName(inst.name) === normName(blockA.instructor)) continue;
      const isBusy = allSchedules.some(s =>
        !s.is_break &&
        normName(s.instructor) === normName(inst.name) &&
        s.day === day &&
        !(s.end <= start || s.start >= end)
      );
      if (!isBusy) {
        suggestions.push({
          type: "instructor",
          label: `Assign to ${inst.name}`,
          instructor: inst.name,
          day, start, end, room,
          icon: inst.employment_type === "Part-time" ? "⏱" : "👨‍🏫",
        });
      }
      if (suggestions.length >= 5) break;
    }
    return suggestions;
  }

  // ── Room / Section / default conflicts: suggest vacant rooms ──
  const suggestions = [];
  ALL_ROOMS.forEach(r => {
    if (r === room) return;
    const blocked = allSchedules.filter(s =>
      !s.is_break && s.day === day && s.room === r &&
      !(s.end <= start || s.start >= end)
    );
    if (!blocked.length) {
      suggestions.push({ type:"room", label:`Move to ${r}`, room: r, day, start, end, icon: LAB_ROOMS.includes(r) ? "🔬" : "📖" });
    }
  });
  for (let t = DAY_START; t + dur <= DAY_END; t++) {
    if (t === start) continue;
    if (t < LUNCH_END && t + dur > LUNCH_START) continue;
    const blocked = allSchedules.filter(s =>
      !s.is_break && s.day === day && s.room === room &&
      !(s.end <= t || s.start >= t + dur)
    );
    if (!blocked.length) {
      suggestions.push({ type:"time", label:`Same room, ${fmtRange(t, t + dur)}`, room, day, start: t, end: t + dur, icon:"🕐" });
    }
  }
  DAYS.forEach(d => {
    if (d === day) return;
    const blocked = allSchedules.filter(s =>
      !s.is_break && s.day === d && s.room === room &&
      !(s.end <= start || s.start >= end)
    );
    if (!blocked.length) {
      suggestions.push({ type:"day", label:`${d}, ${room}, ${fmtRange(start, end)}`, room, day: d, start, end, icon:"📅" });
    }
  });
  return suggestions.slice(0, 5);
}

function convertGrid(grid, instructor) {
  const out=[];
  DAYS.forEach(day=>{
    let cur=null;
    TIMES.forEach(t=>{
      const cell=grid[day]?.[t]||{};
      const sub=cell.subject||"",room=cell.room||"",rt=cell.roomType||"Lecture",sec=cell.section||"";
      if (!sub) { if(cur){out.push(cur);cur=null;} }
      else if (!cur) { cur={instructor,subject:sub,day,start:t,end:t+1,room,roomType:rt,section:sec}; }
      else if (cur.subject===sub&&cur.room===room&&cur.roomType===rt&&cur.section===sec) { cur.end=t+1; }
      else { out.push(cur); cur={instructor,subject:sub,day,start:t,end:t+1,room,roomType:rt,section:sec}; }
    });
    if(cur) out.push(cur);
  });
  return out;
}

function convertStudentGrid(grid, sectionName) {
  const out=[];
  DAYS.forEach(day=>{
    let cur=null;
    TIMES.forEach(t=>{
      const cell=grid[day]?.[t]||{};
      const sub=cell.subject||"",room=cell.room||"",rt=cell.roomType||"Lecture",inst=cell.instructor||"";
      if (!sub) { if(cur){out.push(cur);cur=null;} }
      else if (!cur) { cur={section:sectionName,subject:sub,day,start:t,end:t+1,room,roomType:rt,instructor:inst}; }
      else if (cur.subject===sub&&cur.room===room&&cur.roomType===rt&&normName(cur.instructor)===normName(inst)) { cur.end=t+1; }
      else { out.push(cur); cur={section:sectionName,subject:sub,day,start:t,end:t+1,room,roomType:rt,instructor:inst}; }
    });
    if(cur) out.push(cur);
  });
  return out;
}

function buildPrintTimeSlots(schedules) {
  const pts = new Set();
  for (let h = DAY_START; h < DAY_END; h++) pts.add(h);
  schedules.forEach(b => { pts.add(Number(b.start)); pts.add(Number(b.end)); });
  return [...pts].filter(t => t >= DAY_START && t < DAY_END).sort((a,b)=>a-b);
}

function useSubjectCodeMap() {
  const [codeMap, setCodeMap] = useState({});

  useEffect(() => {
    async function load() {
      try {
        const [r1, r2] = await Promise.all([
          fetch("/api/subjects?semester=1st%20Semester", { credentials:"include" }),
          fetch("/api/subjects?semester=2nd%20Semester", { credentials:"include" }),
        ]);
        const [s1, s2] = await Promise.all([
          r1.ok ? r1.json() : [],
          r2.ok ? r2.json() : [],
        ]);
        const allSubjects = [...(Array.isArray(s1)?s1:[]), ...(Array.isArray(s2)?s2:[])];
        const map = {};
        for (const s of allSubjects) {
          if (!s.subject_name) continue;
          const key = normName(s.subject_name);
          if (!map[key] || s.subject_code) {
            map[key] = { code: s.subject_code || "", name: s.subject_name, type: s.subject_type || "Major" };
          }
        }
        setCodeMap(map);
      } catch {}
    }
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  return codeMap;
}

function resolveSubjectDisplay(block, codeMap) {
  const blockCode = block.subject_code || "";
  const liveLookup = codeMap[normName(block.subject || "")];
  const code = blockCode || liveLookup?.code || "";
  const name = block.subject || "";
  const type = block.subject_type || liveLookup?.type || "Major";
  return { code, name, type };
}

function getBadgeBg(type, theme) {
  if (type === "GE") return "linear-gradient(135deg,#65a30d,#84cc16)";
  return `linear-gradient(135deg,${theme.primary},${theme.primary3||theme.primary})`;
}

/* ════════
   SUBJECT BLOCK CARD
   ════════ */
function SubjectBlockCard({ block, codeMap, theme, children, style={} }) {
  const { code, name } = resolveSubjectDisplay(block, codeMap);
  const lab = block.roomType === "Laboratory";
  return (
    <div style={{
      padding:"12px 14px",
      minWidth:165,
      border:`1px solid ${lab ? theme.border : "#86efac"}`,
      borderLeft:`4px solid ${lab ? theme.primary : "#16a34a"}`,
      borderRadius:10,
      background: lab ? theme.light : "#f0fdf4",
      boxShadow:"0 2px 6px rgba(0,0,0,0.07)",
      ...style
    }}>
      {code ? (
        <div style={{
          display:"inline-flex",
          alignItems:"center",
          background:`linear-gradient(135deg,${theme.primary},${theme.primary3||theme.primary})`,
          color:"#fff",
          borderRadius:6,
          padding:"4px 12px",
          fontSize:13,
          fontWeight:900,
          letterSpacing:1.2,
          marginBottom:6,
          textTransform:"uppercase",
          boxShadow:`0 2px 8px ${lab?"rgba(0,0,0,0.18)":"rgba(22,163,74,0.25)"}`,
        }}>
          {code}
        </div>
      ) : null}
      <div style={{
        fontWeight: code ? 500 : 700,
        fontSize: code ? 11 : 13,
        color: code ? "#64748b" : "#0f172a",
        lineHeight:1.35,
        marginBottom: code ? 2 : 4,
      }}>{name}</div>
      {children}
    </div>
  );
}

/* ════════ SMART CONFLICT TOAST — MODIFIED to pass instructorPool ════════ */
function ConflictToast({ conflicts, allSchedules, onClose, onMoveSchedule, instructorPool = [] }) {
  useEffect(()=>{ const t=setTimeout(onClose,30000); return()=>clearTimeout(t); },[]);

  const conflictsWithSuggestions = conflicts.map(c => ({
    ...c,
    suggestions: c.blockA ? findSuggestions(c, allSchedules, instructorPool) : [],
  }));

  return (
    <div style={{position:"fixed",top:24,right:24,zIndex:9999,background:"#fff",border:"2px solid #fca5a5",borderLeft:"5px solid #ef4444",borderRadius:14,padding:"18px 22px",maxWidth:520,width:"95%",boxShadow:"0 12px 40px rgba(0,0,0,0.22)",fontFamily:"'Segoe UI',sans-serif",animation:"slideIn 0.3s ease",maxHeight:"85vh",overflowY:"auto"}}>
      <style>{`@keyframes slideIn{from{transform:translateX(120%);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:15,color:"#dc2626"}}>❌ {conflicts.length} Conflict{conflicts.length!==1?"s":""} Found</div>
        <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:"#94a3b8"}}>✕</button>
      </div>
      <div style={{fontSize:12,color:"#64748b",marginBottom:12}}>Resolve conflicts below. Click a suggestion to apply it.</div>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        {conflictsWithSuggestions.map((c, i) => (
          <div key={i} style={{background:"#fff8f8",border:"1px solid #fca5a5",borderLeft:"4px solid #ef4444",borderRadius:10,padding:"12px 14px",fontSize:12}}>
            <div style={{fontWeight:700,color:"#ef4444",marginBottom:4}}>⚠ {c.type}</div>
            <div style={{color:"#374151",marginBottom:c.suggestions.length ? 10 : 0,lineHeight:1.6}}>{c.detail}</div>
            {c.suggestions.length > 0 && (
              <>
                <div style={{fontSize:11,fontWeight:700,color:"#6b7280",marginBottom:6,background:"#f1f5f9",borderRadius:6,padding:"4px 8px",display:"inline-block"}}>
                  {c.type === "Instructor Conflict" ? "👨‍🏫 Available instructors:" : "💡 Click to apply fix:"}
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:4}}>
                  {c.suggestions.map((sg, si) => (
                    <button
                      key={si}
                      onClick={() => {
                        if (onMoveSchedule && c.blockA) {
                          onMoveSchedule(c.blockA, sg);
                          onClose();
                        }
                      }}
                      style={{display:"flex",alignItems:"center",gap:8,background:"#f0fdf4",border:"1px solid #86efac",borderRadius:8,padding:"8px 10px",cursor: onMoveSchedule ? "pointer" : "default",textAlign:"left",width:"100%",transition:"background 0.15s"}}
                      onMouseEnter={e => e.currentTarget.style.background="#dcfce7"}
                      onMouseLeave={e => e.currentTarget.style.background="#f0fdf4"}
                    >
                      <span style={{fontSize:14}}>{sg.icon}</span>
                      <div style={{flex:1}}>
                        <div style={{fontSize:12,fontWeight:600,color:"#166534"}}>{sg.label}</div>
                        <div style={{fontSize:10,color:"#6b7280"}}>{sg.day} · {fmtRange(sg.start, sg.end)} · {sg.room}</div>
                      </div>
                      {onMoveSchedule && <span style={{fontSize:10,color:"#16a34a",fontWeight:700}}>Apply →</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
            {c.suggestions.length === 0 && (
              <div style={{fontSize:11,color:"#f59e0b",background:"#fef9c3",border:"1px solid #fde68a",borderRadius:6,padding:"5px 10px",marginTop:6}}>
                {c.type === "Instructor Conflict"
                  ? "⚠ No free instructors found for this time slot."
                  : "⚠ No free alternatives found. Try a different day or time."}
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{marginTop:12,fontSize:11,color:"#94a3b8",textAlign:"right"}}>Auto-closes in 30s</div>
    </div>
  );
}

/* ════════ SCHOOL HEADER ════════ */
function SchoolHeader({ academicYear, semester, compact=false, theme }) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:compact?12:16,padding:compact?"12px 0 10px":"16px 0 14px",borderBottom:`2px solid ${theme.border}`,marginBottom:compact?12:16}}>
      <DeptLogo code={theme.code} style={{width:compact?44:52,height:compact?44:52,objectFit:"contain"}} alt={theme.code}/>
      <div style={{flex:1,textAlign:"center"}}>
        <div style={{fontSize:compact?15:17,fontWeight:800,color:"#0f172a",letterSpacing:.3}}>PASSI CITY COLLEGE</div>
        <div style={{fontSize:compact?11:12,fontWeight:700,color:theme.primary,marginTop:2}}>{theme.shortName}</div>
        <div style={{fontSize:compact?9:10,color:"#64748b",marginTop:1}}>Passi City, Iloilo, Philippines</div>
        {(academicYear || semester) && (
          <div style={{display:"flex",gap:6,justifyContent:"center",marginTop:5,flexWrap:"wrap"}}>
            {academicYear && (
              <span style={{background:theme.light2,color:theme.text,border:`1px solid ${theme.border}`,borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:600}}>📅 A.Y. {academicYear}</span>
            )}
            {semester && (
              <span style={{background:"#fefce8",color:"#854d0e",border:"1px solid #fde68a",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:600}}>📚 {semester}</span>
            )}
          </div>
        )}
      </div>
      <img src={PCCLogo} style={{width:compact?44:52,height:compact?44:52,objectFit:"contain"}} alt="PCC"/>
    </div>
  );
}

/* ════════ EDIT MODAL ════════ */
function EditModal({ block, onSave, onClose, theme }) {
  const [day,setDay]=useState(block.day);
  const [startH,setStartH]=useState(block.start);
  const [endH,setEndH]=useState(block.end);
  const [room,setRoom]=useState(block.room);
  const [saving,setSaving]=useState(false);
  const [err,setErr]=useState("");
  const dur=block.end-block.start;
  const inpStyle={padding:"9px 12px",border:`1px solid ${theme.border}`,borderRadius:8,fontSize:14,outline:"none",width:"100%",background:"#fff",color:"#0f172a"};
  const save=async()=>{
    if(startH>=endH) return setErr("Start time must be before end time.");
    if(!room) return setErr("Please select a room.");
    setSaving(true); setErr("");
    try {
      const res=await fetch(`/api/schedules/${block.id}`,{method:"PUT",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({day,start:startH,end:endH,room,roomType:getRoomType(room)})});
      const data=await res.json();
      if(data.error){setErr(data.error);setSaving(false);return;}
      onSave(data);
    } catch {setErr("Failed to save.");}
    setSaving(false);
  };
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}} onClick={onClose}>
      <div style={{background:"#fff",borderRadius:16,padding:28,width:"100%",maxWidth:480,display:"flex",flexDirection:"column",gap:14,boxShadow:"0 24px 64px rgba(0,0,0,0.25)"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${theme.light2}`,paddingBottom:12}}>
          <div><div style={{fontSize:16,fontWeight:700}}>✏ Edit Schedule Block</div><div style={{fontSize:12,color:"#64748b",marginTop:2}}>Adjust day, time, or room</div></div>
          <button onClick={onClose} style={{background:theme.light,border:"none",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:16,color:theme.primary}}>✕</button>
        </div>
        {err&&<div style={{background:"#fee2e2",color:"#dc2626",border:"1px solid #fca5a5",borderRadius:8,padding:"10px 14px",fontSize:13}}>⚠ {err}</div>}
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>Day</label>
          <select style={inpStyle} value={day} onChange={e=>setDay(e.target.value)}>{DAYS.map(d=><option key={d} value={d}>{d}</option>)}</select>
        </div>
        <div style={{display:"flex",gap:12}}>
          <div style={{flex:1,display:"flex",flexDirection:"column",gap:6}}>
            <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>Start</label>
            <select style={inpStyle} value={startH} onChange={e=>{const s=Number(e.target.value);setStartH(s);setEndH(s+dur);}}>{TIMES.map(t=><option key={t} value={t}>{fmtH(t)}</option>)}</select>
          </div>
          <div style={{flex:1,display:"flex",flexDirection:"column",gap:6}}>
            <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>End</label>
            <select style={inpStyle} value={endH} onChange={e=>setEndH(Number(e.target.value))}>{TIMES.filter(t=>t>startH).concat([DAY_END]).map(t=><option key={t} value={t}>{fmtH(t)}</option>)}</select>
          </div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>Room</label>
          <select style={inpStyle} value={room} onChange={e=>setRoom(e.target.value)}>
            <option value="">— Select Room —</option>
            <optgroup label="Lecture Rooms">{LECTURE_ROOMS.map(r=><option key={r} value={r}>{r}</option>)}</optgroup>
            <optgroup label="Laboratories">{LAB_ROOMS.map(r=><option key={r} value={r}>{r}</option>)}</optgroup>
          </select>
        </div>
        <div style={{display:"flex",gap:10,paddingTop:4,borderTop:"1px solid #f1f5f9"}}>
          <button style={{flex:1,padding:"11px",background:theme.primary,color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:14,fontWeight:600}} onClick={save} disabled={saving}>{saving?"Saving…":"✓ Save Changes"}</button>
          <button style={{padding:"11px 20px",background:theme.light,color:theme.text,border:`1px solid ${theme.border}`,borderRadius:8,cursor:"pointer",fontSize:14}} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ════════ HOURS SUMMARY ════════ */
function HoursSummary({ schedules, theme }) {
  const real = schedules.filter(c=>!c.is_break);
  const total = real.reduce((s,c)=>s+(c.end-c.start),0);
  const labH  = real.filter(c=>c.roomType==="Laboratory").reduce((s,c)=>s+(c.end-c.start),0);
  const lecH  = real.filter(c=>c.roomType==="Lecture").reduce((s,c)=>s+(c.end-c.start),0);
  const labN  = real.filter(c=>c.roomType==="Laboratory").length;
  const lecN  = real.filter(c=>c.roomType==="Lecture").length;
  return (
    <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
      <span style={{padding:"4px 12px",borderRadius:20,fontSize:11,fontWeight:600,background:theme.light2,color:theme.text,border:`1px solid ${theme.border}`}}>⏱ {total} total hr{total!==1?"s":""}</span>
      <span style={{padding:"4px 12px",borderRadius:20,fontSize:11,fontWeight:600,background:"#dcfce7",color:"#166534",border:"1px solid #86efac"}}>📖 Lecture: {lecH}h ({lecN})</span>
      <span style={{padding:"4px 12px",borderRadius:20,fontSize:11,fontWeight:600,background:theme.light2,color:theme.text,border:`1px solid ${theme.border}`}}>🔬 Lab: {labH}h ({labN})</span>
    </div>
  );
}

/* ════════ WEEKLY GRID ════════ */
function WeeklyGrid({ grid, setGrid, theme }) {
  const upd=(day,t,field,val)=>{
    setGrid(prev=>{
      const ex=prev[day]?.[t]||{subject:"",room:"",roomType:"Lecture",section:""};
      let u={...ex,[field]:val};
      if(field==="subject"&&!val) u={subject:"",room:"",roomType:"Lecture",section:""};
      if(field==="room"&&val) u.roomType=getRoomType(val);
      return{...prev,[day]:{...prev[day],[t]:u}};
    });
  };
  const thStyle={padding:"9px 10px",background:theme.primary,border:`1px solid ${theme.primary3}`,textAlign:"left",fontWeight:600,color:"#fff",whiteSpace:"nowrap",minWidth:185};
  return (
    <div style={{overflowX:"auto"}}>
      <table style={{borderCollapse:"collapse",width:"100%",fontSize:13}}>
        <thead><tr>
          <th style={{...thStyle,minWidth:"auto"}}>Time</th>
          {DAYS.map(d=><th key={d} style={thStyle}>{d}</th>)}
        </tr></thead>
        <tbody>{TIMES.map(t=>(
          <tr key={t}>
            <td style={{padding:"4px 6px",border:`1px solid ${theme.light2}`,whiteSpace:"nowrap",fontWeight:600,fontSize:11,color:theme.primary,paddingRight:10,background:theme.light}}>{fmtRange(t,t+1)}</td>
            {DAYS.map(day=>{
              const cell=grid[day]?.[t]||{};
              const sub=cell.subject||"",room=cell.room||"",rt=cell.roomType||"Lecture",sec=cell.section||"";
              const lab=rt==="Laboratory";
              return (
                <td key={day} style={{padding:"5px 6px",border:`1px solid ${theme.light2}`,verticalAlign:"top",background:sub?(lab?theme.light2:theme.light):"transparent"}}>
                  <input style={{width:"100%",padding:"5px 7px",border:`1px solid ${theme.border}`,borderRadius:4,fontSize:12,minWidth:100,marginBottom:4,boxSizing:"border-box"}} value={sub} placeholder="Subject" onChange={e=>upd(day,t,"subject",e.target.value)}/>
                  <input style={{width:"100%",padding:"5px 7px",border:`1px solid ${theme.border}`,borderRadius:4,fontSize:11,marginBottom:4,boxSizing:"border-box",background:sub?"#fff":theme.light,opacity:sub?1:0.4,color:theme.primary,fontWeight:600}} value={sec} placeholder={`${theme.code} Section`} disabled={!sub} onChange={e=>upd(day,t,"section",e.target.value)}/>
                  <select style={{width:"100%",padding:"4px 6px",border:`1px solid ${theme.border}`,borderRadius:4,fontSize:11,fontWeight:600,boxSizing:"border-box",background:sub?"#fff":theme.light,color:sub?"#0f172a":"#94a3b8",opacity:sub?1:0.35,cursor:sub?"pointer":"not-allowed"}} value={room} disabled={!sub} onChange={e=>upd(day,t,"room",e.target.value)}>
                    <option value="">— Select Room —</option>
                    <optgroup label="Lecture Rooms">{LECTURE_ROOMS.map(r=><option key={r} value={r}>{r}</option>)}</optgroup>
                    <optgroup label="Laboratories">{LAB_ROOMS.map(r=><option key={r} value={r}>{r}</option>)}</optgroup>
                  </select>
                  {sub&&room&&<div style={{fontSize:10,fontWeight:700,color:lab?theme.text:"#166534",background:lab?theme.light2:"#dcfce7",border:`1px solid ${lab?theme.border:"#86efac"}`,borderRadius:20,padding:"2px 7px",display:"inline-block",marginTop:2}}>{lab?"🔬":"📖"} {rt}</div>}
                </td>
              );
            })}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   STUDENT WEEKLY GRID
   ════════════════════════════════════════════════════════════ */
function StudentWeeklyGrid({ grid, setGrid, theme, activeSemester }) {
  const [instructorList, setInstructorList] = useState([]);
  const [assignedSubjects, setAssignedSubjects] = useState({});

  useEffect(() => {
    if (!theme?.code) return;
    fetch(`/api/instructor-pool?dept=${theme.code}&semester=${encodeURIComponent(activeSemester || "")}`, { credentials:"include" })
      .then(r => r.ok ? r.json() : [])
      .then(list => {
        if (!Array.isArray(list)) { setInstructorList([]); return; }
        setInstructorList(list.filter(i => i.name));
      })
      .catch(() => setInstructorList([]));
    fetch(`/api/instructor-assignments?semester=${encodeURIComponent(activeSemester || "")}`, { credentials:"include" })
      .then(r => r.ok ? r.json() : [])
      .then(allAssignments => {
        if (!Array.isArray(allAssignments)) return;
        const grouped = {};
        for (const a of allAssignments) {
          const key = normName(a.instructor_name);
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push({ subject_name: a.subject_name, subject_type: a.subject_type });
        }
        setAssignedSubjects(grouped);
      })
      .catch(() => {});
  }, [theme.code, activeSemester]);

  const upd = (day, t, field, val) => {
    setGrid(prev => {
      const ex = prev[day]?.[t] || { subject:"", room:"", roomType:"Lecture", instructor:"" };
      let u = { ...ex, [field]: val };
      if (field === "subject" && !val) u = { ...u, subject:"", room:"", roomType:"Lecture" };
      if (field === "room" && val) u.roomType = getRoomType(val);
      if (field === "instructor") { u.subject = ""; }
      return { ...prev, [day]: { ...prev[day], [t]: u } };
    });
  };

  const InstructorSelect = ({ value, onChange, style }) => (
    <select style={style} value={value} onChange={onChange}>
      <option value="">— Instructor —</option>
      {instructorList.map(i => (
        <option key={i.id} value={i.name}>{i.name}</option>
      ))}
    </select>
  );

  return (
    <div style={{overflowX:"auto"}}>
      <table style={{borderCollapse:"collapse",width:"100%",fontSize:13}}>
        <thead><tr>
          <th style={{padding:"9px 10px",background:theme.primary,border:`1px solid ${theme.primary3}`,textAlign:"left",fontWeight:600,color:"#fff",whiteSpace:"nowrap"}}>Time</th>
          {DAYS.map(d=><th key={d} style={{padding:"9px 10px",background:theme.primary,border:`1px solid ${theme.primary3}`,textAlign:"left",fontWeight:600,color:"#fff",minWidth:200}}>{d}</th>)}
        </tr></thead>
        <tbody>{TIMES.map(t=>(
          <tr key={t}>
            <td style={{padding:"4px 6px",border:`1px solid ${theme.light2}`,whiteSpace:"nowrap",fontWeight:600,fontSize:11,color:theme.primary,background:theme.light}}>{fmtRange(t,t+1)}</td>
            {DAYS.map(day=>{
              const cell = grid[day]?.[t] || {};
              const sub  = cell.subject || "", room = cell.room || "", rt = cell.roomType || "Lecture", inst = cell.instructor || "";
              const lab  = rt === "Laboratory";
              const instKey  = normName(inst);
              const subsList = assignedSubjects[instKey] || [];
              const geSubjects    = subsList.filter(s => s.subject_type === "GE");
              const majorSubjects = subsList.filter(s => s.subject_type === "Major");
              return (
                <td key={day} style={{padding:"5px 6px",border:`1px solid ${theme.light2}`,verticalAlign:"top",background:sub?(lab?theme.light2:theme.light):"transparent"}}>
                  {instructorList.length > 0
                    ? <InstructorSelect value={inst} onChange={e => upd(day, t, "instructor", e.target.value)} style={{width:"100%",padding:"4px 6px",border:`1px solid ${theme.border}`,borderRadius:4,fontSize:11,fontWeight:600,boxSizing:"border-box",marginBottom:4,color:inst?theme.primary:"#94a3b8",background:"#fff"}}/>
                    : <input style={{width:"100%",padding:"5px 7px",border:`1px solid ${theme.border}`,borderRadius:4,fontSize:11,color:theme.primary,fontWeight:600,marginBottom:4,boxSizing:"border-box"}} value={inst} placeholder="Instructor" onChange={e => upd(day, t, "instructor", e.target.value)}/>
                  }
                  {inst && subsList.length > 0
                    ? <select style={{width:"100%",padding:"4px 6px",border:`1px solid ${theme.border}`,borderRadius:4,fontSize:11,boxSizing:"border-box",marginBottom:4,color:sub?"#0f172a":"#94a3b8",background:"#fff"}} value={sub} onChange={e => upd(day, t, "subject", e.target.value)}>
                        <option value="">— Subject —</option>
                        {geSubjects.length > 0 && (
                          <optgroup label="🌐 GE Subjects">
                            {geSubjects.map(s => <option key={s.subject_name} value={s.subject_name}>{s.subject_name}</option>)}
                          </optgroup>
                        )}
                        {majorSubjects.length > 0 && (
                          <optgroup label="🎯 Major Subjects">
                            {majorSubjects.map(s => <option key={s.subject_name} value={s.subject_name}>{s.subject_name}</option>)}
                          </optgroup>
                        )}
                      </select>
                    : inst && subsList.length === 0
                      ? <div style={{fontSize:11,color:"#ef4444",padding:"4px 6px",marginBottom:4,background:"#fff0f0",borderRadius:4,border:"1px solid #fca5a5"}}>⚠ No subjects assigned for {activeSemester}</div>
                      : <input style={{width:"100%",padding:"5px 7px",border:`1px solid ${theme.border}`,borderRadius:4,fontSize:12,marginBottom:4,boxSizing:"border-box",opacity:inst?1:0.4}} value={sub} placeholder={inst?"Subject":"Select instructor first"} disabled={!inst} onChange={e => upd(day, t, "subject", e.target.value)}/>
                  }
                  <select style={{width:"100%",padding:"4px 6px",border:`1px solid ${theme.border}`,borderRadius:4,fontSize:11,fontWeight:600,boxSizing:"border-box",background:sub?"#fff":theme.light,color:sub?"#0f172a":"#94a3b8",opacity:sub?1:0.35,cursor:sub?"pointer":"not-allowed"}} value={room} disabled={!sub} onChange={e => upd(day, t, "room", e.target.value)}>
                    <option value="">— Select Room —</option>
                    <optgroup label="Lecture Rooms">{LECTURE_ROOMS.map(r=><option key={r} value={r}>{r}</option>)}</optgroup>
                    <optgroup label="Laboratories">{LAB_ROOMS.map(r=><option key={r} value={r}>{r}</option>)}</optgroup>
                  </select>
                  {sub&&room&&<div style={{fontSize:10,fontWeight:700,color:lab?theme.text:"#166534",background:lab?theme.light2:"#dcfce7",border:`1px solid ${lab?theme.border:"#86efac"}`,borderRadius:20,padding:"2px 7px",display:"inline-block",marginTop:2}}>{lab?"🔬":"📖"} {rt}</div>}
                </td>
              );
            })}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/* ════════ PRINT MODAL — FACULTY ════════ */
function PrintModal({ schedules, academicYear, semester, onClose, theme, codeMap }) {
  const ref=useRef();
  const [printing,setPrinting]=useState(false);
  const real=schedules.filter(s=>!s.is_break);
  const instructors=[...new Set(real.filter(s=>s.instructor?.trim()).map(s=>s.instructor))].sort();

  const handlePrint=async()=>{
    setPrinting(true);
    const win=window.open("","_blank");
    win.document.write(`<!DOCTYPE html><html><head><title>Faculty Class Schedule</title><style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;font-size:10pt;color:#000;background:#fff;}.page{padding:14mm 14mm 14mm 18mm;}table{width:100%;border-collapse:collapse;}th{background:${theme.primary};color:#fff;font-weight:bold;padding:6px 4px;text-align:center;border:1px solid ${theme.primary3};font-size:8pt;}td{border:1px solid #ddd;padding:4px;text-align:center;vertical-align:middle;height:36px;}.td-lab{background:${theme.light2};}.td-lec{background:${theme.light};}.td-break{background:#fef9c3;}.time-td{background:${theme.light};color:${theme.primary};font-weight:700;font-size:7.5pt;white-space:nowrap;}@media print{@page{margin:0;size:A4 landscape;}body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}.page{padding:8mm;}}</style></head><body><div class="page">${ref.current.innerHTML}</div></body></html>`);
    win.document.close(); win.focus();
    setTimeout(()=>{win.print();win.close();setPrinting(false);},700);
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}} onClick={onClose}>
      <div style={{background:"#fff",borderRadius:16,padding:28,width:"100%",maxWidth:1000,maxHeight:"93vh",overflowY:"auto",display:"flex",flexDirection:"column",gap:16,boxShadow:"0 24px 64px rgba(0,0,0,0.28)"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,borderBottom:`1px solid ${theme.light2}`,paddingBottom:14}}>
          <div><div style={{fontSize:17,fontWeight:700}}>🖨 Print Preview — Faculty</div><div style={{fontSize:12,color:"#64748b",marginTop:2}}>{instructors.length} instructor(s)</div></div>
          <div style={{display:"flex",gap:8}}>
            <button style={{padding:"10px 20px",background:printing?"#94a3b8":theme.primary,color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:14,fontWeight:600}} onClick={handlePrint} disabled={printing}>{printing?"⏳ Preparing…":"🖨 Print / Save PDF"}</button>
            <button style={{padding:"10px 18px",background:theme.light,color:theme.text,border:`1px solid ${theme.border}`,borderRadius:8,cursor:"pointer",fontSize:14}} onClick={onClose}>✕ Close</button>
          </div>
        </div>
        <div ref={ref} style={{fontFamily:"Arial,sans-serif",fontSize:10,color:"#000",background:"#fff",border:`1px solid ${theme.border}`,borderRadius:8,padding:"22px 26px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:14,paddingBottom:10,marginBottom:8,borderBottom:"3px double #000"}}>
            <DeptLogo code={theme.code} style={{width:56,height:56,objectFit:"contain"}} alt={theme.code}/>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:15,fontWeight:900,textTransform:"uppercase"}}>Passi City College</div>
              <div style={{fontSize:10.5,fontWeight:700,color:theme.primary,marginTop:3}}>{theme.shortName}</div>
              <div style={{fontSize:8.5,color:"#555",marginTop:2}}>Passi City, Iloilo, Philippines</div>
            </div>
            <img src={PCCLogo} style={{width:56,height:56,objectFit:"contain"}} alt="PCC"/>
          </div>
          <div style={{textAlign:"center",fontSize:13,fontWeight:"bold",textTransform:"uppercase",letterSpacing:1.5,margin:"10px 0 3px"}}>Faculty Class Schedule</div>
          {(academicYear || semester) && (
            <div style={{textAlign:"center",fontSize:9.5,color:theme.primary,fontWeight:600,marginBottom:4}}>
              {academicYear ? `Academic Year ${academicYear}` : ""}{academicYear && semester ? " · " : ""}{semester || ""}
            </div>
          )}
          <hr style={{border:"none",borderTop:`2px solid ${theme.primary}`,margin:"8px 0 14px"}}/>
          {instructors.map(inst=>{
            const rawCls = schedules
              .filter(s=>normName(s.instructor)===normName(inst)&&!s.is_break)
              .map(b=>({...b, start:Number(b.start), end:Number(b.end)}));
            const cls = DAYS.flatMap(day=>{
              const dayBlocks = rawCls.filter(b=>b.day===day);
              return dayBlocks.length ? insertBreaks(dayBlocks) : [];
            });
            const realCls=cls.filter(s=>!s.is_break);
            const total=realCls.reduce((s,c)=>s+(c.end-c.start),0);
            const labH=realCls.filter(c=>c.roomType==="Laboratory").reduce((s,c)=>s+(c.end-c.start),0);
            const lecH=realCls.filter(c=>c.roomType==="Lecture").reduce((s,c)=>s+(c.end-c.start),0);
            const normalize = arr => arr.map(b=>({...b, start:Number(b.start), end:Number(b.end)}));
            const instSlots = buildPrintTimeSlots(normalize(cls));
            return (
              <div key={inst} style={{marginBottom:22,pageBreakInside:"avoid"}}>
                <div style={{background:theme.primary3,color:"#fff",padding:"7px 14px",borderRadius:"4px 4px 0 0",fontSize:11,fontWeight:"bold"}}>{inst}</div>
                <div style={{background:theme.primary,color:theme.light,fontSize:8,padding:"4px 14px",marginBottom:6,display:"flex",gap:16,flexWrap:"wrap"}}>
                  <span>⏱ Total: <strong style={{color:"#fff"}}>{total} hrs</strong></span>
                  <span>📖 Lecture: <strong style={{color:"#fff"}}>{lecH} hrs</strong></span>
                  <span>🔬 Lab: <strong style={{color:"#fff"}}>{labH} hrs</strong></span>
                </div>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:8}}>
                  <thead><tr>
                    <th style={{background:theme.primary3,color:"#fff",border:`1px solid ${theme.primary}`,padding:"6px 4px",width:80}}>Time</th>
                    {DAYS.map(d=><th key={d} style={{background:theme.primary,color:"#fff",border:`1px solid ${theme.primary3}`,padding:"6px 4px"}}>{d}</th>)}
                  </tr></thead>
                  <tbody>{instSlots.map(t=>{
                    if(t===LUNCH_START) return (
                      <tr key="lunch">
                        <td style={{background:"#fef9c3",border:"1px solid #ddd",padding:"3px 4px",fontWeight:700,fontSize:7.5,textAlign:"center",color:"#854d0e",height:28}}>{fmtRange(LUNCH_START,LUNCH_END)}</td>
                        {DAYS.map(day=><td key={day} style={{border:"1px solid #ddd",textAlign:"center",height:28,background:"#fef9c3"}}><span style={{fontSize:8,color:"#854d0e",fontWeight:700}}>🍽 Lunch</span></td>)}
                      </tr>
                    );
                    if(t>LUNCH_START&&t<LUNCH_END) return null;
                    const nextT=instSlots[instSlots.indexOf(t)+1]??(t+1);
                    return (
                      <tr key={t}>
                        <td style={{background:theme.light,border:"1px solid #ddd",padding:"3px 4px",fontWeight:700,fontSize:7.5,textAlign:"center",color:theme.primary,height:36,whiteSpace:"nowrap"}}>{fmtRange(t,nextT)}</td>
                        {DAYS.map(day=>{
                          const m=cls.find(c=>c.day===day&&Number(c.start)<=t&&Number(c.end)>t&&!c.is_break);
                          const brk=cls.find(c=>c.day===day&&c.is_break&&Number(c.start)<=t&&Number(c.end)>t);
                          const lb=m?.roomType==="Laboratory";
                          if(brk) return <td key={day} style={{border:"1px solid #ddd",textAlign:"center",height:36,background:"#fef9c3"}}><span style={{fontSize:8,color:"#854d0e",fontWeight:700}}>☕ Break</span></td>;
                          if (!m) return <td key={day} style={{border:"1px solid #ddd",height:36,background:"#fff"}}/>;
                          const { code, name, type } = resolveSubjectDisplay(m, codeMap);
                          const isGE = type === "GE";
                          const textColor = isGE ? "#4d7c0f" : theme.primary;
                          return (
                            <td key={day} style={{border:"1px solid #ddd",textAlign:"center",verticalAlign:"middle",height:36,background:m?(lb?theme.light2:theme.light):"#fff"}}>
                              <span style={{fontSize:"8.5pt",fontWeight:900,letterSpacing:0.8,textTransform:"uppercase",color:textColor}}>{code || name}</span>
                              {m.section&&<span style={{fontSize:"7.5pt",color:theme.primary,display:"block",fontWeight:700}}>{m.section}</span>}
                              <span style={{fontSize:"7pt",color:"#475569",display:"block"}}>{m.room}</span>
                              <span style={{fontSize:"7pt",color:lb?theme.text:"#166534",fontWeight:700}}>{lb?"🔬 Lab":"📖 Lec"}</span>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ════════ PRINT MODAL — STUDENT ════════ */
function StudentPrintModal({ schedules, section, academicYear, semester, onClose, theme, codeMap }) {
  const ref=useRef();
  const [printing,setPrinting]=useState(false);
  const real=schedules.filter(s=>!s.is_break);
  const total=real.reduce((s,c)=>s+(c.end-c.start),0);
  const labH=real.filter(c=>c.roomType==="Laboratory").reduce((s,c)=>s+(c.end-c.start),0);
  const lecH=real.filter(c=>c.roomType==="Lecture").reduce((s,c)=>s+(c.end-c.start),0);
  const timeSlots = buildPrintTimeSlots(schedules);

  const handlePrint=async()=>{
    setPrinting(true);
    const win=window.open("","_blank");
    win.document.write(`<!DOCTYPE html><html><head><title>Student Schedule - ${section}</title><style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;font-size:10pt;color:#000;}.page{padding:14mm;}table{width:100%;border-collapse:collapse;}th{background:${theme.primary};color:#fff;font-weight:bold;padding:6px 4px;text-align:center;border:1px solid ${theme.primary3};font-size:8pt;}td{border:1px solid #ddd;padding:4px;text-align:center;vertical-align:middle;height:40px;}@media print{@page{margin:0;size:A4 landscape;}body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}</style></head><body><div class="page">${ref.current.innerHTML}</div></body></html>`);
    win.document.close(); win.focus();
    setTimeout(()=>{win.print();win.close();setPrinting(false);},700);
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}} onClick={onClose}>
      <div style={{background:"#fff",borderRadius:16,padding:28,width:"100%",maxWidth:1000,maxHeight:"93vh",overflowY:"auto",display:"flex",flexDirection:"column",gap:16,boxShadow:"0 24px 64px rgba(0,0,0,0.28)"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,borderBottom:`1px solid ${theme.light2}`,paddingBottom:14}}>
          <div><div style={{fontSize:17,fontWeight:700}}>🖨 Print — {section}</div></div>
          <div style={{display:"flex",gap:8}}>
            <button style={{padding:"10px 20px",background:printing?"#94a3b8":theme.primary,color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:14,fontWeight:600}} onClick={handlePrint} disabled={printing}>{printing?"⏳ Preparing…":"🖨 Print / Save PDF"}</button>
            <button style={{padding:"10px 18px",background:theme.light,color:theme.text,border:`1px solid ${theme.border}`,borderRadius:8,cursor:"pointer",fontSize:14}} onClick={onClose}>✕ Close</button>
          </div>
        </div>
        <div ref={ref} style={{fontFamily:"Arial,sans-serif",fontSize:10,color:"#000",background:"#fff",border:`1px solid ${theme.border}`,borderRadius:8,padding:"22px 26px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:14,paddingBottom:10,marginBottom:8,borderBottom:"3px double #000"}}>
            <DeptLogo code={theme.code} style={{width:56,height:56,objectFit:"contain"}} alt={theme.code}/>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:15,fontWeight:900,textTransform:"uppercase"}}>Passi City College</div>
              <div style={{fontSize:10.5,fontWeight:700,color:theme.primary,marginTop:3}}>{theme.shortName}</div>
              <div style={{fontSize:8.5,color:"#555",marginTop:2}}>Passi City, Iloilo, Philippines</div>
            </div>
            <img src={PCCLogo} style={{width:56,height:56,objectFit:"contain"}} alt="PCC"/>
          </div>
          <div style={{textAlign:"center",fontSize:13,fontWeight:"bold",textTransform:"uppercase",letterSpacing:1.5,margin:"10px 0 3px"}}>Class Schedule</div>
          <div style={{textAlign:"center",fontSize:11,fontWeight:700,color:theme.primary,marginBottom:3}}>{section}</div>
          {(academicYear || semester) && (
            <div style={{textAlign:"center",fontSize:9.5,color:theme.primary,fontWeight:600,marginBottom:4}}>
              {academicYear ? `Academic Year ${academicYear}` : ""}{academicYear && semester ? " · " : ""}{semester || ""}
            </div>
          )}
          <hr style={{border:"none",borderTop:`2px solid ${theme.primary}`,margin:"8px 0 6px"}}/>
          <div style={{background:theme.primary,color:theme.light,fontSize:8,padding:"4px 14px",marginBottom:10,display:"flex",gap:16,flexWrap:"wrap",borderRadius:4}}>
            <span>⏱ Total: <strong style={{color:"#fff"}}>{total} hrs</strong></span>
            <span>📖 Lecture: <strong style={{color:"#fff"}}>{lecH} hrs</strong></span>
            <span>🔬 Lab: <strong style={{color:"#fff"}}>{labH} hrs</strong></span>
          </div>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:8}}>
            <thead><tr>
              <th style={{background:theme.primary3,color:"#fff",border:`1px solid ${theme.primary}`,padding:"6px 4px",width:80}}>Time</th>
              {DAYS.map(d=><th key={d} style={{background:theme.primary,color:"#fff",border:`1px solid ${theme.primary3}`,padding:"6px 4px"}}>{d}</th>)}
            </tr></thead>
            <tbody>
              {timeSlots.map(t=>{
                if(t === LUNCH_START) return (
                  <tr key="lunch">
                    <td style={{background:"#fef9c3",border:`1px solid #ddd`,padding:"3px 4px",fontWeight:700,fontSize:7.5,textAlign:"center",color:"#854d0e",height:28,whiteSpace:"nowrap"}}>{fmtRange(LUNCH_START,LUNCH_END)}</td>
                    {DAYS.map(day=><td key={day} style={{border:`1px solid #ddd`,textAlign:"center",height:28,background:"#fef9c3"}}><span style={{fontSize:8,color:"#854d0e",fontWeight:700}}>🍽 Lunch</span></td>)}
                  </tr>
                );
                if(t > LUNCH_START && t < LUNCH_END) return null;
                const nextT = timeSlots[timeSlots.indexOf(t)+1] ?? (t+1);
                return (
                  <tr key={t}>
                    <td style={{background:theme.light,border:`1px solid #ddd`,padding:"3px 4px",fontWeight:700,fontSize:7.5,textAlign:"center",color:theme.primary,height:40,whiteSpace:"nowrap"}}>{fmtRange(t,nextT)}</td>
                    {DAYS.map(day=>{
                      const m=schedules.find(c=>c.day===day&&c.start<=t&&c.end>t&&!c.is_break);
                      const brk=schedules.find(c=>c.day===day&&c.is_break&&c.start<=t&&c.end>t);
                      const lb=m?.roomType==="Laboratory";
                      if(brk) return <td key={day} style={{border:`1px solid #ddd`,textAlign:"center",height:40,background:"#fef9c3"}}><span style={{fontSize:8,color:"#854d0e",fontWeight:700}}>☕ Break</span></td>;
                      if (!m) return <td key={day} style={{border:`1px solid #ddd`,height:40,background:"#fff"}}/>;
                      const { code, name, type } = resolveSubjectDisplay(m, codeMap);
                      const isGE = type === "GE";
                      const textColor = isGE ? "#4d7c0f" : theme.primary;
                      return (
                        <td key={day} style={{border:`1px solid #ddd`,textAlign:"center",verticalAlign:"middle",height:40,background:m?(lb?theme.light2:theme.light):"#fff"}}>
                          <span style={{fontSize:"8.5pt",fontWeight:900,letterSpacing:0.8,textTransform:"uppercase",color:textColor}}>{code || name}</span>
                          {m.instructor&&<span style={{fontSize:"7.5pt",color:theme.primary,display:"block",fontWeight:700}}>{m.instructor}</span>}
                          <span style={{fontSize:"7pt",color:"#475569",display:"block"}}>{m.room}</span>
                          <span style={{fontSize:"7pt",color:lb?theme.text:"#166534",fontWeight:700}}>{lb?"🔬 Lab":"📖 Lec"}</span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ════════ ROOM SCHEDULE ════════ */
function buildRoomBlocks(instructorSchedules, studentSchedules) {
  const instReal = (instructorSchedules || []).filter(s => !s.is_break && s.room);
  const studReal = (studentSchedules   || []).filter(s => !s.is_break && s.room);
  const seen  = new Set();
  const all   = [];
  for (const b of studReal) {
    const key = `${b.room}|${b.day}|${b.start}|${b.end}|${normName(b.subject)}`;
    if (!seen.has(key)) { seen.add(key); all.push({ ...b, _src:"student" }); }
  }
  for (const b of instReal) {
    const key = `${b.room}|${b.day}|${b.start}|${b.end}|${normName(b.subject)}`;
    if (!seen.has(key)) { seen.add(key); all.push({ ...b, _src:"instructor" }); }
  }
  return all;
}

function RoomPrintModal({ room, blocks, academicYear, semester, onClose, theme, codeMap }) {
  const ref = useRef();
  const [printing, setPrinting] = useState(false);
  const isLab = LAB_ROOMS.includes(room);
  const timeSlots = buildPrintTimeSlots(blocks);

  const handlePrint = () => {
    setPrinting(true);
    const win = window.open("", "_blank");
    win.document.write(`<!DOCTYPE html><html><head><title>Room Schedule - ${room}</title><style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;font-size:10pt;color:#000;}.page{padding:14mm;}table{width:100%;border-collapse:collapse;}th{background:${theme.primary};color:#fff;font-weight:bold;padding:6px 4px;text-align:center;border:1px solid ${theme.primary3};font-size:8pt;}td{border:1px solid #ddd;padding:4px;text-align:center;vertical-align:middle;height:40px;}@media print{@page{margin:0;size:A4 landscape;}body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}</style></head><body><div class="page">${ref.current.innerHTML}</div></body></html>`);
    win.document.close(); win.focus();
    setTimeout(() => { win.print(); win.close(); setPrinting(false); }, 700);
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}} onClick={onClose}>
      <div style={{background:"#fff",borderRadius:16,padding:28,width:"100%",maxWidth:1000,maxHeight:"93vh",overflowY:"auto",display:"flex",flexDirection:"column",gap:16,boxShadow:"0 24px 64px rgba(0,0,0,0.28)"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,borderBottom:`1px solid ${theme.light2}`,paddingBottom:14}}>
          <div>
            <div style={{fontSize:17,fontWeight:700}}>🖨 Print — {room}</div>
            <div style={{fontSize:12,color:"#64748b",marginTop:2}}>{isLab?"🔬 Laboratory":"📖 Lecture Room"} · {blocks.filter(b=>!b.is_break).length} block(s)</div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button style={{padding:"10px 20px",background:printing?"#94a3b8":theme.primary,color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:14,fontWeight:600}} onClick={handlePrint} disabled={printing}>{printing?"⏳ Preparing…":"🖨 Print / Save PDF"}</button>
            <button style={{padding:"10px 18px",background:theme.light,color:theme.text,border:`1px solid ${theme.border}`,borderRadius:8,cursor:"pointer",fontSize:14}} onClick={onClose}>✕ Close</button>
          </div>
        </div>
        <div ref={ref} style={{fontFamily:"Arial,sans-serif",fontSize:10,color:"#000",background:"#fff",border:`1px solid ${theme.border}`,borderRadius:8,padding:"22px 26px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:14,paddingBottom:10,marginBottom:8,borderBottom:"3px double #000"}}>
            <DeptLogo code={theme.code} style={{width:56,height:56,objectFit:"contain"}} alt={theme.code}/>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:15,fontWeight:900,textTransform:"uppercase"}}>Passi City College</div>
              <div style={{fontSize:10.5,fontWeight:700,color:theme.primary,marginTop:3}}>{theme.shortName}</div>
              <div style={{fontSize:8.5,color:"#555",marginTop:2}}>Passi City, Iloilo, Philippines</div>
            </div>
            <img src={PCCLogo} style={{width:56,height:56,objectFit:"contain"}} alt="PCC"/>
          </div>
          <div style={{textAlign:"center",fontSize:13,fontWeight:"bold",textTransform:"uppercase",letterSpacing:1.5,margin:"10px 0 3px"}}>Room Schedule</div>
          <div style={{textAlign:"center",fontSize:11,fontWeight:700,color:theme.primary,marginBottom:3}}>{room} — {isLab?"Laboratory":"Lecture Room"}</div>
          {(academicYear || semester) && (
            <div style={{textAlign:"center",fontSize:9.5,color:theme.primary,fontWeight:600,marginBottom:4}}>
              {academicYear ? `Academic Year ${academicYear}` : ""}{academicYear && semester ? " · " : ""}{semester || ""}
            </div>
          )}
          <hr style={{border:"none",borderTop:`2px solid ${theme.primary}`,margin:"8px 0 10px"}}/>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:8}}>
            <thead><tr>
              <th style={{background:theme.primary3,color:"#fff",border:`1px solid ${theme.primary}`,padding:"6px 4px",width:80}}>Time</th>
              {DAYS.map(d=><th key={d} style={{background:theme.primary,color:"#fff",border:`1px solid ${theme.primary3}`,padding:"6px 4px"}}>{d}</th>)}
            </tr></thead>
            <tbody>
              {timeSlots.map(t => {
                if (t === LUNCH_START) return (
                  <tr key="lunch">
                    <td style={{background:"#fef9c3",border:"1px solid #ddd",padding:"3px 4px",fontWeight:700,fontSize:7.5,textAlign:"center",color:"#854d0e",height:28,whiteSpace:"nowrap"}}>{fmtRange(LUNCH_START,LUNCH_END)}</td>
                    {DAYS.map(day=><td key={day} style={{border:"1px solid #ddd",textAlign:"center",height:28,background:"#fef9c3"}}><span style={{fontSize:8,color:"#854d0e",fontWeight:700}}>🍽 Lunch</span></td>)}
                  </tr>
                );
                if (t > LUNCH_START && t < LUNCH_END) return null;
                const nextT = timeSlots[timeSlots.indexOf(t)+1] ?? (t+1);
                return (
                  <tr key={t}>
                    <td style={{background:theme.light,border:"1px solid #ddd",padding:"3px 4px",fontWeight:700,fontSize:7.5,textAlign:"center",color:theme.primary,height:40,whiteSpace:"nowrap"}}>{fmtRange(t,nextT)}</td>
                    {DAYS.map(day => {
                      const m = blocks.find(c=>c.day===day&&Number(c.start)<=t&&Number(c.end)>t&&!c.is_break);
                      const lb = isLab;
                      if (!m) return <td key={day} style={{border:"1px solid #ddd",height:40,background:"#fff"}}/>;
                      const { code, name, type } = resolveSubjectDisplay(m, codeMap);
                      const isGE = type === "GE";
                      const textColor = isGE ? "#4d7c0f" : theme.primary;
                      return (
                        <td key={day} style={{border:"1px solid #ddd",textAlign:"center",verticalAlign:"middle",height:40,background:m?(lb?theme.light2:theme.light):"#fff"}}>
                          <span style={{fontSize:"8.5pt",fontWeight:900,letterSpacing:0.8,textTransform:"uppercase",color:textColor}}>{code || name}</span>
                          {m.instructor&&<span style={{fontSize:"7.5pt",color:theme.primary,display:"block",fontWeight:700}}>{m.instructor}</span>}
                          {m.section&&<span style={{fontSize:"7pt",color:"#475569",display:"block"}}>{m.section}</span>}
                          <span style={{fontSize:"7pt",color:lb?theme.text:"#166634",fontWeight:700}}>{lb?"🔬 Lab":"📖 Lec"}</span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function RoomScheduleView({ instructorSchedules, studentSchedules, academicYear, semester, theme, codeMap }) {
  const [selectedRoom, setSelectedRoom] = useState("All");
  const [printRoom,    setPrintRoom]    = useState(null);
  const allBlocks = buildRoomBlocks(instructorSchedules, studentSchedules);
  const usedRooms = ALL_ROOMS.filter(r => allBlocks.some(b => b.room === r));
  const displayRooms = selectedRoom === "All" ? usedRooms : (usedRooms.includes(selectedRoom) ? [selectedRoom] : []);
  const roomBlocksFor = (room) => allBlocks.filter(b => b.room === room);
  const cardStyle = { border:`1px solid #e2e8f0`,borderRadius:10,padding:16,background:`linear-gradient(to bottom,${theme.light},#fff)`,marginBottom:8 };
  return (
    <div style={{display:"flex",flexDirection:"column",gap:16,width:"100%",maxWidth:1300,alignSelf:"flex-start"}}>
      {printRoom && <RoomPrintModal room={printRoom} blocks={roomBlocksFor(printRoom)} academicYear={academicYear} semester={semester} onClose={()=>setPrintRoom(null)} theme={theme} codeMap={codeMap}/>}
      <div style={{background:theme.headerBg,borderRadius:10,padding:"16px 22px",display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
        <div style={{fontSize:28}}>🏫</div>
        <div><div style={{color:"#fff",fontWeight:800,fontSize:16}}>Room Schedule</div><div style={{color:"rgba(255,255,255,0.65)",fontSize:12,marginTop:2}}>Aggregated from Instructor &amp; Student schedules · {theme.code}</div></div>
        <div style={{marginLeft:"auto",display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:12,color:"rgba(255,255,255,0.7)",fontWeight:600}}>Filter Room:</span>
          <select value={selectedRoom} onChange={e=>setSelectedRoom(e.target.value)} style={{padding:"7px 12px",borderRadius:7,border:"none",fontSize:13,fontWeight:600,background:"rgba(255,255,255,0.15)",color:"#fff",cursor:"pointer",outline:"none"}}>
            <option value="All" style={{color:"#000"}}>All Rooms</option>
            <optgroup label="── Lecture Rooms ──" style={{color:"#000"}}>{LECTURE_ROOMS.map(r=><option key={r} value={r} style={{color:"#000"}}>{r}</option>)}</optgroup>
            <optgroup label="── Laboratories ──" style={{color:"#000"}}>{LAB_ROOMS.map(r=><option key={r} value={r} style={{color:"#000"}}>{r}</option>)}</optgroup>
          </select>
        </div>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <span style={{padding:"4px 14px",borderRadius:20,fontSize:12,fontWeight:600,background:theme.light2,color:theme.text,border:`1px solid ${theme.border}`}}>🏫 {usedRooms.length} room{usedRooms.length!==1?"s":""} in use</span>
        <span style={{padding:"4px 14px",borderRadius:20,fontSize:12,fontWeight:600,background:"#dcfce7",color:"#166534",border:"1px solid #86efac"}}>📖 Lecture: {LECTURE_ROOMS.filter(r=>usedRooms.includes(r)).length}</span>
        <span style={{padding:"4px 14px",borderRadius:20,fontSize:12,fontWeight:600,background:theme.light2,color:theme.text,border:`1px solid ${theme.border}`}}>🔬 Lab: {LAB_ROOMS.filter(r=>usedRooms.includes(r)).length}</span>
        <span style={{padding:"4px 14px",borderRadius:20,fontSize:12,fontWeight:600,background:"#fef9c3",color:"#854d0e",border:"1px solid #fde68a"}}>📋 {allBlocks.length} total block{allBlocks.length!==1?"s":""}</span>
      </div>
      {usedRooms.length === 0 && <div style={{textAlign:"center",padding:"48px 0",color:"#94a3b8",fontSize:14}}>No room data yet. Add instructor or student schedules first.</div>}
      {displayRooms.map(room => {
        const blocks = roomBlocksFor(room);
        const isLab  = LAB_ROOMS.includes(room);
        const totalH = blocks.reduce((s,b)=>s+(Number(b.end)-Number(b.start)),0);
        return (
          <div key={room} style={cardStyle}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8,borderBottom:`2px solid ${theme.border}`,paddingBottom:10,marginBottom:14}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:20}}>{isLab?"🔬":"📖"}</span>
                <div><div style={{fontSize:15,fontWeight:700,color:"#0f172a"}}>{room}</div><div style={{fontSize:11,color:theme.primary,fontWeight:600}}>{isLab?"Laboratory":"Lecture Room"}</div></div>
                <span style={{padding:"3px 12px",borderRadius:20,fontSize:11,fontWeight:600,background:isLab?theme.light2:"#dcfce7",color:isLab?theme.text:"#166534",border:`1px solid ${isLab?theme.border:"#86efac"}`}}>⏱ {totalH} hr{totalH!==1?"s":""}</span>
              </div>
              <button onClick={()=>setPrintRoom(room)} style={{padding:"6px 16px",background:theme.primary,color:"#fff",border:"none",borderRadius:7,cursor:"pointer",fontSize:12,fontWeight:600}}>🖨 Print</button>
            </div>
            {DAYS.map(day => {
              const dayBlocks = blocks.filter(b=>b.day===day).sort((a,b)=>Number(a.start)-Number(b.start));
              if (!dayBlocks.length) return null;
              return (
                <div key={day} style={{marginBottom:14}}>
                  <span style={{background:theme.primary,color:"#fff",padding:"3px 12px",borderRadius:20,fontSize:11,fontWeight:600}}>{day}</span>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>
                    {dayBlocks.map((b,i) => {
                      const lab = isLab;
                      const { code, name, type } = resolveSubjectDisplay(b, codeMap);
                      const badgeBg = getBadgeBg(type, theme);
                      return (
                        <div key={i} style={{padding:"14px 16px",minWidth:180,border:`1px solid ${lab?theme.border:"#86efac"}`,borderLeft:`4px solid ${lab?theme.primary:"#16a34a"}`,borderRadius:10,background:lab?theme.light:"#f0fdf4",boxShadow:"0 2px 8px rgba(0,0,0,0.07)",display:"flex",flexDirection:"column",gap:4}}>
                          <div style={{display:"inline-flex",alignSelf:"flex-start",background:badgeBg,color:"#fff",borderRadius:6,padding:"4px 11px",fontSize:13,fontWeight:900,letterSpacing:1.2,textTransform:"uppercase",boxShadow:`0 2px 8px ${lab?"rgba(0,0,0,0.15)":"rgba(22,163,74,0.2)"}`}}>{code || name}</div>
                          <span style={{alignSelf:"flex-start",fontSize:10,fontWeight:700,color:lab?theme.text:"#166534",background:lab?theme.light2:"#dcfce7",padding:"2px 9px",borderRadius:20,border:`1px solid ${lab?theme.border:"#86efac"}`}}>{lab?"🔬 Lab":"📖 Lec"}</span>
                          {b.instructor&&<span style={{fontSize:11,color:theme.primary,fontWeight:700}}>👤 {b.instructor}</span>}
                          {b.section&&<span style={{fontSize:11,color:"#475569",fontWeight:600}}>🎓 {b.section}</span>}
                          <span style={{fontSize:11,color:"#334155"}}>🕐 {fmtRange(Number(b.start),Number(b.end))}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   ══ SECTION POOL PAGE ══
   ══════════════════════════════════════════════════════════════ */
function SectionPoolPage({ theme, activeSemester }) {
  const [sections,      setSections]      = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [form,          setForm]          = useState({ section_name:"", year_level:1 });
  const [err,           setErr]           = useState("");
  const [saving,        setSaving]        = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [editId,        setEditId]        = useState(null);

  useEffect(() => { loadSections(); }, [activeSemester]);

  async function loadSections() {
    setLoading(true);
    try {
      const res  = await fetch(`/api/sections?semester=${encodeURIComponent(activeSemester)}`, { credentials:"include" });
      const data = res.ok ? await res.json() : [];
      setSections(Array.isArray(data) ? data : []);
    } catch { setSections([]); }
    setLoading(false);
  }

  function resetForm() {
    setForm({ section_name:"", year_level:1 });
    setEditId(null); setErr("");
  }

  function startEdit(sec) {
    setEditId(sec.id);
    setForm({ section_name: sec.section_name, year_level: sec.year_level });
    setErr("");
    window.scrollTo({ top:0, behavior:"smooth" });
  }

  async function handleSave() {
    if (!form.section_name.trim()) { setErr("Section name is required."); return; }
    setSaving(true); setErr("");
    try {
      const url    = editId ? `/api/sections/${editId}` : "/api/sections";
      const method = editId ? "PUT" : "POST";
      const res    = await fetch(url, { method, credentials:"include", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ ...form, semester: activeSemester }) });
      const data   = await res.json();
      if (!res.ok) { setErr(data.error || "Failed to save."); setSaving(false); return; }
      await loadSections();
      resetForm();
    } catch { setErr("Network error."); }
    setSaving(false);
  }

  async function handleDelete(id) {
    try {
      const res  = await fetch(`/api/sections/${id}`, { method:"DELETE", credentials:"include" });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "Failed to delete."); return; }
      setSections(prev => prev.filter(s => s.id !== id));
      setDeleteConfirm(null);
    } catch { alert("Network error."); }
  }

  const inpStyle     = { padding:"9px 12px", border:`1.5px solid ${theme.border}`, borderRadius:8, fontSize:14, outline:"none", background:"#fff", color:"#0f172a", width:"100%", boxSizing:"border-box" };
  const btnPrimary   = { padding:"10px 22px", background:theme.primary, color:"#fff", border:"none", borderRadius:8, cursor:"pointer", fontSize:14, fontWeight:600 };
  const btnSecondary = { padding:"10px 18px", background:theme.light, color:theme.text, border:`1px solid ${theme.border}`, borderRadius:8, cursor:"pointer", fontSize:14 };

  const byYear = [1,2,3,4].reduce((acc, y) => {
    acc[y] = sections.filter(s => s.year_level === y);
    return acc;
  }, {});

  const yearColors = {
    1: { bg:"#dbeafe", border:"#bfdbfe", badge:"#2563eb", text:"#1e40af", label:"First Year",  emoji:"🌱" },
    2: { bg:"#dcfce7", border:"#86efac", badge:"#16a34a", text:"#166534", label:"Second Year", emoji:"🌿" },
    3: { bg:"#fef9c3", border:"#fde68a", badge:"#d97706", text:"#854d0e", label:"Third Year",  emoji:"🌳" },
    4: { bg:"#fce7f3", border:"#fbcfe8", badge:"#9d174d", text:"#831843", label:"Fourth Year", emoji:"🎓" },
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20,width:"100%",maxWidth:1100,alignSelf:"flex-start"}}>
      <div style={{background:theme.headerBg,borderRadius:10,padding:"16px 22px",display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
        <div style={{fontSize:28}}>🎓</div>
        <div>
          <div style={{color:"#fff",fontWeight:800,fontSize:16}}>Section Pool</div>
          <div style={{color:"rgba(255,255,255,0.65)",fontSize:12,marginTop:2}}>
            {theme.code} · <strong style={{color:"#fff"}}>{activeSemester}</strong> — Manage enrolled sections by year level
          </div>
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:8}}>
          <div style={{background:"rgba(255,255,255,0.12)",borderRadius:8,padding:"8px 16px",textAlign:"center"}}>
            <div style={{color:"rgba(255,255,255,0.6)",fontSize:10}}>Total Sections</div>
            <div style={{color:"#fff",fontSize:18,fontWeight:800}}>{sections.length}</div>
          </div>
        </div>
      </div>
      <div style={{background:"#f0fdf4",border:"1px solid #86efac",borderRadius:10,padding:"12px 18px",fontSize:13,color:"#166534",display:"flex",gap:10,alignItems:"center"}}>
        <span style={{fontSize:18}}>ℹ️</span>
        <span>Sections added here will appear as a dropdown in <strong>Student Load</strong>. Add all sections enrolled for <strong>{activeSemester}</strong>.</span>
      </div>
      <div style={{background:"#fff",borderRadius:12,padding:24,boxShadow:`0 2px 10px rgba(0,0,0,0.07)`,borderTop:`4px solid ${theme.primary}`}}>
        <div style={{fontSize:15,fontWeight:700,color:"#0f172a",marginBottom:16}}>{editId ? "✏ Edit Section" : "➕ Add New Section"}</div>
        {err && <div style={{background:"#fee2e2",color:"#dc2626",border:"1px solid #fca5a5",borderRadius:8,padding:"10px 14px",fontSize:13,marginBottom:14}}>⚠ {err}</div>}
        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:12,alignItems:"end",marginBottom:14}}>
          <div>
            <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:5}}>Section Name</label>
            <input style={{...inpStyle, fontWeight:700, color:theme.primary, fontSize:15}} placeholder={`e.g. ${theme.code} 1A, ${theme.code} 2B`} value={form.section_name} onChange={e => setForm(f => ({ ...f, section_name: e.target.value }))}/>
          </div>
          <div>
            <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:5}}>Year Level</label>
            <select style={inpStyle} value={form.year_level} onChange={e => setForm(f => ({ ...f, year_level: parseInt(e.target.value) }))}>
              <option value={1}>🌱 First Year</option>
              <option value={2}>🌿 Second Year</option>
              <option value={3}>🌳 Third Year</option>
              <option value={4}>🎓 Fourth Year</option>
            </select>
          </div>
        </div>
        {form.section_name && (
          <div style={{marginBottom:14,padding:"10px 16px",background:yearColors[form.year_level].bg,border:`1.5px solid ${yearColors[form.year_level].border}`,borderRadius:8,display:"flex",alignItems:"center",gap:12}}>
            <span style={{fontSize:20}}>{yearColors[form.year_level].emoji}</span>
            <div>
              <div style={{fontSize:11,color:yearColors[form.year_level].text,fontWeight:600,marginBottom:2}}>Preview</div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{background:yearColors[form.year_level].badge,color:"#fff",borderRadius:6,padding:"3px 12px",fontSize:14,fontWeight:900,letterSpacing:.5}}>{form.section_name}</span>
                <span style={{fontSize:12,color:yearColors[form.year_level].text,fontWeight:600}}>{yearColors[form.year_level].label}</span>
              </div>
            </div>
          </div>
        )}
        <div style={{padding:"8px 12px",background:theme.light2,border:`1px solid ${theme.border}`,borderRadius:7,fontSize:12,color:theme.text,marginBottom:14}}>
          📅 Saving under <strong>{activeSemester}</strong>.
        </div>
        <div style={{display:"flex",gap:10}}>
          <button style={btnPrimary} onClick={handleSave} disabled={saving}>{saving ? "Saving…" : editId ? "✓ Update Section" : "✓ Add Section"}</button>
          {editId && <button style={btnSecondary} onClick={resetForm}>✕ Cancel</button>}
        </div>
      </div>
      {loading ? (
        <div style={{textAlign:"center",padding:"40px 0",color:"#94a3b8"}}>Loading sections…</div>
      ) : sections.length === 0 ? (
        <div style={{textAlign:"center",padding:"40px 0",color:"#94a3b8",fontSize:14}}>No sections yet for {activeSemester}. Add one above.</div>
      ) : (
        [1,2,3,4].map(y => {
          const list = byYear[y];
          if (!list.length) return null;
          const yc = yearColors[y];
          return (
            <div key={y} style={{background:"#fff",borderRadius:12,overflow:"hidden",boxShadow:`0 2px 8px rgba(0,0,0,0.06)`}}>
              <div style={{background:yc.badge,color:"#fff",padding:"10px 20px",fontSize:13,fontWeight:700,display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:18}}>{yc.emoji}</span>
                {yc.label}
                <span style={{fontSize:11,opacity:0.75,fontWeight:400}}>· {list.length} section{list.length!==1?"s":""}</span>
              </div>
              <div style={{padding:"14px 20px",display:"flex",gap:10,flexWrap:"wrap"}}>
                {list.map((sec, i) => (
                  <div key={sec.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",border:`1.5px solid ${yc.border}`,borderRadius:10,background:yc.bg,minWidth:160}}>
                    <span style={{background:yc.badge,color:"#fff",borderRadius:6,padding:"4px 12px",fontSize:13,fontWeight:900,letterSpacing:.5,flex:1}}>{sec.section_name}</span>
                    <button onClick={()=>startEdit(sec)} style={{padding:"4px 10px",background:"rgba(255,255,255,0.7)",color:yc.text,border:`1px solid ${yc.border}`,borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:600}}>✏</button>
                    {deleteConfirm===sec.id ? (
                      <>
                        <button onClick={()=>handleDelete(sec.id)} style={{padding:"4px 8px",background:"#ef4444",color:"#fff",border:"none",borderRadius:5,cursor:"pointer",fontSize:11,fontWeight:700}}>Yes</button>
                        <button onClick={()=>setDeleteConfirm(null)} style={{padding:"4px 8px",background:"#f1f5f9",color:"#64748b",border:"1px solid #cbd5e1",borderRadius:5,cursor:"pointer",fontSize:11}}>No</button>
                      </>
                    ) : (
                      <button onClick={()=>setDeleteConfirm(sec.id)} style={{padding:"4px 10px",background:"rgba(239,68,68,0.1)",color:"#ef4444",border:"1px solid #fca5a5",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:600}}>🗑</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   ══ SUBJECT SETUP PAGE — MODIFIED: added hour_load field ══
   ══════════════════════════════════════════════════════════════ */
function SubjectSetupPage({ theme, activeSemester, allSchedules = [] }) {
  const [subjects,       setSubjects]       = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [editId,         setEditId]         = useState(null);
  // ── MODIFIED: added hour_load to form (0 = unlimited) ──
  const [form,           setForm]           = useState({ subject_name:"", subject_code:"", subject_type:"Major", year_level:1, units:3, hour_load:0 });
  const [err,            setErr]            = useState("");
  const [saving,         setSaving]         = useState(false);
  const [deleteConfirm,  setDeleteConfirm]  = useState(null);

  const YEAR_LEVELS = [1, 2, 3, 4];

  useEffect(() => { loadSubjects(); }, [activeSemester]);

  async function loadSubjects() {
    setLoading(true);
    try {
      const res  = await fetch(`/api/subjects?semester=${encodeURIComponent(activeSemester)}`, { credentials:"include" });
      const data = res.ok ? await res.json() : [];
      setSubjects(Array.isArray(data) ? data : []);
    } catch { setSubjects([]); }
    setLoading(false);
  }

  function resetForm() {
    setForm({ subject_name:"", subject_code:"", subject_type:"Major", year_level:1, units:3, hour_load:0 });
    setEditId(null); setErr("");
  }

  function startEdit(s) {
    setEditId(s.id);
    setForm({ subject_name:s.subject_name, subject_code:s.subject_code||"", subject_type:s.subject_type, year_level:s.year_level, units:s.units, hour_load:s.hour_load||0 });
    setErr("");
    window.scrollTo({ top:0, behavior:"smooth" });
  }

  async function handleSave() {
    if (!form.subject_name.trim()) { setErr("Subject name is required."); return; }
    if (!form.subject_code.trim()) { setErr("Subject code is required (e.g. SIA, CC101)."); return; }
    const typeToSave = hasGE(form.year_level, activeSemester) ? form.subject_type : "Major";
    setSaving(true); setErr("");
    try {
      const url    = editId ? `/api/subjects/${editId}` : "/api/subjects";
      const method = editId ? "PUT" : "POST";
      const res    = await fetch(url, { method, credentials:"include", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ ...form, subject_type: typeToSave, semester: activeSemester }) });
      const data   = await res.json();
      if (!res.ok) { setErr(data.error || "Failed to save."); setSaving(false); return; }
      await loadSubjects();
      resetForm();
    } catch { setErr("Network error."); }
    setSaving(false);
  }

  async function handleDelete(id) {
    try {
      const res  = await fetch(`/api/subjects/${id}`, { method:"DELETE", credentials:"include" });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "Failed to delete."); return; }
      setSubjects(prev => prev.filter(s => s.id !== id));
      setDeleteConfirm(null);
    } catch { alert("Network error."); }
  }

  // ── Helper: compute how many hours a subject has been scheduled ──
  function getConsumedHours(subjectName) {
    return allSchedules
      .filter(s => !s.is_break && normName(s.subject) === normName(subjectName))
      .reduce((sum, s) => sum + (Number(s.end) - Number(s.start)), 0);
  }

  const inpStyle = { padding:"9px 12px", border:`1.5px solid ${theme.border}`, borderRadius:8, fontSize:14, outline:"none", background:"#fff", color:"#0f172a", width:"100%", boxSizing:"border-box" };
  const btnPrimary   = { padding:"10px 22px", background:theme.primary, color:"#fff", border:"none", borderRadius:8, cursor:"pointer", fontSize:14, fontWeight:600 };
  const btnSecondary = { padding:"10px 18px", background:theme.light, color:theme.text, border:`1px solid ${theme.border}`, borderRadius:8, cursor:"pointer", fontSize:14 };

  const byYear = YEAR_LEVELS.reduce((acc, y) => {
    acc[y] = {
      ge:    subjects.filter(s => s.year_level === y && s.subject_type === "GE"),
      major: subjects.filter(s => s.year_level === y && s.subject_type === "Major"),
    };
    return acc;
  }, {});

  const yearHasData = (y) => byYear[y].ge.length > 0 || byYear[y].major.length > 0;

  // ── MODIFIED: SubjectRow now shows hour_load + consumed hours bar ──
  const SubjectRow = ({ s, i }) => {
    const icon = getSubjectIcon(s.subject_name);
    const isGE = s.subject_type === "GE";
    const hourLoad = s.hour_load || 0;
    const consumed = getConsumedHours(s.subject_name);
    const pct = hourLoad > 0 ? Math.min(100, Math.round((consumed / hourLoad) * 100)) : 0;
    const overLimit = hourLoad > 0 && consumed >= hourLoad;
    return (
      <tr style={{ background: editId===s.id ? theme.light2 : (i%2===0?"#fff":"#f8fafc") }}>
        <td style={{padding:"10px 14px",borderBottom:`1px solid ${theme.light2}`}}>
          <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
            <span style={{fontSize:18,minWidth:24,textAlign:"center",marginTop:3}}>{icon}</span>
            <div style={{flex:1}}>
              {s.subject_code
                ? <div style={{marginBottom:5}}>
                    <span style={{display:"inline-block",padding:"4px 13px",background:isGE?"linear-gradient(135deg,#65a30d,#84cc16)":`linear-gradient(135deg,${theme.primary},${theme.primary3||theme.primary})`,color:"#fff",borderRadius:6,fontSize:13,fontWeight:900,letterSpacing:1.2,textTransform:"uppercase",boxShadow:"0 2px 8px rgba(0,0,0,0.18)"}}>{s.subject_code}</span>
                  </div>
                : <div style={{marginBottom:5}}><span style={{display:"inline-block",padding:"2px 10px",background:"#fef3c7",color:"#92400e",border:"1px dashed #fbbf24",borderRadius:5,fontSize:11,fontWeight:600}}>⚠ No code yet</span></div>
              }
              <div style={{fontWeight:600,color:"#0f172a",fontSize:13,lineHeight:1.4}}>{s.subject_name}</div>
            </div>
          </div>
        </td>
        <td style={{padding:"10px 12px",borderBottom:`1px solid ${theme.light2}`,textAlign:"center",fontWeight:700,color:theme.primary}}>{s.units}</td>
        {/* ── MODIFIED: Hour load column ── */}
        <td style={{padding:"10px 14px",borderBottom:`1px solid ${theme.light2}`,minWidth:160}}>
          {hourLoad > 0 ? (
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <span style={{fontSize:11,fontWeight:700,color:overLimit?"#ef4444":theme.text}}>
                  {consumed}h / {hourLoad}h
                </span>
                <span style={{fontSize:10,fontWeight:700,padding:"1px 7px",borderRadius:20,
                  background:overLimit?"#fee2e2":pct>=80?"#fef9c3":"#dcfce7",
                  color:overLimit?"#dc2626":pct>=80?"#854d0e":"#166534",
                  border:`1px solid ${overLimit?"#fca5a5":pct>=80?"#fde68a":"#86efac"}`}}>
                  {overLimit ? "🔴 Full" : pct >= 80 ? "🟡 Near full" : "🟢 Available"}
                </span>
              </div>
              <div style={{background:"#e2e8f0",borderRadius:99,height:6,overflow:"hidden"}}>
                <div style={{width:`${pct}%`,height:"100%",borderRadius:99,background:overLimit?"#ef4444":pct>=80?"#f59e0b":"#16a34a",transition:"width 0.3s"}}/>
              </div>
            </div>
          ) : (
            <span style={{fontSize:11,color:"#94a3b8",fontStyle:"italic"}}>No limit set</span>
          )}
        </td>
        <td style={{padding:"10px 12px",borderBottom:`1px solid ${theme.light2}`,textAlign:"center"}}>
          <div style={{display:"flex",gap:6,justifyContent:"center"}}>
            <button onClick={()=>startEdit(s)} style={{padding:"5px 12px",background:theme.light,color:theme.primary,border:`1px solid ${theme.border}`,borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:600}}>✏</button>
            {deleteConfirm===s.id ? (
              <>
                <button onClick={()=>handleDelete(s.id)} style={{padding:"5px 10px",background:"#ef4444",color:"#fff",border:"none",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:700}}>Yes</button>
                <button onClick={()=>setDeleteConfirm(null)} style={{padding:"5px 10px",background:"#f1f5f9",color:"#64748b",border:"1px solid #cbd5e1",borderRadius:6,cursor:"pointer",fontSize:11}}>No</button>
              </>
            ) : (
              <button onClick={()=>setDeleteConfirm(s.id)} style={{padding:"5px 12px",background:"#fee2e2",color:"#ef4444",border:"1px solid #fca5a5",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:600}}>🗑</button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  // ── MODIFIED: table header now includes Hour Load column ──
  const TwoColTable = ({ yearLevel, geList, majorList }) => {
    const showGE = hasGE(yearLevel, activeSemester);
    const tableHeader = (borderColor, bg, textColor) => (
      <thead><tr style={{background:bg}}>
        <th style={{padding:"9px 14px",textAlign:"left",borderBottom:`1px solid ${borderColor}`,fontWeight:600,color:textColor}}>Code + Description</th>
        <th style={{padding:"9px 12px",textAlign:"center",borderBottom:`1px solid ${borderColor}`,fontWeight:600,color:textColor,width:70}}>Units</th>
        <th style={{padding:"9px 12px",textAlign:"left",borderBottom:`1px solid ${borderColor}`,fontWeight:600,color:textColor,width:180}}>Hour Load</th>
        <th style={{padding:"9px 12px",textAlign:"center",borderBottom:`1px solid ${borderColor}`,fontWeight:600,color:textColor,width:100}}>Actions</th>
      </tr></thead>
    );
    if (!showGE) {
      return (
        <div style={{background:"#fff",borderRadius:10,overflow:"hidden",border:`1px solid ${theme.light2}`}}>
          <div style={{background:theme.primary,color:"#fff",padding:"8px 16px",fontSize:12,fontWeight:700,display:"flex",alignItems:"center",gap:8}}>🎯 Major Subjects <span style={{opacity:0.7,fontWeight:400,fontSize:11}}>({majorList.length})</span></div>
          {majorList.length === 0 ? <div style={{padding:"18px",textAlign:"center",color:"#94a3b8",fontSize:13}}>No Major subjects yet.</div> : <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>{tableHeader(theme.light2,theme.light,theme.text)}<tbody>{majorList.map((s,i)=><SubjectRow key={s.id} s={s} i={i}/>)}</tbody></table>}
        </div>
      );
    }
    return (
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <div style={{background:"#fff",borderRadius:10,overflow:"hidden",border:"1px solid #bfdbfe"}}>
          <div style={{background:"#2563eb",color:"#fff",padding:"8px 16px",fontSize:12,fontWeight:700,display:"flex",alignItems:"center",gap:8}}>🌐 General Education (GE) <span style={{opacity:0.7,fontWeight:400,fontSize:11}}>({geList.length})</span></div>
          {geList.length === 0 ? <div style={{padding:"18px",textAlign:"center",color:"#94a3b8",fontSize:13}}>No GE subjects yet.</div> : <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>{tableHeader("#bfdbfe","#eff6ff","#1e40af")}<tbody>{geList.map((s,i)=><SubjectRow key={s.id} s={s} i={i}/>)}</tbody></table>}
        </div>
        <div style={{background:"#fff",borderRadius:10,overflow:"hidden",border:`1px solid ${theme.border}`}}>
          <div style={{background:theme.primary,color:"#fff",padding:"8px 16px",fontSize:12,fontWeight:700,display:"flex",alignItems:"center",gap:8}}>🎯 Major Subjects <span style={{opacity:0.7,fontWeight:400,fontSize:11}}>({majorList.length})</span></div>
          {majorList.length === 0 ? <div style={{padding:"18px",textAlign:"center",color:"#94a3b8",fontSize:13}}>No Major subjects yet.</div> : <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>{tableHeader(theme.light2,theme.light,theme.text)}<tbody>{majorList.map((s,i)=><SubjectRow key={s.id} s={s} i={i}/>)}</tbody></table>}
        </div>
      </div>
    );
  };

  const showGEOption = hasGE(form.year_level, activeSemester);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20,width:"100%",maxWidth:1200,alignSelf:"flex-start"}}>
      <div style={{background:theme.headerBg,borderRadius:10,padding:"16px 22px",display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
        <div style={{fontSize:28}}>📚</div>
        <div>
          <div style={{color:"#fff",fontWeight:800,fontSize:16}}>Subject Setup</div>
          <div style={{color:"rgba(255,255,255,0.65)",fontSize:12,marginTop:2}}>{theme.code} · <strong style={{color:"#fff"}}>{activeSemester}</strong> — GE &amp; Major subjects by year level</div>
        </div>
        <div style={{marginLeft:"auto",background:"rgba(255,255,255,0.12)",borderRadius:8,padding:"8px 16px",textAlign:"center"}}>
          <div style={{color:"rgba(255,255,255,0.6)",fontSize:10}}>Total ({activeSemester})</div>
          <div style={{color:"#fff",fontSize:18,fontWeight:800}}>{subjects.length}</div>
        </div>
      </div>
      <div style={{background:"#fefce8",border:"1px solid #fde68a",borderRadius:10,padding:"12px 18px",fontSize:13,color:"#854d0e",display:"flex",gap:10,alignItems:"center"}}>
        <span style={{fontSize:18}}>📅</span>
        <span>Showing subjects for <strong>{activeSemester}</strong>. Change semester in <strong>Academic Setup</strong> to manage the other semester's subjects.<span style={{marginLeft:8,fontStyle:"italic",fontSize:12}}>{activeSemester==="1st Semester"?"Year 1–3 show GE + Major columns. Year 4 is Major only.":"Year 1–2 show GE + Major columns. Year 3–4 are Major only."}</span></span>
      </div>
      <div style={{background:"#fff",borderRadius:12,padding:24,boxShadow:`0 2px 10px rgba(0,0,0,0.07)`,borderTop:`4px solid ${theme.primary}`}}>
        <div style={{fontSize:15,fontWeight:700,color:"#0f172a",marginBottom:16}}>{editId ? "✏ Edit Subject" : "➕ Add New Subject"}</div>
        {err && <div style={{background:"#fee2e2",color:"#dc2626",border:"1px solid #fca5a5",borderRadius:8,padding:"10px 14px",fontSize:13,marginBottom:14}}>⚠ {err}</div>}
        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:12,marginBottom:12}}>
          <div>
            <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:5}}>Subject Description / Full Name</label>
            <input style={inpStyle} placeholder="e.g. System Integration and Architecture" value={form.subject_name} onChange={e=>setForm(f=>({...f,subject_name:e.target.value}))}/>
          </div>
          <div>
            <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:5}}>Subject Code <span style={{background:theme.primary,color:"#fff",borderRadius:4,padding:"1px 7px",fontSize:11,fontWeight:800}}>shown in schedule ★</span></label>
            <input style={{...inpStyle,fontWeight:900,letterSpacing:.8,textTransform:"uppercase",border:`2px solid ${theme.primary}`,color:theme.primary,fontSize:15}} placeholder="e.g. SIA, CC101" value={form.subject_code} onChange={e=>setForm(f=>({...f,subject_code:e.target.value.toUpperCase()}))}/>
          </div>
        </div>
        {/* ── MODIFIED: added Hour Load field in the form grid ── */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12,alignItems:"end"}}>
          <div>
            <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:5}}>Type {!showGEOption && <span style={{color:"#94a3b8",fontWeight:400,fontSize:11}}>(Major only)</span>}</label>
            <select style={{...inpStyle,opacity:showGEOption?1:0.5}} value={form.subject_type} disabled={!showGEOption} onChange={e=>setForm(f=>({...f,subject_type:e.target.value}))}>
              <option value="GE">🌐 GE</option>
              <option value="Major">🎯 Major</option>
            </select>
          </div>
          <div>
            <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:5}}>Year Level</label>
            <select style={inpStyle} value={form.year_level} onChange={e=>{const y=parseInt(e.target.value);setForm(f=>({...f,year_level:y,subject_type:hasGE(y,activeSemester)?f.subject_type:"Major"}));}}>
              {YEAR_LEVELS.map(y=><option key={y} value={y}>Year {y}{!hasGE(y,activeSemester)?" (Major only)":""}</option>)}
            </select>
          </div>
          <div>
            <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:5}}>Units</label>
            <input type="number" min={1} max={9} style={inpStyle} value={form.units} onChange={e=>setForm(f=>({...f,units:parseInt(e.target.value)||1}))}/>
          </div>
          <div>
            <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:5}}>
              Hour Load <span style={{color:"#94a3b8",fontWeight:400,fontSize:11}}>(0 = unlimited)</span>
            </label>
            <input
              type="number" min={0} max={200}
              style={{...inpStyle, border:`2px solid ${form.hour_load > 0 ? "#f59e0b" : theme.border}`, color: form.hour_load > 0 ? "#854d0e" : "#0f172a"}}
              value={form.hour_load}
              onChange={e=>setForm(f=>({...f,hour_load:parseInt(e.target.value)||0}))}
              placeholder="e.g. 18"
            />
          </div>
        </div>
        {(form.subject_code || form.subject_name) && (
          <div style={{marginTop:12,padding:"12px 16px",background:theme.light2,border:`1.5px solid ${theme.border}`,borderRadius:8,display:"flex",alignItems:"center",gap:14}}>
            <div style={{fontSize:11,fontWeight:700,color:theme.text,whiteSpace:"nowrap"}}>Preview in schedule:</div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              {form.subject_code && <span style={{display:"inline-block",background:form.subject_type==="GE"?"linear-gradient(135deg,#65a30d,#84cc16)":`linear-gradient(135deg,${theme.primary},${theme.primary3||theme.primary})`,color:"#fff",borderRadius:6,padding:"4px 13px",fontSize:14,fontWeight:900,letterSpacing:1.2,textTransform:"uppercase",boxShadow:"0 2px 8px rgba(0,0,0,0.18)"}}>{form.subject_code}</span>}
              {form.subject_name && <span style={{fontSize:11,color:"#475569"}}>{form.subject_name}</span>}
            </div>
            {form.hour_load > 0 && (
              <div style={{marginLeft:"auto",padding:"6px 14px",background:"#fef9c3",border:"1px solid #fde68a",borderRadius:8,fontSize:12,color:"#854d0e",fontWeight:700}}>
                ⏱ Max {form.hour_load} hrs/semester
              </div>
            )}
          </div>
        )}
        <div style={{marginTop:6,padding:"8px 12px",background:theme.light2,border:`1px solid ${theme.border}`,borderRadius:7,fontSize:12,color:theme.text}}>📅 Saving under <strong>{activeSemester}</strong>.</div>
        <div style={{display:"flex",gap:10,marginTop:14}}>
          <button style={btnPrimary} onClick={handleSave} disabled={saving}>{saving?"Saving…":editId?"✓ Update Subject":"✓ Add Subject"}</button>
          {editId && <button style={btnSecondary} onClick={resetForm}>✕ Cancel</button>}
        </div>
      </div>
      {loading ? <div style={{textAlign:"center",padding:"40px 0",color:"#94a3b8"}}>Loading subjects…</div>
        : subjects.length===0 ? <div style={{textAlign:"center",padding:"40px 0",color:"#94a3b8",fontSize:14}}>No subjects yet for {activeSemester}.</div>
        : YEAR_LEVELS.map(y=>{
            if(!yearHasData(y)) return null;
            const showGE=hasGE(y,activeSemester);
            return (
              <div key={y} style={{display:"flex",flexDirection:"column",gap:8}}>
                <div style={{background:theme.sidebar,borderRadius:8,padding:"10px 18px",display:"flex",alignItems:"center",gap:10}}>
                  <span style={{color:"#fff",fontWeight:800,fontSize:14}}>Year {y}</span>
                  <span style={{color:"rgba(255,255,255,0.6)",fontSize:12}}>—</span>
                  {showGE?<><span style={{background:"rgba(59,130,246,0.25)",color:"#93c5fd",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700}}>🌐 GE: {byYear[y].ge.length}</span><span style={{background:"rgba(255,255,255,0.12)",color:"rgba(255,255,255,0.8)",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700}}>🎯 Major: {byYear[y].major.length}</span></>:<span style={{background:"rgba(255,255,255,0.12)",color:"rgba(255,255,255,0.8)",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700}}>🎯 Major only: {byYear[y].major.length}</span>}
                  <span style={{marginLeft:"auto",color:"rgba(255,255,255,0.4)",fontSize:11}}>{activeSemester}</span>
                </div>
                <TwoColTable yearLevel={y} geList={byYear[y].ge} majorList={byYear[y].major}/>
              </div>
            );
          })
      }
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   ══ INSTRUCTOR POOL PAGE — MODIFIED: added max_load + current load display ══
   ══════════════════════════════════════════════════════════════ */
function InstructorPoolPage({ theme, activeSemester, allSchedules = [] }) {
  const [instructors,    setInstructors]   = useState([]);
  const [loading,        setLoading]       = useState(true);
  const [editId,         setEditId]        = useState(null);
  // ── MODIFIED: added max_load to form ──
  const [form,           setForm]          = useState({ name:"", department:theme.code, email:"", employment_type:"Regular", max_load:0 });
  const [err,            setErr]           = useState("");
  const [saving,         setSaving]        = useState(false);
  const [deleteConfirm,  setDeleteConfirm] = useState(null);

  const EMP_TYPES = ["Regular", "Part-time"];

  const DEPT_BADGE_COLORS = {
    "BSIT":  { bg:"#dbeafe", color:"#1d4ed8", border:"#bfdbfe" },
    "BSCS":  { bg:"#ede9fe", color:"#6d28d9", border:"#ddd6fe" },
    "BSA":   { bg:"#dcfce7", color:"#166534", border:"#86efac" },
    "BSN":   { bg:"#fce7f3", color:"#9d174d", border:"#fbcfe8" },
    "BSED":  { bg:"#fef9c3", color:"#854d0e", border:"#fde68a" },
    "BEED":  { bg:"#ffedd5", color:"#9a3412", border:"#fed7aa" },
    "BSCpE": { bg:"#e0f2fe", color:"#0369a1", border:"#bae6fd" },
    "BSME":  { bg:"#fef3c7", color:"#92400e", border:"#fde68a" },
  };

  function getDeptBadgeStyle(deptCode) {
    return DEPT_BADGE_COLORS[deptCode] || { bg: theme.light2, color: theme.text, border: theme.border };
  }

  useEffect(() => { loadPool(); }, []);
  useEffect(() => { setForm(f => ({ ...f, department: f.department || theme.code })); }, [theme.code]);

  async function loadPool() {
    setLoading(true);
    try {
      const res  = await fetch("/api/instructor-pool", { credentials:"include" });
      const data = res.ok ? await res.json() : [];
      setInstructors(Array.isArray(data) ? data : []);
    } catch { setInstructors([]); }
    setLoading(false);
  }

  function resetForm() { setForm({ name:"", department:theme.code, email:"", employment_type:"Regular", max_load:0 }); setEditId(null); setErr(""); }

  function startEdit(inst) {
    setEditId(inst.id);
    const empType = (inst.employment_type === "Permanent" ? "Regular" : inst.employment_type) || "Regular";
    setForm({ name:inst.name, department:inst.department||theme.code, email:inst.email||"", employment_type:empType, max_load:inst.max_load||0 });
    setErr(""); window.scrollTo({ top:0, behavior:"smooth" });
  }

  async function handleSave() {
    if (!form.name.trim()) { setErr("Instructor name is required."); return; }
    setSaving(true); setErr("");
    try {
      const url    = editId ? `/api/instructor-pool/${editId}` : "/api/instructor-pool";
      const method = editId ? "PUT" : "POST";
      const res    = await fetch(url, { method, credentials:"include", headers:{"Content-Type":"application/json"}, body:JSON.stringify(form) });
      const data   = await res.json();
      if (!res.ok) { setErr(data.error||"Failed to save."); setSaving(false); return; }
      await loadPool(); resetForm();
    } catch { setErr("Network error."); }
    setSaving(false);
  }

  async function handleDelete(id) {
    try {
      const res  = await fetch(`/api/instructor-pool/${id}`, { method:"DELETE", credentials:"include" });
      const data = await res.json();
      if (!res.ok) { alert(data.error||"Failed to delete."); return; }
      setInstructors(prev => prev.filter(i => i.id !== id));
      setDeleteConfirm(null);
    } catch { alert("Network error."); }
  }

  // ── MODIFIED: compute current scheduled hours for an instructor from allSchedules ──
  function getCurrentLoad(instName) {
    return allSchedules
      .filter(s => !s.is_break && normName(s.instructor) === normName(instName))
      .reduce((sum, s) => sum + (Number(s.end) - Number(s.start)), 0);
  }

  const inpStyle     = { padding:"9px 12px", border:`1.5px solid ${theme.border}`, borderRadius:8, fontSize:14, outline:"none", background:"#fff", color:"#0f172a", width:"100%", boxSizing:"border-box" };
  const btnPrimary   = { padding:"10px 22px", background:theme.primary, color:"#fff", border:"none", borderRadius:8, cursor:"pointer", fontSize:14, fontWeight:600 };
  const btnSecondary = { padding:"10px 18px", background:theme.light, color:theme.text, border:`1px solid ${theme.border}`, borderRadius:8, cursor:"pointer", fontSize:14 };

  function displayEmpType(raw) { if (!raw || raw === "Permanent") return "Regular"; return raw; }

  const regular  = instructors.filter(i => displayEmpType(i.employment_type) === "Regular");
  const parttime = instructors.filter(i => displayEmpType(i.employment_type) === "Part-time");

  const DeptBadge = ({ deptCode }) => {
    if (!deptCode) return null;
    const style = getDeptBadgeStyle(deptCode);
    return <span style={{padding:"2px 9px",borderRadius:20,fontSize:10,fontWeight:800,background:style.bg,color:style.color,border:`1px solid ${style.border}`,letterSpacing:.3,whiteSpace:"nowrap"}}>🏛 {deptCode}</span>;
  };

  // ── MODIFIED: InstructorTable now includes Hour Load column ──
  const InstructorTable = ({ list, emptyMsg }) => (
    list.length === 0 ? <div style={{padding:"14px 18px",textAlign:"center",color:"#94a3b8",fontSize:13}}>{emptyMsg}</div> : (
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr style={{background:theme.light}}>
          <th style={{padding:"9px 16px",textAlign:"left",borderBottom:`1px solid ${theme.light2}`,fontWeight:600,color:theme.text}}>Name</th>
          <th style={{padding:"9px 12px",textAlign:"center",borderBottom:`1px solid ${theme.light2}`,fontWeight:600,color:theme.text,width:110}}>Department</th>
          <th style={{padding:"9px 12px",textAlign:"center",borderBottom:`1px solid ${theme.light2}`,fontWeight:600,color:theme.text,width:130}}>Employment</th>
          <th style={{padding:"9px 12px",textAlign:"left",borderBottom:`1px solid ${theme.light2}`,fontWeight:600,color:theme.text}}>Email</th>
          {/* ── MODIFIED: Hour Load column header ── */}
          <th style={{padding:"9px 12px",textAlign:"left",borderBottom:`1px solid ${theme.light2}`,fontWeight:600,color:theme.text,width:190}}>Hour Load</th>
          <th style={{padding:"9px 12px",textAlign:"center",borderBottom:`1px solid ${theme.light2}`,fontWeight:600,color:theme.text,width:110}}>Actions</th>
        </tr></thead>
        <tbody>{list.map((inst,i)=>{
          const empLabel=displayEmpType(inst.employment_type);
          const isReg=empLabel==="Regular";
          const maxLoad = inst.max_load || 0;
          const currentLoad = getCurrentLoad(inst.name);
          const remaining = maxLoad > 0 ? Math.max(0, maxLoad - currentLoad) : null;
          const pct = maxLoad > 0 ? Math.min(100, Math.round((currentLoad / maxLoad) * 100)) : 0;
          const overLimit = maxLoad > 0 && currentLoad >= maxLoad;
          return (
            <tr key={inst.id} style={{background:editId===inst.id?theme.light2:(i%2===0?"#fff":"#f8fafc")}}>
              <td style={{padding:"10px 16px",borderBottom:`1px solid ${theme.light2}`}}><div style={{fontWeight:600,color:"#0f172a",marginBottom:3}}>{inst.name}</div><DeptBadge deptCode={inst.department}/></td>
              <td style={{padding:"10px 12px",borderBottom:`1px solid ${theme.light2}`,textAlign:"center"}}><DeptBadge deptCode={inst.department}/></td>
              <td style={{padding:"10px 12px",borderBottom:`1px solid ${theme.light2}`,textAlign:"center"}}><span style={{padding:"3px 12px",borderRadius:20,fontSize:11,fontWeight:700,background:isReg?"#dcfce7":"#fef9c3",color:isReg?"#166534":"#854d0e",border:`1px solid ${isReg?"#86efac":"#fde68a"}`}}>{isReg?"🏛 Regular":"⏱ Part-time"}</span></td>
              <td style={{padding:"10px 12px",borderBottom:`1px solid ${theme.light2}`,color:"#64748b",fontSize:12}}>{inst.email||"—"}</td>
              {/* ── MODIFIED: Hour Load cell with progress bar ── */}
              <td style={{padding:"10px 14px",borderBottom:`1px solid ${theme.light2}`,minWidth:190}}>
                {maxLoad > 0 ? (
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                      <span style={{fontSize:11,fontWeight:700,color:overLimit?"#ef4444":"#334155"}}>
                        {currentLoad}h used / {maxLoad}h max
                      </span>
                      <span style={{fontSize:10,fontWeight:700,padding:"1px 7px",borderRadius:20,
                        background:overLimit?"#fee2e2":pct>=80?"#fef9c3":"#dcfce7",
                        color:overLimit?"#dc2626":pct>=80?"#854d0e":"#166534",
                        border:`1px solid ${overLimit?"#fca5a5":pct>=80?"#fde68a":"#86efac"}`}}>
                        {overLimit ? "🔴 Full" : pct >= 80 ? `🟡 ${remaining}h left` : `🟢 ${remaining}h left`}
                      </span>
                    </div>
                    <div style={{background:"#e2e8f0",borderRadius:99,height:7,overflow:"hidden"}}>
                      <div style={{width:`${pct}%`,height:"100%",borderRadius:99,
                        background:overLimit?"#ef4444":pct>=80?"#f59e0b":"#16a34a",
                        transition:"width 0.3s"}}/>
                    </div>
                  </div>
                ) : (
                  <span style={{fontSize:11,color:"#94a3b8",fontStyle:"italic"}}>No limit set</span>
                )}
              </td>
              <td style={{padding:"10px 12px",borderBottom:`1px solid ${theme.light2}`,textAlign:"center"}}>
                <div style={{display:"flex",gap:6,justifyContent:"center"}}>
                  <button onClick={()=>startEdit(inst)} style={{padding:"5px 12px",background:theme.light,color:theme.primary,border:`1px solid ${theme.border}`,borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:600}}>✏</button>
                  {deleteConfirm===inst.id?(<><button onClick={()=>handleDelete(inst.id)} style={{padding:"5px 10px",background:"#ef4444",color:"#fff",border:"none",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:700}}>Yes</button><button onClick={()=>setDeleteConfirm(null)} style={{padding:"5px 10px",background:"#f1f5f9",color:"#64748b",border:"1px solid #cbd5e1",borderRadius:6,cursor:"pointer",fontSize:11}}>No</button></>):(<button onClick={()=>setDeleteConfirm(inst.id)} style={{padding:"5px 12px",background:"#fee2e2",color:"#ef4444",border:"1px solid #fca5a5",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:600}}>🗑</button>)}
                </div>
              </td>
            </tr>
          );
        })}</tbody>
      </table>
    )
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20,width:"100%",maxWidth:1100,alignSelf:"flex-start"}}>
      <div style={{background:theme.headerBg,borderRadius:10,padding:"16px 22px",display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
        <div style={{fontSize:28}}>👥</div>
        <div><div style={{color:"#fff",fontWeight:800,fontSize:16}}>Instructor Pool</div><div style={{color:"rgba(255,255,255,0.65)",fontSize:12,marginTop:2}}>{theme.code} · Manage faculty members</div></div>
        <div style={{marginLeft:"auto",background:"rgba(255,255,255,0.12)",borderRadius:8,padding:"8px 16px",textAlign:"center"}}>
          <div style={{color:"rgba(255,255,255,0.6)",fontSize:10}}>Total</div>
          <div style={{color:"#fff",fontSize:18,fontWeight:800}}>{instructors.length}</div>
        </div>
      </div>
      <div style={{background:"#fff",borderRadius:12,padding:24,boxShadow:`0 2px 10px rgba(0,0,0,0.07)`,borderTop:`4px solid ${theme.primary}`}}>
        <div style={{fontSize:15,fontWeight:700,color:"#0f172a",marginBottom:16}}>{editId?"✏ Edit Instructor":"➕ Add Instructor"}</div>
        {err&&<div style={{background:"#fee2e2",color:"#dc2626",border:"1px solid #fca5a5",borderRadius:8,padding:"10px 14px",fontSize:13,marginBottom:14}}>⚠ {err}</div>}
        <div style={{marginBottom:14,padding:"9px 14px",background:theme.light2,border:`1px solid ${theme.border}`,borderRadius:8,fontSize:12,color:theme.text,display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:16}}>🏛</span>
          <span>New instructors will be tagged to <strong>{theme.code}</strong> by default. You can change the department below if needed.</span>
        </div>
        {/* ── MODIFIED: added Max Load field to form grid ── */}
        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr",gap:12,alignItems:"end"}}>
          <div><label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:5}}>Full Name</label><input style={inpStyle} placeholder="e.g. Juan Dela Cruz" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></div>
          <div><label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:5}}>Department <span style={{background:theme.primary,color:"#fff",borderRadius:4,padding:"1px 6px",fontSize:10,fontWeight:800}}>{theme.code}</span></label><input style={{...inpStyle,fontWeight:700,color:theme.primary,textTransform:"uppercase"}} placeholder={theme.code} value={form.department} onChange={e=>setForm(f=>({...f,department:e.target.value.toUpperCase()}))}/></div>
          <div><label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:5}}>Email (optional)</label><input style={inpStyle} placeholder="email@pcc.edu.ph" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))}/></div>
          <div><label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:5}}>Employment Type</label><select style={inpStyle} value={form.employment_type} onChange={e=>setForm(f=>({...f,employment_type:e.target.value}))}>{EMP_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
          <div>
            <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:5}}>
              Max Load (hrs) <span style={{color:"#94a3b8",fontWeight:400,fontSize:10}}>/sem</span>
            </label>
            <input
              type="number" min={0} max={300}
              style={{...inpStyle, border:`2px solid ${form.max_load > 0 ? "#f59e0b" : theme.border}`, color: form.max_load > 0 ? "#854d0e" : "#0f172a", fontWeight: form.max_load > 0 ? 700 : 400}}
              value={form.max_load}
              onChange={e=>setForm(f=>({...f,max_load:parseInt(e.target.value)||0}))}
              placeholder="e.g. 18"
            />
          </div>
        </div>
        <div style={{display:"flex",gap:10,marginTop:14}}>
          <button style={btnPrimary} onClick={handleSave} disabled={saving}>{saving?"Saving…":editId?"✓ Update Instructor":"✓ Add Instructor"}</button>
          {editId&&<button style={btnSecondary} onClick={resetForm}>✕ Cancel</button>}
        </div>
      </div>
      {loading?<div style={{textAlign:"center",padding:"40px 0",color:"#94a3b8"}}>Loading instructors…</div>
        :instructors.length===0?<div style={{textAlign:"center",padding:"40px 0",color:"#94a3b8",fontSize:14}}>No instructors yet.</div>
        :<>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <span style={{padding:"4px 14px",borderRadius:20,fontSize:12,fontWeight:600,background:"#dcfce7",color:"#166534",border:"1px solid #86efac"}}>🏛 Regular: {regular.length}</span>
            <span style={{padding:"4px 14px",borderRadius:20,fontSize:12,fontWeight:600,background:"#fef9c3",color:"#854d0e",border:"1px solid #fde68a"}}>⏱ Part-time: {parttime.length}</span>
            <span style={{padding:"4px 14px",borderRadius:20,fontSize:12,fontWeight:600,background:theme.light2,color:theme.text,border:`1px solid ${theme.border}`}}>Total: {instructors.length}</span>
          </div>
          {[["🏛 Regular Instructors",regular,"No regular instructors yet."],["⏱ Part-time Instructors",parttime,"No part-time instructors yet."]].map(([label,list,emptyMsg])=>{
            if(!list.length) return null;
            return (
              <div key={label} style={{background:"#fff",borderRadius:12,overflow:"hidden",boxShadow:`0 2px 8px rgba(0,0,0,0.06)`}}>
                <div style={{background:theme.primary,color:"#fff",padding:"10px 20px",fontSize:13,fontWeight:700,display:"flex",gap:10,alignItems:"center"}}>{label}<span style={{fontSize:11,opacity:0.7}}>· {list.length} instructor{list.length!==1?"s":""}</span></div>
                <InstructorTable list={list} emptyMsg={emptyMsg}/>
              </div>
            );
          })}
        </>
      }
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   ══ INSTRUCTOR ASSIGNMENT PAGE ══
   ══════════════════════════════════════════════════════════════ */
function InstructorAssignmentPage({ theme, activeSemester }) {
  const [assignments,   setAssignments]   = useState([]);
  const [instructors,   setInstructors]   = useState([]);
  const [subjects,      setSubjects]      = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [form,          setForm]          = useState({ instructor_id:"", subject_id:"" });
  const [err,           setErr]           = useState("");
  const [saving,        setSaving]        = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [filterInst,    setFilterInst]    = useState("All");
  const [groupFilter,   setGroupFilter]   = useState("all");

  useEffect(() => { loadAll(); }, [activeSemester]);

  async function loadAll() {
    setLoading(true);
    try {
      const [aRes, iRes, sRes] = await Promise.all([
        fetch(`/api/instructor-assignments?semester=${encodeURIComponent(activeSemester)}`, { credentials:"include" }),
        fetch(`/api/instructor-pool?semester=${encodeURIComponent(activeSemester)}`,        { credentials:"include" }),
        fetch(`/api/subjects?semester=${encodeURIComponent(activeSemester)}`,               { credentials:"include" }),
      ]);
      const [a, i, s] = await Promise.all([aRes.ok?aRes.json():[], iRes.ok?iRes.json():[], sRes.ok?sRes.json():[]]);
      setAssignments(Array.isArray(a)?a:[]); setInstructors(Array.isArray(i)?i:[]); setSubjects(Array.isArray(s)?s:[]);
    } catch {}
    setLoading(false);
  }

  async function handleAdd() {
    if (!form.instructor_id || !form.subject_id) { setErr("Please select both instructor and subject."); return; }
    setSaving(true); setErr("");
    try {
      const res  = await fetch("/api/instructor-assignments", { method:"POST", credentials:"include", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ ...form, semester: activeSemester }) });
      const data = await res.json();
      if (!res.ok) { setErr(data.error||"Failed to assign."); setSaving(false); return; }
      setAssignments(prev => [...prev, data]);
      setForm(f => ({ ...f, subject_id:"" }));
    } catch { setErr("Network error."); }
    setSaving(false);
  }

  async function handleDelete(id) {
    try {
      const res = await fetch(`/api/instructor-assignments/${id}`, { method:"DELETE", credentials:"include" });
      if (!res.ok) { const d = await res.json(); alert(d.error||"Failed."); return; }
      setAssignments(prev => prev.filter(a => a.id !== id));
      setDeleteConfirm(null);
    } catch { alert("Network error."); }
  }

  const inpStyle   = { padding:"9px 12px", border:`1.5px solid ${theme.border}`, borderRadius:8, fontSize:14, outline:"none", background:"#fff", color:"#0f172a", width:"100%", boxSizing:"border-box" };
  const btnPrimary = { padding:"10px 22px", background:theme.primary, color:"#fff", border:"none", borderRadius:8, cursor:"pointer", fontSize:14, fontWeight:600 };

  const alreadyAssigned = new Set(assignments.filter(a=>String(a.instructor_id)===form.instructor_id).map(a=>String(a.subject_id)));
  const subjectsByYear = [1,2,3,4].reduce((acc,y)=>{const ge=subjects.filter(s=>s.year_level===y&&s.subject_type==="GE"),major=subjects.filter(s=>s.year_level===y&&s.subject_type==="Major");if(ge.length||major.length)acc[y]={ge,major};return acc;},{});

  function getInstGroup(instId) {
    const instAssigns=assignments.filter(a=>String(a.instructor_id)===String(instId));
    const hasG=instAssigns.some(a=>a.subject_type==="GE"),hasM=instAssigns.some(a=>a.subject_type==="Major"||a.subject_type!=="GE");
    if(hasG&&hasM)return "Both";if(hasG)return "GE Only";if(hasM)return "Major Only";return "None";
  }

  const filteredAssigns=assignments.filter(a=>filterInst==="All"||String(a.instructor_id)===filterInst);
  const byInstructor={};
  for(const a of filteredAssigns){if(!byInstructor[a.instructor_name])byInstructor[a.instructor_name]={instructor_id:a.instructor_id,employment_type:a.employment_type,items:[]};byInstructor[a.instructor_name].items.push(a);}

  const instWithGroup=instructors.map(i=>({...i,group:getInstGroup(i.id)}));
  const instGEOnly=instWithGroup.filter(i=>i.group==="GE Only"),instMajorOnly=instWithGroup.filter(i=>i.group==="Major Only"),instBoth=instWithGroup.filter(i=>i.group==="Both"),instNone=instWithGroup.filter(i=>i.group==="None");

  const groupCounts={all:Object.keys(byInstructor).length,ge:Object.values(byInstructor).filter(g=>g.items.every(a=>a.subject_type==="GE")).length,major:Object.values(byInstructor).filter(g=>g.items.every(a=>a.subject_type!=="GE")).length,both:Object.values(byInstructor).filter(g=>g.items.some(a=>a.subject_type==="GE")&&g.items.some(a=>a.subject_type!=="GE")).length};

  const filteredByGroup=Object.entries(byInstructor).filter(([_,{items}])=>{
    if(groupFilter==="all")return true;const hG=items.some(a=>a.subject_type==="GE"),hM=items.some(a=>a.subject_type!=="GE");
    if(groupFilter==="ge")return hG&&!hM;if(groupFilter==="major")return hM&&!hG;if(groupFilter==="both")return hG&&hM;return true;
  });

  function displayEmpType(raw){if(!raw||raw==="Permanent")return "Regular";return raw;}

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20,width:"100%",maxWidth:1100,alignSelf:"flex-start"}}>
      <div style={{background:theme.headerBg,borderRadius:10,padding:"16px 22px",display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
        <div style={{fontSize:28}}>🔗</div>
        <div><div style={{color:"#fff",fontWeight:800,fontSize:16}}>Instructor Assignment</div><div style={{color:"rgba(255,255,255,0.65)",fontSize:12,marginTop:2}}>{theme.code} · <strong style={{color:"#fff"}}>{activeSemester}</strong> — Assign subjects (GE + Major allowed per instructor)</div></div>
        <div style={{marginLeft:"auto",background:"rgba(255,255,255,0.12)",borderRadius:8,padding:"8px 16px",textAlign:"center"}}>
          <div style={{color:"rgba(255,255,255,0.6)",fontSize:10}}>Assignments ({activeSemester})</div>
          <div style={{color:"#fff",fontSize:18,fontWeight:800}}>{assignments.length}</div>
        </div>
      </div>
      <div style={{background:"#f0fdf4",border:"1px solid #86efac",borderRadius:10,padding:"12px 18px",fontSize:13,color:"#166534",display:"flex",gap:10,alignItems:"center"}}>
        <span style={{fontSize:18}}>ℹ️</span>
        <span><strong>{instructors.length}</strong> instructor{instructors.length!==1?"s":""} available · <strong>{subjects.length}</strong> subject{subjects.length!==1?"s":""} this semester. An instructor can be assigned <strong>both GE and Major subjects</strong>.</span>
      </div>
      <div style={{background:"#fff",borderRadius:12,padding:24,boxShadow:`0 2px 10px rgba(0,0,0,0.07)`,borderTop:`4px solid ${theme.primary}`}}>
        <div style={{fontSize:15,fontWeight:700,color:"#0f172a",marginBottom:16}}>➕ New Assignment — {activeSemester}</div>
        {err&&<div style={{background:"#fee2e2",color:"#dc2626",border:"1px solid #fca5a5",borderRadius:8,padding:"10px 14px",fontSize:13,marginBottom:14}}>⚠ {err}</div>}
        <div style={{display:"grid",gridTemplateColumns:"2fr 2fr auto",gap:12,alignItems:"end"}}>
          <div>
            <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:5}}>Instructor</label>
            <select style={inpStyle} value={form.instructor_id} onChange={e=>setForm(f=>({...f,instructor_id:e.target.value,subject_id:""}))}>
              <option value="">— Select Instructor —</option>
              {instNone.length>0&&<optgroup label="📋 Not Yet Assigned">{instNone.map(i=><option key={i.id} value={i.id}>{displayEmpType(i.employment_type)==="Regular"?"🏛":"⏱"} {i.name}{i.department?` [${i.department}]`:""}</option>)}</optgroup>}
              {instGEOnly.length>0&&<optgroup label="🌐 Currently GE Only">{instGEOnly.map(i=><option key={i.id} value={i.id}>{i.name}{i.department?` [${i.department}]`:""}</option>)}</optgroup>}
              {instMajorOnly.length>0&&<optgroup label="🎯 Currently Major Only">{instMajorOnly.map(i=><option key={i.id} value={i.id}>{i.name}{i.department?` [${i.department}]`:""}</option>)}</optgroup>}
              {instBoth.length>0&&<optgroup label="🔀 GE & Major">{instBoth.map(i=><option key={i.id} value={i.id}>{i.name}{i.department?` [${i.department}]`:""}</option>)}</optgroup>}
            </select>
          </div>
          <div>
            <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:5}}>Subject <span style={{color:"#64748b",fontWeight:400,fontSize:11}}>— GE and Major both available</span></label>
            <select style={inpStyle} value={form.subject_id} onChange={e=>setForm(f=>({...f,subject_id:e.target.value}))} disabled={!form.instructor_id}>
              <option value="">— Select Subject —</option>
              {Object.entries(subjectsByYear).map(([yr,{ge,major}])=>{
                const geAvail=ge.filter(s=>!alreadyAssigned.has(String(s.id))),geUsed=ge.filter(s=>alreadyAssigned.has(String(s.id)));
                const majorAvail=major.filter(s=>!alreadyAssigned.has(String(s.id))),majorUsed=major.filter(s=>alreadyAssigned.has(String(s.id)));
                if(!geAvail.length&&!geUsed.length&&!majorAvail.length&&!majorUsed.length)return null;
                return <optgroup key={yr} label={`── Year ${yr} ──`}>
                  {geAvail.map(s=><option key={s.id} value={s.id}>🌐 {s.subject_code?`[${s.subject_code}] `:""}{s.subject_name} (GE)</option>)}
                  {geUsed.map(s=><option key={s.id} value={s.id} disabled>✓ {s.subject_name} (GE — already assigned)</option>)}
                  {majorAvail.map(s=><option key={s.id} value={s.id}>🎯 {s.subject_code?`[${s.subject_code}] `:""}{s.subject_name} (Major)</option>)}
                  {majorUsed.map(s=><option key={s.id} value={s.id} disabled>✓ {s.subject_name} (Major — already assigned)</option>)}
                </optgroup>;
              })}
            </select>
          </div>
          <div style={{paddingBottom:1}}><button style={{...btnPrimary,whiteSpace:"nowrap"}} onClick={handleAdd} disabled={saving}>{saving?"…":"✓ Assign"}</button></div>
        </div>
        {instructors.length===0&&<div style={{marginTop:12,background:"#fef9c3",border:"1px solid #fde68a",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#854d0e"}}>⚠ No instructors found. Go to <strong>Instructor Pool</strong> to add instructors.</div>}
        {subjects.length===0&&<div style={{marginTop:12,background:"#fef9c3",border:"1px solid #fde68a",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#854d0e"}}>⚠ No subjects found for {activeSemester}. Go to <strong>Subject Setup</strong> to add subjects.</div>}
      </div>
      <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
        <span style={{fontSize:13,fontWeight:600,color:"#374151"}}>Filter by Instructor:</span>
        <select value={filterInst} onChange={e=>setFilterInst(e.target.value)} style={{padding:"7px 12px",border:`1px solid ${theme.border}`,borderRadius:7,fontSize:13,background:"#fff",color:"#0f172a",outline:"none"}}>
          <option value="All">All Instructors</option>
          {instructors.map(i=><option key={i.id} value={String(i.id)}>{i.name}{i.department?` [${i.department}]`:""}</option>)}
        </select>
        <div style={{display:"flex",gap:4,marginLeft:12}}>
          {[["all",`All (${groupCounts.all})`,"#e2e8f0","#334155"],["ge",`🌐 GE Only (${groupCounts.ge})`,"#dbeafe","#1d4ed8"],["major",`🎯 Major Only (${groupCounts.major})`,theme.light2,theme.text],["both",`🔀 Both (${groupCounts.both})`,"#dcfce7","#166534"]].map(([v,label,bg,col])=>(
            <button key={v} onClick={()=>setGroupFilter(v)} style={{padding:"5px 12px",borderRadius:20,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,background:groupFilter===v?col:bg,color:groupFilter===v?"#fff":col,outline:groupFilter===v?`2px solid ${col}`:"none"}}>{label}</button>
          ))}
        </div>
        <span style={{fontSize:12,color:"#64748b",marginLeft:4}}>{filteredByGroup.length} instructor{filteredByGroup.length!==1?"s":""}</span>
      </div>
      {loading?<div style={{textAlign:"center",padding:"40px 0",color:"#94a3b8"}}>Loading…</div>
        :filteredByGroup.length===0?<div style={{textAlign:"center",padding:"40px 0",color:"#94a3b8",fontSize:14}}>{assignments.length===0?`No assignments yet for ${activeSemester}.`:"No assignments match the filter."}</div>
        :filteredByGroup.map(([instName,{instructor_id,employment_type,items}])=>{
          const empLabel=displayEmpType(employment_type),isReg=empLabel==="Regular";
          const geItems=items.filter(a=>a.subject_type==="GE"),majItems=items.filter(a=>a.subject_type!=="GE");
          const totalUnits=items.reduce((s,a)=>s+(a.units||0),0);
          const hG=geItems.length>0,hM=majItems.length>0;
          const groupBadge=hG&&hM?"🔀 GE & Major":hG?"🌐 GE Only":"🎯 Major Only";
          const groupBadgeStyle=hG&&hM?{background:"rgba(22,163,74,0.2)",color:"#86efac",border:"1px solid rgba(22,163,74,0.3)"}:hG?{background:"rgba(59,130,246,0.2)",color:"#93c5fd",border:"1px solid rgba(59,130,246,0.3)"}:{background:"rgba(255,255,255,0.15)",color:"rgba(255,255,255,0.85)",border:"1px solid rgba(255,255,255,0.2)"};
          const instObj=instructors.find(i=>String(i.id)===String(instructor_id));
          const instDept=instObj?.department||"";
          return (
            <div key={instName} style={{background:"#fff",borderRadius:12,overflow:"hidden",boxShadow:`0 2px 8px rgba(0,0,0,0.06)`}}>
              <div style={{background:theme.primary,color:"#fff",padding:"10px 20px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <span style={{fontWeight:700,fontSize:14}}>{instName}</span>
                {instDept&&<span style={{padding:"2px 9px",borderRadius:20,fontSize:10,fontWeight:800,background:"rgba(255,255,255,0.18)",color:"#fff",border:"1px solid rgba(255,255,255,0.3)"}}>🏛 {instDept}</span>}
                <span style={{padding:"2px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.3)",color:"#fff"}}>{isReg?"🏛 Regular":"⏱ Part-time"}</span>
                <span style={{padding:"2px 10px",borderRadius:20,fontSize:11,fontWeight:700,...groupBadgeStyle}}>{groupBadge}</span>
                <span style={{marginLeft:"auto",fontSize:12,opacity:0.8}}>{items.length} subject{items.length!==1?"s":""} · {totalUnits} unit{totalUnits!==1?"s":""}</span>
              </div>
              <div style={{padding:"14px 20px"}}>
                {geItems.length===0&&majItems.length===0?<div style={{color:"#94a3b8",fontSize:13,padding:"8px 0"}}>No subjects assigned.</div>:(
                  <div style={{display:"grid",gridTemplateColumns:geItems.length>0&&majItems.length>0?"1fr 1fr":"1fr",gap:16}}>
                    {geItems.length>0&&(
                      <div>
                        <div style={{fontSize:12,fontWeight:700,color:"#1d4ed8",marginBottom:8,background:"#dbeafe",border:"1px solid #bfdbfe",borderRadius:6,padding:"5px 12px",display:"inline-block"}}>🌐 GE Subjects — {geItems.length}</div>
                        <div style={{display:"flex",flexDirection:"column",gap:6}}>
                          {geItems.map(a=>(
                            <div key={a.id} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 12px",borderRadius:8,border:"1px solid #bfdbfe",borderLeft:"4px solid #3b82f6",background:"#eff6ff"}}>
                              <div style={{flex:1}}>
                                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>{a.subject_code&&<span style={{background:"linear-gradient(135deg,#65a30d,#84cc16)",color:"#fff",borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:900,letterSpacing:.5}}>{a.subject_code}</span>}<div style={{fontSize:13,fontWeight:600,color:"#0f172a"}}>{a.subject_name}</div></div>
                                <div style={{fontSize:11,color:"#64748b",marginTop:2}}>{a.units} unit{a.units!==1?"s":""} · Year {a.year_level}</div>
                              </div>
                              {deleteConfirm===a.id?(<div style={{display:"flex",gap:4}}><button onClick={()=>handleDelete(a.id)} style={{padding:"4px 10px",background:"#ef4444",color:"#fff",border:"none",borderRadius:5,cursor:"pointer",fontSize:11,fontWeight:700}}>Yes</button><button onClick={()=>setDeleteConfirm(null)} style={{padding:"4px 8px",background:"#f1f5f9",color:"#64748b",border:"1px solid #cbd5e1",borderRadius:5,cursor:"pointer",fontSize:11}}>No</button></div>):(<button onClick={()=>setDeleteConfirm(a.id)} style={{padding:"4px 10px",background:"#fee2e2",color:"#ef4444",border:"1px solid #fca5a5",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:600,flexShrink:0}}>🗑</button>)}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {majItems.length>0&&(
                      <div>
                        <div style={{fontSize:12,fontWeight:700,color:theme.text,marginBottom:8,background:theme.light2,border:`1px solid ${theme.border}`,borderRadius:6,padding:"5px 12px",display:"inline-block"}}>🎯 Major Subjects — {majItems.length}</div>
                        <div style={{display:"flex",flexDirection:"column",gap:6}}>
                          {majItems.map(a=>(
                            <div key={a.id} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 12px",borderRadius:8,border:`1px solid ${theme.border}`,borderLeft:`4px solid ${theme.primary}`,background:theme.light}}>
                              <div style={{flex:1}}>
                                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>{a.subject_code&&<span style={{background:theme.primary,color:"#fff",borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:900,letterSpacing:.5}}>{a.subject_code}</span>}<div style={{fontSize:13,fontWeight:600,color:"#0f172a"}}>{a.subject_name}</div></div>
                                <div style={{fontSize:11,color:"#64748b",marginTop:2}}>{a.units} unit{a.units!==1?"s":""} · Year {a.year_level}</div>
                              </div>
                              {deleteConfirm===a.id?(<div style={{display:"flex",gap:4}}><button onClick={()=>handleDelete(a.id)} style={{padding:"4px 10px",background:"#ef4444",color:"#fff",border:"none",borderRadius:5,cursor:"pointer",fontSize:11,fontWeight:700}}>Yes</button><button onClick={()=>setDeleteConfirm(null)} style={{padding:"4px 8px",background:"#f1f5f9",color:"#64748b",border:"1px solid #cbd5e1",borderRadius:5,cursor:"pointer",fontSize:11}}>No</button></div>):(<button onClick={()=>setDeleteConfirm(a.id)} style={{padding:"4px 10px",background:"#fee2e2",color:"#ef4444",border:"1px solid #fca5a5",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:600,flexShrink:0}}>🗑</button>)}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })
      }
    </div>
  );
}

/* ════════ THEMED SIDEBAR ════════ */
function Sidebar({ activePage, setActivePage, theme, previewDept, setPreviewDept }) {
  const auth = useAuth();
  const menu = [
    { label:"Dashboard" },
    { label:"Academic Setup" },
    { label:"Subject Setup" },
    { label:"Instructor Pool" },
    { label:"Instructor Assignment" },
    { label:"Section Pool" },
    { label:"Student Load" },
    { label:"Instructor Load" },
    { label:"Schedule Output" },
    { label:"Room Schedule" },
  ];
  return (
    <div style={{width:252,minWidth:252,background:theme.sidebar,color:"#e2e8f0",padding:"20px 16px",display:"flex",flexDirection:"column",overflowY:"auto"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
        <DeptLogo code={theme.code} style={{width:36,height:36,borderRadius:4,objectFit:"contain"}} alt={theme.code}/>
        <img src={PCCLogo} style={{width:36,height:36,borderRadius:4,objectFit:"contain"}} alt="PCC"/>
        <div style={{fontSize:16,fontWeight:"bold",color:"#f0f9ff"}}>SmartSched</div>
      </div>
      <div style={{fontSize:11,color:"rgba(255,255,255,0.5)",marginBottom:14,paddingLeft:2}}>Scheduling System</div>
      <div style={{marginBottom:16,padding:"10px 14px",background:"rgba(255,255,255,0.07)",borderRadius:8,border:"1px solid rgba(255,255,255,0.1)"}}>
        {auth?.isSuperAdmin && previewDept ? (
          <>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
              <span style={{fontSize:16}}>{theme.emoji}</span>
              <span style={{fontSize:12,fontWeight:800,color:"#fff"}}>{theme.code}</span>
              <span style={{marginLeft:"auto",fontSize:9,background:"rgba(251,191,36,0.2)",color:"#fbbf24",border:"1px solid rgba(251,191,36,0.3)",borderRadius:20,padding:"1px 7px",fontWeight:700}}>PREVIEW</span>
            </div>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.6)",lineHeight:1.4,marginBottom:8}}>{theme.shortName}</div>
            <button onClick={()=>setPreviewDept(null)} style={{width:"100%",padding:"6px",background:"rgba(239,68,68,0.15)",color:"#fca5a5",border:"1px solid rgba(239,68,68,0.2)",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:600}}>✕ Exit Preview → Dashboard</button>
          </>
        ) : (
          <>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
              <span style={{fontSize:16}}>{theme.emoji}</span>
              <span style={{fontSize:12,fontWeight:800,color:"#fff"}}>{theme.code}</span>
            </div>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.6)",lineHeight:1.4}}>{theme.shortName}</div>
          </>
        )}
        <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginTop:4}}>{auth?.name}</div>
      </div>
      <div style={{height:3,background:`linear-gradient(90deg,${theme.primary2},${theme.accent})`,borderRadius:99,marginBottom:12}}/>
      {menu.map(({ label }) => (
        <div key={label} onClick={() => setActivePage(label)}
          style={{padding:"10px 14px",borderRadius:6,cursor:"pointer",marginBottom:3,fontSize:13.5,transition:"all 0.15s",
            background: activePage===label ? theme.primary : "transparent",
            color:      activePage===label ? "#fff" : "rgba(255,255,255,0.7)",
            borderLeft: activePage===label ? `3px solid ${theme.accent}` : "3px solid transparent"}}>
          {label}
        </div>
      ))}
      <div style={{marginTop:"auto",paddingTop:16}}>
        <button onClick={async () => { await fetch("/auth/logout",{method:"POST",credentials:"include"}); window.__smartschedLogout?.(); }}
          style={{width:"100%",padding:"9px 14px",background:"rgba(239,68,68,0.12)",color:"#fca5a5",border:"1px solid rgba(239,68,68,0.2)",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:600,textAlign:"left"}}>
          🚪 Sign Out
        </button>
      </div>
    </div>
  );
}

/* ════════ PAGE CONTENT ════════ */
/* ════════ DRAG-DROP INLINE SCHEDULE GRID — FACULTY ════════ */
function InlineScheduleGrid({ schedules, allSchedules, academicYear, semester, onMoveBlock, theme, codeMap, instructorPool = [] }) {
  const [dragBlock, setDragBlock] = useState(null);
  const [dragOver, setDragOver]   = useState(null); // {day, time}
  const [toast, setToast]         = useState(null);

  const real = schedules.filter(s => !s.is_break);
  const instructors = [...new Set(real.filter(s => s.instructor?.trim()).map(s => s.instructor))].sort();

  const handlePrint = () => {
    const win = window.open("", "_blank");
    const content = document.getElementById("inline-faculty-print-area")?.innerHTML || "";
    win.document.write(`<!DOCTYPE html><html><head><title>Faculty Class Schedule</title><style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;font-size:10pt;color:#000;background:#fff;}.page{padding:14mm;}table{width:100%;border-collapse:collapse;}th{background:${theme.primary};color:#fff;font-weight:bold;padding:6px 4px;text-align:center;border:1px solid ${theme.primary3||theme.primary};font-size:8pt;}td{border:1px solid #ddd;padding:4px;text-align:center;vertical-align:middle;height:36px;}@media print{@page{margin:0;size:A4 landscape;}body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}.page{padding:8mm;}}</style></head><body><div class="page">${content}</div></body></html>`);
    win.document.close(); win.focus();
    setTimeout(() => { win.print(); win.close(); }, 700);
  };

  const handleDragStart = (e, block) => {
    setDragBlock(block);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDrop = async (e, day, time, instructor) => {
    e.preventDefault();
    if (!dragBlock) return;
    setDragOver(null);
    const dur = dragBlock.end - dragBlock.start;
    const newStart = time;
    const newEnd   = time + dur;
    if (newStart === dragBlock.start && day === dragBlock.day) { setDragBlock(null); return; }

    // Build combined schedules excluding the block being moved
    const others = allSchedules.filter(s => !s.is_break && s.id !== dragBlock.id);
    const moved  = { ...dragBlock, day, start: newStart, end: newEnd };
    const conflicts = detectConflicts([...others, moved]);
    const relevant  = conflicts.filter(c => c.blockA?.id === dragBlock.id || c.blockB?.id === dragBlock.id);

    if (relevant.length > 0) {
      // Attach suggestions
      const withSugg = relevant.map(c => ({
        ...c,
        suggestions: findSuggestions(c, others, instructorPool),
      }));
      setToast({ conflicts: withSugg, movedBlock: moved, others });
      setDragBlock(null);
      return;
    }

    // No conflicts — save
    await onMoveBlock(dragBlock, { day, start: newStart, end: newEnd, room: dragBlock.room });
    setDragBlock(null);
  };

  const handleDragOver = (e, day, time) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver({ day, time });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Toast */}
      {toast && (
        <ConflictToast
          conflicts={toast.conflicts}
          allSchedules={allSchedules}
          onClose={() => setToast(null)}
          onMoveSchedule={null}
          instructorPool={instructorPool}
        />
      )}

      {/* Print button row */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <button
          onClick={handlePrint}
          style={{ padding: "9px 22px", background: theme.primary, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}
        >
          🖨 Print / Save PDF
        </button>
      </div>

      {/* Printable content */}
      <div id="inline-faculty-print-area" style={{ fontFamily: "Arial, sans-serif", fontSize: 10, color: "#000", background: "#fff" }}>
        <SchoolHeader academicYear={academicYear} semester={semester} theme={theme} compact />

        <div style={{ textAlign: "center", fontSize: 14, fontWeight: "bold", textTransform: "uppercase", letterSpacing: 1.5, margin: "10px 0 16px" }}>
          Faculty Class Schedule
        </div>

        {instructors.length === 0 && (
          <div style={{ textAlign: "center", padding: "48px 0", color: "#94a3b8", fontSize: 14 }}>
            No instructor schedules yet. Add schedules in <strong>Instructor Load</strong>.
          </div>
        )}

        {instructors.map(inst => {
          const rawCls = schedules
            .filter(s => normName(s.instructor) === normName(inst) && !s.is_break)
            .map(b => ({ ...b, start: Number(b.start), end: Number(b.end) }));
          const cls = DAYS.flatMap(day => {
            const dayBlocks = rawCls.filter(b => b.day === day);
            return dayBlocks.length ? insertBreaks(dayBlocks) : [];
          });
          const realCls = cls.filter(s => !s.is_break);
          const total   = realCls.reduce((s, c) => s + (c.end - c.start), 0);
          const labH    = realCls.filter(c => c.roomType === "Laboratory").reduce((s, c) => s + (c.end - c.start), 0);
          const lecH    = realCls.filter(c => c.roomType === "Lecture").reduce((s, c) => s + (c.end - c.start), 0);
          const instSlots = buildPrintTimeSlots(cls);

          return (
            <div key={inst} style={{ marginBottom: 28, border: `1px solid ${theme.border}`, borderRadius: 10, overflow: "hidden" }}>
              {/* Instructor header */}
              <div style={{ background: theme.primary, color: "#fff", padding: "9px 16px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>👨‍🏫 {inst}</span>
                <span style={{ fontSize: 11, opacity: 0.8 }}>⏱ {total} hrs total</span>
                <span style={{ fontSize: 11, opacity: 0.8 }}>📖 Lecture: {lecH}h</span>
                <span style={{ fontSize: 11, opacity: 0.8 }}>🔬 Lab: {labH}h</span>
                <span style={{ marginLeft: "auto", fontSize: 10, opacity: 0.6, fontStyle: "italic" }}>Drag blocks to reschedule</span>
              </div>

              {/* Grid table */}
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ background: theme.primary, color: "#fff", padding: "7px 10px", border: `1px solid ${theme.primary3 || theme.primary}`, minWidth: 90, textAlign: "center", fontSize: 11 }}>Time</th>
                      {DAYS.map(d => (
                        <th key={d} style={{ background: theme.primary, color: "#fff", padding: "7px 8px", border: `1px solid ${theme.primary3 || theme.primary}`, textAlign: "center", fontSize: 11, minWidth: 110 }}>{d}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {instSlots.map(t => {
                      if (t === LUNCH_START) return (
                        <tr key="lunch">
                          <td style={{ background: "#fef9c3", border: "1px solid #ddd", padding: "4px 8px", fontWeight: 700, fontSize: 10, textAlign: "center", color: "#854d0e", height: 28 }}>{fmtRange(LUNCH_START, LUNCH_END)}</td>
                          {DAYS.map(day => (
                            <td key={day} style={{ border: "1px solid #ddd", textAlign: "center", height: 28, background: "#fef9c3" }}>
                              <span style={{ fontSize: 10, color: "#854d0e", fontWeight: 700 }}>🍽 Lunch</span>
                            </td>
                          ))}
                        </tr>
                      );
                      if (t > LUNCH_START && t < LUNCH_END) return null;
                      const nextT = instSlots[instSlots.indexOf(t) + 1] ?? (t + 1);

                      return (
                        <tr key={t}>
                          <td style={{ background: theme.light, border: "1px solid #ddd", padding: "4px 8px", fontWeight: 700, fontSize: 10, textAlign: "center", color: theme.primary, height: 44, whiteSpace: "nowrap" }}>
                            {fmtRange(t, nextT)}
                          </td>
                          {DAYS.map(day => {
                            const m   = cls.find(c => c.day === day && Number(c.start) <= t && Number(c.end) > t && !c.is_break);
                            const brk = cls.find(c => c.day === day && c.is_break && Number(c.start) <= t && Number(c.end) > t);
                            const isDragTarget = dragOver?.day === day && dragOver?.time === t;
                            const isDragging   = dragBlock && m && m.id === dragBlock.id;
                            const lb = m?.roomType === "Laboratory";

                            if (brk) return (
                              <td key={day} style={{ border: "1px solid #ddd", textAlign: "center", height: 44, background: "#fef9c3" }}>
                                <span style={{ fontSize: 10, color: "#854d0e", fontWeight: 700 }}>☕ Break</span>
                              </td>
                            );

                            if (!m) return (
                              <td
                                key={day}
                                style={{
                                  border: `2px solid ${isDragTarget ? theme.primary : "#ddd"}`,
                                  height: 44,
                                  background: isDragTarget ? theme.light2 : "#fff",
                                  transition: "all 0.12s",
                                  cursor: dragBlock ? "copy" : "default",
                                }}
                                onDragOver={e => handleDragOver(e, day, t)}
                                onDragLeave={() => setDragOver(null)}
                                onDrop={e => handleDrop(e, day, t, inst)}
                              >
                                {isDragTarget && (
                                  <div style={{ fontSize: 10, color: theme.primary, fontWeight: 700, textAlign: "center", padding: 4 }}>
                                    Drop here
                                  </div>
                                )}
                              </td>
                            );

                            const { code, name, type } = resolveSubjectDisplay(m, codeMap);
                            const isGE = type === "GE";
                            const badgeBg = getBadgeBg(type, theme);

                            return (
                              <td
                                key={day}
                                style={{
                                  border: `1px solid #ddd`,
                                  textAlign: "center",
                                  verticalAlign: "middle",
                                  height: 44,
                                  background: isDragging ? "rgba(0,0,0,0.04)" : (lb ? theme.light2 : theme.light),
                                  opacity: isDragging ? 0.45 : 1,
                                  cursor: m.id ? "grab" : "default",
                                  transition: "all 0.12s",
                                  outline: isDragging ? `2px dashed ${theme.primary}` : "none",
                                }}
                                draggable={!!m.id}
                                onDragStart={e => m.id && handleDragStart(e, m)}
                                onDragOver={e => handleDragOver(e, day, t)}
                                onDragLeave={() => setDragOver(null)}
                                onDrop={e => handleDrop(e, day, t, inst)}
                              >
                                <div style={{ display: "inline-flex", alignItems: "center", background: badgeBg, color: "#fff", borderRadius: 4, padding: "2px 8px", fontSize: 10, fontWeight: 900, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 2 }}>
                                  {code || name}
                                </div>
                                {m.section && <div style={{ fontSize: 9, color: theme.primary, fontWeight: 700 }}>{m.section}</div>}
                                <div style={{ fontSize: 9, color: "#475569" }}>{m.room}</div>
                                <div style={{ fontSize: 9, color: lb ? theme.text : "#166534", fontWeight: 700 }}>{lb ? "🔬 Lab" : "📖 Lec"}</div>
                                {m.id && (
                                  <div style={{ fontSize: 8, color: "#94a3b8", marginTop: 2 }}>✥ drag</div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ════════ DRAG-DROP INLINE SCHEDULE GRID — STUDENT ════════ */
function InlineStudentGrid({ schedules, allSchedules, academicYear, semester, onMoveBlock, theme, codeMap, instructorPool = [] }) {
  const [dragBlock, setDragBlock] = useState(null);
  const [dragOver, setDragOver]   = useState(null);
  const [toast, setToast]         = useState(null);

  const real     = schedules.filter(s => !s.is_break);
  const sections = [...new Set(real.filter(s => s.section?.trim()).map(s => s.section))].sort();

  const handlePrint = (section) => {
    const win = window.open("", "_blank");
    const content = document.getElementById(`inline-student-print-${section}`)?.innerHTML || "";
    win.document.write(`<!DOCTYPE html><html><head><title>Schedule - ${section}</title><style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;font-size:10pt;color:#000;}.page{padding:14mm;}table{width:100%;border-collapse:collapse;}th{background:${theme.primary};color:#fff;font-weight:bold;padding:6px 4px;text-align:center;border:1px solid ${theme.primary3||theme.primary};font-size:8pt;}td{border:1px solid #ddd;padding:4px;text-align:center;vertical-align:middle;height:40px;}@media print{@page{margin:0;size:A4 landscape;}body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}</style></head><body><div class="page">${content}</div></body></html>`);
    win.document.close(); win.focus();
    setTimeout(() => { win.print(); win.close(); }, 700);
  };

  const handleDragStart = (e, block) => {
    setDragBlock(block);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDrop = async (e, day, time, section) => {
    e.preventDefault();
    if (!dragBlock || dragBlock.section !== section) return;
    setDragOver(null);
    const dur      = dragBlock.end - dragBlock.start;
    const newStart = time;
    const newEnd   = time + dur;
    if (newStart === dragBlock.start && day === dragBlock.day) { setDragBlock(null); return; }

    const others    = allSchedules.filter(s => !s.is_break && s.id !== dragBlock.id);
    const moved     = { ...dragBlock, day, start: newStart, end: newEnd };
    const conflicts = detectConflicts([...others, moved]);
    const relevant  = conflicts.filter(c => c.blockA?.id === dragBlock.id || c.blockB?.id === dragBlock.id);

    if (relevant.length > 0) {
      setToast({ conflicts: relevant.map(c => ({ ...c, suggestions: findSuggestions(c, others, instructorPool) })) });
      setDragBlock(null);
      return;
    }

    await onMoveBlock(dragBlock, { day, start: newStart, end: newEnd, room: dragBlock.room });
    setDragBlock(null);
  };

  const handleDragOver = (e, day, time) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver({ day, time });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {toast && (
        <ConflictToast
          conflicts={toast.conflicts}
          allSchedules={allSchedules}
          onClose={() => setToast(null)}
          onMoveSchedule={null}
          instructorPool={instructorPool}
        />
      )}

      {sections.length === 0 && (
        <div style={{ textAlign: "center", padding: "48px 0", color: "#94a3b8", fontSize: 14 }}>
          No student schedules yet. Add schedules in <strong>Student Load</strong>.
        </div>
      )}

      {sections.map(sec => {
        const rawCls = schedules
          .filter(s => s.section === sec && !s.is_break)
          .map(b => ({ ...b, start: Number(b.start), end: Number(b.end) }));
        const cls = DAYS.flatMap(day => {
          const dayBlocks = rawCls.filter(b => b.day === day);
          return dayBlocks.length ? insertBreaks(dayBlocks) : [];
        });
        const realCls = cls.filter(s => !s.is_break);
        const total   = realCls.reduce((s, c) => s + (c.end - c.start), 0);
        const labH    = realCls.filter(c => c.roomType === "Laboratory").reduce((s, c) => s + (c.end - c.start), 0);
        const lecH    = realCls.filter(c => c.roomType === "Lecture").reduce((s, c) => s + (c.end - c.start), 0);
        const timeSlots = buildPrintTimeSlots(cls);

        return (
          <div key={sec} style={{ marginBottom: 28, border: `1px solid ${theme.border}`, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ background: theme.primary, color: "#fff", padding: "9px 16px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>🎓 {sec}</span>
              <span style={{ fontSize: 11, opacity: 0.8 }}>⏱ {total} hrs total</span>
              <span style={{ fontSize: 11, opacity: 0.8 }}>📖 {lecH}h Lec</span>
              <span style={{ fontSize: 11, opacity: 0.8 }}>🔬 {labH}h Lab</span>
              <button
                onClick={() => handlePrint(sec)}
                style={{ marginLeft: "auto", padding: "5px 14px", background: "rgba(255,255,255,0.15)", color: "#fff", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 600 }}
              >
                🖨 Print
              </button>
            </div>

            {/* Hidden printable version */}
            <div id={`inline-student-print-${sec}`} style={{ display: "none" }}>
              <div style={{ textAlign: "center", fontWeight: "bold", fontSize: 13, textTransform: "uppercase", margin: "8px 0 4px" }}>Class Schedule — {sec}</div>
              {academicYear && semester && <div style={{ textAlign: "center", fontSize: 10, color: theme.primary, marginBottom: 6 }}>A.Y. {academicYear} · {semester}</div>}
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ background: theme.primary, color: "#fff", padding: "7px 10px", border: `1px solid ${theme.primary3 || theme.primary}`, minWidth: 90, textAlign: "center", fontSize: 11 }}>Time</th>
                    {DAYS.map(d => (
                      <th key={d} style={{ background: theme.primary, color: "#fff", padding: "7px 8px", border: `1px solid ${theme.primary3 || theme.primary}`, textAlign: "center", fontSize: 11, minWidth: 115 }}>{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {timeSlots.map(t => {
                    if (t === LUNCH_START) return (
                      <tr key="lunch">
                        <td style={{ background: "#fef9c3", border: "1px solid #ddd", fontWeight: 700, fontSize: 10, textAlign: "center", color: "#854d0e", height: 28 }}>{fmtRange(LUNCH_START, LUNCH_END)}</td>
                        {DAYS.map(day => <td key={day} style={{ border: "1px solid #ddd", textAlign: "center", height: 28, background: "#fef9c3" }}><span style={{ fontSize: 10, color: "#854d0e", fontWeight: 700 }}>🍽 Lunch</span></td>)}
                      </tr>
                    );
                    if (t > LUNCH_START && t < LUNCH_END) return null;
                    const nextT = timeSlots[timeSlots.indexOf(t) + 1] ?? (t + 1);

                    return (
                      <tr key={t}>
                        <td style={{ background: theme.light, border: "1px solid #ddd", fontWeight: 700, fontSize: 10, textAlign: "center", color: theme.primary, height: 44, whiteSpace: "nowrap", padding: "4px 8px" }}>
                          {fmtRange(t, nextT)}
                        </td>
                        {DAYS.map(day => {
                          const m   = cls.find(c => c.day === day && Number(c.start) <= t && Number(c.end) > t && !c.is_break);
                          const brk = cls.find(c => c.day === day && c.is_break && Number(c.start) <= t && Number(c.end) > t);
                          const isDragTarget = dragOver?.day === day && dragOver?.time === t;
                          const isDragging   = dragBlock && m && m.id === dragBlock.id;
                          const lb = m?.roomType === "Laboratory";

                          if (brk) return (
                            <td key={day} style={{ border: "1px solid #ddd", textAlign: "center", height: 44, background: "#fef9c3" }}>
                              <span style={{ fontSize: 10, color: "#854d0e", fontWeight: 700 }}>☕ Break</span>
                            </td>
                          );

                          if (!m) return (
                            <td
                              key={day}
                              style={{ border: `2px solid ${isDragTarget ? theme.primary : "#ddd"}`, height: 44, background: isDragTarget ? theme.light2 : "#fff", transition: "all 0.12s", cursor: dragBlock ? "copy" : "default" }}
                              onDragOver={e => handleDragOver(e, day, t)}
                              onDragLeave={() => setDragOver(null)}
                              onDrop={e => handleDrop(e, day, t, sec)}
                            >
                              {isDragTarget && <div style={{ fontSize: 10, color: theme.primary, fontWeight: 700, textAlign: "center", padding: 4 }}>Drop here</div>}
                            </td>
                          );

                          const { code, name, type } = resolveSubjectDisplay(m, codeMap);
                          const badgeBg = getBadgeBg(type, theme);

                          return (
                            <td
                              key={day}
                              style={{ border: "1px solid #ddd", textAlign: "center", verticalAlign: "middle", height: 44, background: isDragging ? "rgba(0,0,0,0.04)" : (lb ? theme.light2 : theme.light), opacity: isDragging ? 0.45 : 1, cursor: m.id ? "grab" : "default", transition: "all 0.12s", outline: isDragging ? `2px dashed ${theme.primary}` : "none" }}
                              draggable={!!m.id}
                              onDragStart={e => m.id && handleDragStart(e, m)}
                              onDragOver={e => handleDragOver(e, day, t)}
                              onDragLeave={() => setDragOver(null)}
                              onDrop={e => handleDrop(e, day, t, sec)}
                            >
                              <div style={{ display: "inline-flex", alignItems: "center", background: badgeBg, color: "#fff", borderRadius: 4, padding: "2px 8px", fontSize: 10, fontWeight: 900, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 2 }}>
                                {code || name}
                              </div>
                              {m.instructor && <div style={{ fontSize: 9, color: theme.primary, fontWeight: 700 }}>{m.instructor}</div>}
                              <div style={{ fontSize: 9, color: "#475569" }}>{m.room}</div>
                              <div style={{ fontSize: 9, color: lb ? theme.text : "#166534", fontWeight: 700 }}>{lb ? "🔬 Lab" : "📖 Lec"}</div>
                              {m.id && <div style={{ fontSize: 8, color: "#94a3b8", marginTop: 2 }}>✥ drag</div>}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ════════ DRAG-DROP INLINE ROOM GRID ════════ */
function InlineRoomGrid({ instructorSchedules, studentSchedules, allSchedules, academicYear, semester, onMoveBlock, theme, codeMap, instructorPool = [] }) {
  const [dragBlock, setDragBlock] = useState(null);
  const [dragOver, setDragOver]   = useState(null);
  const [toast, setToast]         = useState(null);
  const [selectedRoom, setSelectedRoom] = useState("All");

  const allBlocks  = buildRoomBlocks(instructorSchedules, studentSchedules);
  const usedRooms  = ALL_ROOMS.filter(r => allBlocks.some(b => b.room === r));
  const displayRooms = selectedRoom === "All" ? usedRooms : (usedRooms.includes(selectedRoom) ? [selectedRoom] : []);

  const handleDragStart = (e, block) => {
    setDragBlock(block);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDrop = async (e, day, time, room) => {
    e.preventDefault();
    if (!dragBlock) return;
    setDragOver(null);
    const dur      = dragBlock.end - dragBlock.start;
    const newStart = time;
    const newEnd   = time + dur;
    if (newStart === dragBlock.start && day === dragBlock.day && room === dragBlock.room) { setDragBlock(null); return; }

    const others    = allSchedules.filter(s => !s.is_break && s.id !== dragBlock.id);
    const moved     = { ...dragBlock, day, start: newStart, end: newEnd, room, roomType: getRoomType(room) };
    const conflicts = detectConflicts([...others, moved]);
    const relevant  = conflicts.filter(c => c.blockA?.id === dragBlock.id || c.blockB?.id === dragBlock.id);

    if (relevant.length > 0) {
      setToast({ conflicts: relevant.map(c => ({ ...c, suggestions: findSuggestions(c, others, instructorPool) })) });
      setDragBlock(null);
      return;
    }

    await onMoveBlock(dragBlock, { day, start: newStart, end: newEnd, room, roomType: getRoomType(room) });
    setDragBlock(null);
  };

  const handleDragOver = (e, day, time) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver({ day, time });
  };

  const handlePrint = (room) => {
    const win = window.open("", "_blank");
    const content = document.getElementById(`inline-room-print-${room.replace(/\s/g, "-")}`)?.innerHTML || "";
    win.document.write(`<!DOCTYPE html><html><head><title>Room Schedule - ${room}</title><style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;font-size:10pt;color:#000;}.page{padding:14mm;}table{width:100%;border-collapse:collapse;}th{background:${theme.primary};color:#fff;font-weight:bold;padding:6px 4px;text-align:center;border:1px solid ${theme.primary3||theme.primary};font-size:8pt;}td{border:1px solid #ddd;padding:4px;text-align:center;vertical-align:middle;height:40px;}@media print{@page{margin:0;size:A4 landscape;}body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}</style></head><body><div class="page">${content}</div></body></html>`);
    win.document.close(); win.focus();
    setTimeout(() => { win.print(); win.close(); }, 700);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
       `1 kjiv c`
       

      {/* Filter bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: theme.light2, borderRadius: 8, padding: "10px 16px", border: `1px solid ${theme.border}` }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>🏫 Filter Room:</span>
        <select
          value={selectedRoom}
          onChange={e => setSelectedRoom(e.target.value)}
          style={{ padding: "6px 12px", border: `1px solid ${theme.border}`, borderRadius: 7, fontSize: 13, background: "#fff", color: "#0f172a", outline: "none" }}
        >
          <option value="All">All Rooms</option>
          <optgroup label="── Lecture Rooms ──">{LECTURE_ROOMS.map(r => <option key={r} value={r}>{r}</option>)}</optgroup>
          <optgroup label="── Laboratories ──">{LAB_ROOMS.map(r => <option key={r} value={r}>{r}</option>)}</optgroup>
        </select>
        <span style={{ fontSize: 12, color: "#64748b" }}>{usedRooms.length} room(s) in use · drag blocks to move across rooms & days</span>
      </div>

      {usedRooms.length === 0 && (
        <div style={{ textAlign: "center", padding: "48px 0", color: "#94a3b8", fontSize: 14 }}>
          No room data yet. Add instructor or student schedules first.
        </div>
      )}

      {displayRooms.map(room => {
        const isLab   = LAB_ROOMS.includes(room);
        const blocks  = allBlocks.filter(b => b.room === room).map(b => ({ ...b, start: Number(b.start), end: Number(b.end) }));
        const timeSlots = buildPrintTimeSlots(blocks);

        return (
          <div key={room} style={{ border: `1px solid ${theme.border}`, borderRadius: 10, overflow: "hidden" }}>
            {/* Room header */}
            <div style={{ background: isLab ? theme.primary : "#16a34a", color: "#fff", padding: "9px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 18 }}>{isLab ? "🔬" : "📖"}</span>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{room}</span>
              <span style={{ fontSize: 11, opacity: 0.8 }}>{isLab ? "Laboratory" : "Lecture Room"}</span>
              <span style={{ fontSize: 11, opacity: 0.7 }}>· {blocks.length} block(s)</span>
              <button
                onClick={() => handlePrint(room)}
                style={{ marginLeft: "auto", padding: "5px 14px", background: "rgba(255,255,255,0.15)", color: "#fff", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 600 }}
              >
                🖨 Print
              </button>
            </div>

            {/* Hidden printable area */}
            <div id={`inline-room-print-${room.replace(/\s/g, "-")}`} style={{ display: "none" }}>
              <div style={{ textAlign: "center", fontWeight: "bold", fontSize: 13, textTransform: "uppercase", margin: "8px 0 4px" }}>Room Schedule — {room}</div>
              {academicYear && semester && <div style={{ textAlign: "center", fontSize: 10, color: theme.primary, marginBottom: 6 }}>A.Y. {academicYear} · {semester}</div>}
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ background: isLab ? theme.primary : "#16a34a", color: "#fff", padding: "7px 10px", border: `1px solid ${isLab ? theme.primary3 || theme.primary : "#15803d"}`, minWidth: 90, textAlign: "center", fontSize: 11 }}>Time</th>
                    {DAYS.map(d => (
                      <th key={d} style={{ background: isLab ? theme.primary : "#16a34a", color: "#fff", padding: "7px 8px", border: `1px solid ${isLab ? theme.primary3 || theme.primary : "#15803d"}`, textAlign: "center", fontSize: 11, minWidth: 115 }}>{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {timeSlots.map(t => {
                    if (t === LUNCH_START) return (
                      <tr key="lunch">
                        <td style={{ background: "#fef9c3", border: "1px solid #ddd", fontWeight: 700, fontSize: 10, textAlign: "center", color: "#854d0e", height: 28 }}>{fmtRange(LUNCH_START, LUNCH_END)}</td>
                        {DAYS.map(day => <td key={day} style={{ border: "1px solid #ddd", textAlign: "center", height: 28, background: "#fef9c3" }}><span style={{ fontSize: 10, color: "#854d0e", fontWeight: 700 }}>🍽 Lunch</span></td>)}
                      </tr>
                    );
                    if (t > LUNCH_START && t < LUNCH_END) return null;
                    const nextT = timeSlots[timeSlots.indexOf(t) + 1] ?? (t + 1);

                    return (
                      <tr key={t}>
                        <td style={{ background: theme.light, border: "1px solid #ddd", fontWeight: 700, fontSize: 10, textAlign: "center", color: theme.primary, height: 44, whiteSpace: "nowrap", padding: "4px 8px" }}>
                          {fmtRange(t, nextT)}
                        </td>
                        {DAYS.map(day => {
                          const m   = blocks.find(c => c.day === day && Number(c.start) <= t && Number(c.end) > t);
                          const isDragTarget = dragOver?.day === day && dragOver?.time === t;
                          const isDragging   = dragBlock && m && m.id === dragBlock.id;
                          const lb = isLab;

                          if (!m) return (
                            <td
                              key={day}
                              style={{ border: `2px solid ${isDragTarget ? (isLab ? theme.primary : "#16a34a") : "#ddd"}`, height: 44, background: isDragTarget ? theme.light2 : "#fff", transition: "all 0.12s", cursor: dragBlock ? "copy" : "default" }}
                              onDragOver={e => handleDragOver(e, day, t)}
                              onDragLeave={() => setDragOver(null)}
                              onDrop={e => handleDrop(e, day, t, room)}
                            >
                              {isDragTarget && <div style={{ fontSize: 10, color: theme.primary, fontWeight: 700, textAlign: "center", padding: 4 }}>Drop here</div>}
                            </td>
                          );

                          const { code, name, type } = resolveSubjectDisplay(m, codeMap);
                          const badgeBg = getBadgeBg(type, theme);

                          return (
                            <td
                              key={day}
                              style={{ border: "1px solid #ddd", textAlign: "center", verticalAlign: "middle", height: 44, background: isDragging ? "rgba(0,0,0,0.04)" : (lb ? theme.light2 : "#f0fdf4"), opacity: isDragging ? 0.45 : 1, cursor: m.id ? "grab" : "default", transition: "all 0.12s", outline: isDragging ? `2px dashed ${theme.primary}` : "none" }}
                              draggable={!!m.id}
                              onDragStart={e => m.id && handleDragStart(e, m)}
                              onDragOver={e => handleDragOver(e, day, t)}
                              onDragLeave={() => setDragOver(null)}
                              onDrop={e => handleDrop(e, day, t, room)}
                            >
                              <div style={{ display: "inline-flex", alignItems: "center", background: badgeBg, color: "#fff", borderRadius: 4, padding: "2px 8px", fontSize: 10, fontWeight: 900, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 2 }}>
                                {code || name}
                              </div>
                              {m.instructor && <div style={{ fontSize: 9, color: theme.primary, fontWeight: 700 }}>{m.instructor}</div>}
                              {m.section && <div style={{ fontSize: 9, color: "#475569" }}>{m.section}</div>}
                              <div style={{ fontSize: 9, color: lb ? theme.text : "#166534", fontWeight: 700 }}>{lb ? "🔬 Lab" : "📖 Lec"}</div>
                              {m.id && <div style={{ fontSize: 8, color: "#94a3b8", marginTop: 2 }}>✥ drag</div>}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}




function PageContent({ activePage, data, setData, theme, deptCode, codeMap }) {
  const auth = useAuth();
  const [grid,setGrid]=useState({});
  const [studentGrid,setStudentGrid]=useState({});
  const [selectedInstructor, setSelectedInstructor] = useState("");
  const [selectedSection,    setSelectedSection]    = useState("");
  const [ay,setAy]=useState(data.academicYear||"");
  const [sem,setSem]=useState(data.semester||"1st Semester");
  const [editBlock,setEditBlock]=useState(null);
  const [showPrint,setShowPrint]=useState(false);
  const [showStudentPrint,setShowStudentPrint]=useState(null);
  const [outputTab,setOutputTab]=useState("instructor");
  const [toast,setToast]=useState(null);
  const [generating,setGenerating]=useState(false);

  const [instructorPoolList, setInstructorPoolList] = useState([]);
  const [sectionPoolList,    setSectionPoolList]    = useState([]);

  const activeSemester = data.semester || "1st Semester";

  useEffect(() => {
    if (data.academicYear) setAy(data.academicYear);
    if (data.semester)     setSem(data.semester);
  }, [data.academicYear, data.semester]);

  useEffect(() => {
    fetch(`/api/instructor-pool?dept=${theme.code}`, { credentials:"include" })
      .then(r => r.ok ? r.json() : [])
      .then(list => setInstructorPoolList(Array.isArray(list) ? list.filter(i => i.name) : []))
      .catch(() => setInstructorPoolList([]));
  }, [theme.code]);

  useEffect(() => {
    fetch(`/api/sections?semester=${encodeURIComponent(activeSemester)}`, { credentials:"include" })
      .then(r => r.ok ? r.json() : [])
      .then(list => setSectionPoolList(Array.isArray(list) ? list : []))
      .catch(() => setSectionPoolList([]));
  }, [activeSemester, activePage]);

  const cardStyle={background:"#fff",padding:28,borderRadius:12,width:"100%",maxWidth:1300,boxShadow:`0 4px 12px rgba(0,0,0,0.06)`,display:"flex",flexDirection:"column",gap:16,alignSelf:"flex-start",borderTop:`4px solid ${theme.primary}`};
  const inpStyle={padding:"10px 12px",border:`1px solid ${theme.border}`,borderRadius:8,fontSize:14,outline:"none"};
  const btnStyle={padding:"11px 20px",background:theme.primary,color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:14,fontWeight:600,alignSelf:"flex-start"};

  useEffect(()=>{
    fetch("/api/schedules",{credentials:"include"})
      .then(r=>r.ok?r.json():[])
      .then(rows=>{
        const all = Array.isArray(rows) ? rows : [];
        const filtered = deptCode ? all.filter(s => !s.dept_code || s.dept_code === deptCode) : all;
        setData(p=>({...p,schedules:filtered}));
      }).catch(()=>{});
    fetch("/api/student-schedules",{credentials:"include"})
      .then(r=>r.ok?r.json():[])
      .then(rows=>{
        const all = Array.isArray(rows) ? rows : [];
        const filtered = deptCode ? all.filter(s => !s.dept_code || s.dept_code === deptCode) : all;
        setData(p=>({...p,studentSchedules:filtered}));
      }).catch(()=>{});
  },[deptCode]);

  const saveEdit=(updated)=>{ setData(p=>({...p,schedules:p.schedules.map(s=>s.id===updated.id?updated:s)})); setEditBlock(null); };

  const allRealSchedules = [
    ...data.schedules.filter(s=>!s.is_break),
    ...data.studentSchedules.filter(s=>!s.is_break),
  ];

  const handleMoveSchedule = async (block, suggestion) => {
    if (!block.id) return;
    try {
      const res = await fetch(`/api/schedules/${block.id}`, {
        method:"PUT", credentials:"include",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ day:suggestion.day, start:suggestion.start, end:suggestion.end, room:suggestion.room, roomType:getRoomType(suggestion.room) }),
      });
      const updated = await res.json();
      if (updated.error) { alert("Move failed: " + updated.error); return; }
      setData(p => ({ ...p, schedules: p.schedules.map(s => s.id === block.id ? updated : s) }));
      setToast(null);
    } catch { alert("Network error while moving schedule."); }
  };

  if (activePage==="Subject Setup")         return <SubjectSetupPage theme={theme} activeSemester={activeSemester} allSchedules={allRealSchedules}/>;
  if (activePage==="Instructor Pool")       return <InstructorPoolPage theme={theme} activeSemester={activeSemester} allSchedules={data.schedules.filter(s=>!s.is_break)}/>;
  if (activePage==="Instructor Assignment") return <InstructorAssignmentPage theme={theme} activeSemester={activeSemester}/>;
  if (activePage==="Section Pool")          return <SectionPoolPage theme={theme} activeSemester={activeSemester}/>;

  /* ── DASHBOARD ── */
  if (activePage==="Dashboard") {
    const scheduledInsts = [...new Set(data.schedules.filter(s=>!s.is_break&&s.instructor?.trim()).map(s=>s.instructor))];
    const sections       = [...new Set(data.studentSchedules.filter(s=>!s.is_break&&s.section?.trim()).map(s=>s.section))];
    const allBlocks      = buildRoomBlocks(data.schedules, data.studentSchedules);
    const usedRooms      = ALL_ROOMS.filter(r => allBlocks.some(b => b.room === r));
    const usedLecRooms   = LECTURE_ROOMS.filter(r => usedRooms.includes(r));
    const usedLabRooms   = LAB_ROOMS.filter(r => usedRooms.includes(r));

    const statCards = [
      { n: scheduledInsts.length,  label:"Instructors Scheduled", sub:`with active schedule blocks`,          color:theme.primary,  icon:"👨‍🏫" },
      { n: sections.length,         label:"Student Sections",       sub:`sections with schedules saved`,        color:"#16a34a",      icon:"🎓" },
      { n: usedRooms.length,        label:"Rooms In Use",           sub:`${usedLecRooms.length} lec · ${usedLabRooms.length} lab`, color:"#d97706", icon:"🏫" },
    ];

    return (
      <div style={{display:"flex",flexDirection:"column",gap:20,width:"100%",maxWidth:1000,alignSelf:"flex-start"}}>
        <SchoolHeader academicYear={data.academicYear} semester={data.semester} theme={theme}/>
        <div style={{display:"flex",alignItems:"center",gap:14,padding:"18px 22px",background:`linear-gradient(135deg,${theme.sidebar},${theme.primary3})`,borderRadius:12,boxShadow:`0 4px 20px rgba(0,0,0,0.15)`}}>
          <span style={{fontSize:36}}>{theme.emoji}</span>
          <div>
            <div style={{fontSize:15,fontWeight:800,color:"#fff"}}>{auth?.isSuperAdmin ? `Previewing: ${theme.code} — ${theme.name}` : `${theme.code} — ${theme.name}`}</div>
            <div style={{fontSize:11,color:"rgba(255,255,255,0.6)",marginTop:2}}>Logged in as {auth?.name} · SmartSched</div>
          </div>
          <div style={{marginLeft:"auto",background:"rgba(255,255,255,0.1)",borderRadius:8,padding:"8px 14px",textAlign:"center"}}>
            <div style={{color:"rgba(255,255,255,0.6)",fontSize:10}}>A.Y.</div>
            <div style={{color:"#fff",fontSize:12,fontWeight:700}}>{data.academicYear||"—"}</div>
          </div>
        </div>
        {data.semester && (
          <div style={{background:theme.light2,border:`1px solid ${theme.border}`,borderRadius:8,padding:"10px 18px",fontSize:13,color:theme.text,display:"flex",gap:8,alignItems:"center"}}>
            <span>📅</span>
            <span>Active Semester: <strong>{data.semester}</strong> — Subject Setup, Instructor Pool, and Assignments are filtered to this semester.</span>
          </div>
        )}
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:18}}>
          {statCards.map(({ n, label, sub, color, icon }) => (
            <div key={label} style={{background:"#fff",padding:"22px 24px",borderRadius:12,boxShadow:`0 2px 8px rgba(0,0,0,0.07)`,border:`1px solid ${theme.light2}`,borderTop:`4px solid ${color}`}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                <span style={{fontSize:24}}>{icon}</span>
                <div style={{fontSize:32,fontWeight:800,color}}>{n}</div>
              </div>
              <div style={{fontSize:13,fontWeight:700,color:"#0f172a"}}>{label}</div>
              <div style={{fontSize:11,color:"#94a3b8",marginTop:3}}>{sub}</div>
            </div>
          ))}
        </div>
        {usedRooms.length > 0 && (
          <div style={{background:"#fff",borderRadius:12,padding:"18px 22px",boxShadow:`0 2px 8px rgba(0,0,0,0.06)`,border:`1px solid ${theme.light2}`}}>
            <div style={{fontSize:14,fontWeight:700,color:"#0f172a",marginBottom:12}}>🏫 Room Utilization</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {usedRooms.map(r => {
                const isLab = LAB_ROOMS.includes(r);
                const cnt   = allBlocks.filter(b => b.room === r).length;
                return (
                  <div key={r} style={{padding:"8px 14px",borderRadius:8,border:`1px solid ${isLab?theme.border:"#86efac"}`,background:isLab?theme.light:"#f0fdf4",display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontSize:14}}>{isLab?"🔬":"📖"}</span>
                    <span style={{fontSize:12,fontWeight:700,color:isLab?theme.text:"#166534"}}>{r}</span>
                    <span style={{fontSize:11,color:"#94a3b8"}}>· {cnt} block{cnt!==1?"s":""}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div style={{background:"#fff",borderRadius:12,padding:"18px 22px",boxShadow:`0 2px 8px rgba(0,0,0,0.06)`,border:`1px solid ${theme.light2}`}}>
          <div style={{fontSize:13,fontWeight:700,color:"#64748b",marginBottom:10,textTransform:"uppercase",letterSpacing:.5}}>Quick Setup Checklist</div>
          {[
            { done: !!data.academicYear && !!data.semester, label:"Academic Year & Semester configured",       page:"Academic Setup" },
            { done: instructorPoolList.length > 0,           label:"Instructors added to Instructor Pool",     page:"Instructor Pool" },
            { done: sectionPoolList.length > 0,              label:"Sections added to Section Pool",           page:"Section Pool" },
            { done: data.schedules.filter(s=>!s.is_break).length > 0,       label:"Instructor schedules saved",            page:"Schedule Output" },
            { done: data.studentSchedules.filter(s=>!s.is_break).length > 0, label:"Student schedules saved",             page:"Schedule Output" },
          ].map(({ done, label, page }) => (
            <div key={label} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:`1px solid #f1f5f9`}}>
              <span style={{fontSize:16,width:24,textAlign:"center"}}>{done?"✅":"⬜"}</span>
              <span style={{fontSize:13,color:done?"#166534":"#64748b",flex:1,fontWeight:done?600:400}}>{label}</span>
              {!done && <span style={{fontSize:11,color:theme.primary,fontWeight:600,cursor:"pointer",textDecoration:"underline"}}>{page}</span>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ── ACADEMIC SETUP ── */
  if (activePage==="Academic Setup") {
    const save=async()=>{
      if(!ay.trim()) return alert("Please enter an Academic Year.");
      try {
        const res=await fetch("/api/academic",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({year:ay,semester:sem})});
        const s=await res.json();
        setData(prev=>({...prev,academicYear:s.year||ay,semester:s.semester||sem,academicYearId:s.id}));
      } catch {setData(prev=>({...prev,academicYear:ay,semester:sem}));}
      alert("Academic setup saved!");
    };
    const semesterOptions = [
      { value:"1st Semester", icon:"🌱", desc:"August – December", color:"#16a34a", bg:"#dcfce7", border:"#86efac" },
      { value:"2nd Semester", icon:"🌸", desc:"January – May",     color:"#d97706", bg:"#fef9c3", border:"#fde68a" },
    ];
    return (
      <div style={{display:"flex",flexDirection:"column",gap:20,width:"100%",maxWidth:700,alignSelf:"flex-start"}}>
        <div style={{background:theme.headerBg,borderRadius:12,padding:"20px 26px",display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
          <span style={{fontSize:36}}>🏫</span>
          <div><div style={{color:"#fff",fontWeight:800,fontSize:18}}>Academic Setup</div><div style={{color:"rgba(255,255,255,0.65)",fontSize:12,marginTop:3}}>Configure the current Academic Year and active Semester for {theme.code}</div></div>
        </div>
        {(data.academicYear || data.semester) && (
          <div style={{background:"#fff",borderRadius:12,padding:"18px 22px",boxShadow:`0 2px 8px rgba(0,0,0,0.07)`,border:`1px solid ${theme.light2}`,display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
            <div style={{fontSize:28}}>📌</div>
            <div>
              <div style={{fontSize:12,fontWeight:600,color:"#64748b",marginBottom:4}}>Currently Saved</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                {data.academicYear&&<span style={{display:"inline-flex",alignItems:"center",gap:6,background:theme.light2,color:theme.text,border:`1px solid ${theme.border}`,borderRadius:8,padding:"5px 14px",fontSize:13,fontWeight:700}}>📅 A.Y. {data.academicYear}</span>}
                {data.semester&&<span style={{display:"inline-flex",alignItems:"center",gap:6,background:"#fefce8",color:"#854d0e",border:"1px solid #fde68a",borderRadius:8,padding:"5px 14px",fontSize:13,fontWeight:700}}>📚 {data.semester}</span>}
              </div>
            </div>
          </div>
        )}
        <div style={{background:"#fff",borderRadius:12,padding:28,boxShadow:`0 2px 10px rgba(0,0,0,0.07)`,borderTop:`4px solid ${theme.primary}`,display:"flex",flexDirection:"column",gap:20}}>
          <div>
            <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:8}}><span style={{fontSize:20}}>📅</span> Academic Year</label>
            <input placeholder="e.g. 2024–2025" style={{...inpStyle,width:"100%",boxSizing:"border-box",fontSize:15,fontWeight:600,border:`2px solid ${theme.border}`,borderRadius:10,padding:"12px 16px"}} value={ay} onChange={e=>setAy(e.target.value)}/>
            <div style={{marginTop:6,fontSize:11,color:"#94a3b8"}}>Format: YYYY–YYYY (e.g. 2024–2025)</div>
          </div>
          <div>
            <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,fontWeight:700,color:"#0f172a",marginBottom:10}}><span style={{fontSize:20}}>📚</span> Active Semester</label>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              {semesterOptions.map(opt => {
                const isActive = sem === opt.value;
                return (
                  <div key={opt.value} onClick={() => setSem(opt.value)} style={{cursor:"pointer",padding:"18px 20px",borderRadius:10,border:`2px solid ${isActive?opt.color:"#e2e8f0"}`,background:isActive?opt.bg:"#fafafa",display:"flex",alignItems:"center",gap:12,transition:"all 0.15s",boxShadow:isActive?`0 4px 14px ${opt.border}`:"none"}}>
                    <span style={{fontSize:28}}>{opt.icon}</span>
                    <div><div style={{fontWeight:700,fontSize:14,color:isActive?opt.color:"#374151"}}>{opt.value}</div><div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>{opt.desc}</div></div>
                    {isActive&&<span style={{marginLeft:"auto",background:opt.color,color:"#fff",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700}}>✓ Active</span>}
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{background:"#fef9c3",border:"1px solid #fde68a",borderRadius:10,padding:"12px 16px",fontSize:13,color:"#854d0e",display:"flex",gap:10,alignItems:"flex-start"}}>
            <span style={{fontSize:18,lineHeight:1}}>⚠️</span>
            <span>Changing the semester updates which subjects, instructors, and assignments appear across <strong>all setup pages</strong>. Make sure to configure each semester separately.</span>
          </div>
          <button style={{padding:"13px 28px",background:theme.primary,color:"#fff",border:"none",borderRadius:10,cursor:"pointer",fontSize:15,fontWeight:700,display:"flex",alignItems:"center",gap:8,alignSelf:"flex-start",boxShadow:`0 4px 14px ${theme.border}`}} onClick={save}>
            <span style={{fontSize:18}}>💾</span> Save Academic Setup
          </button>
        </div>
      </div>
    );
  }

  /* ── INSTRUCTOR LOAD ── */
  if (activePage==="Instructor Load") {
    // ── MODIFIED: check subject hour_load before saving ──
    const saveSchedule=async()=>{
      if(!selectedInstructor) return alert("Please select an instructor.");
      const rawBlocks=convertGrid(grid,selectedInstructor);
      if(!rawBlocks.length) return alert("No subjects entered.");
      const noRoom=rawBlocks.find(b=>!b.room.trim());
      if(noRoom) return alert(`Please select a room for "${noRoom.subject}" on ${noRoom.day}.`);

      // ── Subject hour load check ──
      try {
        const subjectRes = await fetch(`/api/subjects?semester=${encodeURIComponent(activeSemester)}`, { credentials:"include" });
        const subjectList = subjectRes.ok ? await subjectRes.json() : [];
        for (const rb of rawBlocks) {
          const subDef = subjectList.find(s => normName(s.subject_name) === normName(rb.subject));
          if (subDef && subDef.hour_load > 0) {
            const alreadyScheduled = allRealSchedules
              .filter(s => normName(s.subject) === normName(rb.subject))
              .reduce((sum, s) => sum + (Number(s.end) - Number(s.start)), 0);
            const newHours = rawBlocks
              .filter(b => normName(b.subject) === normName(rb.subject))
              .reduce((sum, b) => sum + (b.end - b.start), 0);
            if (alreadyScheduled + newHours > subDef.hour_load) {
              return alert(`⚠ Hour load limit reached for "${rb.subject}".\nMax: ${subDef.hour_load}h | Already scheduled: ${alreadyScheduled}h | Trying to add: ${newHours}h\nPlease reduce the hours for this subject.`);
            }
          }
        }
      } catch {}

      const blocks=DAYS.flatMap(day=>{ const dayBlocks=rawBlocks.filter(b=>b.day===day); return insertBreaks(dayBlocks); });
      const realBlocks=blocks.filter(b=>!b.is_break);
      const combined=[...allRealSchedules,...realBlocks];
      const allConflicts=detectConflicts(combined);
      const newConflicts=allConflicts.filter(c=>realBlocks.some(b=>(normName(b.instructor)===normName(c.blockA?.instructor)&&b.day===c.blockA?.day&&b.start===c.blockA?.start)||(normName(b.instructor)===normName(c.blockB?.instructor)&&b.day===c.blockB?.day&&b.start===c.blockB?.start)||(b.room===c.blockA?.room&&b.day===c.blockA?.day&&b.start===c.blockA?.start)||(b.room===c.blockB?.room&&b.day===c.blockB?.day&&b.start===c.blockB?.start)));
      if(newConflicts.length>0){setToast(newConflicts);return;}
      try { await fetch("/api/schedules",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({schedules:blocks,academicYearId:data.academicYearId||null})}); } catch {}
      setData({...data,schedules:[...data.schedules,...blocks]});
      setGrid({}); setSelectedInstructor("");
      alert(`Schedule for ${selectedInstructor} saved!`);
    };

    const regular  = instructorPoolList.filter(i => !i.employment_type || i.employment_type === "Regular" || i.employment_type === "Permanent");
    const parttime = instructorPoolList.filter(i => i.employment_type === "Part-time");

    return (
      <div style={cardStyle}>
        {toast && <ConflictToast conflicts={toast} allSchedules={allRealSchedules} onClose={()=>setToast(null)} onMoveSchedule={handleMoveSchedule} instructorPool={instructorPoolList}/>}
        <div style={{background:theme.headerBg,borderRadius:10,padding:"16px 22px",marginBottom:4,display:"flex",alignItems:"center",gap:14}}>
          <div style={{fontSize:28}}>📋</div>
          <div><div style={{color:"#fff",fontWeight:800,fontSize:16}}>Instructor Load</div><div style={{color:"rgba(255,255,255,0.65)",fontSize:12,marginTop:2}}>Enter weekly schedule per instructor — {theme.code}</div></div>
          {data.semester && <span style={{marginLeft:"auto",background:"rgba(255,255,255,0.15)",color:"#fff",borderRadius:20,padding:"4px 14px",fontSize:11,fontWeight:600}}>📅 {data.semester}</span>}
        </div>
        <div style={{maxWidth:480}}>
          <label style={{fontSize:13,fontWeight:600,color:"#374151",display:"block",marginBottom:6}}>Select Instructor</label>
          {instructorPoolList.length > 0 ? (
            <select
              style={{...inpStyle,width:"100%",boxSizing:"border-box",fontWeight:600,color:selectedInstructor?theme.primary:"#94a3b8",border:`2px solid ${selectedInstructor?theme.primary:theme.border}`,borderRadius:8}}
              value={selectedInstructor}
              onChange={e => { setSelectedInstructor(e.target.value); setGrid({}); }}
            >
              <option value="">— Select Instructor —</option>
              {regular.length > 0 && <optgroup label="🏛 Regular">{regular.map(i=><option key={i.id} value={i.name}>{i.name}{i.department&&i.department!==theme.code?` [${i.department}]`:""}</option>)}</optgroup>}
              {parttime.length > 0 && <optgroup label="⏱ Part-time">{parttime.map(i=><option key={i.id} value={i.name}>{i.name}{i.department&&i.department!==theme.code?` [${i.department}]`:""}</option>)}</optgroup>}
            </select>
          ) : (
            <div style={{padding:"12px 16px",background:"#fef9c3",border:"1px solid #fde68a",borderRadius:8,fontSize:13,color:"#854d0e"}}>
              ⚠ No instructors found. Go to <strong>Instructor Pool</strong> to add instructors first.
            </div>
          )}
          {selectedInstructor && (
            <div style={{marginTop:8,padding:"8px 14px",background:theme.light2,border:`1px solid ${theme.border}`,borderRadius:7,fontSize:12,color:theme.text,display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:16}}>👨‍🏫</span>
              <span>Entering schedule for <strong>{selectedInstructor}</strong></span>
              {/* ── Show instructor current load vs max load inline ── */}
              {(() => {
                const instObj = instructorPoolList.find(i => i.name === selectedInstructor);
                const maxLoad = instObj?.max_load || 0;
                if (!maxLoad) return null;
                const currentLoad = allRealSchedules
                  .filter(s => normName(s.instructor) === normName(selectedInstructor))
                  .reduce((sum, s) => sum + (Number(s.end) - Number(s.start)), 0);
                const remaining = Math.max(0, maxLoad - currentLoad);
                const pct = Math.min(100, Math.round((currentLoad / maxLoad) * 100));
                const over = currentLoad >= maxLoad;
                return (
                  <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:11,fontWeight:700,color:over?"#dc2626":"#334155"}}>{currentLoad}h / {maxLoad}h</span>
                    <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:20,
                      background:over?"#fee2e2":pct>=80?"#fef9c3":"#dcfce7",
                      color:over?"#dc2626":pct>=80?"#854d0e":"#166534",
                      border:`1px solid ${over?"#fca5a5":pct>=80?"#fde68a":"#86efac"}`}}>
                      {over ? "🔴 Full" : `🟢 ${remaining}h left`}
                    </span>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <span style={{padding:"4px 12px",borderRadius:20,fontSize:12,fontWeight:600,background:"#dcfce7",color:"#166534",border:"1px solid #86efac"}}>📖 Room 1–5 = Lecture</span>
          <span style={{padding:"4px 12px",borderRadius:20,fontSize:12,fontWeight:600,background:theme.light2,color:theme.text,border:`1px solid ${theme.border}`}}>🔬 Lab A/B/C = Laboratory</span>
          <span style={{padding:"4px 12px",borderRadius:20,fontSize:12,fontWeight:600,background:"#fef9c3",color:"#854d0e",border:"1px solid #fde68a"}}>☕ Breaks auto-inserted after every {BREAK_TRIGGER} hrs</span>
        </div>
        {selectedInstructor && <WeeklyGrid grid={grid} setGrid={setGrid} theme={theme}/>}
        {selectedInstructor && <button style={{...btnStyle,boxShadow:`0 4px 14px ${theme.border}`}} onClick={saveSchedule}>💾 Save Weekly Schedule</button>}
      </div>
    );
  }

  /* ── STUDENT LOAD ── */
  if (activePage==="Student Load") {
    // ── MODIFIED: check subject hour_load before saving ──
    const saveStudentSchedule=async()=>{
      if(!selectedSection) return alert("Please select a section.");
      const rawBlocks=convertStudentGrid(studentGrid,selectedSection);
      if(!rawBlocks.length) return alert("No subjects entered.");
      const noRoom=rawBlocks.find(b=>!b.room.trim());
      if(noRoom) return alert(`Please select a room for "${noRoom.subject}" on ${noRoom.day}.`);

      // ── Subject hour load check ──
      try {
        const subjectRes = await fetch(`/api/subjects?semester=${encodeURIComponent(activeSemester)}`, { credentials:"include" });
        const subjectList = subjectRes.ok ? await subjectRes.json() : [];
        for (const rb of rawBlocks) {
          const subDef = subjectList.find(s => normName(s.subject_name) === normName(rb.subject));
          if (subDef && subDef.hour_load > 0) {
            const alreadyScheduled = allRealSchedules
              .filter(s => normName(s.subject) === normName(rb.subject))
              .reduce((sum, s) => sum + (Number(s.end) - Number(s.start)), 0);
            const newHours = rawBlocks
              .filter(b => normName(b.subject) === normName(rb.subject))
              .reduce((sum, b) => sum + (b.end - b.start), 0);
            if (alreadyScheduled + newHours > subDef.hour_load) {
              return alert(`⚠ Hour load limit reached for "${rb.subject}".\nMax: ${subDef.hour_load}h | Already scheduled: ${alreadyScheduled}h | Trying to add: ${newHours}h\nPlease reduce the hours for this subject.`);
            }
          }
        }
      } catch {}

      const blocks=DAYS.flatMap(day=>{ const dayBlocks=rawBlocks.filter(b=>b.day===day); return insertBreaks(dayBlocks); });
      const realBlocks=blocks.filter(b=>!b.is_break);
      const combined=[...allRealSchedules,...realBlocks];
      const allConflicts=detectConflicts(combined);
      const newConflicts=allConflicts.filter(c=>realBlocks.some(b=>(b.section===c.blockA?.section&&b.day===c.blockA?.day&&b.start===c.blockA?.start)||(b.section===c.blockB?.section&&b.day===c.blockB?.day&&b.start===c.blockB?.start)||(b.room===c.blockA?.room&&b.day===c.blockA?.day&&b.start===c.blockA?.start)||(b.room===c.blockB?.room&&b.day===c.blockB?.day&&b.start===c.blockB?.start)));
      if(newConflicts.length>0){setToast(newConflicts);return;}
      try { await fetch("/api/student-schedules",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({schedules:blocks,academicYearId:data.academicYearId||null})}); } catch {}
      setData({...data,studentSchedules:[...data.studentSchedules,...blocks]});
      setStudentGrid({}); setSelectedSection("");
      alert(`Schedule for ${selectedSection} saved!`);
    };

    const autoGenerateFaculty=async()=>{
      if(!data.studentSchedules.filter(s=>!s.is_break).length) return alert("No student schedules saved yet.");
      if(!window.confirm("Auto-generate faculty schedules from student data?")) return;
      setGenerating(true);
      try {
        const res=await fetch("/api/generate-faculty-from-students",{method:"POST",credentials:"include"});
        const result=await res.json();
        if(!res.ok) return alert("Error: "+(result.error||"Failed."));
        const schedRes=await fetch("/api/schedules",{credentials:"include"});
        const allRows=schedRes.ok?await schedRes.json():[];
        const filtered = deptCode ? allRows.filter(s => !s.dept_code || s.dept_code === deptCode) : allRows;
        setData(p=>({...p,schedules:Array.isArray(filtered)?filtered:[]}));
        alert(`✅ Faculty schedule updated!\nAdded: ${result.generated} new block(s)\nSkipped: ${result.skipped}`);
      } catch { alert("Network error."); }
      setGenerating(false);
    };

    const sectionsByYear = [1,2,3,4].reduce((acc,y)=>{
      acc[y] = sectionPoolList.filter(s => s.year_level === y);
      return acc;
    },{});
    const yearLabels = { 1:"🌱 First Year", 2:"🌿 Second Year", 3:"🌳 Third Year", 4:"🎓 Fourth Year" };

    return (
      <div style={cardStyle}>
        {toast && <ConflictToast conflicts={toast} allSchedules={allRealSchedules} onClose={()=>setToast(null)} onMoveSchedule={null} instructorPool={instructorPoolList}/>}
        <div style={{background:theme.headerBg,borderRadius:10,padding:"16px 22px",marginBottom:4,display:"flex",alignItems:"center",justifyContent:"space-between",gap:14,flexWrap:"wrap"}}>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div style={{fontSize:28}}>🎓</div>
            <div><div style={{color:"#fff",fontWeight:800,fontSize:16}}>Student Load</div><div style={{color:"rgba(255,255,255,0.65)",fontSize:12,marginTop:2}}>Enter weekly schedule per section — {theme.code}</div></div>
            {data.semester && <span style={{background:"rgba(255,255,255,0.15)",color:"#fff",borderRadius:20,padding:"4px 14px",fontSize:11,fontWeight:600}}>📅 {data.semester}</span>}
          </div>
          <button style={{padding:"10px 20px",background:"#16a34a",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:700,opacity:generating?0.6:1}} onClick={autoGenerateFaculty} disabled={generating}>{generating?"⏳ Generating…":"⚡ Auto-Generate Faculty"}</button>
        </div>
        <div style={{maxWidth:480}}>
          <label style={{fontSize:13,fontWeight:600,color:"#374151",display:"block",marginBottom:6}}>Select Section</label>
          {sectionPoolList.length > 0 ? (
            <select
              style={{...inpStyle,width:"100%",boxSizing:"border-box",fontWeight:600,color:selectedSection?theme.primary:"#94a3b8",border:`2px solid ${selectedSection?theme.primary:theme.border}`,borderRadius:8}}
              value={selectedSection}
              onChange={e => { setSelectedSection(e.target.value); setStudentGrid({}); }}
            >
              <option value="">— Select Section —</option>
              {[1,2,3,4].map(y => {
                const list = sectionsByYear[y];
                if (!list?.length) return null;
                return (
                  <optgroup key={y} label={yearLabels[y]}>
                    {list.map(s => <option key={s.id} value={s.section_name}>{s.section_name}</option>)}
                  </optgroup>
                );
              })}
            </select>
          ) : (
            <div style={{padding:"12px 16px",background:"#fef9c3",border:"1px solid #fde68a",borderRadius:8,fontSize:13,color:"#854d0e"}}>
              ⚠ No sections found for {activeSemester}. Go to <strong>Section Pool</strong> to add sections first.
            </div>
          )}
          {selectedSection && (
            <div style={{marginTop:8,padding:"8px 14px",background:theme.light2,border:`1px solid ${theme.border}`,borderRadius:7,fontSize:12,color:theme.text,display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:16}}>🎓</span>
              <span>Entering schedule for section <strong>{selectedSection}</strong></span>
            </div>
          )}
        </div>
        {selectedSection && <StudentWeeklyGrid grid={studentGrid} setGrid={setStudentGrid} theme={theme} activeSemester={activeSemester}/>}
        {selectedSection && <button style={{...btnStyle,boxShadow:`0 4px 14px ${theme.border}`}} onClick={saveStudentSchedule}>💾 Save Section Schedule</button>}
      </div>
    );
  }

  /* ── SCHEDULE OUTPUT ── */
  /* ── SCHEDULE OUTPUT ── */
if (activePage === "Schedule Output") {
  const clearAll = async () => {
    if (!window.confirm("Clear all instructor schedules?")) return;
    try { await fetch("/api/schedules", { method: "DELETE", credentials: "include" }); } catch {}
    setData({ ...data, schedules: [] });
  };
  const clearStudents = async () => {
    if (!window.confirm("Clear all student schedules?")) return;
    try { await fetch("/api/student-schedules", { method: "DELETE", credentials: "include" }); } catch {}
    setData({ ...data, studentSchedules: [] });
  };

  const handleMoveInstructor = async (block, suggestion) => {
    if (!block.id) return;
    try {
      const res = await fetch(`/api/schedules/${block.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day: suggestion.day, start: suggestion.start, end: suggestion.end, room: suggestion.room, roomType: getRoomType(suggestion.room) }),
      });
      const updated = await res.json();
      if (updated.error) { alert("Move failed: " + updated.error); return; }
      setData(p => ({ ...p, schedules: p.schedules.map(s => s.id === block.id ? updated : s) }));
    } catch { alert("Network error."); }
  };

  const handleMoveStudent = async (block, suggestion) => {
    if (!block.id) return;
    try {
      const res = await fetch(`/api/student-schedules/${block.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day: suggestion.day, start: suggestion.start, end: suggestion.end, room: suggestion.room, roomType: getRoomType(suggestion.room) }),
      });
      const updated = await res.json();
      if (updated.error) { alert("Move failed: " + updated.error); return; }
      setData(p => ({ ...p, studentSchedules: p.studentSchedules.map(s => s.id === block.id ? updated : s) }));
    } catch { alert("Network error."); }
  };

  const tabActive   = { padding: "10px 22px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: "transparent", borderBottom: `3px solid ${theme.primary}`, color: theme.primary, marginBottom: -2 };
  const tabInactive = { padding: "10px 22px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: "transparent", borderBottom: "3px solid transparent", color: "#64748b", marginBottom: -2 };

  return (
    <div style={cardStyle}>
      <SchoolHeader academicYear={data.academicYear} semester={data.semester} theme={theme} />
      {(!data.academicYear || !data.semester) && (
        <div style={{ background: "#fef9c3", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 16px", fontSize: 13, color: "#854d0e", display: "flex", gap: 8, alignItems: "center" }}>
          <span>⚠</span><span>Academic Year or Semester not set. Go to <strong>Academic Setup</strong>.</span>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: `2px solid ${theme.light2}` }}>
        <button onClick={() => setOutputTab("instructor")} style={outputTab === "instructor" ? tabActive : tabInactive}>📋 Instructor Schedules</button>
        <button onClick={() => setOutputTab("student")} style={outputTab === "student" ? tabActive : tabInactive}>🎓 Student Schedules</button>
      </div>

      {/* Clear button */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        {outputTab === "instructor" && data.schedules.filter(s => !s.is_break).length > 0 && (
          <button style={{ padding: "7px 16px", background: "#ef4444", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 600 }} onClick={clearAll}>🗑 Clear All Instructor</button>
        )}
        {outputTab === "student" && data.studentSchedules.filter(s => !s.is_break).length > 0 && (
          <button style={{ padding: "7px 16px", background: "#ef4444", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 600 }} onClick={clearStudents}>🗑 Clear All Student</button>
        )}
      </div>

      {/* Inline drag-drop grids */}
     {toast && (
        <ConflictToast
          conflicts={toast.conflicts}
          allSchedules={allSchedules}
          onClose={() => setToast(null)}
          onMoveSchedule={onMoveBlock}
          instructorPool={instructorPool}
        />
      )}
      {outputTab === "student" && (
        <InlineStudentGrid
          schedules={data.studentSchedules}
          allSchedules={allRealSchedules}
          academicYear={data.academicYear}
          semester={data.semester}
          onMoveBlock={handleMoveStudent}
          theme={theme}
          codeMap={codeMap}
          instructorPool={instructorPoolList}
        />
      )}
    </div>
  );
}
  /* ── ROOM SCHEDULE ── */
  if (activePage==="Room Schedule") {
    return (
      <div style={{width:"100%",maxWidth:1300,alignSelf:"flex-start"}}>
        <RoomScheduleView instructorSchedules={data.schedules} studentSchedules={data.studentSchedules} academicYear={data.academicYear} semester={data.semester} theme={theme} codeMap={codeMap}/>
      </div>
    );
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16,width:"100%",maxWidth:1000,alignSelf:"flex-start"}}>
      <SchoolHeader academicYear={data.academicYear} semester={data.semester} theme={theme}/>
    </div>
  );
}

/* ════════ MAIN APP ════════ */
export default function App() {
  const auth = useAuth();
  const [previewDept, setPreviewDept] = useState(null);
  const effectiveDeptCode = auth?.isSuperAdmin ? (previewDept || "BSIT") : (auth?.deptCode || "BSIT");
  const theme = getDeptTheme(effectiveDeptCode);
  const [activePage, setActivePage] = useState("Dashboard");
  const [data, setData] = useState({ academicYear:"", semester:"1st Semester", schedules:[], studentSchedules:[] });

  const codeMap = useSubjectCodeMap();

  useEffect(() => {
    fetch("/api/academic", { credentials:"include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(p => ({ ...p, academicYear: d.year || "", semester: d.semester || "1st Semester", academicYearId: d.id })); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!auth?.isSuperAdmin) return;
    fetch("/api/set-preview-dept", {
      method:"POST", credentials:"include",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ deptCode: previewDept || null }),
    }).catch(() => {});
  }, [previewDept, auth?.isSuperAdmin]);

  if (auth?.isSuperAdmin && !previewDept) {
    return (
      <div style={{display:"flex",height:"100vh",fontFamily:"'Segoe UI',sans-serif",background:"#F0F9FF",flexDirection:"column",overflow:"hidden"}}>
        <div style={{background:"#0C4A6E",padding:"10px 24px",display:"flex",alignItems:"center",gap:14,boxShadow:"0 2px 8px rgba(0,0,0,0.18)",flexShrink:0}}>
          <img src={PCCLogo} style={{width:32,height:32,objectFit:"contain",borderRadius:4}} alt="PCC"/>
          <span style={{color:"#fff",fontWeight:800,fontSize:15,letterSpacing:.3}}>SmartSched</span>
          <span style={{color:"rgba(255,255,255,0.35)",fontSize:13}}>›</span>
          <span style={{color:"rgba(255,255,255,0.7)",fontSize:12}}>Centralized Dashboard</span>
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:10}}>
            <select value="" onChange={e=>{ if(e.target.value){setActivePage("Dashboard");setData({academicYear:"",semester:"1st Semester",schedules:[],studentSchedules:[]});setPreviewDept(e.target.value);}}}
              style={{padding:"6px 12px",background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.25)",borderRadius:7,color:"#fff",fontSize:12,cursor:"pointer",outline:"none"}}>
              <option value="">🏫 Switch to Dept Interface…</option>
              {Object.keys(DEPT_THEMES).map(code=>{const t=DEPT_THEMES[code];return <option key={code} value={code} style={{color:"#000",background:"#fff"}}>{t.emoji} {code} — {t.shortName}</option>;})}
            </select>
            <span style={{background:"rgba(251,191,36,0.18)",color:"#fbbf24",border:"1px solid rgba(251,191,36,0.28)",borderRadius:20,padding:"3px 14px",fontSize:11,fontWeight:700}}>🛡 {auth?.name}</span>
            <button onClick={async()=>{ await fetch("/auth/logout",{method:"POST",credentials:"include"}); window.__smartschedLogout?.(); }}
              style={{padding:"6px 14px",background:"rgba(239,68,68,0.15)",color:"#fca5a5",border:"1px solid rgba(239,68,68,0.25)",borderRadius:7,cursor:"pointer",fontSize:12,fontWeight:600}}>
              🚪 Sign Out
            </button>
          </div>
        </div>
        <div style={{flex:1,overflowY:"auto",width:"100%",minWidth:0}}><SuperAdminPanel/></div>
      </div>
    );
  }

  return (
    <div style={{display:"flex",height:"100vh",fontFamily:"'Segoe UI',sans-serif",background:theme.light}}>
      <Sidebar activePage={activePage} setActivePage={setActivePage} theme={theme} previewDept={previewDept} setPreviewDept={setPreviewDept}/>
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{background:"#fff",padding:"14px 28px",fontSize:18,fontWeight:700,color:"#0f172a",display:"flex",alignItems:"center",borderBottom:`2px solid ${theme.light2}`}}>
          <span style={{color:"#64748b",fontSize:12,fontWeight:500,marginRight:8}}>
            {auth?.isSuperAdmin ? `Previewing: ${previewDept}` : (auth?.deptCode || "PCC")} — {theme.shortName}
          </span>
          <span style={{color:theme.border}}>›</span>
          <span style={{marginLeft:8,color:theme.primary}}>{activePage}</span>
          {data.semester && <span style={{marginLeft:12,background:"#fefce8",color:"#854d0e",border:"1px solid #fde68a",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:600}}>📅 {data.semester}</span>}
          {data.academicYear && <span style={{marginLeft:6,background:theme.light2,color:theme.text,border:`1px solid ${theme.border}`,borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:600}}>A.Y. {data.academicYear}</span>}
          {!auth?.isSuperAdmin && <span style={{marginLeft:"auto",background:theme.light2,color:theme.text,border:`1px solid ${theme.border}`,borderRadius:20,padding:"3px 14px",fontSize:11,fontWeight:700}}>{theme.emoji} {auth?.deptCode}</span>}
          {auth?.isSuperAdmin && <span style={{marginLeft:"auto",background:theme.primary,color:"#fff",borderRadius:20,padding:"3px 14px",fontSize:11,fontWeight:700}}>{theme.emoji} {previewDept} — Preview Mode</span>}
        </div>
        <div style={{flex:1,padding:28,overflowY:"auto",display:"flex",justifyContent:"center"}}>
          <PageContent activePage={activePage} data={data} setData={setData} theme={theme} deptCode={auth?.isSuperAdmin ? previewDept : (auth?.deptCode || null)} codeMap={codeMap}/>
        </div>
      </div>
    </div>
  );
}