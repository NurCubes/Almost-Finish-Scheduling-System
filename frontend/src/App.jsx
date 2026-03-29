import { useState, useEffect, useRef } from "react";
import ITLogo  from "./IT.png";
import PCCLogo from "./pcc.png";

const API       = "http://localhost:5000";
const DAY_START = 8;
const DAY_END   = 20;
const DAYS      = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const TIMES     = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);
const LECTURE_ROOMS = ["Room 1","Room 2","Room 3","Room 4","Room 5"];
const LAB_ROOMS     = ["Lab A","Lab B","Lab C"];

const SKY = {
  50:"#f0f9ff", 100:"#e0f2fe", 200:"#bae6fd", 300:"#7dd3fc",
  400:"#38bdf8", 500:"#0ea5e9", 600:"#0284c7", 700:"#0369a1",
  800:"#075985", 900:"#0c4a6e",
};

function getRoomType(r) { return LAB_ROOMS.includes(r) ? "Laboratory" : "Lecture"; }
function fmtH(h) {
  if (h===0)  return "12:00 AM";
  if (h===12) return "12:00 PM";
  if (h<12)   return `${h}:00 AM`;
  return `${h-12}:00 PM`;
}
function fmtRange(s,e) { return `${fmtH(s)} – ${fmtH(e)}`; }

async function toBase64(url) {
  try {
    const blob = await (await fetch(url)).blob();
    return new Promise(res => { const r=new FileReader(); r.onloadend=()=>res(r.result); r.readAsDataURL(blob); });
  } catch { return ""; }
}

/* ════════════════════════════════════════════════════════
   CONFLICT DETECTOR — 5 rules
════════════════════════════════════════════════════════ */
function detectConflicts(schedules) {
  const out = [];
  for (let i = 0; i < schedules.length; i++) {
    for (let j = i + 1; j < schedules.length; j++) {
      const a = schedules[i], b = schedules[j];
      if (a.day !== b.day) continue;
      const overlaps = a.start < b.end && b.start < a.end;
      if (!overlaps) continue;
      const s = fmtH(Math.max(a.start, b.start));
      const e = fmtH(Math.min(a.end,   b.end));

      if (a.room && b.room && a.room === b.room) {
        const sameSection    = a.section && b.section && a.section === b.section;
        const sameInstructor = a.instructor && b.instructor && a.instructor === b.instructor;
        if (!sameSection || !sameInstructor) {
          out.push({ type:"Room Conflict", day:a.day, room:a.room,
            detail:`"${a.room}" is double-booked on ${a.day} ${s}–${e}: ${a.instructor||a.section||"?"} (${a.subject}) vs ${b.instructor||b.section||"?"} (${b.subject})`,
            blockA:a, blockB:b });
        }
      }
      if (a.instructor && b.instructor && a.instructor === b.instructor) {
  // Skip if it's the exact same class (duplicate block in array)
  const identical = a.subject===b.subject && a.section===b.section &&
                    a.room===b.room && a.start===b.start && a.end===b.end;
  if (!identical) {
    out.push({ type:"Instructor Conflict", day:a.day, room:a.room||"",
      detail:`${a.instructor} is double-booked on ${a.day} ${s}–${e}: "${a.subject}"${a.section?" ("+a.section+")":""} in ${a.room||"?"} and "${b.subject}"${b.section?" ("+b.section+")":""} in ${b.room||"?"}`,
      blockA:a, blockB:b });
  }
}
      if (a.section && b.section && a.section === b.section) {
        if ((a.instructor||"") !== (b.instructor||"")) {
          out.push({ type:"Section Conflict", day:a.day, room:a.room||"",
            detail:`Section ${a.section} has two instructors on ${a.day} ${s}–${e}: ${a.instructor||"?"} (${a.subject}) and ${b.instructor||"?"} (${b.subject})`,
            blockA:a, blockB:b });
        }
      }
      if (a.section && b.section && a.section === b.section &&
          a.room && b.room && a.room !== b.room) {
        out.push({ type:"Section Room Conflict", day:a.day, room:a.room||"",
          detail:`Section ${a.section} is scheduled in two rooms on ${a.day} ${s}–${e}: ${a.room} (${a.subject}) and ${b.room} (${b.subject})`,
          blockA:a, blockB:b });
      }
    }
  }
  return out;
}

/* ── Block mergers — UNCHANGED ── */
function convertGrid(grid, instructor) {
  const out=[];
  DAYS.forEach(day=>{
    let cur=null;
    TIMES.forEach(t=>{
      const cell=grid[day]?.[t]||{};
      const sub=cell.subject||"", room=cell.room||"", rt=cell.roomType||"Lecture", sec=cell.section||"";
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
      const sub=cell.subject||"", room=cell.room||"", rt=cell.roomType||"Lecture", inst=cell.instructor||"";
      if (!sub) { if(cur){out.push(cur);cur=null;} }
      else if (!cur) { cur={section:sectionName,subject:sub,day,start:t,end:t+1,room,roomType:rt,instructor:inst}; }
      else if (cur.subject===sub&&cur.room===room&&cur.roomType===rt&&cur.instructor===inst) { cur.end=t+1; }
      else { out.push(cur); cur={section:sectionName,subject:sub,day,start:t,end:t+1,room,roomType:rt,instructor:inst}; }
    });
    if(cur) out.push(cur);
  });
  return out;
}

/* ═══════════════════ CONFLICT TOAST ═══════════════════ */
function ConflictToast({ conflicts, onClose }) {
  useEffect(()=>{ const t=setTimeout(onClose,10000); return()=>clearTimeout(t); },[]);
  const typeColor=(type)=>{
    if(type==="Room Conflict")         return{bg:"#fff0f0",border:"#fca5a5",accent:"#ef4444",icon:"🏠"};
    if(type==="Instructor Conflict")   return{bg:"#fff7ed",border:"#fed7aa",accent:"#f97316",icon:"👤"};
    if(type==="Section Conflict")      return{bg:"#fefce8",border:"#fde68a",accent:"#eab308",icon:"🎓"};
    if(type==="Section Room Conflict") return{bg:"#f0fdf4",border:"#86efac",accent:"#22c55e",icon:"📍"};
    return{bg:"#f8fafc",border:"#e2e8f0",accent:"#64748b",icon:"⚠"};
  };
  return (
    <div style={{position:"fixed",top:24,right:24,zIndex:9999,background:"#fff",
      border:"2px solid #fca5a5",borderLeft:"5px solid #ef4444",borderRadius:14,
      padding:"18px 22px",maxWidth:460,width:"90%",
      boxShadow:"0 12px 40px rgba(0,0,0,0.18)",fontFamily:"'Segoe UI',sans-serif",
      animation:"slideIn 0.3s ease"}}>
      <style>{`@keyframes slideIn{from{transform:translateX(120%);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:15,color:"#dc2626"}}>
          ❌ Save Blocked — {conflicts.length} Conflict{conflicts.length!==1?"s":""} Found
        </div>
        <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:"#94a3b8",padding:"0 4px",lineHeight:1}}>✕</button>
      </div>
      <div style={{fontSize:12,color:"#64748b",marginBottom:12,lineHeight:1.5}}>
        Resolve the following conflicts before saving. No data has been stored.
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:280,overflowY:"auto"}}>
        {conflicts.map((c,i)=>{
          const col=typeColor(c.type);
          return(
            <div key={i} style={{background:col.bg,border:`1px solid ${col.border}`,
              borderLeft:`4px solid ${col.accent}`,borderRadius:8,padding:"10px 12px",fontSize:12,lineHeight:1.6}}>
              <span style={{fontWeight:700,color:col.accent}}>{col.icon} {c.type}</span>
              <div style={{color:"#374151",marginTop:3}}>{c.detail}</div>
            </div>
          );
        })}
      </div>
      <div style={{marginTop:12,fontSize:11,color:"#94a3b8",textAlign:"right"}}>Auto-closes in 10s</div>
    </div>
  );
}

/* ═══════════════════ SCHOOL HEADER ═══════════════════ */
function SchoolHeader({ academicYear, semester, compact=false }) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:compact?12:16,
      padding:compact?"12px 0 10px":"16px 0 14px",
      borderBottom:`2px solid ${SKY[200]}`,marginBottom:compact?12:16,background:"transparent"}}>
      <img src={ITLogo} style={{width:compact?44:52,height:compact?44:52,objectFit:"contain"}} alt="ICT"/>
      <div style={{flex:1,textAlign:"center"}}>
        <div style={{fontSize:compact?15:17,fontWeight:800,color:"#0f172a",letterSpacing:.3,lineHeight:1.2}}>PASSI CITY COLLEGE</div>
        <div style={{fontSize:compact?11:12,fontWeight:700,color:SKY[700],marginTop:2}}>Information and Communication Technology</div>
        <div style={{fontSize:compact?9:10,color:"#64748b",marginTop:1}}>Passi City, Iloilo, Philippines</div>
        {academicYear&&(
          <div style={{display:"flex",gap:6,justifyContent:"center",marginTop:5,flexWrap:"wrap"}}>
            <span style={{background:SKY[100],color:SKY[800],border:`1px solid ${SKY[300]}`,borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:600}}>📅 A.Y. {academicYear}</span>
            <span style={{background:"#fefce8",color:"#854d0e",border:"1px solid #fde68a",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:600}}>📚 {semester}</span>
          </div>
        )}
      </div>
      <img src={PCCLogo} style={{width:compact?44:52,height:compact?44:52,objectFit:"contain"}} alt="PCC"/>
    </div>
  );
}

/* ═══════════════════ EDIT MODAL — UNCHANGED ═══════════════════ */
function EditModal({ block, onSave, onClose }) {
  const [day,setDay]=useState(block.day);
  const [startH,setStartH]=useState(block.start);
  const [endH,setEndH]=useState(block.end);
  const [room,setRoom]=useState(block.room);
  const [saving,setSaving]=useState(false);
  const [err,setErr]=useState("");
  const dur=block.end-block.start;
  const save=async()=>{
    if(startH>=endH) return setErr("Start time must be before end time.");
    if(!room) return setErr("Please select a room.");
    setSaving(true); setErr("");
    try {
      const res=await fetch(`/api/schedules/${block.id}`,{method:"PUT",credentials:"include",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({day,start:startH,end:endH,room,roomType:getRoomType(room)})});
      const data=await res.json();
      if(data.error){setErr(data.error);setSaving(false);return;}
      onSave(data);
    } catch {setErr("Failed to save.");}
    setSaving(false);
  };
  const lab=getRoomType(room)==="Laboratory";
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}} onClick={onClose}>
      <div style={{background:"#fff",borderRadius:16,padding:28,width:"100%",maxWidth:480,display:"flex",flexDirection:"column",gap:14,boxShadow:"0 24px 64px rgba(0,0,0,0.25)"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${SKY[100]}`,paddingBottom:12}}>
          <div>
            <div style={{fontSize:16,fontWeight:700,color:"#0f172a"}}>✏ Edit Schedule Block</div>
            <div style={{fontSize:12,color:"#64748b",marginTop:2}}>Adjust day, time, or room assignment</div>
          </div>
          <button onClick={onClose} style={{background:SKY[50],border:"none",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:16,color:"#64748b"}}>✕</button>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <span style={{background:"#0f172a",color:"#fff",borderRadius:20,padding:"4px 14px",fontSize:12,fontWeight:600}}>{block.instructor}</span>
          <span style={{background:SKY[100],color:SKY[800],border:`1px solid ${SKY[200]}`,borderRadius:20,padding:"4px 14px",fontSize:12,fontWeight:600}}>{block.subject}</span>
          {block.section&&<span style={{background:"#f0fdf4",color:"#166534",border:"1px solid #86efac",borderRadius:20,padding:"4px 14px",fontSize:12,fontWeight:600}}>{block.section}</span>}
        </div>
        {err&&<div style={{background:"#fee2e2",color:"#dc2626",border:"1px solid #fca5a5",borderRadius:8,padding:"10px 14px",fontSize:13}}>⚠ {err}</div>}
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>Day</label>
          <select style={F.inp} value={day} onChange={e=>setDay(e.target.value)}>
            {DAYS.map(d=><option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div style={{display:"flex",gap:12}}>
          <div style={{flex:1,display:"flex",flexDirection:"column",gap:6}}>
            <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>Start Time</label>
            <select style={F.inp} value={startH} onChange={e=>{const s=Number(e.target.value);setStartH(s);setEndH(s+dur);}}>
              {TIMES.map(t=><option key={t} value={t}>{fmtH(t)}</option>)}
            </select>
          </div>
          <div style={{flex:1,display:"flex",flexDirection:"column",gap:6}}>
            <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>End Time</label>
            <select style={F.inp} value={endH} onChange={e=>setEndH(Number(e.target.value))}>
              {TIMES.filter(t=>t>startH).concat([DAY_END]).map(t=><option key={t} value={t}>{fmtH(t)}</option>)}
            </select>
          </div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>Room</label>
          <select style={F.inp} value={room} onChange={e=>setRoom(e.target.value)}>
            <option value="">— Select Room —</option>
            <optgroup label="Lecture Rooms">{LECTURE_ROOMS.map(r=><option key={r} value={r}>{r}</option>)}</optgroup>
            <optgroup label="Laboratories">{LAB_ROOMS.map(r=><option key={r} value={r}>{r}</option>)}</optgroup>
          </select>
          {room&&<div style={{fontSize:12,borderRadius:20,padding:"4px 14px",display:"inline-block",color:lab?SKY[800]:"#166534",background:lab?SKY[100]:"#dcfce7",border:`1px solid ${lab?SKY[300]:"#86efac"}`}}>{lab?"🔬 Laboratory":"📖 Lecture"}</div>}
        </div>
        <div style={{display:"flex",gap:10,paddingTop:4,borderTop:"1px solid #f1f5f9"}}>
          <button style={{flex:1,padding:"11px",background:SKY[600],color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:14,fontWeight:600}} onClick={save} disabled={saving}>{saving?"Saving…":"✓ Save Changes"}</button>
          <button style={{padding:"11px 20px",background:SKY[50],color:"#334155",border:`1px solid ${SKY[200]}`,borderRadius:8,cursor:"pointer",fontSize:14,fontWeight:500}} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

const F={inp:{padding:"9px 12px",border:`1px solid ${SKY[200]}`,borderRadius:8,fontSize:14,outline:"none",width:"100%",background:"#fff",color:"#0f172a"}};

/* ═══════════════════ HOURS SUMMARY BADGE ROW (NEW) ═══════════════════
   Shows: ⏱ Total X hrs | 📖 Lecture Y hrs (Z slots) | 🔬 Laboratory A hrs (B slots)
   Used in Schedule Output cards (both instructor and student) AND in print modal bars.
═══════════════════════════════════════════════════════════════════════ */
function HoursSummary({ schedules }) {
  const total = schedules.reduce((s,c)=>s+(c.end-c.start),0);
  const labH  = schedules.filter(c=>c.roomType==="Laboratory").reduce((s,c)=>s+(c.end-c.start),0);
  const lecH  = schedules.filter(c=>c.roomType==="Lecture").reduce((s,c)=>s+(c.end-c.start),0);
  const labN  = schedules.filter(c=>c.roomType==="Laboratory").length;
  const lecN  = schedules.filter(c=>c.roomType==="Lecture").length;
  return (
    <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
      <span style={{...ST.badge,background:SKY[100],color:SKY[800],border:`1px solid ${SKY[200]}`,fontSize:11}}>
        ⏱ {total} total hr{total!==1?"s":""}
      </span>
      <span style={{...ST.badge,background:"#dcfce7",color:"#166534",border:"1px solid #86efac",fontSize:11}}>
        📖 Lecture: {lecH} hr{lecH!==1?"s":""} ({lecN} slot{lecN!==1?"s":""})
      </span>
      <span style={{...ST.badge,background:SKY[100],color:SKY[800],border:`1px solid ${SKY[300]}`,fontSize:11}}>
        🔬 Laboratory: {labH} hr{labH!==1?"s":""} ({labN} slot{labN!==1?"s":""})
      </span>
    </div>
  );
}

/* ═══════════════════ PRINT MODAL (INSTRUCTOR) ═══════════════════ */
function PrintModal({ schedules, academicYear, semester, onClose }) {
  const ref=useRef();
  const [printing,setPrinting]=useState(false);
  const instructors=[...new Set(schedules.map(s=>s.instructor))].sort();
  const activeDays=DAYS.filter(d=>schedules.some(s=>s.day===d));

  const handlePrint=async()=>{
    setPrinting(true);
    const [itB64,pccB64]=await Promise.all([toBase64(ITLogo),toBase64(PCCLogo)]);
    let html=ref.current.innerHTML;
    html=html.replace(/(<img[^>]*alt="ICT"[^>]*src=")[^"]*(")/,`$1${itB64}$2`);
    html=html.replace(/(<img[^>]*alt="PCC"[^>]*src=")[^"]*(")/,`$1${pccB64}$2`);
    html=html.replace(/(<img[^>]*src=")[^"]*"([^>]*alt="ICT")/,`$1${itB64}"$2`);
    html=html.replace(/(<img[^>]*src=")[^"]*"([^>]*alt="PCC")/,`$1${pccB64}"$2`);
    const win=window.open("","_blank");
    win.document.write(`<!DOCTYPE html><html><head><title>Faculty Class Schedule</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:Arial,sans-serif;font-size:10pt;color:#000;background:#fff;}
.page{padding:14mm 14mm 14mm 18mm;}
table{width:100%;border-collapse:collapse;}
th{background:#0369a1;color:#fff;font-weight:bold;padding:6px 4px;text-align:center;border:1px solid #0284c7;font-size:8pt;}
th.time-th{background:#075985;}
td{border:1px solid #bae6fd;padding:4px;text-align:center;vertical-align:middle;height:36px;}
.td-lab{background:#dbeafe;}.td-lec{background:#f0f9ff;}
.inst-bar{background:#0c4a6e;color:#fff;}
.hrs-bar{background:#075985;color:#bae6fd;font-size:7.5pt;padding:3px 14px;}
.time-td{background:#e0f2fe;color:#075985;font-weight:700;font-size:7.5pt;white-space:nowrap;}
@media print{
  @page{margin:0;size:A4 landscape;}
  body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .page{padding:8mm;}
}
</style></head><body><div class="page">${html}</div></body></html>`);
    win.document.close(); win.focus();
    setTimeout(()=>{win.print();win.close();setPrinting(false);},700);
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}} onClick={onClose}>
      <div style={{background:"#fff",borderRadius:16,padding:28,width:"100%",maxWidth:1000,maxHeight:"93vh",overflowY:"auto",display:"flex",flexDirection:"column",gap:16,boxShadow:"0 24px 64px rgba(0,0,0,0.28)"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,borderBottom:`1px solid ${SKY[100]}`,paddingBottom:14}}>
          <div>
            <div style={{fontSize:17,fontWeight:700,color:"#0f172a"}}>🖨 Print Preview — Faculty</div>
            <div style={{fontSize:12,color:"#64748b",marginTop:2}}>{instructors.length} instructor(s) · {schedules.length} block(s)</div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button style={{padding:"10px 20px",background:printing?"#94a3b8":SKY[600],color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:14,fontWeight:600}} onClick={handlePrint} disabled={printing}>{printing?"⏳ Preparing…":"🖨 Print / Save PDF"}</button>
            <button style={{padding:"10px 18px",background:SKY[50],color:"#334155",border:`1px solid ${SKY[200]}`,borderRadius:8,cursor:"pointer",fontSize:14}} onClick={onClose}>✕ Close</button>
          </div>
        </div>
        <div ref={ref} style={{fontFamily:"Arial,sans-serif",fontSize:10,color:"#000",background:"#fff",border:`1px solid ${SKY[200]}`,borderRadius:8,padding:"22px 26px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:14,paddingBottom:10,marginBottom:8,borderBottom:"3px double #000"}}>
            <img src={ITLogo} alt="ICT" style={{width:56,height:56,objectFit:"contain"}}/>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:15,fontWeight:900,textTransform:"uppercase",color:"#0f172a"}}>Passi City College</div>
              <div style={{fontSize:10.5,fontWeight:700,color:SKY[800],marginTop:3}}>Information and Communication Technology</div>
              <div style={{fontSize:8.5,color:"#555",marginTop:2}}>Passi City, Iloilo, Philippines</div>
            </div>
            <img src={PCCLogo} alt="PCC" style={{width:56,height:56,objectFit:"contain"}}/>
          </div>
          <div style={{textAlign:"center",fontSize:13,fontWeight:"bold",textTransform:"uppercase",letterSpacing:1.5,margin:"10px 0 3px",color:"#0f172a"}}>Faculty Class Schedule</div>
          {academicYear&&<div style={{textAlign:"center",fontSize:9.5,color:SKY[700],fontWeight:600,marginBottom:4}}>Academic Year {academicYear} · {semester}</div>}
          <hr style={{border:"none",borderTop:`2px solid ${SKY[700]}`,margin:"8px 0 14px"}}/>

          {instructors.map(inst=>{
            const cls=schedules.filter(s=>s.instructor===inst);
            const total=cls.reduce((s,c)=>s+(c.end-c.start),0);
            const labH=cls.filter(c=>c.roomType==="Laboratory").reduce((s,c)=>s+(c.end-c.start),0);
            const lecH=cls.filter(c=>c.roomType==="Lecture").reduce((s,c)=>s+(c.end-c.start),0);
            const labN=cls.filter(c=>c.roomType==="Laboratory").length;
            const lecN=cls.filter(c=>c.roomType==="Lecture").length;
            return (
              <div key={inst} style={{marginBottom:22,pageBreakInside:"avoid"}}>
                {/* Name bar */}
                <div className="inst-bar" style={{display:"flex",alignItems:"center",gap:10,background:SKY[900],color:"#fff",padding:"7px 14px",borderRadius:"4px 4px 0 0",marginBottom:0}}>
                  <span style={{fontSize:11,fontWeight:"bold"}}>{inst}</span>
                </div>
                {/* ── Hours summary bar — FIXED ── */}
                <div className="hrs-bar" style={{background:SKY[800],color:SKY[200],fontSize:8,padding:"4px 14px",marginBottom:6,display:"flex",gap:14,flexWrap:"wrap"}}>
                  <span>⏱ Total: <strong style={{color:"#fff"}}>{total} hr{total!==1?"s":""}</strong></span>
                  <span>📖 Lecture: <strong style={{color:"#fff"}}>{lecH} hr{lecH!==1?"s":""}</strong> ({lecN} slot{lecN!==1?"s":""})</span>
                  <span>🔬 Laboratory: <strong style={{color:"#fff"}}>{labH} hr{labH!==1?"s":""}</strong> ({labN} slot{labN!==1?"s":""})</span>
                </div>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:8}}>
                  <thead><tr>
                    <th className="time-th" style={{background:SKY[800],color:"#fff",border:`1px solid ${SKY[600]}`,padding:"6px 4px",width:80,fontSize:8}}>Time</th>
                    {activeDays.map(d=><th key={d} style={{background:SKY[700],color:"#fff",border:`1px solid ${SKY[600]}`,padding:"6px 4px",fontSize:8}}>{d}</th>)}
                  </tr></thead>
                  <tbody>{TIMES.map(t=>(
                    <tr key={t}>
                      <td className="time-td" style={{background:SKY[50],border:`1px solid ${SKY[200]}`,padding:"3px 4px",fontWeight:700,fontSize:7.5,whiteSpace:"nowrap",textAlign:"center",color:SKY[800],height:36}}>{fmtRange(t,t+1)}</td>
                      {activeDays.map(day=>{
                        const m=cls.find(c=>c.day===day&&c.start<=t&&c.end>t);
                        const lb=m?.roomType==="Laboratory";
                        return <td key={day} className={m?(lb?"td-lab":"td-lec"):""} style={{border:`1px solid ${SKY[200]}`,padding:"3px 4px",textAlign:"center",verticalAlign:"middle",height:36,background:m?(lb?SKY[100]:SKY[50]):"#fff"}}>
                          {m&&<>
  <span style={{fontWeight:900,fontSize:10,color:"#0f172a",display:"block"}}>{m.subject}</span>
  {m.section&&<span style={{fontSize:9,color:SKY[700],display:"block",fontWeight:700}}>{m.section}</span>}
  <span style={{fontSize:8,color:"#475569",display:"block",marginTop:1}}>{m.room}</span>
  <span style={{fontSize:7,fontStyle:"italic",display:"block",color:lb?SKY[700]:"#166534"}}>[{m.roomType}]</span>
</>}
                        </td>;
                      })}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            );
          })}

          <div style={{borderTop:`1.5px solid ${SKY[700]}`,paddingTop:14,marginTop:10}}>
            <div style={{fontSize:8.5,fontWeight:"bold",textAlign:"center",textTransform:"uppercase",letterSpacing:.8,marginBottom:20,color:SKY[800]}}>Certification / Approval</div>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              {[{title:"Prepared by",role:"Scheduling Coordinator"},{title:"Noted by",role:"Department Head / Dean"},{title:"Approved by",role:"College Registrar"}].map(({title,role})=>(
                <div key={title} style={{textAlign:"center",width:200}}>
                  <div style={{height:38}}/>
                  <div style={{borderTop:"1.5px solid #000",paddingTop:4}}>
                    <div style={{fontSize:10,fontWeight:"bold",color:"#0f172a"}}>{title}</div>
                    <div style={{fontSize:8,color:"#555",marginTop:2}}>{role}</div>
                    <div style={{fontSize:7.5,color:"#777",marginTop:12}}>Date: _______________</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ PRINT MODAL (STUDENT) ═══════════════════ */
function StudentPrintModal({ schedules, section, academicYear, semester, onClose }) {
  const ref=useRef();
  const [printing,setPrinting]=useState(false);
  const activeDays=DAYS.filter(d=>schedules.some(s=>s.day===d));

  const handlePrint=async()=>{
    setPrinting(true);
    const [itB64,pccB64]=await Promise.all([toBase64(ITLogo),toBase64(PCCLogo)]);
    let html=ref.current.innerHTML;
    html=html.replace(/(<img[^>]*alt="ICT"[^>]*src=")[^"]*(")/,`$1${itB64}$2`);
    html=html.replace(/(<img[^>]*alt="PCC"[^>]*src=")[^"]*(")/,`$1${pccB64}$2`);
    const win=window.open("","_blank");
    win.document.write(`<!DOCTYPE html><html><head><title>Student Schedule - ${section}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:Arial,sans-serif;font-size:10pt;color:#000;}
.page{padding:14mm;}
table{width:100%;border-collapse:collapse;}
th{background:#0369a1;color:#fff;font-weight:bold;padding:6px 4px;text-align:center;border:1px solid #0284c7;font-size:8pt;}
th.time-th{background:#075985;}
td{border:1px solid #bae6fd;padding:4px;text-align:center;vertical-align:middle;height:40px;}
.td-lab{background:#dbeafe;}.td-lec{background:#f0f9ff;}
.sec-bar{background:#4c1d95;color:#fff;}
.hrs-bar{background:#6d28d9;color:#ddd6fe;font-size:7.5pt;padding:3px 14px;}
.time-td{background:#e0f2fe;color:#075985;font-weight:700;font-size:7.5pt;white-space:nowrap;}
@media print{
  @page{margin:0;size:A4 landscape;}
  body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .page{padding:8mm;}
}
</style></head><body><div class="page">${html}</div></body></html>`);
    win.document.close(); win.focus();
    setTimeout(()=>{win.print();win.close();setPrinting(false);},700);
  };

  const total=schedules.reduce((s,c)=>s+(c.end-c.start),0);
  const labH=schedules.filter(c=>c.roomType==="Laboratory").reduce((s,c)=>s+(c.end-c.start),0);
  const lecH=schedules.filter(c=>c.roomType==="Lecture").reduce((s,c)=>s+(c.end-c.start),0);
  const labN=schedules.filter(c=>c.roomType==="Laboratory").length;
  const lecN=schedules.filter(c=>c.roomType==="Lecture").length;

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}} onClick={onClose}>
      <div style={{background:"#fff",borderRadius:16,padding:28,width:"100%",maxWidth:1000,maxHeight:"93vh",overflowY:"auto",display:"flex",flexDirection:"column",gap:16,boxShadow:"0 24px 64px rgba(0,0,0,0.28)"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,borderBottom:`1px solid ${SKY[100]}`,paddingBottom:14}}>
          <div>
            <div style={{fontSize:17,fontWeight:700,color:"#0f172a"}}>🖨 Print Preview — {section}</div>
            <div style={{fontSize:12,color:"#64748b",marginTop:2}}>{schedules.length} block(s)</div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button style={{padding:"10px 20px",background:printing?"#94a3b8":SKY[600],color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:14,fontWeight:600}} onClick={handlePrint} disabled={printing}>{printing?"⏳ Preparing…":"🖨 Print / Save PDF"}</button>
            <button style={{padding:"10px 18px",background:SKY[50],color:"#334155",border:`1px solid ${SKY[200]}`,borderRadius:8,cursor:"pointer",fontSize:14}} onClick={onClose}>✕ Close</button>
          </div>
        </div>
        <div ref={ref} style={{fontFamily:"Arial,sans-serif",fontSize:10,color:"#000",background:"#fff",border:`1px solid ${SKY[200]}`,borderRadius:8,padding:"22px 26px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:14,paddingBottom:10,marginBottom:8,borderBottom:"3px double #000"}}>
            <img src={ITLogo} alt="ICT" style={{width:56,height:56,objectFit:"contain"}}/>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:15,fontWeight:900,textTransform:"uppercase",color:"#0f172a"}}>Passi City College</div>
              <div style={{fontSize:10.5,fontWeight:700,color:SKY[800],marginTop:3}}>Information and Communication Technology</div>
              <div style={{fontSize:8.5,color:"#555",marginTop:2}}>Passi City, Iloilo, Philippines</div>
            </div>
            <img src={PCCLogo} alt="PCC" style={{width:56,height:56,objectFit:"contain"}}/>
          </div>
          <div style={{textAlign:"center",fontSize:13,fontWeight:"bold",textTransform:"uppercase",letterSpacing:1.5,margin:"10px 0 3px",color:"#0f172a"}}>Class Schedule</div>
          <div style={{textAlign:"center",fontSize:11,fontWeight:700,color:"#7c3aed",marginBottom:3}}>{section}</div>
          {academicYear&&<div style={{textAlign:"center",fontSize:9.5,color:SKY[700],fontWeight:600,marginBottom:4}}>Academic Year {academicYear} · {semester}</div>}
          <hr style={{border:"none",borderTop:`2px solid ${SKY[700]}`,margin:"8px 0 6px"}}/>

          {/* ── Hours summary bar — FIXED ── */}
          <div className="hrs-bar" style={{background:"#6d28d9",color:"#ddd6fe",fontSize:8,padding:"4px 14px",marginBottom:10,display:"flex",gap:14,flexWrap:"wrap",borderRadius:4}}>
            <span>⏱ Total: <strong style={{color:"#fff"}}>{total} hr{total!==1?"s":""}</strong></span>
            <span>📖 Lecture: <strong style={{color:"#fff"}}>{lecH} hr{lecH!==1?"s":""}</strong> ({lecN} slot{lecN!==1?"s":""})</span>
            <span>🔬 Laboratory: <strong style={{color:"#fff"}}>{labH} hr{labH!==1?"s":""}</strong> ({labN} slot{labN!==1?"s":""})</span>
          </div>

          <table style={{width:"100%",borderCollapse:"collapse",fontSize:8}}>
            <thead><tr>
              <th style={{background:SKY[800],color:"#fff",border:`1px solid ${SKY[600]}`,padding:"6px 4px",width:80,fontSize:8}}>Time</th>
              {activeDays.map(d=><th key={d} style={{background:SKY[700],color:"#fff",border:`1px solid ${SKY[600]}`,padding:"6px 4px",fontSize:8}}>{d}</th>)}
            </tr></thead>
            <tbody>{TIMES.map(t=>(
              <tr key={t}>
                <td style={{background:SKY[50],border:`1px solid ${SKY[200]}`,padding:"3px 4px",fontWeight:700,fontSize:7.5,whiteSpace:"nowrap",textAlign:"center",color:SKY[800],height:40}}>{fmtRange(t,t+1)}</td>
                {activeDays.map(day=>{
                  const m=schedules.find(c=>c.day===day&&c.start<=t&&c.end>t);
                  const lb=m?.roomType==="Laboratory";
                  return <td key={day} className={m?(lb?"td-lab":"td-lec"):""} style={{border:`1px solid ${SKY[200]}`,padding:"3px 4px",textAlign:"center",verticalAlign:"middle",height:40,background:m?(lb?SKY[100]:SKY[50]):"#fff"}}>
                   {m&&<>
  <span style={{fontWeight:900,fontSize:10,color:"#0f172a",display:"block"}}>{m.subject}</span>
  {m.instructor&&<span style={{fontSize:9,color:"#7c3aed",display:"block",fontWeight:700}}>{m.instructor}</span>}
  <span style={{fontSize:8,color:"#475569",display:"block",marginTop:1}}>{m.room}</span>
  <span style={{fontSize:7,fontStyle:"italic",display:"block",color:lb?SKY[700]:"#166534"}}>[{m.roomType}]</span>
</>}
                  </td>;
                })}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ SIDEBAR ═══════════════════ */
function Sidebar({ activePage, setActivePage }) {
  const menu=[{label:"Dashboard"},{label:"Academic Setup"},{label:"Instructor Load"},{label:"Student Load"},{label:"Generate Schedule"},{label:"Schedule Output"}];
  return (
    <div style={ST.sidebar}>
      <div style={ST.topRow}>
        <img src={ITLogo} style={ST.logo} alt="ICT"/>
        <img src={PCCLogo} style={ST.logo} alt="PCC"/>
        <div style={ST.sysTitle}>SmartSched</div>
      </div>
      <div style={ST.sysSub}>Scheduling System</div>
      {menu.map(({label})=>(
        <div key={label} onClick={()=>setActivePage(label)}
          style={{...ST.menuItem,background:activePage===label?SKY[900]:"transparent",
            color:activePage===label?"#fff":"#cbd5e1",
            borderLeft:activePage===label?`3px solid ${SKY[400]}`:"3px solid transparent",
            display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          {label}
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════ WEEKLY GRIDS — UNCHANGED ═══════════════════ */
function WeeklyGrid({ grid, setGrid }) {
  const upd=(day,t,field,val)=>{
    setGrid(prev=>{
      const ex=prev[day]?.[t]||{subject:"",room:"",roomType:"Lecture",section:""};
      let u={...ex,[field]:val};
      if(field==="subject"&&!val) u={subject:"",room:"",roomType:"Lecture",section:""};
      if(field==="room"&&val) u.roomType=getRoomType(val);
      return{...prev,[day]:{...prev[day],[t]:u}};
    });
  };
  return (
    <div style={{overflowX:"auto"}}>
      <table style={ST.table}>
        <thead><tr>
          <th style={ST.th}>Time</th>
          {DAYS.map(d=><th key={d} style={{...ST.th,minWidth:185}}>{d}</th>)}
        </tr></thead>
        <tbody>{TIMES.map(t=>(
          <tr key={t}>
            <td style={{...ST.td,whiteSpace:"nowrap",fontWeight:600,fontSize:11,color:SKY[700],paddingRight:10,background:SKY[50]}}>{fmtRange(t,t+1)}</td>
            {DAYS.map(day=>{
              const cell=grid[day]?.[t]||{};
              const sub=cell.subject||"",room=cell.room||"",rt=cell.roomType||"Lecture",sec=cell.section||"";
              const lab=rt==="Laboratory";
              return (
                <td key={day} style={{...ST.td,padding:"5px 6px",background:sub?(lab?SKY[100]:SKY[50]):"transparent"}}>
                  <input style={ST.cellInput} value={sub} placeholder="Subject" onChange={e=>upd(day,t,"subject",e.target.value)}/>
                  <input style={{...ST.cellInput,marginBottom:4,fontSize:11,background:sub?"#fff":SKY[50],opacity:sub?1:0.4,color:SKY[700],fontWeight:600}} value={sec} placeholder="Section (e.g. BSIT 3A)" disabled={!sub} onChange={e=>upd(day,t,"section",e.target.value)}/>
                  <select style={{...ST.cellSelect,marginBottom:4,background:sub?"#fff":SKY[50],color:sub?"#0f172a":"#94a3b8",borderColor:SKY[200],opacity:sub?1:0.35,cursor:sub?"pointer":"not-allowed",fontWeight:400}} value={room} disabled={!sub} onChange={e=>upd(day,t,"room",e.target.value)}>
                    <option value="">— Select Room —</option>
                    <optgroup label="Lecture Rooms">{LECTURE_ROOMS.map(r=><option key={r} value={r}>{r}</option>)}</optgroup>
                    <optgroup label="Laboratories">{LAB_ROOMS.map(r=><option key={r} value={r}>{r}</option>)}</optgroup>
                  </select>
                  {sub&&room&&<div style={{fontSize:10,fontWeight:700,color:lab?SKY[800]:"#166534",background:lab?SKY[100]:"#dcfce7",border:`1px solid ${lab?SKY[300]:"#86efac"}`,borderRadius:20,padding:"2px 7px",display:"inline-block",marginTop:2}}>{lab?"🔬":"📖"} {rt}</div>}
                </td>
              );
            })}
          </tr>
        ))}</tbody>
      </table>
      <p style={{fontSize:11,color:"#94a3b8",marginTop:8}}>* Room Type is set automatically — 🔵 Lab A/B/C = Laboratory &nbsp;|&nbsp; 🟢 Room 1–5 = Lecture</p>
    </div>
  );
}

function StudentWeeklyGrid({ grid, setGrid }) {
  const upd=(day,t,field,val)=>{
    setGrid(prev=>{
      const ex=prev[day]?.[t]||{subject:"",room:"",roomType:"Lecture",instructor:""};
      let u={...ex,[field]:val};
      if(field==="subject"&&!val) u={subject:"",room:"",roomType:"Lecture",instructor:""};
      if(field==="room"&&val) u.roomType=getRoomType(val);
      return{...prev,[day]:{...prev[day],[t]:u}};
    });
  };
  return (
    <div style={{overflowX:"auto"}}>
      <table style={ST.table}>
        <thead><tr>
          <th style={ST.th}>Time</th>
          {DAYS.map(d=><th key={d} style={{...ST.th,minWidth:185}}>{d}</th>)}
        </tr></thead>
        <tbody>{TIMES.map(t=>(
          <tr key={t}>
            <td style={{...ST.td,whiteSpace:"nowrap",fontWeight:600,fontSize:11,color:SKY[700],paddingRight:10,background:SKY[50]}}>{fmtRange(t,t+1)}</td>
            {DAYS.map(day=>{
              const cell=grid[day]?.[t]||{};
              const sub=cell.subject||"",room=cell.room||"",rt=cell.roomType||"Lecture",inst=cell.instructor||"";
              const lab=rt==="Laboratory";
              return (
                <td key={day} style={{...ST.td,padding:"5px 6px",background:sub?(lab?SKY[100]:SKY[50]):"transparent"}}>
                  <input style={ST.cellInput} value={sub} placeholder="Subject" onChange={e=>upd(day,t,"subject",e.target.value)}/>
                  <input style={{...ST.cellInput,marginBottom:4,fontSize:11,background:sub?"#fff":SKY[50],opacity:sub?1:0.4,color:"#7c3aed",fontWeight:600}} value={inst} placeholder="Instructor" disabled={!sub} onChange={e=>upd(day,t,"instructor",e.target.value)}/>
                  <select style={{...ST.cellSelect,marginBottom:4,background:sub?"#fff":SKY[50],color:sub?"#0f172a":"#94a3b8",borderColor:SKY[200],opacity:sub?1:0.35,cursor:sub?"pointer":"not-allowed",fontWeight:400}} value={room} disabled={!sub} onChange={e=>upd(day,t,"room",e.target.value)}>
                    <option value="">— Select Room —</option>
                    <optgroup label="Lecture Rooms">{LECTURE_ROOMS.map(r=><option key={r} value={r}>{r}</option>)}</optgroup>
                    <optgroup label="Laboratories">{LAB_ROOMS.map(r=><option key={r} value={r}>{r}</option>)}</optgroup>
                  </select>
                  {sub&&room&&<div style={{fontSize:10,fontWeight:700,color:lab?SKY[800]:"#166534",background:lab?SKY[100]:"#dcfce7",border:`1px solid ${lab?SKY[300]:"#86efac"}`,borderRadius:20,padding:"2px 7px",display:"inline-block",marginTop:2}}>{lab?"🔬":"📖"} {rt}</div>}
                </td>
              );
            })}
          </tr>
        ))}</tbody>
      </table>
      <p style={{fontSize:11,color:"#94a3b8",marginTop:8}}>* Room Type is set automatically — 🔵 Lab A/B/C = Laboratory &nbsp;|&nbsp; 🟢 Room 1–5 = Lecture</p>
    </div>
  );
}

/* ═══════════════════ PAGE CONTENT ═══════════════════ */
function PageContent({ activePage, data, setData }) {
  const [grid,setGrid]=useState({});
  const [studentGrid,setStudentGrid]=useState({});
  const [name,setName]=useState("");
  const [sectionName,setSectionName]=useState("");
  const [ay,setAy]=useState(data.academicYear||"");
  const [sem,setSem]=useState(data.semester||"1st Semester");
  const [editBlock,setEditBlock]=useState(null);
  const [showPrint,setShowPrint]=useState(false);
  const [showStudentPrint,setShowStudentPrint]=useState(null);
  const [outputTab,setOutputTab]=useState("instructor");
  const [toast,setToast]=useState(null);

  // ── Load BOTH instructor AND student schedules from DB on mount ──
  useEffect(()=>{
    fetch("/api/schedules",{credentials:"include"})
      .then(r=>r.ok?r.json():[])
      .then(rows=>setData(p=>({...p,schedules:Array.isArray(rows)?rows:[]})))
      .catch(()=>{});
    fetch("/api/student-schedules",{credentials:"include"})
      .then(r=>r.ok?r.json():[])
      .then(rows=>setData(p=>({...p,studentSchedules:Array.isArray(rows)?rows:[]})))
      .catch(()=>{});
  },[]);

  const saveEdit=(updated)=>{
    setData(p=>({...p,schedules:p.schedules.map(s=>s.id===updated.id?updated:s)}));
    setEditBlock(null);
  };

  /* ── DASHBOARD ── */
  if (activePage==="Dashboard") {
    const insts=[...new Set(data.schedules.map(s=>s.instructor))];
    const sections=[...new Set(data.studentSchedules.map(s=>s.section))];
    return (
      <div style={{display:"flex",flexDirection:"column",gap:16,width:"100%",maxWidth:1000,alignSelf:"flex-start"}}>
        <SchoolHeader academicYear={data.academicYear} semester={data.semester}/>
        <div style={ST.dashGrid}>
          {[
            {n:insts.length,                label:"Total Instructors", color:SKY[600]},
            {n:data.schedules.length,        label:"Schedule Blocks",  color:SKY[500]},
            {n:sections.length,              label:"Student Sections", color:"#7c3aed"},
            {n:data.studentSchedules.length, label:"Student Blocks",   color:SKY[400]},
          ].map(({n,label,color})=>(
            <div key={label} style={ST.statCard}>
              <div style={{...ST.statNum,color}}>{n}</div>
              <div style={ST.statLabel}>{label}</div>
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
        setData({...data,academicYear:s.year,semester:s.semester,academicYearId:s.id});
      } catch {setData({...data,academicYear:ay,semester:sem});}
      alert("Academic setup saved!");
    };
    return (
      <div style={ST.card}>
        <SchoolHeader compact/>
        <h3 style={ST.title}>Academic Setup</h3>
        <label style={ST.label}>Academic Year</label>
        <input placeholder="e.g. 2024–2025" style={ST.input} value={ay} onChange={e=>setAy(e.target.value)}/>
        <label style={ST.label}>Semester</label>
        <select style={ST.input} value={sem} onChange={e=>setSem(e.target.value)}>
          <option>1st Semester</option><option>2nd Semester</option><option>Summer</option>
        </select>
        <button style={ST.btn} onClick={save}>Save</button>
      </div>
    );
  }

  /* ── INSTRUCTOR LOAD ── */
  if (activePage==="Instructor Load") {
    const saveSchedule=async()=>{
      if(!name.trim()) return alert("Please enter an instructor name.");
      const blocks=convertGrid(grid,name);
      if(!blocks.length) return alert("No subjects entered.");
      const noRoom=blocks.find(b=>!b.room.trim());
      if(noRoom) return alert(`Please select a room for "${noRoom.subject}" on ${noRoom.day}.`);
      const combined=[...data.schedules,...data.studentSchedules,...blocks];
      const allConflicts=detectConflicts(combined);
      const newConflicts=allConflicts.filter(c=>blocks.some(b=>
        (b.instructor===c.blockA?.instructor&&b.day===c.blockA?.day&&b.start===c.blockA?.start)||
        (b.instructor===c.blockB?.instructor&&b.day===c.blockB?.day&&b.start===c.blockB?.start)||
        (b.room===c.blockA?.room&&b.day===c.blockA?.day&&b.start===c.blockA?.start)||
        (b.room===c.blockB?.room&&b.day===c.blockB?.day&&b.start===c.blockB?.start)
      ));
      if(newConflicts.length>0){setToast(newConflicts);return;}
      try {
        await fetch("/api/schedules",{method:"POST",credentials:"include",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({schedules:blocks,academicYearId:data.academicYearId||null})});
      } catch {}
      setData({...data,schedules:[...data.schedules,...blocks]});
      setGrid({}); setName("");
      alert(`Schedule for ${name} saved! (${blocks.length} block/s added)`);
    };
    return (
      <div style={{...ST.card,borderTop:`4px solid ${SKY[400]}`}}>
        {toast&&<ConflictToast conflicts={toast} onClose={()=>setToast(null)}/>}
        <div style={{background:`linear-gradient(135deg,${SKY[700]} 0%,${SKY[500]} 100%)`,borderRadius:10,padding:"16px 22px",marginBottom:4,display:"flex",alignItems:"center",gap:14}}>
          <div style={{fontSize:28}}>📋</div>
          <div>
            <div style={{color:"#fff",fontWeight:800,fontSize:16}}>Instructor Load</div>
            <div style={{color:SKY[200],fontSize:12,marginTop:2}}>Enter weekly schedule per instructor</div>
          </div>
        </div>
        <div style={{maxWidth:400}}>
          <label style={ST.label}>Instructor Name</label>
          <input placeholder="e.g. Juan Dela Cruz" style={{...ST.input,marginTop:6,width:"100%",boxSizing:"border-box",border:`1.5px solid ${SKY[300]}`,outline:"none"}} value={name} onChange={e=>setName(e.target.value)}/>
        </div>
        <div style={ST.legendRow}>
          <span style={{...ST.badge,background:"#dcfce7",color:"#166534",border:"1px solid #86efac"}}>📖 Room 1–5 = Lecture</span>
          <span style={{...ST.badge,background:SKY[100],color:SKY[800],border:`1px solid ${SKY[300]}`}}>🔬 Lab A/B/C = Laboratory</span>
          <span style={{...ST.badge,background:SKY[50],color:SKY[700],border:`1px solid ${SKY[200]}`}}>🎓 Section field per slot</span>
        </div>
        <WeeklyGrid grid={grid} setGrid={setGrid}/>
        <button style={{...ST.btn,background:SKY[600],boxShadow:`0 4px 14px ${SKY[300]}`}} onClick={saveSchedule}>💾 Save Weekly Schedule</button>
      </div>
    );
  }

  /* ── STUDENT LOAD ── */
  if (activePage==="Student Load") {
    const saveStudentSchedule=async()=>{
      if(!sectionName.trim()) return alert("Please enter a section name.");
      const blocks=convertStudentGrid(studentGrid,sectionName);
      if(!blocks.length) return alert("No subjects entered.");
      const noRoom=blocks.find(b=>!b.room.trim());
      if(noRoom) return alert(`Please select a room for "${noRoom.subject}" on ${noRoom.day}.`);
      const combined=[...data.schedules,...data.studentSchedules,...blocks];
      const allConflicts=detectConflicts(combined);
      const newConflicts=allConflicts.filter(c=>blocks.some(b=>
        (b.section===c.blockA?.section&&b.day===c.blockA?.day&&b.start===c.blockA?.start)||
        (b.section===c.blockB?.section&&b.day===c.blockB?.day&&b.start===c.blockB?.start)||
        (b.room===c.blockA?.room&&b.day===c.blockA?.day&&b.start===c.blockA?.start)||
        (b.room===c.blockB?.room&&b.day===c.blockB?.day&&b.start===c.blockB?.start)
      ));
      if(newConflicts.length>0){setToast(newConflicts);return;}
      // ── Now saves to DB (was missing in doc 7) ──
      try {
        await fetch("/api/student-schedules",{method:"POST",credentials:"include",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({schedules:blocks,academicYearId:data.academicYearId||null})});
      } catch {}
      setData({...data,studentSchedules:[...data.studentSchedules,...blocks]});
      setStudentGrid({}); setSectionName("");
      alert(`Schedule for ${sectionName} saved! (${blocks.length} block/s added)`);
    };
    return (
      <div style={{...ST.card,borderTop:"4px solid #7c3aed"}}>
        {toast&&<ConflictToast conflicts={toast} onClose={()=>setToast(null)}/>}
        <div style={{background:"linear-gradient(135deg,#4c1d95 0%,#7c3aed 100%)",borderRadius:10,padding:"16px 22px",marginBottom:4,display:"flex",alignItems:"center",gap:14}}>
          <div style={{fontSize:28}}>🎓</div>
          <div>
            <div style={{color:"#fff",fontWeight:800,fontSize:16}}>Student Load</div>
            <div style={{color:"#ddd6fe",fontSize:12,marginTop:2}}>Enter weekly schedule per section</div>
          </div>
        </div>
        <div style={{maxWidth:400}}>
          <label style={ST.label}>Section Name</label>
          <input placeholder="e.g. BSIT 3A" style={{...ST.input,marginTop:6,width:"100%",boxSizing:"border-box",border:"1.5px solid #ddd6fe",outline:"none"}} value={sectionName} onChange={e=>setSectionName(e.target.value)}/>
        </div>
        <div style={ST.legendRow}>
          <span style={{...ST.badge,background:"#dcfce7",color:"#166534",border:"1px solid #86efac"}}>📖 Room 1–5 = Lecture</span>
          <span style={{...ST.badge,background:SKY[100],color:SKY[800],border:`1px solid ${SKY[300]}`}}>🔬 Lab A/B/C = Laboratory</span>
          <span style={{...ST.badge,background:"#f5f3ff",color:"#7c3aed",border:"1px solid #ddd6fe"}}>👤 Instructor field per slot</span>
        </div>
        <StudentWeeklyGrid grid={studentGrid} setGrid={setStudentGrid}/>
        <button style={{...ST.btn,background:"#7c3aed",boxShadow:"0 4px 14px #c4b5fd"}} onClick={saveStudentSchedule}>💾 Save Section Schedule</button>
      </div>
    );
  }

  /* ── GENERATE ── */
  if (activePage==="Generate Schedule") {
    const generate=async(type)=>{
      if(type==="instructor"&&!data.schedules.length) return alert("No instructor schedules to generate.");
      if(type==="student"&&!data.studentSchedules.length) return alert("No student schedules to generate.");
      try {
        const res=await fetch("/api/generate",{method:"POST",credentials:"include",
          headers:{"Content-Type":"application/json"},body:JSON.stringify({type})});
        const result=await res.json();
        if(result.error) return alert("Error: "+result.error);
        // ── FIXED: pass type query param so correct file is downloaded ──
        window.open(`/api/download?type=${type}`,"_blank");
      } catch {alert("Backend not connected.");}
    };
    return (
      <div style={ST.card}>
        <h3 style={ST.title}>Generate Schedule Output</h3>
        <p style={{color:"#64748b",fontSize:13}}>Choose which schedule to generate as a formatted Excel file.</p>
        <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
          <div style={{flex:1,minWidth:220,background:SKY[50],border:`1px solid ${SKY[200]}`,borderRadius:12,padding:"20px 22px",display:"flex",flexDirection:"column",gap:10}}>
            <div style={{fontSize:15,fontWeight:700,color:SKY[800]}}>📋 Instructor Schedule</div>
            <div style={{fontSize:12,color:SKY[700]}}><strong>{data.schedules.length}</strong> block(s) · <strong>{[...new Set(data.schedules.map(s=>s.instructor))].length}</strong> instructor(s)</div>
            <button style={{...ST.btn,background:SKY[600],alignSelf:"stretch",marginTop:4}} onClick={()=>generate("instructor")}>📥 Download Instructor Excel</button>
          </div>
          <div style={{flex:1,minWidth:220,background:"#f5f3ff",border:"1px solid #ddd6fe",borderRadius:12,padding:"20px 22px",display:"flex",flexDirection:"column",gap:10}}>
            <div style={{fontSize:15,fontWeight:700,color:"#7c3aed"}}>🎓 Student Schedule</div>
            <div style={{fontSize:12,color:"#7c3aed"}}><strong>{data.studentSchedules.length}</strong> block(s) · <strong>{[...new Set(data.studentSchedules.map(s=>s.section))].length}</strong> section(s)</div>
            <button style={{...ST.btn,background:"#7c3aed",alignSelf:"stretch",marginTop:4}} onClick={()=>generate("student")}>📥 Download Student Excel</button>
          </div>
        </div>
      </div>
    );
  }

  /* ── SCHEDULE OUTPUT ── */
  if (activePage==="Schedule Output") {
    const instructors=[...new Set(data.schedules.map(s=>s.instructor))];
    const sections=[...new Set(data.studentSchedules.map(s=>s.section))];

    const clearAll=async()=>{
      if(!window.confirm("Clear all instructor schedules?")) return;
      try{await fetch("/api/schedules",{method:"DELETE",credentials:"include"});}catch{}
      setData({...data,schedules:[]});
    };
    const clearStudents=async()=>{
      if(!window.confirm("Clear all student schedules?")) return;
      // ── FIXED: also calls DELETE on backend ──
      try{await fetch("/api/student-schedules",{method:"DELETE",credentials:"include"});}catch{}
      setData({...data,studentSchedules:[]});
    };

    return (
      <div style={{...ST.card,borderTop:`4px solid ${SKY[400]}`}}>
        {showPrint&&<PrintModal schedules={data.schedules} academicYear={data.academicYear} semester={data.semester} onClose={()=>setShowPrint(false)}/>}
        {showStudentPrint&&<StudentPrintModal schedules={data.studentSchedules.filter(s=>s.section===showStudentPrint)} section={showStudentPrint} academicYear={data.academicYear} semester={data.semester} onClose={()=>setShowStudentPrint(null)}/>}
        {editBlock&&<EditModal block={editBlock} onSave={saveEdit} onClose={()=>setEditBlock(null)}/>}
        <SchoolHeader academicYear={data.academicYear} semester={data.semester}/>

        <div style={{display:"flex",gap:0,borderBottom:`2px solid ${SKY[100]}`}}>
          {[{key:"instructor",label:"📋 Instructor Schedules"},{key:"student",label:"🎓 Student Schedules"}].map(({key,label})=>(
            <button key={key} onClick={()=>setOutputTab(key)}
              style={{padding:"10px 22px",border:"none",cursor:"pointer",fontSize:13,fontWeight:600,background:"transparent",
                borderBottom:outputTab===key?`3px solid ${SKY[500]}`:"3px solid transparent",
                color:outputTab===key?SKY[600]:"#64748b",marginBottom:-2}}>
              {label}
            </button>
          ))}
        </div>

        {outputTab==="instructor"&&<>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
            <h3 style={{...ST.title,margin:0}}>Instructor Schedules</h3>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {data.schedules.length>0&&<button style={{...ST.btn,background:SKY[600],padding:"8px 18px"}} onClick={()=>setShowPrint(true)}>🖨 Print Schedule</button>}
              {instructors.length>0&&<button style={{...ST.btn,background:"#ef4444",padding:"8px 16px"}} onClick={clearAll}>🗑 Clear All</button>}
            </div>
          </div>
          {data.schedules.length>0&&(
            <div style={{display:"flex",gap:10,flexWrap:"wrap",padding:"10px 14px",background:SKY[50],borderRadius:8,border:`1px solid ${SKY[200]}`}}>
              <span style={{fontSize:12,color:SKY[700]}}>📊 <strong>{instructors.length}</strong> instructor(s)</span>
              <span style={{color:SKY[300]}}>|</span>
              <span style={{fontSize:12,color:SKY[700]}}><strong>{data.schedules.length}</strong> total blocks</span>
              <span style={{color:SKY[300]}}>|</span>
              <span style={{fontSize:12,color:SKY[700]}}>🔬 <strong>{data.schedules.filter(s=>s.roomType==="Laboratory").length}</strong> Lab</span>
              <span style={{color:SKY[300]}}>|</span>
              <span style={{fontSize:12,color:"#166534"}}>📖 <strong>{data.schedules.filter(s=>s.roomType==="Lecture").length}</strong> Lecture</span>
            </div>
          )}
          {instructors.length===0&&<div style={{textAlign:"center",padding:"32px 0",color:"#94a3b8",fontSize:14}}>No schedules yet. Go to <strong>Instructor Load</strong> to add some.</div>}
          {instructors.map(inst=>{
            const cls=data.schedules.filter(s=>s.instructor===inst);
            return (
              <div key={inst} style={{border:`1px solid ${SKY[100]}`,borderRadius:10,padding:16,background:`linear-gradient(to bottom,${SKY[50]},#fff)`,marginBottom:4}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8,borderBottom:`2px solid ${SKY[300]}`,paddingBottom:10,marginBottom:14}}>
                  <h3 style={{color:"#0f172a",margin:0,fontSize:15,fontWeight:700}}>{inst}</h3>
                  {/* ── HoursSummary replaces the old simple badge row ── */}
                  <HoursSummary schedules={cls}/>
                </div>
                {DAYS.map(day=>{
                  const dc=cls.filter(c=>c.day===day).sort((a,b)=>a.start-b.start);
                  if(!dc.length) return null;
                  return (
                    <div key={day} style={{marginBottom:14}}>
                      <span style={{background:SKY[700],color:"#fff",padding:"3px 12px",borderRadius:20,fontSize:11,fontWeight:600}}>{day}</span>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>
                        {dc.map((c,i)=>{
                          const lab=c.roomType==="Laboratory";
                          return (
                            <div key={i} style={{padding:"12px 16px",minWidth:165,border:`1px solid ${lab?SKY[200]:"#86efac"}`,borderLeft:`5px solid ${lab?SKY[500]:"#16a34a"}`,borderRadius:8,background:lab?SKY[50]:"#f0fdf4",boxShadow:"0 1px 3px rgba(0,0,0,0.05)"}}>
                              <strong style={{fontSize:13,color:"#0f172a",display:"block",marginBottom:5}}>{c.subject}</strong>
                              {c.section&&<span style={{fontSize:11,color:SKY[700],display:"block",fontWeight:700,marginBottom:3}}>🎓 {c.section}</span>}
                              <span style={{fontSize:12,color:"#334155",display:"block"}}>🕐 {fmtRange(c.start,c.end)}</span>
                              {c.room&&<span style={{fontSize:12,color:"#64748b",display:"block",marginTop:2}}>📍 {c.room}</span>}
                              <span style={{fontSize:11,fontWeight:700,color:lab?SKY[700]:"#166534",background:lab?SKY[100]:"#dcfce7",padding:"2px 10px",borderRadius:20,display:"inline-block",marginTop:7,border:`1px solid ${lab?SKY[300]:"#86efac"}`}}>{lab?"🔬":"📖"} {c.roomType||"Lecture"}</span>
                              {c.id&&<div><button onClick={()=>setEditBlock(c)} style={{marginTop:8,padding:"5px 12px",background:SKY[50],color:SKY[700],border:`1px solid ${SKY[200]}`,borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:500}}>✏ Edit</button></div>}
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
        </>}

        {outputTab==="student"&&<>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
            <h3 style={{...ST.title,margin:0}}>Student Section Schedules</h3>
            {sections.length>0&&<button style={{...ST.btn,background:"#ef4444",padding:"8px 16px"}} onClick={clearStudents}>🗑 Clear All</button>}
          </div>
          {sections.length===0&&<div style={{textAlign:"center",padding:"32px 0",color:"#94a3b8",fontSize:14}}>No student schedules yet. Go to <strong>Student Load</strong> to add some.</div>}
          {sections.map(sec=>{
            const cls=data.studentSchedules.filter(s=>s.section===sec);
            return (
              <div key={sec} style={{border:"1px solid #ede9fe",borderRadius:10,padding:16,background:"linear-gradient(to bottom,#f5f3ff,#fff)",marginBottom:4}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8,borderBottom:"2px solid #c4b5fd",paddingBottom:10,marginBottom:14}}>
                  <h3 style={{color:"#0f172a",margin:0,fontSize:15,fontWeight:700}}>🎓 {sec}</h3>
                  <div style={{display:"flex",flexDirection:"column",gap:6,alignItems:"flex-end"}}>
                    {/* ── HoursSummary for students ── */}
                    <HoursSummary schedules={cls}/>
                    <button style={{...ST.btn,background:SKY[600],padding:"5px 14px",fontSize:12}} onClick={()=>setShowStudentPrint(sec)}>🖨 Print</button>
                  </div>
                </div>
                {DAYS.map(day=>{
                  const dc=cls.filter(c=>c.day===day).sort((a,b)=>a.start-b.start);
                  if(!dc.length) return null;
                  return (
                    <div key={day} style={{marginBottom:14}}>
                      <span style={{background:"#6d28d9",color:"#fff",padding:"3px 12px",borderRadius:20,fontSize:11,fontWeight:600}}>{day}</span>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>
                        {dc.map((c,i)=>{
                          const lab=c.roomType==="Laboratory";
                          return (
                            <div key={i} style={{padding:"12px 16px",minWidth:165,border:`1px solid ${lab?SKY[200]:"#86efac"}`,borderLeft:`5px solid ${lab?"#7c3aed":"#16a34a"}`,borderRadius:8,background:lab?SKY[50]:"#f0fdf4",boxShadow:"0 1px 3px rgba(0,0,0,0.05)"}}>
                              <strong style={{fontSize:13,color:"#0f172a",display:"block",marginBottom:5}}>{c.subject}</strong>
                              {c.instructor&&<span style={{fontSize:11,color:"#7c3aed",display:"block",fontWeight:700,marginBottom:3}}>👤 {c.instructor}</span>}
                              <span style={{fontSize:12,color:"#334155",display:"block"}}>🕐 {fmtRange(c.start,c.end)}</span>
                              {c.room&&<span style={{fontSize:12,color:"#64748b",display:"block",marginTop:2}}>📍 {c.room}</span>}
                              <span style={{fontSize:11,fontWeight:700,color:lab?SKY[700]:"#166534",background:lab?SKY[100]:"#dcfce7",padding:"2px 10px",borderRadius:20,display:"inline-block",marginTop:7,border:`1px solid ${lab?SKY[300]:"#86efac"}`}}>{lab?"🔬":"📖"} {c.roomType||"Lecture"}</span>
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
        </>}
      </div>
    );
  }

  /* ── DEFAULT ── */
  const insts=[...new Set(data.schedules.map(s=>s.instructor))];
  return (
    <div style={{display:"flex",flexDirection:"column",gap:16,width:"100%",maxWidth:1000,alignSelf:"flex-start"}}>
      <SchoolHeader academicYear={data.academicYear} semester={data.semester}/>
      <div style={ST.dashGrid}>
        {[{n:insts.length,label:"Total Instructors",color:SKY[600]},{n:data.schedules.length,label:"Schedule Blocks",color:SKY[500]}].map(({n,label,color})=>(
          <div key={label} style={ST.statCard}>
            <div style={{...ST.statNum,color}}>{n}</div>
            <div style={ST.statLabel}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════ MAIN ═══════════════════ */
export default function App() {
  const [activePage,setActivePage]=useState("Dashboard");
  const [data,setData]=useState({academicYear:"",semester:"",schedules:[],studentSchedules:[]});
  return (
    <div style={ST.container}>
      <Sidebar activePage={activePage} setActivePage={setActivePage}/>
      <div style={ST.main}>
        <div style={{...ST.header,borderBottom:`2px solid ${SKY[100]}`}}>
          <span style={{color:"#64748b",fontSize:12,fontWeight:500,marginRight:8}}>Passi City College — ICT</span>
          <span style={{color:SKY[300]}}>›</span>
          <span style={{marginLeft:8,color:SKY[700]}}> {activePage}</span>
        </div>
        <div style={ST.content}>
          <PageContent activePage={activePage} data={data} setData={setData}/>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ STYLES ═══════════════════ */
const ST={
  container:{display:"flex",height:"100vh",fontFamily:"'Segoe UI',sans-serif",background:SKY[50]},
  sidebar:{width:248,minWidth:248,background:"#0c4a6e",color:"#e2e8f0",padding:"20px 16px",display:"flex",flexDirection:"column"},
  topRow:{display:"flex",alignItems:"center",gap:8,marginBottom:6},
  logo:{width:36,height:36,borderRadius:4,objectFit:"contain"},
  sysTitle:{fontSize:17,fontWeight:"bold",color:"#f0f9ff"},
  sysSub:{fontSize:11,color:SKY[400],marginBottom:20,paddingLeft:2},
  menuItem:{padding:"10px 14px",borderRadius:6,cursor:"pointer",marginBottom:3,fontSize:13.5,transition:"all 0.15s"},
  main:{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"},
  header:{background:"#fff",padding:"14px 28px",fontSize:18,fontWeight:700,color:"#0f172a",display:"flex",alignItems:"center"},
  content:{flex:1,padding:28,overflowY:"auto",display:"flex",justifyContent:"center"},
  card:{background:"#fff",padding:28,borderRadius:12,width:"100%",maxWidth:1300,boxShadow:`0 4px 12px rgba(14,165,233,0.08)`,display:"flex",flexDirection:"column",gap:16,alignSelf:"flex-start"},
  title:{fontSize:18,fontWeight:700,margin:0,color:"#0f172a"},
  label:{fontSize:13,fontWeight:600,color:"#374151"},
  input:{padding:"10px 12px",border:`1px solid ${SKY[200]}`,borderRadius:8,fontSize:14,outline:"none"},
  btn:{padding:"11px 20px",background:SKY[600],color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:14,fontWeight:600,alignSelf:"flex-start"},
  legendRow:{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"},
  badge:{padding:"4px 12px",borderRadius:20,fontSize:12,fontWeight:600},
  dashGrid:{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:20,width:"100%",maxWidth:900},
  statCard:{background:"#fff",padding:28,borderRadius:12,boxShadow:`0 2px 8px rgba(14,165,233,0.1)`,textAlign:"center",border:`1px solid ${SKY[100]}`},
  statNum:{fontSize:36,fontWeight:"bold"},
  statLabel:{marginTop:6,color:"#64748b",fontSize:13},
  table:{borderCollapse:"collapse",width:"100%",fontSize:13},
  th:{padding:"9px 10px",background:SKY[700],border:`1px solid ${SKY[600]}`,textAlign:"left",fontWeight:600,color:"#fff",whiteSpace:"nowrap"},
  td:{padding:"4px 6px",border:`1px solid ${SKY[100]}`,verticalAlign:"top"},
  cellInput:{width:"100%",padding:"5px 7px",border:`1px solid ${SKY[200]}`,borderRadius:4,fontSize:12,minWidth:100,marginBottom:4,boxSizing:"border-box"},
  cellSelect:{width:"100%",padding:"4px 6px",border:"1px solid",borderRadius:4,fontSize:11,fontWeight:600,boxSizing:"border-box"},
};