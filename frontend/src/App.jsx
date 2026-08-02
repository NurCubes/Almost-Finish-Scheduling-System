import { useState, useEffect, useRef } from "react";
import SuperAdminPanel        from "./SuperAdminPanel.jsx";
import { useAuth }            from "./ProtectedRoute.jsx";
import { getDeptTheme, DEPT_THEMES } from "./DeptTheme.js";
import { DeptLogo, PCCLogo } from "./LogoMap.jsx";

const DAY_START = 7;
const DAY_END   = 20;
const TIME_STEP = 0.5;
const DAYS  = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const TIMES = Array.from({ length: Math.round((DAY_END - DAY_START) / TIME_STEP) }, (_, i) => +(DAY_START + i * TIME_STEP).toFixed(1));
const LECTURE_ROOMS = ["Room 1","Room 2","Room 3","Room 4","Room 5"];
const LAB_ROOMS     = ["Lab A","Lab B","Lab C"];
const TBA_ROOM      = "TBA";  // NEW
const ALL_ROOMS     = [...LECTURE_ROOMS, ...LAB_ROOMS, TBA_ROOM];  // UPDATED

const LUNCH_START   = 12;
const LUNCH_END     = 13;
const BREAK_TRIGGER = 3;
const BREAK_DUR     = 0.5;
const SEMESTERS = ["1st Semester", "2nd Semester"];
const YEAR_LEVEL_LABELS = {
  1: "First Year",
  2: "Second Year",
  3: "Third Year",
  4: "Fourth Year",
};



// Fixed row height (px) used ONLY by the printed schedule tables. Printed
// tables merge multi-slot classes into one <td> via rowSpan; without a fixed
// height, the browser sizes each row off that cell's content, which desyncs
// the Time column from the grid once a block has enough text to need more
// room than a bare time-slot row would. Locking every row — and every
// rowSpan cell to an exact multiple of this value — keeps the grid perfectly
// rectangular no matter how many/how busy the blocks are.
const PRINT_ROW_H = 84;

function printCellBox(rowSpan = 1, extra = {}) {
  return {
    height: PRINT_ROW_H * rowSpan,
    minHeight: PRINT_ROW_H * rowSpan,
    maxHeight: PRINT_ROW_H * rowSpan,

    overflow: "hidden",
    boxSizing: "border-box",

    verticalAlign: "top",
    display: "table-cell",

    ...extra,
  };
}

const PRINT_TIME_CELL = {
  width: 105,
  minWidth: 105,
  maxWidth: 105,

  height: PRINT_ROW_H,
  minHeight: PRINT_ROW_H,
  maxHeight: PRINT_ROW_H,

  padding: "0 8px",

  whiteSpace: "nowrap",

  overflow: "hidden",

  textAlign: "center",

  verticalAlign: "middle",

  fontSize: 10,

  fontWeight: 700,

  boxSizing: "border-box",
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
function getRoomType(r) { 
  if (r === "TBA") return "Lecture";  // ✅ Changed from "TBA" to "Lecture"
  return LAB_ROOMS.includes(r) ? "Laboratory" : "Lecture"; 
}

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

  // Step 1 — carve out the fixed lunch window, same as before.
  const withLunch = [];
  let lunchDone = false;
  for (const b of sorted) {
    if (b.is_break) { withLunch.push(b); continue; }
    const overlapsLunch = !lunchDone && b.start < LUNCH_END && b.end > LUNCH_START;
    if (overlapsLunch) {
      if (b.start < LUNCH_START) withLunch.push({ ...b, end: LUNCH_START });
      // Mark lunch breaks with is_lunch: true so they don't get shifted
      withLunch.push({ ...b, subject:"BREAK", room:"—", roomType:"Break", section:"", instructor:"", start:LUNCH_START, end:LUNCH_END, is_break:true, is_lunch: true });
      if (b.end > LUNCH_END) withLunch.push({ ...b, start: LUNCH_END });
      lunchDone = true;
    } else {
      if (!lunchDone && b.start >= LUNCH_END) {
        withLunch.push({ ...b, subject:"BREAK", room:"—", roomType:"Break", section:"", instructor:"", start:LUNCH_START, end:LUNCH_END, is_break:true, is_lunch: true });
        lunchDone = true;
      }
      withLunch.push(b);
    }
  }

  // Step 2 — walk the day as ONE continuous timeline. Every 3 cumulative
  // hours of class triggers a 0.5-hour break.
  // KEY FIX: Don't shift lunch breaks - only shift regular class blocks
  const result = [];
  let cursor = null;
  let hoursSincePause = 0;
  let shift = 0;

  for (const raw of withLunch) {
    // FIXED: Only apply shift to non-lunch breaks
    let bStart = +(raw.start + (raw.is_lunch ? 0 : shift)).toFixed(1);
    let bEnd   = +(raw.end   + (raw.is_lunch ? 0 : shift)).toFixed(1);

    if (raw.is_break) {
      result.push({ ...raw, start: bStart, end: bEnd });
      cursor = bEnd;
      hoursSincePause = 0;
      continue;
    }

    if (cursor !== null) {
      if (bStart > cursor) {
        hoursSincePause = 0;
      } else if (bStart < cursor) {
        if (bEnd <= cursor) continue;
        bStart = cursor;
      }
    }

    let segStart = bStart;
    let remaining = +(bEnd - bStart).toFixed(1);
    if (remaining <= 0) { cursor = bEnd; continue; }

    while (remaining > 0) {
      const room  = +(BREAK_TRIGGER - hoursSincePause).toFixed(1);
      const chunk = Math.min(room, remaining);
      if (chunk > 0) {
        const chunkEnd = +(segStart + chunk).toFixed(1);
        result.push({ ...raw, start: segStart, end: chunkEnd });
        hoursSincePause = +(hoursSincePause + chunk).toFixed(1);
        segStart = chunkEnd;
        remaining = +(remaining - chunk).toFixed(1);
      }
      if (hoursSincePause >= BREAK_TRIGGER) {
        const breakEnd = +(segStart + BREAK_DUR).toFixed(1);
        result.push({ ...raw, subject:"BREAK", room:"—", roomType:"Break", section:"", instructor:"", start: segStart, end: breakEnd, is_break:true });
        shift = +(shift + BREAK_DUR).toFixed(1);
        segStart = breakEnd;
        hoursSincePause = 0;
      } else {
        break;
      }
    }
    cursor = segStart;
  }

  return result;
}
// ── NEW: recognizes the same class recorded on both the instructor side
// and student side, even if per-table break insertion made their exact
// start/end drift apart slightly. This must come BEFORE the type checks,
// otherwise dragging a class back near its own linked entry falsely
// flags a self-conflict.
function isSameSession(a, b) {
  if (normName(a.subject) !== normName(b.subject)) return false;
  if (a.day !== b.day) return false;

  const aSec = normName(a.section), bSec = normName(b.section);
  const aIns = normName(a.instructor), bIns = normName(b.instructor);

  // If both sides specify a section, it must match to be "the same class".
  if (aSec && bSec && aSec !== bSec) return false;
  // If both sides specify an instructor, it must match too.
  if (aIns && bIns && aIns !== bIns) return false;
  // Need at least one shared identifying field, or there's nothing linking them.
  if (!((aSec && bSec) || (aIns && bIns))) return false;

  const overlaps  = a.start < b.end && b.start < a.end;
  const tolerance = Math.max(BREAK_DUR, 1); // tolerate one break-width of drift
  const closeTime = Math.abs(a.start - b.start) <= tolerance && Math.abs(a.end - b.end) <= tolerance;

  return overlaps || closeTime;
}

function detectConflicts(schedules) {
  const out = [];
  for (let i = 0; i < schedules.length; i++) {
    for (let j = i + 1; j < schedules.length; j++) {
      const a = schedules[i], b = schedules[j];
      if (a.is_break || b.is_break) continue;
      if (a.day !== b.day) continue;

      // Replaces the old strict `sameMeeting` check — this one tolerates
      // the room/time drift that naturally exists between linked pairs
      // (instructor-side record vs. student-side record of the same class).
      if (isSameSession(a, b)) continue;

      const overlaps = a.start < b.end && b.start < a.end;
      if (!overlaps) continue;

      const s = fmtH(Math.max(a.start, b.start));
      const e = fmtH(Math.min(a.end,   b.end));

      if (a.room && b.room && a.room === b.room && a.room !== "TBA") {
  out.push({ type:"Room Conflict", day:a.day, room:a.room, detail:`"${a.room}" is double-booked on ${a.day} ${s}–${e}: ${a.instructor||a.section||"?"} (${a.subject}) vs ${b.instructor||b.section||"?"} (${b.subject})`, blockA:a, blockB:b });
}
      const aInst = normName(a.instructor), bInst = normName(b.instructor);
      if (aInst && bInst && aInst === bInst) {
        out.push({ type:"Instructor Conflict", day:a.day, room:a.room||"", detail:`${a.instructor} is double-booked on ${a.day} ${s}–${e}: "${a.subject}"${a.section?" ("+a.section+")":""} in ${a.room||"?"} and "${b.subject}"${b.section?" ("+b.section+")":""} in ${b.room||"?"}`, blockA:a, blockB:b });
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


// Add to your existing utilities file
async function getPrefMatchScore(instructorId, semester, day, startTime, endTime) {
  try {
    const res = await fetch("/api/calculate-preference-match", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instructor_id: instructorId, semester, day, time_start: startTime, time_end: endTime }),
    });
    const data = res.ok ? await res.json() : { score: 0 };
    return data.score || 0;
  } catch {
    return 0;
  }
}

// MODIFIED: findSuggestions — rank by preference score
function findSuggestions(conflict, allSchedules, instructorPool = [], preferences = []) {
  const { type, blockA } = conflict;
  if (!blockA) return [];
  const { day, start, end, room } = blockA;
  const dur = end - start;

  // ── Instructor Conflict: suggest vacant instructors ──
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
          prefScore: 0, // Will be calculated client-side if needed
        });
      }
      if (suggestions.length >= 5) break;
    }
    return suggestions;
  }

  // ── Room / Section / default conflicts: suggest vacant rooms, ranked by preference ──
  const suggestions = [];
  
  // Suggest same room, different time (prioritize preferred times)
  for (let t = 7; t + dur <= 20; t++) {
    if (t === start) continue;
    if (t < 13 && t + dur > 12) continue; // Skip lunch
    const blocked = allSchedules.filter(s =>
      !s.is_break && s.day === day && s.room === room &&
      !(s.end <= t || s.start >= t + dur)
    );
    if (!blocked.length) {
      let prefMatch = 0;
      // Check if this time matches instructor's preferences (if applicable)
      if (blockA.instructor && preferences.length > 0) {
        const instPrefs = preferences.filter(p => normName(p.instructor) === normName(blockA.instructor) && p.day === day);
        for (const pref of instPrefs) {
          if (t < pref.time_end && t + dur > pref.time_start) {
            prefMatch = pref.priority === "primary" ? 100 : 60;
            break;
          }
        }
      }
      
      suggestions.push({
        type: "time",
        label: `Same room, ${fmtRange(t, t + dur)}`,
        room,
        day,
        start: t,
        end: t + dur,
        icon: "🕐",
        prefMatch,
      });
    }
  }

  // Suggest different room, same time (prioritize available rooms)
  ALL_ROOMS.forEach(r => {
    if (r === room) return;
    const blocked = allSchedules.filter(s =>
      !s.is_break && s.day === day && s.room === r &&
      !(s.end <= start || s.start >= end)
    );
    if (!blocked.length) {
      suggestions.push({
        type: "room",
        label: `Move to ${r}`,
        room: r,
        day,
        start,
        end,
        icon: LAB_ROOMS.includes(r) ? "🔬" : "📖",
        prefMatch: 0,
      });
    }
  });

  // Suggest different day, same room/time
  DAYS.forEach(d => {
    if (d === day) return;
    const blocked = allSchedules.filter(s =>
      !s.is_break && s.day === d && s.room === room &&
      !(s.end <= start || s.start >= end)
    );
    if (!blocked.length) {
      suggestions.push({
        type: "day",
        label: `${d}, ${room}, ${fmtRange(start, end)}`,
        room,
        day: d,
        start,
        end,
        icon: "📅",
        prefMatch: 0,
      });
    }
  });

  // Sort by prefMatch descending (preferred times first)
  suggestions.sort((a, b) => (b.prefMatch || 0) - (a.prefMatch || 0));

  return suggestions.slice(0, 5);
}


// ── MODIFIED: findSuggestions now branches by conflict type ──
// If Instructor Conflict → suggest vacant instructors
// If Room/Time/Section conflict → suggest vacant rooms (original logic)

function convertGrid(grid, instructor) {
  const out=[];
  DAYS.forEach(day=>{
    let cur=null;
    TIMES.forEach(t=>{
      const cell=grid[day]?.[t]||{};
      const sub=cell.subject||"",room=cell.room||"",rt=cell.roomType||"Lecture",sec=cell.section||"";
      if (!sub) { if(cur){out.push(cur);cur=null;} }
      else if (!cur) { cur={instructor,subject:sub,day,start:t,end:t+TIME_STEP,room,roomType:rt,section:sec}; }
      else if (cur.subject===sub&&cur.room===room&&cur.roomType===rt&&cur.section===sec) { cur.end=t+TIME_STEP; }
      else { out.push(cur); cur={instructor,subject:sub,day,start:t,end:t+TIME_STEP,room,roomType:rt,section:sec}; }
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
      else if (!cur) { cur={section:sectionName,subject:sub,day,start:t,end:t+TIME_STEP,room,roomType:rt,instructor:inst}; }
      else if (cur.subject===sub&&cur.room===room&&cur.roomType===rt&&normName(cur.instructor)===normName(inst)) { cur.end=t+TIME_STEP; }
      else { out.push(cur); cur={section:sectionName,subject:sub,day,start:t,end:t+TIME_STEP,room,roomType:rt,instructor:inst}; }
    });
    if(cur) out.push(cur);
  });
  return out;
}

const DURATIONS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]; // hours, in TIME_STEP increments

function getRunLength(grid, day, t, matchFields) {
  // Counts how many consecutive slots from `t` share the same subject/room/roomType/section(/instructor)
  let count = 0;
  let cur = t;
  while (cur < DAY_END) {
    const cell = grid[day]?.[cur];
    if (!cell || cell.subject !== matchFields.subject) break;
    const sameRoom    = cell.room === matchFields.room;
    const sameRT      = cell.roomType === matchFields.roomType;
    const sameSec     = (cell.section || "") === (matchFields.section || "");
    const sameInst    = matchFields.instructor === undefined || normName(cell.instructor||"") === normName(matchFields.instructor||"");
    if (!sameRoom || !sameRT || !sameSec || !sameInst) break;
    count++;
    cur = +(cur + TIME_STEP).toFixed(1);
  }
  return count;
}

function isRunStart(grid, day, t, subject) {
  const prevT = +(t - TIME_STEP).toFixed(1);
  const prevCell = grid[day]?.[prevT];
  return !prevCell || prevCell.subject !== subject;
}

// Writes `duration` hours worth of identical slots starting at `t`.
// Refuses to overwrite a *different* subject already occupying part of the range.
function applyBlockDuration(setGrid, day, t, duration, values) {
  const steps = Math.round(duration / TIME_STEP);
  let conflict = null;
  setGrid(prev => {
    const dayGrid = prev[day] || {};
    // pre-check for collisions with a different subject
    for (let i = 0; i < steps; i++) {
      const ti = +(t + i * TIME_STEP).toFixed(1);
      if (ti >= DAY_END) { conflict = "Duration extends past the end of the day."; return prev; }
      const existing = dayGrid[ti];
      if (existing?.subject && existing.subject !== values.subject) {
        conflict = `"${existing.subject}" already occupies ${fmtH(ti)}. Clear it first or pick a shorter duration.`;
        return prev;
      }
    }
    const nextDay = { ...dayGrid };
    for (let i = 0; i < steps; i++) {
      const ti = +(t + i * TIME_STEP).toFixed(1);
      nextDay[ti] = { ...values };
    }
    return { ...prev, [day]: nextDay };
  });
  return conflict; // null on success, string message on failure
}

// Clears any slots from t+newDuration up to the end of the previous run
// (used when the user shrinks a duration on an already-placed block).
function trimRun(setGrid, day, t, oldSteps, newSteps) {
  if (newSteps >= oldSteps) return;
  setGrid(prev => {
    const dayGrid = { ...(prev[day] || {}) };
    for (let i = newSteps; i < oldSteps; i++) {
      const ti = +(t + i * TIME_STEP).toFixed(1);
      delete dayGrid[ti];
    }
    return { ...prev, [day]: dayGrid };
  });
}

// Moves a pending (not-yet-saved) grid entry from its current day/time to a
// suggested day/time/room — used when a user clicks a ConflictToast
// suggestion while still on the Instructor Load / Student Load entry screen,
// before the block has been saved to the database (and so has no id yet,
// meaning the DB-patching handleLinkedMove path used by drag-and-drop can't
// be used). This gives the "click to apply" button in these two toasts the
// same immediate, visible effect that dragging a block already has.
function moveGridBlock(setGridFn, block, suggestion, extraFields = {}) {
  const duration = +(block.end - block.start).toFixed(1);
  const newDay   = suggestion.day || block.day;
  const newStart = suggestion.start !== undefined ? Number(suggestion.start) : block.start;
  const newEnd   = suggestion.end   !== undefined ? Number(suggestion.end)   : +(newStart + duration).toFixed(1);
  const newRoom  = suggestion.room || block.room;

  setGridFn(prev => {
    const next = { ...prev };

    const oldDayGrid = { ...(next[block.day] || {}) };
    for (let t = block.start; t < block.end; t = +(t + TIME_STEP).toFixed(1)) {
      delete oldDayGrid[t];
    }
    next[block.day] = oldDayGrid;

    const newDayGrid = { ...(next[newDay] || {}) };
    for (let t = newStart; t < newEnd; t = +(t + TIME_STEP).toFixed(1)) {
      newDayGrid[t] = {
        subject: block.subject,
        room: newRoom,
        roomType: getRoomType(newRoom),
        ...extraFields,
      };
    }
    next[newDay] = newDayGrid;
    return next;
  });
}




function buildPrintTimeSlots(schedules) {
  const pts = new Set();
  for (let h = DAY_START; h < DAY_END; h++) pts.add(h);
  schedules.forEach(b => { pts.add(Number(b.start)); pts.add(Number(b.end)); });
  return [...pts].filter(t => t >= DAY_START && t < DAY_END).sort((a,b)=>a-b);
}

// Determines how a merged-cell grid should render a given day/time row.
// kind "start"   → first row of a block; caller renders one <td rowSpan=...>
// kind "covered" → row falls inside a block that already started; caller renders NOTHING
// kind "empty"   → no block; caller renders the normal empty/drop-target cell
function getCellSpanInfo(cls, day, t, slots) {
  const covering = cls.find(c => c.day === day && Number(c.start) <= t && Number(c.end) > t);
  if (!covering) return { kind: "empty" };
  if (Number(covering.start) === t) {
    const startIdx = slots.indexOf(t);
    let endIdx = slots.findIndex(s => s >= Number(covering.end));
    if (endIdx === -1) endIdx = slots.length;
    const span = Math.max(1, endIdx - startIdx);
    return { kind: "start", block: covering, span };
  }
  return { kind: "covered" };
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

// ── SUBJECT COLOR SYSTEM ──
// Every subject gets a stable color derived from a hash of its name, so it's
// consistent everywhere (grid, print, room view) without any manual setup.
// Major subjects get a dominant/saturated fill; GE subjects get a lighter
// pastel version of the SAME hue. Lab vs Lecture is folded into the same
// color family — lab = deeper fill, lecture = lighter tint.
// A palette of 32 hues spaced by the golden angle (137.508°) around the
// color wheel. This spreads hues far more evenly than a straight hue % 360,
// so even subjects whose names hash to nearby numbers still land on
// visually distinct colors instead of two shades of the same color.
// ── SUBJECT COLOR SYSTEM v2 ──
// A small, curated set of muted hues instead of the full color wheel at
// high saturation. Subjects still get a stable, distinct color, but the
// palette reads as one coherent document instead of a rainbow — solid
// badges instead of gradients, near-white cell tints, and low saturation
// throughout so it holds up in print as well as on screen.
const PROFESSIONAL_HUES = [210, 173, 262, 15, 38, 340, 152, 282, 25, 199, 318, 48, 235, 95];

function hashHue(name) {
  let hash = 0;
  const s = (name || "").trim().toLowerCase();
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  const idx = Math.abs(hash) % PROFESSIONAL_HUES.length;
  return PROFESSIONAL_HUES[idx];
}

function getSubjectColor(subjectName, type, roomType) {
  const hue   = hashHue(subjectName || "Unknown");
  const isGE  = type === "GE";
  const isLab = roomType === "Laboratory";

  // Badge — solid muted fill, dark enough for white text. GE sits a touch
  // lighter/less saturated so it visually reads as the secondary category.
  const badgeSat   = isGE ? 30 : 40;
  const badgeLight = isLab ? 28 : 34;
  const badgeBg = `hsl(${hue}, ${badgeSat}%, ${badgeLight}%)`;

  // Cell background — near-white tint, just enough separation without
  // fighting the block's text.
  const cellSat     = 28;
  const cellLight   = 95;
  const cellBg      = `hsl(${hue}, ${cellSat}%, ${cellLight}%)`;
  const cellBorder  = `hsl(${hue}, ${cellSat + 12}%, 74%)`;
  const accentColor = `hsl(${hue}, ${badgeSat + 10}%, 30%)`;

  return { hue, badgeBg, cellBg, cellBorder, accentColor };
}

// Small color-key strip shown above a schedule output so viewers can match
// subject → color at a glance.
function SubjectColorLegend({ blocks, codeMap }) {
  const real = (blocks || []).filter(b => !b.is_break && b.subject);
  const seen = new Map();
  real.forEach(b => {
    const { code, name, type } = resolveSubjectDisplay(b, codeMap);
    const key = normName(b.subject);
    if (!seen.has(key)) seen.set(key, { code, name, type, roomType: b.roomType });
  });
  const entries = [...seen.values()].sort((a, b) => (a.code || a.name).localeCompare(b.code || b.name));
  if (!entries.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "12px 16px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginRight: 2 }}>🎨 Subject Colors:</span>
      {entries.map((e, i) => {
        const c = getSubjectColor(e.name, e.type, e.roomType);
        return (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px 3px 4px", borderRadius: 20, background: "#fff", border: `1px solid ${c.cellBorder}` }}>
            <span style={{ width: 15, height: 15, borderRadius: "50%", background: c.badgeBg, display: "inline-block", flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: "#334155" }}>{e.code || e.name}</span>
            <span style={{ fontSize: 9, fontWeight: 700, color: e.type === "GE" ? "#4d7c0f" : "#64748b" }}>{e.type === "GE" ? "GE" : "Major"}</span>
          </span>
        );
      })}
    </div>
  );
}

// ── EDIT NAMES/TITLES HERE — shown at the bottom of every printed schedule ──
// ── DEPARTMENT-SPECIFIC SIGNATORIES — Edit per department ──
const DEPT_SIGNATORIES = {
  "BSIT": {
    notedBy:    { name: "MYLEN B. PADERES", title: "Dean SOICT" },
    approvedBy: { name: "HEIDI A. PAMA",    title: "Academic Coordinator" },
  },
  "BSCS": {
    notedBy:    { name: "Dr. JOHN DOE",      title: "Dean of CICS" },
    approvedBy: { name: "MS. JANE SMITH",    title: "Academic Coordinator" },
  },
  "BSA": {
    notedBy:    { name: "DR. MARIA GARCIA",  title: "Dean of CAS" },
    approvedBy: { name: "MR. LUIS SANTOS",   title: "Academic Coordinator" },
  },
  "BSN": {
    notedBy:    { name: "DR. ROSA CRUZ",     title: "Dean of CHS" },
    approvedBy: { name: "MS. ANNA FLORES",   title: "Academic Coordinator" },
  },
  "BSED": {
    notedBy:    { name: "DR. ROBERT DAVIS",  title: "Dean of CED" },
    approvedBy: { name: "MR. CARLOS REYES",  title: "Academic Coordinator" },
  },
  "BEED": {
    notedBy:    { name: "DR. PATRICIA YOUNG", title: "Dean of CECEP" },
    approvedBy: { name: "MS. SOPHIE MARTIN", title: "Academic Coordinator" },
  },
  "BSCpE": {
    notedBy:    { name: "DR. MICHAEL WONG",   title: "Dean of CET" },
    approvedBy: { name: "MR. JAMES TAYLOR",  title: "Academic Coordinator" },
  },
  "BSME": {
    notedBy:    { name: "DR. ANTONIO LOPEZ",  title: "Dean of CEAT" },
    approvedBy: { name: "MR. MIGUEL TORRES",  title: "Academic Coordinator" },
  },
};

// Helper to get signatories for a department
function getSignatories(deptCode) {
  return DEPT_SIGNATORIES[deptCode] || DEPT_SIGNATORIES["BSIT"];
}

function SignatureBlock({ theme }) {
  const sigs = getSignatories(theme?.code || "BSIT");
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 34, paddingTop: 4 }}>
      <div style={{ textAlign: "center", width: "45%" }}>
        <div style={{ fontSize: 10.5, color: "#475569", marginBottom: 26 }}>Noted by:</div>
        <div style={{ borderTop: "1px solid #000", paddingTop: 5, fontSize: 25, fontWeight: 800, textTransform: "uppercase" }}>
          {sigs.notedBy.name}
        </div>
        <div style={{ fontSize: 20, color: "#475569" }}>{sigs.notedBy.title}</div>
      </div>
      <div style={{ textAlign: "center", width: "45%" }}>
        <div style={{ fontSize: 10.5, color: "#475569", marginBottom: 26 }}>Approved by:</div>
        <div style={{ borderTop: "1px solid #000", paddingTop: 5, fontSize: 25, fontWeight: 800, textTransform: "uppercase" }}>
          {sigs.approvedBy.name}
        </div>
        <div style={{ fontSize: 20, color: "#475569" }}>{sigs.approvedBy.title}</div>
      </div>
    </div>
  );
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

 // NEW
const conflictsWithSuggestions = conflicts.map(c => ({
    ...c,
    suggestions: c.suggestions || (c.blockA ? findSuggestions(c, allSchedules, instructorPool) : []),
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
/* ════════ SCHOOL HEADER ════════ */
function SchoolHeader({ academicYear, semester, compact=false, theme }) {
  return (
    <div style={{display:"flex",justifyContent:"center",padding:compact?"12px 0 10px":"16px 0 14px",borderBottom:`2px solid ${theme.border}`,marginBottom:compact?12:16}}>
      <div style={{display:"flex",alignItems:"center",gap:compact?12:16,maxWidth:520}}>
        <DeptLogo code={theme.code} style={{ width: 68, height: 68, objectFit: "contain", flexShrink: 0 }} alt={theme.code}/>
        <div style={{textAlign:"center"}}>
          <div style={{ fontSize: 23, fontWeight: 900, textTransform: "uppercase" }}>Passi City College</div>
<div style={{ fontSize: 15, fontWeight: 700, color: theme.primary, marginTop: 3 }}>{theme.shortName}</div>
<div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>Barangay Bacuranan, Passi City, Iloilo</div>
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
       <img src={PCCLogo} style={{ width: 68, height: 68, objectFit: "contain", flexShrink: 0 }} alt="PCC"/>
      </div>
    </div>
  );
}

function EditModal({ block, onSave, onClose, theme, allSchedules = [], instructorPool = [] }) {
  const [day,setDay]=useState(block.day);
  const [startH,setStartH]=useState(block.start);
  const [endH,setEndH]=useState(block.end);
  const [room,setRoom]=useState(block.room);
  const [saving,setSaving]=useState(false);
  const [err,setErr]=useState("");
  const [showConflicts, setShowConflicts] = useState(false);
  const [conflicts, setConflicts] = useState([]);
  
  const dur=block.end-block.start;
  const inpStyle={padding:"9px 12px",border:`1px solid ${theme.border}`,borderRadius:8,fontSize:14,outline:"none",width:"100%",background:"#fff",color:"#0f172a"};
  
  const checkConflicts = () => {
    const target = { day, start: startH, end: endH, room: room || block.room, roomType: getRoomType(room || block.room) };
    const moved = { ...block, day, start: startH, end: endH, room: room || block.room, roomType: getRoomType(room || block.room) };
    
    const others = allSchedules.filter(s => !s.is_break && s.id !== block.id);
    const combined = [...others, moved];
    const found = detectConflicts(combined);
    
    const relevant = found.filter(c => 
      (c.blockA?.id === block.id || c.blockB?.id === block.id) ||
      (c.blockA?.day === day && c.blockA?.start === startH) ||
      (c.blockB?.day === day && c.blockB?.start === startH)
    );
    
    return relevant;
  };

  const save=async()=>{
    if(startH>=endH) return setErr("Start time must be before end time.");
    if(!room) return setErr("Please select a room.");
    
    const foundConflicts = checkConflicts();
    if(foundConflicts.length > 0) {
      setConflicts(foundConflicts);
      setShowConflicts(true);
      return;
    }
    
    setSaving(true); 
    setErr("");
    try {
      await onSave({ day, start:startH, end:endH, room });
    } catch {setErr("Failed to save.");}
    setSaving(false);
  };
  
  return (
    // ✅ FIX: Increased z-index to 99999, added explicit width/height for viewport coverage
    <div style={{
      position:"fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: "100%",
      height: "100%",
      background:"rgba(15,23,42,0.6)",
      display:"flex",
      alignItems:"center",
      justifyContent:"center",
      zIndex: 99999
    }} onClick={onClose}>
      {/* ✅ FIX: Changed boxSizing to border-box */}
      <div style={{
        background:"#fff",
        borderRadius:16,
        padding:28,
        width:"100%",
        maxWidth:520,
        display:"flex",
        flexDirection:"column",
        gap:14,
        boxSizing: "border-box",
        boxShadow:"0 24px 64px rgba(0,0,0,0.25)"
      }} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${theme.light2}`,paddingBottom:12}}>
          <div><div style={{fontSize:16,fontWeight:700}}>✏ Edit Schedule Block</div><div style={{fontSize:12,color:"#64748b",marginTop:2}}>Adjust day, time, or room</div></div>
          <button onClick={onClose} style={{background:theme.light,border:"none",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:16,color:theme.primary}}>✕</button>
        </div>
        
        {showConflicts && conflicts.length > 0 && (
          <div style={{background:"#fee2e2",border:"1px solid #fca5a5",borderRadius:8,padding:"12px 14px"}}>
            <div style={{fontSize:13,fontWeight:700,color:"#dc2626",marginBottom:8}}>⚠ {conflicts.length} Conflict{conflicts.length!==1?"s":""} Found</div>
            {conflicts.map((c, i) => (
              <div key={i} style={{fontSize:12,color:"#991b1b",marginBottom:6,paddingLeft:8,borderLeft:`3px solid #dc2626`}}>
                <strong>{c.type}:</strong> {c.detail}
              </div>
            ))}
            <button 
              onClick={() => setShowConflicts(false)} 
              style={{marginTop:8,padding:"6px 12px",background:"#ffffff",border:"1px solid #fca5a5",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:600,color:"#dc2626"}}
            >
              ← Back to Editing
            </button>
          </div>
        )}
        
        {err&&<div style={{background:"#fee2e2",color:"#dc2626",border:"1px solid #fca5a5",borderRadius:8,padding:"10px 14px",fontSize:13}}>⚠ {err}</div>}
        
        {!showConflicts && (
          <>
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
                <option value="TBA" style={{fontWeight:700,color:"#d97706"}}>📌 TBA (To Be Arranged)</option>
                <optgroup label="Lecture Rooms">{LECTURE_ROOMS.map(r=><option key={r} value={r}>{r}</option>)}</optgroup>
                <optgroup label="Laboratories">{LAB_ROOMS.map(r=><option key={r} value={r}>{r}</option>)}</optgroup>
              </select>
            </div>
            <div style={{display:"flex",gap:10,paddingTop:4,borderTop:"1px solid #f1f5f9"}}>
              <button style={{flex:1,padding:"11px",background:theme.primary,color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:14,fontWeight:600}} onClick={save} disabled={saving}>{saving?"Saving…":"✓ Save Changes"}</button>
              <button style={{padding:"11px 20px",background:theme.light,color:theme.text,border:`1px solid ${theme.border}`,borderRadius:8,cursor:"pointer",fontSize:14}} onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}


/* ════════ WEEKLY GRID — INSTRUCTOR LOAD ════════
   NOW WITH PREFERENCE SUPPORT
   ════════════════════════════════════════════════ */
/* ════════ WEEKLY GRID — INSTRUCTOR LOAD ════════
   NOW WITH PREFERENCE SUPPORT + SUBJECT/SECTION DROPDOWNS
   (subjects limited to what this instructor is assigned to teach,
    sections pulled from Section Pool)
   ════════════════════════════════════════════════ */
function WeeklyGrid({ grid, setGrid, theme, preferences = [], occupancy = [], selectedInstructor, activeSemester, sectionPoolList = [] }) {
  const [assignedSubjects, setAssignedSubjects] = useState([]);

  // Load this instructor's assigned subjects for the active semester
  useEffect(() => {
    if (!selectedInstructor) { setAssignedSubjects([]); return; }
    fetch(`/api/instructor-assignments?semester=${encodeURIComponent(activeSemester || "")}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(list => {
        if (!Array.isArray(list)) { setAssignedSubjects([]); return; }
        setAssignedSubjects(list.filter(a => normName(a.instructor_name) === normName(selectedInstructor)));
      })
      .catch(() => setAssignedSubjects([]));
  }, [selectedInstructor, activeSemester]);

  const geSubjects    = assignedSubjects.filter(s => s.subject_type === "GE");
  const majorSubjects = assignedSubjects.filter(s => s.subject_type !== "GE");

  const upd = (day, t, field, val) => {
    setGrid(prev => {
      const ex = prev[day]?.[t] || { subject: "", room: "", roomType: "Lecture", section: "" };
      let u = { ...ex, [field]: val };
      if (field === "subject" && !val) u = { subject: "", room: "", roomType: "Lecture", section: "" };
      if (field === "room" && val) u.roomType = getRoomType(val);
      return { ...prev, [day]: { ...prev[day], [t]: u } };
    });
  };

  // Get preference color for a time slot
  const getPreferenceColor = (day, t) => {
    if (!preferences || preferences.length === 0) return "transparent";

    const timeEnd = +(t + TIME_STEP).toFixed(1);
    for (const pref of preferences) {
      if (pref.day === day && t < pref.time_end && timeEnd > pref.time_start) {
        return pref.priority === "primary" ? "#ecfdf5" : "#fffbeb";
      }
    }
    return "#f8fafc";
  };

  const thStyle = {
    padding: "9px 10px",
    background: theme.primary,
    border: `1px solid ${theme.primary3}`,
    textAlign: "left",
    fontWeight: 600,
    color: "#fff",
    whiteSpace: "nowrap",
    minWidth: 185,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Preference Summary Banner */}
      {preferences && preferences.length > 0 && (
        <div style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 12,
          padding: "12px 16px",
          background: theme.light2,
          borderRadius: 8,
          border: `1px solid ${theme.border}`,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: theme.text }}>
            ⏰ Your Preference Windows:
          </div>

          {preferences
            .filter(p => p.priority === "primary")
            .map(p => {
              const occ = occupancy.find(o => o.prefId === p.id);
              return (
                <span
                  key={`${p.day}-${p.id}-primary`}
                  style={{
                    padding: "3px 12px",
                    borderRadius: 20,
                    fontSize: 11,
                    fontWeight: 600,
                    background: occ?.percentage >= 80 ? "#fee2e2" : occ?.percentage >= 50 ? "#fef9c3" : "#dcfce7",
                    color: occ?.percentage >= 80 ? "#dc2626" : occ?.percentage >= 50 ? "#854d0e" : "#166534",
                    border:
                      occ?.percentage >= 80
                        ? "1px solid #fca5a5"
                        : occ?.percentage >= 50
                        ? "1px solid #fde68a"
                        : "1px solid #86efac",
                    whiteSpace: "nowrap",
                  }}
                >
                  🎯 {p.day} {fmtH(p.time_start)}–{fmtH(p.time_end)}: {occ?.percentage || 0}% ({occ?.occupiedCount || 0}/{occ?.totalSlots || 0})
                </span>
              );
            })}

          {preferences
            .filter(p => p.priority === "secondary")
            .map(p => {
              const occ = occupancy.find(o => o.prefId === p.id);
              return (
                <span
                  key={`${p.day}-${p.id}-secondary`}
                  style={{
                    padding: "3px 12px",
                    borderRadius: 20,
                    fontSize: 11,
                    fontWeight: 600,
                    background: "#f1f5f9",
                    color: "#64748b",
                    border: "1px solid #cbd5e1",
                    whiteSpace: "nowrap",
                  }}
                >
                  📋 {p.day} {fmtH(p.time_start)}–{fmtH(p.time_end)}: {occ?.percentage || 0}%
                </span>
              );
            })}
        </div>
      )}

      {/* Legend */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 11, fontWeight: 600, padding: "8px 12px", background: theme.light2, borderRadius: 6, border: `1px solid ${theme.border}` }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ display: "inline-block", width: 20, height: 12, background: "#1b8f59", border: "1px solid #86efac" }}></span>
          🎯 Primary Preference
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ display: "inline-block", width: 20, height: 12, background: "#c2a11e", border: "1px solid #fde68a" }}></span>
          📋 Secondary Preference
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ display: "inline-block", width: 20, height: 12, background: "#f8fafc", border: "1px solid #cbd5e1" }}></span>
          ⚪ Outside Preferences
        </span>
      </div>

      {/* Grid Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, minWidth: "auto" }}>Time</th>
              {DAYS.map(d => (
                <th key={d} style={thStyle}>
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TIMES.map(t => (
              <tr key={t}>
                <td
                  style={{
                    padding: "4px 6px",
                    border: `1px solid ${theme.light2}`,
                    whiteSpace: "nowrap",
                    fontWeight: 600,
                    fontSize: 11,
                    color: theme.primary,
                    paddingRight: 10,
                    background: theme.light,
                  }}
                >
                  {fmtRange(t, t + TIME_STEP)}
                </td>

                {DAYS.map(day => {
                  const cell = grid[day]?.[t] || {};
                  const sub = cell.subject || "";
                  const room = cell.room || "";
                  const rt = cell.roomType || "Lecture";
                  const sec = cell.section || "";
                  const lab = rt === "Laboratory";
                  const prefColor = getPreferenceColor(day, t);

                  return (
                    <td
                      key={day}
                      style={{
                        padding: "5px 6px",
                        border: `1px solid ${theme.light2}`,
                        verticalAlign: "top",
                        background: sub ? (lab ? theme.light2 : theme.light) : prefColor,
                        transition: "background-color 0.15s",
                      }}
                    >
                      {/* SUBJECT DROPDOWN — limited to this instructor's assigned subjects */}
                      {assignedSubjects.length > 0 ? (
                        <select
                          style={{
                            width: "100%",
                            padding: "5px 7px",
                            border: `1px solid ${theme.border}`,
                            borderRadius: 4,
                            fontSize: 12,
                            marginBottom: 4,
                            boxSizing: "border-box",
                            color: sub ? "#0f172a" : "#94a3b8",
                            background: "#fff",
                          }}
                          value={sub}
                          onChange={e => upd(day, t, "subject", e.target.value)}
                        >
                          <option value="">— Subject —</option>
                          {geSubjects.length > 0 && (
                            <optgroup label="🌐 GE Subjects">
                              {geSubjects.map(s => (
                                <option key={s.id} value={s.subject_name}>
                                  {s.subject_name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {majorSubjects.length > 0 && (
                            <optgroup label="🎯 Major Subjects">
                              {majorSubjects.map(s => (
                                <option key={s.id} value={s.subject_name}>
                                  {s.subject_name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      ) : (
                        <div
                          style={{
                            fontSize: 11,
                            color: "#ef4444",
                            padding: "4px 6px",
                            marginBottom: 4,
                            background: "#fff0f0",
                            borderRadius: 4,
                            border: "1px solid #fca5a5",
                          }}
                        >
                          ⚠ No subjects assigned
                        </div>
                      )}

                      {/* SECTION DROPDOWN — pulled from Section Pool */}
                      <select
                        style={{
                          width: "100%",
                          padding: "5px 7px",
                          border: `1px solid ${theme.border}`,
                          borderRadius: 4,
                          fontSize: 11,
                          marginBottom: 4,
                          boxSizing: "border-box",
                          background: sub ? "#fff" : theme.light,
                          opacity: sub ? 1 : 0.4,
                          color: theme.primary,
                          fontWeight: 600,
                        }}
                        value={sec}
                        disabled={!sub}
                        onChange={e => upd(day, t, "section", e.target.value)}
                      >
                        <option value="">— Section —</option>
                        {[1, 2, 3, 4].map(y => {
                          const list = sectionPoolList.filter(s => s.year_level === y);
                          if (!list.length) return null;
                          return (
                            <optgroup key={y} label={YEAR_LEVEL_LABELS[y]}>
                              {list.map(s => (
                                <option key={s.id} value={s.section_name}>
                                  {s.section_name}
                                </option>
                              ))}
                            </optgroup>
                          );
                        })}
                      </select>

                      {/* ROOM DROPDOWN — now includes TBA */}
                      <select
                        style={{
                          width: "100%",
                          padding: "4px 6px",
                          border: `1px solid ${theme.border}`,
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600,
                          boxSizing: "border-box",
                          background: sub ? "#fff" : theme.light,
                          color: sub ? "#0f172a" : "#94a3b8",
                          opacity: sub ? 1 : 0.35,
                          cursor: sub ? "pointer" : "not-allowed",
                        }}
                        value={room}
                        disabled={!sub}
                        onChange={e => upd(day, t, "room", e.target.value)}
                      >
                        <option value="">— Select Room —</option>
                        <option value="TBA" style={{ fontWeight: 700, color: "#d97706" }}>
                          📌 TBA (To Be Arranged)
                        </option>
                        <optgroup label="Lecture Rooms">
                          {LECTURE_ROOMS.map(r => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Laboratories">
                          {LAB_ROOMS.map(r => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </optgroup>
                      </select>

                      {sub && room && (
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: lab ? theme.text : "#166534",
                            background: lab ? theme.light2 : "#dcfce7",
                            border: `1px solid ${lab ? theme.border : "#86efac"}`,
                            borderRadius: 20,
                            padding: "2px 7px",
                            display: "inline-block",
                            marginTop: 2,
                          }}
                        >
                          {lab ? "🔬" : "📖"} {rt}
                        </div>
                      )}

                      {sub &&
                        room &&
                        isRunStart(grid, day, t, sub) &&
                        (() => {
                          const runLen = getRunLength(grid, day, t, {
                            subject: sub,
                            room,
                            roomType: rt,
                            section: sec,
                          });
                          const curDuration = +(runLen * TIME_STEP).toFixed(1);
                          return (
                            <select
                              style={{
                                width: "100%",
                                marginTop: 4,
                                padding: "3px 6px",
                                border: `1px solid ${theme.border}`,
                                borderRadius: 4,
                                fontSize: 10,
                                fontWeight: 600,
                                color: theme.primary,
                                background: "#160861",
                                boxSizing: "border-box",
                              }}
                              value={curDuration}
                              onChange={e => {
                                const newDuration = Number(e.target.value);
                                const oldSteps = runLen;
                                const newSteps = Math.round(newDuration / TIME_STEP);
                                if (newSteps < oldSteps) {
                                  trimRun(setGrid, day, t, oldSteps, newSteps);
                                } else if (newSteps > oldSteps) {
                                  const err = applyBlockDuration(
                                    setGrid,
                                    day,
                                    t,
                                    newDuration,
                                    { subject: sub, room, roomType: rt, section: sec }
                                  );
                                  if (err) alert(err);
                                }
                              }}
                            >
                              {DURATIONS.map(d => (
                                <option key={d} value={d}>
                                  {d}h
                                </option>
                              ))}
                            </select>
                          );
                        })()}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   STUDENT WEEKLY GRID
   ════════════════════════════════════════════════════════════ */
function StudentWeeklyGrid({ grid, setGrid, theme, activeSemester, selectedSection }) {
  const [instructorList, setInstructorList] = useState([]);
  const [assignedSubjects, setAssignedSubjects] = useState({});
  const [preferences, setPreferences] = useState([]);
  const [loadingPrefs, setLoadingPrefs] = useState(false);

  useEffect(() => {
    if (!theme?.code) return;
    fetch(`/api/instructor-pool?dept=${theme.code}&semester=${encodeURIComponent(activeSemester || "")}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(list => {
        if (!Array.isArray(list)) { setInstructorList([]); return; }
        setInstructorList(list.filter(i => i.name));
      })
      .catch(() => setInstructorList([]));

    fetch(`/api/instructor-assignments?semester=${encodeURIComponent(activeSemester || "")}`, { credentials: "include" })
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

  // Load preferences for all instructors in this section
  useEffect(() => {
    if (!selectedSection || !activeSemester) {
      setPreferences([]);
      return;
    }

    setLoadingPrefs(true);
    Promise.all(
      instructorList.map(inst =>
        fetch(`/api/instructor-preferences?instructor_id=${inst.id}&semester=${encodeURIComponent(activeSemester)}`, { credentials: "include" })
          .then(r => r.ok ? r.json() : [])
          .catch(() => [])
      )
    ).then(results => {
      const allPrefs = results.flat();
      setPreferences(Array.isArray(allPrefs) ? allPrefs : []);
    }).finally(() => setLoadingPrefs(false));
  }, [selectedSection, activeSemester, instructorList.length]);

  const upd = (day, t, field, val) => {
    setGrid(prev => {
      const ex = prev[day]?.[t] || { subject: "", room: "", roomType: "Lecture", instructor: "" };
      let u = { ...ex, [field]: val };
      if (field === "subject" && !val) u = { ...u, subject: "", room: "", roomType: "Lecture" };
      if (field === "room" && val) u.roomType = getRoomType(val);
      if (field === "instructor") { u.subject = ""; }
      return { ...prev, [day]: { ...prev[day], [t]: u } };
    });
  };

  const assignedInstructorList = instructorList.filter(
    i => (assignedSubjects[normName(i.name)] || []).length > 0
  );

  const InstructorSelect = ({ value, onChange, style }) => (
    <select style={style} value={value} onChange={onChange}>
      <option value="">— Instructor —</option>
      {assignedInstructorList.map(i => (
        <option key={i.id} value={i.name}>{i.name}</option>
      ))}
    </select>
  );

  const thStyle = {
    padding: "9px 10px",
    background: theme.primary,
    border: `1px solid ${theme.primary3}`,
    textAlign: "left",
    fontWeight: 600,
    color: "#fff",
    whiteSpace: "nowrap",
    minWidth: 200,
  };

  const inpStyle = {
    padding: "4px 6px",
    border: `1px solid ${theme.border}`,
    borderRadius: 4,
    fontSize: 11,
    boxSizing: "border-box",
    marginBottom: 4,
  };

  // Get preference color for a time slot based on selected instructor
  const getPreferenceColor = (day, t, instructor) => {
    if (!instructor || preferences.length === 0) return "transparent";
    
    const timeEnd = +(t + TIME_STEP).toFixed(1);
    const instPrefs = preferences.filter(p => 
      p.instructor_id === instructorList.find(i => i.name === instructor)?.id
    );
    
    for (const pref of instPrefs) {
      if (pref.day === day && t < pref.time_end && timeEnd > pref.time_start) {
        return pref.priority === "primary" ? "#ecfdf5" : "#fffbeb";
      }
    }
    
    return "transparent";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Legend */}
      <div style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        fontSize: 11,
        fontWeight: 600,
        padding: "8px 12px",
        background: theme.light2,
        borderRadius: 6,
        border: `1px solid ${theme.border}`,
      }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ display: "inline-block", width: 20, height: 12, background: "#dcfce7", border: "1px solid #86efac" }}></span>
          Lecture Room
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ display: "inline-block", width: 20, height: 12, background: theme.light2, border: `1px solid ${theme.border}` }}></span>
          Laboratory
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ display: "inline-block", width: 20, height: 12, background: "#fef9c3", border: "1px solid #fde68a" }}></span>
          TBA Room
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ display: "inline-block", width: 20, height: 12, background: "#ecfdf5", border: "1px solid #86efac" }}></span>
          Primary Pref
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ display: "inline-block", width: 20, height: 12, background: "#fffbeb", border: "1px solid #fde68a" }}></span>
          Secondary Pref
        </span>
      </div>

      {/* Main Grid Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, minWidth: "auto" }}>Time</th>
              {DAYS.map(d => <th key={d} style={thStyle}>{d}</th>)}
            </tr>
          </thead>
          <tbody>
            {TIMES.map(t => (
              <tr key={t}>
                <td style={{
                  padding: "4px 6px",
                  border: `1px solid ${theme.light2}`,
                  whiteSpace: "nowrap",
                  fontWeight: 600,
                  fontSize: 11,
                  color: theme.primary,
                  background: theme.light,
                }}>
                  {fmtRange(t, t + TIME_STEP)}
                </td>
                {DAYS.map(day => {
                  const cell = grid[day]?.[t] || {};
                  const sub = cell.subject || "";
                  const room = cell.room || "";
                  const rt = cell.roomType || "Lecture";
                  const inst = cell.instructor || "";
                  const lab = rt === "Laboratory";
                  const instKey = normName(inst);
                  const subsList = assignedSubjects[instKey] || [];
                  const geSubjects = subsList.filter(s => s.subject_type === "GE");
                  const majorSubjects = subsList.filter(s => s.subject_type === "Major");
                  const prefColor = getPreferenceColor(day, t, inst);

                  return (
                    <td
                      key={day}
                      style={{
                        padding: "5px 6px",
                        border: `1px solid ${theme.light2}`,
                        verticalAlign: "top",
                        background: sub ? (lab ? theme.light2 : theme.light) : prefColor || "transparent",
                      }}
                    >
                      {assignedInstructorList.length > 0 ? (
                        <InstructorSelect
                          value={inst}
                          onChange={e => upd(day, t, "instructor", e.target.value)}
                          style={{
                            width: "100%",
                            padding: "4px 6px",
                            border: `1px solid ${theme.border}`,
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 600,
                            boxSizing: "border-box",
                            marginBottom: 4,
                            color: inst ? theme.primary : "#94a3b8",
                            background: "#fff",
                          }}
                        />
                      ) : (
                        <input
                          style={{ ...inpStyle, width: "100%", color: theme.primary, fontWeight: 600 }}
                          value={inst}
                          placeholder="Instructor"
                          onChange={e => upd(day, t, "instructor", e.target.value)}
                        />
                      )}

                      {inst && subsList.length > 0 ? (
                        <select
                          style={{
                            width: "100%",
                            padding: "4px 6px",
                            border: `1px solid ${theme.border}`,
                            borderRadius: 4,
                            fontSize: 11,
                            boxSizing: "border-box",
                            marginBottom: 4,
                            color: sub ? "#0f172a" : "#94a3b8",
                            background: "#fff",
                          }}
                          value={sub}
                          onChange={e => upd(day, t, "subject", e.target.value)}
                        >
                          <option value="">— Subject —</option>
                          {geSubjects.length > 0 && (
                            <optgroup label="🌐 GE Subjects">
                              {geSubjects.map(s => (
                                <option key={s.subject_name} value={s.subject_name}>
                                  {s.subject_name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {majorSubjects.length > 0 && (
                            <optgroup label="🎯 Major Subjects">
                              {majorSubjects.map(s => (
                                <option key={s.subject_name} value={s.subject_name}>
                                  {s.subject_name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      ) : inst && subsList.length === 0 ? (
                        <div
                          style={{
                            fontSize: 11,
                            color: "#ef4444",
                            padding: "4px 6px",
                            marginBottom: 4,
                            background: "#fff0f0",
                            borderRadius: 4,
                            border: "1px solid #fca5a5",
                          }}
                        >
                          ⚠ No subjects assigned
                        </div>
                      ) : (
                        <input
                          style={{
                            ...inpStyle,
                            width: "100%",
                            opacity: inst ? 1 : 0.4,
                          }}
                          value={sub}
                          placeholder={inst ? "Subject" : "Select instructor first"}
                          disabled={!inst}
                          onChange={e => upd(day, t, "subject", e.target.value)}
                        />
                      )}

                      <select
                        style={{
                          width: "100%",
                          padding: "5px 7px",
                          border: `1px solid ${theme.border}`,
                          borderRadius: 6,
                          fontSize: 11,
                        }}
                        value={room}
                        disabled={!sub}
                        onChange={e => upd(day, t, "room", e.target.value)}
                      >
                        <option value="">— Select Room —</option>
                        <option value="TBA" style={{ fontWeight: 700, color: "#d97706" }}>
                          📌 TBA (To Be Arranged)
                        </option>
                        <optgroup label="Lecture Rooms">
                          {LECTURE_ROOMS.map(r => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Laboratories">
                          {LAB_ROOMS.map(r => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </optgroup>
                      </select>

                      {sub && room && (
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: lab ? theme.text : "#166534",
                            background: lab ? theme.light2 : "#dcfce7",
                            border: `1px solid ${lab ? theme.border : "#86efac"}`,
                            borderRadius: 20,
                            padding: "2px 7px",
                            display: "inline-block",
                            marginTop: 2,
                          }}
                        >
                          {lab ? "🔬" : "📖"} {rt}
                        </div>
                      )}

                      {sub && room && isRunStart(grid, day, t, sub) && (() => {
                        const matchFields = { subject: sub, room, roomType: rt, section: "", instructor: inst };
                        const runLen = getRunLength(grid, day, t, matchFields);
                        const curDuration = +(runLen * TIME_STEP).toFixed(1);
                        return (
                          <select
                            style={{
                              width: "100%",
                              marginTop: 4,
                              padding: "3px 6px",
                              border: `1px solid ${theme.border}`,
                              borderRadius: 4,
                              fontSize: 10,
                              fontWeight: 600,
                              color: theme.primary,
                              background: "#fff",
                              boxSizing: "border-box",
                            }}
                            value={curDuration}
                            onChange={e => {
                              const newDuration = Number(e.target.value);
                              const oldSteps = runLen;
                              const newSteps = Math.round(newDuration / TIME_STEP);
                              if (newSteps < oldSteps) {
                                trimRun(setGrid, day, t, oldSteps, newSteps);
                              } else if (newSteps > oldSteps) {
                                const err = applyBlockDuration(setGrid, day, t, newDuration, {
                                  subject: sub,
                                  room,
                                  roomType: rt,
                                  instructor: inst,
                                });
                                if (err) alert(err);
                              }
                            }}
                          >
                            {DURATIONS.map(d => (
                              <option key={d} value={d}>
                                {d}h
                              </option>
                            ))}
                          </select>
                        );
                      })()}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
          <div style={{display:"flex",justifyContent:"center",paddingBottom:10,marginBottom:8,borderBottom:"3px double #000"}}>
            <div style={{display:"flex",alignItems:"center",gap:14,maxWidth:480}}>
              <DeptLogo code={theme.code} style={{width:56,height:56,objectFit:"contain",flexShrink:0}} alt={theme.code}/>
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:15,fontWeight:900,textTransform:"uppercase"}}>Passi City College</div>
                <div style={{fontSize:10.5,fontWeight:700,color:theme.primary,marginTop:3}}>{theme.shortName}</div>
                <div style={{fontSize:8.5,color:"#555",marginTop:2}}>Barangay Bacuranan, Passi City, Iloilo</div>
              </div>
              <img src={PCCLogo} style={{width:56,height:56,objectFit:"contain",flexShrink:0}} alt="PCC"/>
            </div>
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
win.document.write(`<!DOCTYPE html><html><head><title>Student Schedule - ${section}</title><style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;font-size:10pt;color:#000;}.page{width:297mm;padding:14mm;margin:0 auto;}table{width:100%;border-collapse:collapse;table-layout:fixed;}th:first-child,td:first-child{width:80px;}th{background:${theme.primary};color:#fff;font-weight:bold;padding:6px 4px;text-align:center;border:1px solid ${theme.primary3};font-size:8pt;}td{border:1px solid #ddd;padding:4px;text-align:center;vertical-align:middle;height:40px;}tr{page-break-inside:avoid;}thead{display:table-header-group;}@media print{@page{margin:10mm;size:A4 landscape;}body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}</style></head><body><div class="page">${ref.current.innerHTML}</div></body></html>`);
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
          <div style={{display:"flex",justifyContent:"center",paddingBottom:10,marginBottom:8,borderBottom:"3px double #000"}}>
            <div style={{display:"flex",alignItems:"center",gap:14,maxWidth:480}}>
              <DeptLogo code={theme.code} style={{width:56,height:56,objectFit:"contain",flexShrink:0}} alt={theme.code}/>
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:15,fontWeight:900,textTransform:"uppercase"}}>Passi City College</div>
                <div style={{fontSize:10.5,fontWeight:700,color:theme.primary,marginTop:3}}>{theme.shortName}</div>
                <div style={{fontSize:8.5,color:"#555",marginTop:2}}>Barangay Bacuranan, Passi City, Iloilo</div>
              </div>
              <img src={PCCLogo} style={{width:56,height:56,objectFit:"contain",flexShrink:0}} alt="PCC"/>
            </div>
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

  // Insert breaks per day (was missing — only lunch was ever carved out here)
  const cls = DAYS.flatMap(day => {
    const dayBlocks = blocks
      .filter(b => b.day === day && !b.is_break)
      .map(b => ({ ...b, start: Number(b.start), end: Number(b.end) }));
    return dayBlocks.length ? insertBreaks(dayBlocks) : [];
  });
  const timeSlots = buildPrintTimeSlots(cls);

  const handlePrint = () => {
    setPrinting(true);
   const win = window.open("", "_blank");
   win.document.write(`<!DOCTYPE html><html><head><title>Room Schedule - ${room}</title><style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;font-size:10pt;color:#000;}.page{width:297mm;padding:14mm;margin:0 auto;}table{width:100%;border-collapse:collapse;table-layout:fixed;}th:first-child,td:first-child{width:80px;}th{background:${theme.primary};color:#fff;font-weight:bold;padding:6px 4px;text-align:center;border:1px solid ${theme.primary3};font-size:8pt;}td{border:1px solid #ddd;padding:4px;text-align:center;vertical-align:middle;height:40px;}tr{page-break-inside:avoid;}thead{display:table-header-group;}@media print{@page{margin:10mm;size:A4 landscape;}body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}</style></head><body><div class="page">${ref.current.innerHTML}</div></body></html>`);
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
          <div style={{display:"flex",justifyContent:"center",paddingBottom:10,marginBottom:8,borderBottom:"3px double #000"}}>
            <div style={{display:"flex",alignItems:"center",gap:14,maxWidth:480}}>
              <DeptLogo code={theme.code} style={{width:56,height:56,objectFit:"contain",flexShrink:0}} alt={theme.code}/>
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:15,fontWeight:900,textTransform:"uppercase"}}>Passi City College</div>
                <div style={{fontSize:10.5,fontWeight:700,color:theme.primary,marginTop:3}}>{theme.shortName}</div>
                <div style={{fontSize:8.5,color:"#555",marginTop:2}}>Barangay Bacuranan, Passi City, Iloilo</div>
              </div>
              <img src={PCCLogo} style={{width:56,height:56,objectFit:"contain",flexShrink:0}} alt="PCC"/>
            </div>
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
                      const m   = cls.find(c=>c.day===day&&Number(c.start)<=t&&Number(c.end)>t&&!c.is_break);
                      const brk = cls.find(c=>c.day===day&&c.is_break&&Number(c.start)<=t&&Number(c.end)>t);
                      const lb  = isLab;
                      if (brk) return <td key={day} style={{border:"1px solid #ddd",textAlign:"center",height:40,background:"#fef9c3"}}><span style={{fontSize:8,color:"#854d0e",fontWeight:700}}>☕ Break</span></td>;
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
          <select
  value={selectedRoom}
  onChange={e => setSelectedRoom(e.target.value)}
  style={{
    padding: "6px",
    borderRadius: 6,
    border: `1px solid ${theme.border}`,
    background: theme.card,
    color: theme.text,
  }}
>
  <option value="All" style={{ color: "#000" }}>
    All Rooms
  </option>

  <option
    value="TBA"
    style={{ color: "#d97706", fontWeight: "bold" }}
  >
    📌 TBA (To Be Arranged)
  </option>

  <optgroup label="── Lecture Rooms ──">
    {LECTURE_ROOMS.map(r => (
      <option key={r} value={r} style={{ color: "#000" }}>
        {r}
      </option>
    ))}
  </optgroup>

  <optgroup label="── Laboratories ──">
    {LAB_ROOMS.map(r => (
      <option key={r} value={r} style={{ color: "#000" }}>
        {r}
      </option>
    ))}
  </optgroup>
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
  const [form,           setForm]           = useState({ subject_name:"", subject_code:"", subject_type:"Major", year_level:1, units:3 });
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
    setForm({ subject_name:"", subject_code:"", subject_type:"Major", year_level:1, units:3 });
    setEditId(null); setErr("");
  }

  function startEdit(s) {
    setEditId(s.id);
    setForm({ subject_name:s.subject_name, subject_code:s.subject_code||"", subject_type:s.subject_type, year_level:s.year_level, units:s.units });
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

  const SubjectRow = ({ s, i }) => {
    const icon = getSubjectIcon(s.subject_name);
    const isGE = s.subject_type === "GE";
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

  const TwoColTable = ({ yearLevel, geList, majorList }) => {
    const showGE = hasGE(yearLevel, activeSemester);
    const tableHeader = (borderColor, bg, textColor) => (
      <thead><tr style={{background:bg}}>
        <th style={{padding:"9px 14px",textAlign:"left",borderBottom:`1px solid ${borderColor}`,fontWeight:600,color:textColor}}>Code + Description</th>
        <th style={{padding:"9px 12px",textAlign:"center",borderBottom:`1px solid ${borderColor}`,fontWeight:600,color:textColor,width:70}}>Units</th>
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
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,alignItems:"end"}}>
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
        </div>
        {(form.subject_code || form.subject_name) && (
          <div style={{marginTop:12,padding:"12px 16px",background:theme.light2,border:`1.5px solid ${theme.border}`,borderRadius:8,display:"flex",alignItems:"center",gap:14}}>
            <div style={{fontSize:11,fontWeight:700,color:theme.text,whiteSpace:"nowrap"}}>Preview in schedule:</div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              {form.subject_code && <span style={{display:"inline-block",background:form.subject_type==="GE"?"linear-gradient(135deg,#65a30d,#84cc16)":`linear-gradient(135deg,${theme.primary},${theme.primary3||theme.primary})`,color:"#fff",borderRadius:6,padding:"4px 13px",fontSize:14,fontWeight:900,letterSpacing:1.2,textTransform:"uppercase",boxShadow:"0 2px 8px rgba(0,0,0,0.18)"}}>{form.subject_code}</span>}
              {form.subject_name && <span style={{fontSize:11,color:"#475569"}}>{form.subject_name}</span>}
            </div>
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
  const [form,           setForm]          = useState({ name:"", department:theme.code, email:"", employment_type:"Regular", max_load:0 });
  const [err,            setErr]           = useState("");
  const [saving,         setSaving]        = useState(false);
  const [deleteConfirm,  setDeleteConfirm] = useState(null);

  const EMP_TYPES = ["Regular", "Part-time", "Contractual"];

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

  const EMP_TYPE_COLORS = {
    "Regular": { bg:"#dcfce7", color:"#166534", border:"#86efac", icon:"🏛", label:"Regular" },
    "Part-time": { bg:"#fef9c3", color:"#854d0e", border:"#fde68a", icon:"⏱", label:"Part-time" },
    "Contractual": { bg:"#e0e7ff", color:"#3730a3", border:"#c7d2fe", icon:"📋", label:"Contractual" },
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
    const empType = inst.employment_type === "Permanent" ? "Regular" : (inst.employment_type || "Regular");
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

  function getCurrentLoad(instName) {
    return allSchedules
      .filter(s => !s.is_break && normName(s.instructor) === normName(instName))
      .reduce((sum, s) => sum + (Number(s.end) - Number(s.start)), 0);
  }

  const inpStyle     = { padding:"9px 12px", border:`1.5px solid ${theme.border}`, borderRadius:8, fontSize:14, outline:"none", background:"#fff", color:"#0f172a", width:"100%", boxSizing:"border-box" };
  const btnPrimary   = { padding:"10px 22px", background:theme.primary, color:"#fff", border:"none", borderRadius:8, cursor:"pointer", fontSize:14, fontWeight:600 };
  const btnSecondary = { padding:"10px 18px", background:theme.light, color:theme.text, border:`1px solid ${theme.border}`, borderRadius:8, cursor:"pointer", fontSize:14 };

  function displayEmpType(raw) { 
    if (!raw || raw === "Permanent") return "Regular"; 
    return raw; 
  }

  function getEmpTypeBadgeStyle(raw) {
    const empType = displayEmpType(raw);
    return EMP_TYPE_COLORS[empType] || EMP_TYPE_COLORS["Regular"];
  }

  const regular  = instructors.filter(i => displayEmpType(i.employment_type) === "Regular");
  const parttime = instructors.filter(i => displayEmpType(i.employment_type) === "Part-time");
  const contractual = instructors.filter(i => displayEmpType(i.employment_type) === "Contractual");

  const DeptBadge = ({ deptCode }) => {
    if (!deptCode) return null;
    const style = getDeptBadgeStyle(deptCode);
    return <span style={{padding:"2px 9px",borderRadius:20,fontSize:10,fontWeight:800,background:style.bg,color:style.color,border:`1px solid ${style.border}`,letterSpacing:.3,whiteSpace:"nowrap"}}>🏛 {deptCode}</span>;
  };

  const InstructorTable = ({ list, emptyMsg }) => (
    list.length === 0 ? <div style={{padding:"14px 18px",textAlign:"center",color:"#94a3b8",fontSize:13}}>{emptyMsg}</div> : (
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr style={{background:theme.light}}>
          <th style={{padding:"9px 16px",textAlign:"left",borderBottom:`1px solid ${theme.light2}`,fontWeight:600,color:theme.text}}>Name</th>
          <th style={{padding:"9px 12px",textAlign:"center",borderBottom:`1px solid ${theme.light2}`,fontWeight:600,color:theme.text,width:110}}>Department</th>
          <th style={{padding:"9px 12px",textAlign:"center",borderBottom:`1px solid ${theme.light2}`,fontWeight:600,color:theme.text,width:130}}>Employment</th>
          <th style={{padding:"9px 12px",textAlign:"left",borderBottom:`1px solid ${theme.light2}`,fontWeight:600,color:theme.text}}>Email</th>
          <th style={{padding:"9px 12px",textAlign:"left",borderBottom:`1px solid ${theme.light2}`,fontWeight:600,color:theme.text,width:190}}>Hour Load</th>
          <th style={{padding:"9px 12px",textAlign:"center",borderBottom:`1px solid ${theme.light2}`,fontWeight:600,color:theme.text,width:110}}>Actions</th>
        </tr></thead>
        <tbody>{list.map((inst,i)=>{
          const empLabel = displayEmpType(inst.employment_type);
          const empStyle = getEmpTypeBadgeStyle(inst.employment_type);
          const maxLoad = inst.max_load || 0;
          const currentLoad = getCurrentLoad(inst.name);
          const remaining = maxLoad > 0 ? Math.max(0, maxLoad - currentLoad) : null;
          const pct = maxLoad > 0 ? Math.min(100, Math.round((currentLoad / maxLoad) * 100)) : 0;
          const overLimit = maxLoad > 0 && currentLoad >= maxLoad;
          return (
            <tr key={inst.id} style={{background:editId===inst.id?theme.light2:(i%2===0?"#fff":"#f8fafc")}}>
              <td style={{padding:"10px 16px",borderBottom:`1px solid ${theme.light2}`}}><div style={{fontWeight:600,color:"#0f172a",marginBottom:3}}>{inst.name}</div><DeptBadge deptCode={inst.department}/></td>
              <td style={{padding:"10px 12px",borderBottom:`1px solid ${theme.light2}`,textAlign:"center"}}><DeptBadge deptCode={inst.department}/></td>
              <td style={{padding:"10px 12px",borderBottom:`1px solid ${theme.light2}`,textAlign:"center"}}>
                <span style={{padding:"3px 12px",borderRadius:20,fontSize:11,fontWeight:700,background:empStyle.bg,color:empStyle.color,border:`1px solid ${empStyle.border}`}}>
                  {empStyle.icon} {empStyle.label}
                </span>
              </td>
              <td style={{padding:"10px 12px",borderBottom:`1px solid ${theme.light2}`,color:"#64748b",fontSize:12}}>{inst.email||"—"}</td>
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
            <span style={{padding:"4px 14px",borderRadius:20,fontSize:12,fontWeight:600,background:"#e0e7ff",color:"#3730a3",border:"1px solid #c7d2fe"}}>📋 Contractual: {contractual.length}</span>
            <span style={{padding:"4px 14px",borderRadius:20,fontSize:12,fontWeight:600,background:theme.light2,color:theme.text,border:`1px solid ${theme.border}`}}>Total: {instructors.length}</span>
          </div>
          {[["🏛 Regular Instructors",regular,"No regular instructors yet."],["⏱ Part-time Instructors",parttime,"No part-time instructors yet."],["📋 Contractual Instructors",contractual,"No contractual instructors yet."]].map(([label,list,emptyMsg])=>{
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
    
    // ✅ MODIFIED: Allow the same subject to be assigned to multiple instructors
    // Check only if THIS SPECIFIC INSTRUCTOR already has THIS SUBJECT
    if (assignments.some(a => String(a.instructor_id) === String(form.instructor_id) && String(a.subject_id) === String(form.subject_id))) {
      setErr(`This instructor is already assigned to this subject.`);
      return;
    }
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

  // ✅ MODIFIED: Get ALL instructors teaching a subject (not just the first one)
  function getAllOwnersOf(subjectId) {
    return assignments
      .filter(a => String(a.subject_id) === String(subjectId))
      .map(a => a.instructor_name)
      .filter((name, index, arr) => arr.indexOf(name) === index); // Remove duplicates
  }

  // ✅ NEW: Get instructor count for a subject
  function getInstructorCountForSubject(subjectId) {
    return getAllOwnersOf(subjectId).length;
  }

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
        <div><div style={{color:"#fff",fontWeight:800,fontSize:16}}>Instructor Assignment</div><div style={{color:"rgba(255,255,255,0.65)",fontSize:12,marginTop:2}}>{theme.code} · <strong style={{color:"#fff"}}>{activeSemester}</strong> — Assign subjects (multiple instructors can teach the same subject)</div></div>
        <div style={{marginLeft:"auto",background:"rgba(255,255,255,0.12)",borderRadius:8,padding:"8px 16px",textAlign:"center"}}>
          <div style={{color:"rgba(255,255,255,0.6)",fontSize:10}}>Assignments ({activeSemester})</div>
          <div style={{color:"#fff",fontSize:18,fontWeight:800}}>{assignments.length}</div>
        </div>
      </div>
      <div style={{background:"#f0fdf4",border:"1px solid #86efac",borderRadius:10,padding:"12px 18px",fontSize:13,color:"#166534",display:"flex",gap:10,alignItems:"center"}}>
        <span style={{fontSize:18}}>ℹ️</span>
        <span><strong>{instructors.length}</strong> instructor{instructors.length!==1?"s":""} available · <strong>{subjects.length}</strong> subject{subjects.length!==1?"s":""} this semester. <strong>Multiple instructors can teach the same subject</strong> (e.g., GE 1 in Section A & Section B).</span>
      </div>
      <div style={{background:"#dbeafe",border:"1px solid #bfdbfe",borderRadius:10,padding:"12px 18px",fontSize:13,color:"#1d4ed8",display:"flex",gap:10,alignItems:"center"}}>
        <span style={{fontSize:18}}>👥</span>
        <span><strong>New:</strong> One instructor can teach GE 1 in Section A, while another instructor teaches the same GE 1 in Section B. Simply select the same subject for multiple instructors!</span>
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
                if(!ge.length&&!major.length)return null;
                return <optgroup key={yr} label={`── Year ${yr} ──`}>
                  {/* ✅ MODIFIED: Show all subjects, not marking any as "used" */}
                  {ge.map(s=>{
                    const instructorCount = getInstructorCountForSubject(s.id);
                    const owners = getAllOwnersOf(s.id);
                    return (
                      <option key={s.id} value={s.id}>
                        🌐 {s.subject_code?`[${s.subject_code}] `:""}{s.subject_name} (GE){instructorCount > 0 ? ` — ${instructorCount} instructor${instructorCount!==1?"s":""}: ${owners.slice(0,2).join(", ")}${instructorCount > 2 ? ", ..." : ""}` : ""}
                      </option>
                    );
                  })}
                  {major.map(s=>{
                    const instructorCount = getInstructorCountForSubject(s.id);
                    const owners = getAllOwnersOf(s.id);
                    return (
                      <option key={s.id} value={s.id}>
                        🎯 {s.subject_code?`[${s.subject_code}] `:""}{s.subject_name} (Major){instructorCount > 0 ? ` — ${instructorCount} instructor${instructorCount!==1?"s":""}: ${owners.slice(0,2).join(", ")}${instructorCount > 2 ? ", ..." : ""}` : ""}
                      </option>
                    );
                  })}
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








/* ════════════════════════════════════════════════════════════════
   InlineScheduleGrid — FACULTY PRINT FIX v3 (single page, no split)
   ════════════════════════════════════════════════════════════════
   WHAT WENT WRONG IN v2:
   v2 introduced a MIN_SCALE floor (0.78) meaning "never shrink past
   this point — if the schedule still doesn't fit, let it flow onto a
   second printed page instead of over-compressing." For a bulky
   schedule (Sat classes + full week + lunch), that floor got hit, so
   the table split into two separate pages: the header repeated, a
   visual gap appeared between them, and it read as "cut in half."
   That's not what you asked for — you want it ALL on one page.

   THE FIX IN v3:
   - No more MIN_SCALE "give up and paginate" logic. fitAll() now
     always computes a scale that makes the ENTIRE table fit on one
     printed page, however small that requires — down to a tiny safety
     epsilon (0.15) that only exists to prevent a literal divide-by-zero
     or NaN, not to trigger a second page.
   - The scale is still computed against a fixed, reliable reference
     height (not the flaky wrap.clientHeight that caused the original
     collapse bug), so it can't blow up into the "5000% width" disaster
     from before.
   - <colgroup> still locks Time + 7 day columns to stable relative
     widths, so the scale transform shrinks everything uniformly —
     nothing drifts out of alignment, no matter how small the scale.
   - Only faculty (InlineScheduleGrid) touched, as before.
   ════════════════════════════════════════════════════════════════ */
function InlineScheduleGrid({ schedules, allSchedules, academicYear, semester, onMoveBlock, onCheckMove, theme, codeMap, instructorPool = [] }) {
  const [dragBlock, setDragBlock] = useState(null);
  const [dragOver, setDragOver]   = useState(null);
  const [toast, setToast]         = useState(null);
  const [editingBlock, setEditingBlock] = useState(null);
  const [collapsed, setCollapsed] = useState({});

  const real = schedules.filter(s => !s.is_break);
  const instructors = [...new Set(real.filter(s => s.instructor?.trim()).map(s => s.instructor))].sort();

  useEffect(() => {
    setCollapsed(prev => {
      const next = { ...prev };
      let changed = false;
      instructors.forEach(inst => { if (!(inst in next)) { next[inst] = true; changed = true; } });
      return changed ? next : prev;
    });
  }, [instructors.join("|")]);

  const formatPrintTime = (start, end) => {
    const formatted = fmtRange(start, end).replace(/\s(?:AM|PM)\b/gi, "");
    const isAM = start < 12;
    return formatted + (isAM ? " AM" : " PM");
  };

  const handlePrint = () => {
    const win = window.open("", "_blank");
    const pages = instructors
      .map(inst => document.getElementById(`inline-faculty-print-${inst}`)?.innerHTML || "")
      .filter(Boolean);

    if (!win || !pages.length) {
      if (win) win.close();
      return;
    }

    const pagesHtml = pages
      .map((content, index) => `
        <section class="print-page">
          <div class="print-inner" id="printInner${index}">${content}</div>
        </section>
      `)
      .join("");

    win.document.write(`<!DOCTYPE html>
<html>
  <head>
    <title>Faculty Class Schedule</title>
    <style>
      :root {
        --page-width: 100%;
        --page-height: auto;
        --time-column-width: 18%;
        --day-column-width: calc((100% - 18%) / 7);
        --base-font-size: 11pt;
      }
      
      * { box-sizing: border-box; margin: 0; padding: 0; }
      
      html, body { 
        width: 100%;
        margin: 0;
        padding: 0;
        font-family: Arial, sans-serif;
        color: #000;
        background: #fff;
      }
      
      body { 
        font-size: var(--base-font-size);
      }

      .print-page {
        width: 100%;
        padding: 0.2in;
        background: white;
        page-break-after: always;
        break-after: always;
        margin-bottom: 0.2in;
      }

      .print-inner { 
        width: 100%;
      }

      .print-table {
        width: 100%;
        overflow-x: auto;
        margin-bottom: 0.15in;
      }

      .print-table table {
        width: 100% !important;
        border-collapse: collapse;
        table-layout: fixed !important;
      }

      .print-table table col:first-child { 
        width: var(--time-column-width) !important; 
      }

      .print-table table col:not(:first-child) { 
        width: var(--day-column-width) !important; 
      }

      .print-table table th:first-child,
      .print-table table td:first-child {
        width: var(--time-column-width) !important;
        min-width: var(--time-column-width) !important;
        max-width: var(--time-column-width) !important;
      }

      .print-table table thead { 
        display: table-header-group; 
      }

      .print-table table tr,
      .print-table table td,
      .print-table table th {
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .print-header { 
        width: 100%;
        margin-bottom: 0.15in;
      }

      .print-header > div:first-child { 
        padding-bottom: 6px !important;
        margin-bottom: 6px !important;
        border-bottom: 3px double #000;
      }

      .print-header > div:first-child > div { 
        gap: 12px !important;
      }

      .print-header > div:first-child img { 
        width: 45px !important;
        height: 45px !important;
      }

      .print-header > div:first-child > div > div:nth-child(2) > div:nth-child(1) { 
        font-size: 13pt !important;
        font-weight: 900;
      }

      .print-header > div:first-child > div > div:nth-child(2) > div:nth-child(2) { 
        font-size: 10pt !important;
        margin-top: 1px !important;
      }

      .print-header > div:first-child > div > div:nth-child(2) > div:nth-child(3) { 
        font-size: 9pt !important;
        margin-top: 1px !important;
      }

      .print-header > div:nth-child(2) { 
        font-size: 16pt !important;
        font-weight: bold;
        margin: 6px 0 3px !important;
        text-align: center;
      }

      .print-header > div:nth-child(3) { 
        font-size: 10pt !important;
        margin-bottom: 4px !important;
        text-align: center;
      }

      .print-header > div:last-child { 
        font-size: 9pt !important;
        padding: 6px 10px !important;
        margin-bottom: 6px !important;
        gap: 15px !important;
      }

      .print-table table thead th {
        padding: 5px 3px !important;
        font-size: 8.5pt !important;
        font-weight: bold;
        white-space: normal !important;
        word-break: break-word;
      }

      .print-table table thead th:first-child {
        font-size: 8pt !important;
      }

      .print-table table tbody td:first-child {
        font-size: 7.5pt !important;
        font-weight: bold;
        padding: 2px 3px !important;
        white-space: normal !important;
        word-break: break-word;
      }

      .print-table table tbody td:not(:first-child) {
        font-size: 7.5pt !important;
        padding: 3px !important;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .subject-badge {
        display: inline-block;
        padding: 1px 5px !important;
        border-radius: 2px;
        font-size: 7.5pt !important;
        font-weight: bold;
        margin-bottom: 1px !important;
      }

      .subject-code {
        font-size: 7.5pt !important;
        font-weight: bold;
        line-height: 1.1;
      }

      .subject-section {
        font-size: 7pt !important;
        line-height: 1.1;
        margin-top: 0;
      }

      .subject-room {
        font-size: 7pt !important;
        line-height: 1.1;
        margin-top: 0;
      }

      .subject-type {
        font-size: 7pt !important;
        font-weight: bold;
        margin-top: 0;
      }

      .break-cell {
        font-size: 8pt !important;
        font-weight: bold;
        padding: 2px !important;
      }

  /* COMPACT SIGNATURE BLOCK */
.signature-block {
  width: 100%;
  margin-top: 0.5in;
  padding: 0;
  margin-bottom: 0.1in;
}

.signature-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.03in;
  gap: 40px;
}

.signature-item {
  flex: 1;
  text-align: center;
}

.signature-line {
  border-bottom: 1px solid #000;
  width: 40%;
  height: 0;
  margin: 0 auto 0.01in auto;
}

.signature-label {
  font-size: 7pt !important;
  color: #666;
  margin-bottom: 0.01in;
  display: none;
}

.signature-name {
  font-size: 7.5pt !important;
  font-weight: bold;
  margin-top: 0;
  line-height: 1;
}

.signature-title {
  font-size: 6.5pt !important;
  color: #555;
  margin-top: 0;
  line-height: 1;
}

      @page { 
        size: A4 landscape;
        margin: 0.2in;
      }

      @media print {
        html, body { 
          width: 100%;
          margin: 0;
          padding: 0;
        }
        
        .print-page { 
          width: 100%;
          padding: 0.15in;
          page-break-after: always;
          break-after: always;
        }

        body { 
          -webkit-print-color-adjust: exact; 
          print-color-adjust: exact; 
        }
      }
    </style>
  </head>
  <body>
    ${pagesHtml}
    <script>
      (function () {
        var printed = false;

        function printOnce() {
          if (printed) return;
          printed = true;
          
          var images = Array.prototype.slice.call(document.images);
          var pending = images.filter(function (image) { return !image.complete; }).length;

          if (!pending) {
            doPrint();
          } else {
            var finished = 0;
            function imageDone() { 
              finished += 1; 
              if (finished >= pending) doPrint(); 
            }
            images.forEach(function (image) {
              image.addEventListener("load", imageDone, { once: true });
              image.addEventListener("error", imageDone, { once: true });
            });
            setTimeout(doPrint, 2000);
          }
        }

        function doPrint() {
          setTimeout(function () { 
            window.print(); 
            window.close(); 
          }, 100);
        }

        requestAnimationFrame(printOnce);
      }());
    </script>
  </body>
</html>`);

    win.document.close();
    win.focus();
  };

  const handleDragStart = (e, block) => {
    setDragBlock(block);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDrop = async (e, day, time, instructor) => {
    e.preventDefault();
    if (!dragBlock) return;
    if (normName(dragBlock.instructor) !== normName(instructor)) { setDragOver(null); setDragBlock(null); return; }
    setDragOver(null);
    const dur = dragBlock.end - dragBlock.start;
    const newStart = time;
    const newEnd   = time + dur;
    if (!(newStart < newEnd)) { setDragBlock(null); return; }
    if (newStart === dragBlock.start && day === dragBlock.day) { setDragBlock(null); return; }

    const target = { day, start: newStart, end: newEnd, room: dragBlock.room };
    const { conflicts, moved, others } = onCheckMove(dragBlock, target);

    if (conflicts.length > 0) {
      const withSugg = conflicts.map(c => ({
        ...c,
        suggestions: findSuggestions(c, others || allSchedules, instructorPool),
      }));
      setToast({ conflicts: withSugg, movedBlock: moved });
      setDragBlock(null);
      return;
    }

    await onMoveBlock(dragBlock, target);
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
          onMoveSchedule={async (block, sg) => {
            const target = toast?.movedBlock || block;
            const targetRoom  = sg.room || target.room;
            const targetStart = Number(sg.start);
            const targetEnd   = Number(sg.end);
            if (!targetRoom || targetStart === undefined || targetEnd === undefined || targetStart >= targetEnd) return;
            const payload = { day: sg.day, start: targetStart, end: targetEnd, room: targetRoom };
            if (sg.instructor) payload.instructor = sg.instructor;
            await onMoveBlock(target, payload);
            setToast(null);
          }}
          instructorPool={instructorPool}
        />
      )}

    {editingBlock && (
  <EditModal
    block={editingBlock}
    theme={theme}
    onClose={() => setEditingBlock(null)}
    onSave={async (updated) => {
      await onMoveBlock(editingBlock, { day: updated.day, start: updated.start, end: updated.end, room: updated.room });
      setEditingBlock(null);
    }}
    allSchedules={allSchedules}
    instructorPool={instructorPool}
  />
)}

      {/* Legend + Print button row */}
      <div style={{ marginBottom: 12 }}>
        <SubjectColorLegend blocks={schedules} codeMap={codeMap} />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
          <button
            onClick={handlePrint}
            style={{ padding: "9px 22px", background: theme.primary, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}
          >
            🖨 Print / Save PDF
          </button>
        </div>
      </div>

      {instructors.length === 0 && (
        <div style={{ textAlign: "center", padding: "48px 0", color: "#94a3b8", fontSize: 14 }}>
          No instructor schedules yet. Add schedules in <strong>Instructor Load</strong>.
        </div>
      )}

      {instructors.map(inst => {
        const rawCls = schedules
          .filter(s => normName(s.instructor) === normName(inst))
          .map(b => ({ ...b, start: Number(b.start), end: Number(b.end) }));
        
        // Don't insert automatic breaks - use only what's in the data
        const cls = rawCls;
        
        const realCls = cls.filter(s => !s.is_break);
        const total   = realCls.reduce((s, c) => s + (c.end - c.start), 0);
        const labH    = realCls.filter(c => c.roomType === "Laboratory").reduce((s, c) => s + (c.end - c.start), 0);
        const lecH    = realCls.filter(c => c.roomType === "Lecture").reduce((s, c) => s + (c.end - c.start), 0);
        const instSlots = buildPrintTimeSlots(cls);

        return (
          <div key={inst} style={{ marginBottom: 28, border: `1px solid ${theme.border}`, borderRadius: 10, overflow: "hidden" }}>
            {/* Instructor header */}
            <div
              style={{ background: theme.primary, color: "#fff", padding: "9px 16px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", cursor: "pointer", userSelect: "none" }}
              onClick={() => setCollapsed(prev => ({ ...prev, [inst]: !prev[inst] }))}
            >
              <span style={{ fontWeight: 700, fontSize: 14 }}>👨‍🏫 {inst}</span>
              <span style={{ fontSize: 11, opacity: 0.8 }}>⏱ {total} hrs total</span>
              <span style={{ fontSize: 11, opacity: 0.8 }}>📖 Lecture: {lecH}h</span>
              <span style={{ fontSize: 11, opacity: 0.8 }}>🔬 Lab: {labH}h</span>
              <span style={{ marginLeft: "auto", fontSize: 12, opacity: 0.85 }}>{collapsed[inst] ? "▶ Show" : "▼ Hide"}</span>
            </div>

            {/* Hidden printable schedule */}
            <div id={`inline-faculty-print-${inst}`} style={{ display: "none" }}>
              <div className="print-header">
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 20, maxWidth: 900 }}>
                    <DeptLogo code={theme.code} style={{ width: 60, height: 60, objectFit: "contain", flexShrink: 0 }} alt={theme.code}/>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 13, fontWeight: 900, textTransform: "uppercase" }}>Passi City College</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: theme.primary, marginTop: 1 }}>{theme.shortName}</div>
                      <div style={{ fontSize: 9, color: "#555", marginTop: 1 }}>Barangay Bacuranan, Passi City, Iloilo</div>
                    </div>
                    <img src={PCCLogo} style={{ width: 60, height: 60, objectFit: "contain", flexShrink: 0 }} alt="PCC"/>
                  </div>
                </div>
                <div style={{ textTransform: "uppercase" }}>Faculty Class Schedule — {inst}</div>
                {academicYear && semester && <div style={{ color: theme.primary }}>A.Y. {academicYear} · {semester}</div>}
                <div style={{ background: theme.primary, color: theme.light, padding: "5px 8px", display: "flex", gap: 12, flexWrap: "wrap", borderRadius: 4 }}>
                  <span>⏱ Total: <strong style={{ color: "#fff" }}>{total} hrs</strong></span>
                  <span>📖 Lecture: <strong style={{ color: "#fff" }}>{lecH} hrs</strong></span>
                  <span>🔬 Lab: <strong style={{ color: "#fff" }}>{labH} hrs</strong></span>
                </div>
              </div>

              <div className="print-table">
                <table style={{ width: "100%" }}>
                  <colgroup>
                    <col style={{ width: "18%" }} />
                    {DAYS.map(d => <col key={d} style={{ width: "calc((100% - 18%) / 7)" }} />)}
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={{ background: theme.primary3 || theme.primary, color: "#fff", border: `1px solid ${theme.primary}` }}>TIME</th>
                      {DAYS.map(d => <th key={d} style={{ background: theme.primary, color: "#fff", border: `1px solid ${theme.primary3 || theme.primary}` }}>{d}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {instSlots.map(t => {
                      const nextT = instSlots[instSlots.indexOf(t) + 1] ?? (t + 1);
                      return (
                        <tr key={t}>
                          <td style={{ background: theme.light, border: "1px solid #ddd", textAlign: "center", color: theme.primary, fontWeight: 700 }}>
                            {formatPrintTime(t, nextT)}
                          </td>
                          {DAYS.map(day => {
                            const info = getCellSpanInfo(cls, day, t, instSlots);
                            if (info.kind === "covered") return null;

                            if (info.kind === "empty") return (
                              <td key={day} style={{ border: "1px solid #ddd", background: "#fff" }} />
                            );

                            const m = info.block;
                            const rowSpan = info.span;

                            if (m.is_break) return (
                              <td key={day} rowSpan={rowSpan} style={{ border: "1px solid #ddd", textAlign: "center", background: "#fef9c3" }} className="break-cell">
                                ☕ Break
                              </td>
                            );

                            const lb = m.roomType === "Laboratory";
                            const { code, name, type } = resolveSubjectDisplay(m, codeMap);
                            const sc = getSubjectColor(m.subject, type, m.roomType);

                            return (
                              <td
                                key={day}
                                rowSpan={rowSpan}
                                style={{
                                  border: `1px solid #ddd`,
                                  borderLeft: `3px solid ${sc.cellBorder}`,
                                  textAlign: "center",
                                  verticalAlign: "middle",
                                  background: sc.cellBg,
                                }}
                              >
                                <div className="subject-badge" style={{ background: sc.badgeBg, color: "#fff" }}>
                                  {code || name}
                                </div>
                                {m.section && <div className="subject-section" style={{ color: sc.accentColor }}>{m.section}</div>}
                                <div className="subject-room" style={{ color: "#475569" }}>{m.room}</div>
                                <div className="subject-type" style={{ color: sc.accentColor }}>{lb ? "🔬 Lab" : "📖 Lec"}</div>
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

            {!collapsed[inst] && (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: 12 }}>
                  <colgroup>
                    <col style={{ width: "160px" }} />
                    {DAYS.map(d => <col key={d} style={{ width: "calc((100% - 160px) / 7)" }} />)}
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={{ background: theme.primary, color: "#fff", padding: "14px 16px", border: `1px solid ${theme.primary3 || theme.primary}`, textAlign: "center", fontSize: 14 }}>Time</th>
                      {DAYS.map(d => (
                        <th key={d} style={{ background: theme.primary, color: "#fff", padding: "14px 12px", border: `1px solid ${theme.primary3 || theme.primary}`, textAlign: "center", fontSize: 14 }}>{d}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {instSlots.map(t => {
                      const nextT = instSlots[instSlots.indexOf(t) + 1] ?? (t + 1);
                      return (
                        <tr key={t}>
                          <td style={{ background: theme.light, border: "1px solid #ddd", padding: "10px 12px", fontWeight: 700, fontSize: 13, textAlign: "center", verticalAlign: "middle", color: theme.primary, whiteSpace: "nowrap" }}>{fmtRange(t, nextT)}</td>
                          {DAYS.map(day => {
                            const info = getCellSpanInfo(cls, day, t, instSlots);
                            if (info.kind === "covered") return null;

                            const isDragTarget = dragOver?.day === day && dragOver?.time === t;

                            if (info.kind === "empty") return (
                              <td
                                key={day}
                                style={{
                                  border: `2px solid ${isDragTarget ? theme.primary : "#ddd"}`,
                                  padding: "10px 12px",
                                  verticalAlign: "middle",
                                  background: isDragTarget ? theme.light2 : "#fff",
                                  transition: "all 0.12s",
                                  cursor: dragBlock ? "copy" : "default",
                                }}
                                onDragOver={e => handleDragOver(e, day, t)}
                                onDragLeave={() => setDragOver(null)}
                                onDrop={e => handleDrop(e, day, t, inst)}
                              >
                                {isDragTarget && (
                                  <div style={{ fontSize: 11, color: theme.primary, fontWeight: 700, textAlign: "center", padding: 4 }}>
                                    Drop here
                                  </div>
                                )}
                              </td>
                            );

                            const m = info.block;
                            const rowSpan = info.span;

                            if (m.is_break) return (
                              <td key={day} rowSpan={rowSpan} style={{ border: "1px solid #ddd", textAlign: "center", verticalAlign: "middle", padding: "10px 12px", background: "#fef9c3" }}>
                                <span style={{ fontSize: 14, color: "#854d0e", fontWeight: 700 }}>☕ Break</span>
                              </td>
                            );

                            const isDragging = dragBlock && m.id === dragBlock.id;
                            const lb = m.roomType === "Laboratory";
                            const { code, name, type } = resolveSubjectDisplay(m, codeMap);
                            const sc = getSubjectColor(m.subject, type, m.roomType);

                            return (
                              <td
                                key={day}
                                rowSpan={rowSpan}
                                style={{
                                  border: `1px solid #ddd`,
                                  borderLeft: `4px solid ${sc.cellBorder}`,
                                  textAlign: "center",
                                  verticalAlign: "middle",
                                  padding: "10px 12px",
                                  background: isDragging ? "rgba(0,0,0,0.04)" : sc.cellBg,
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
                                onDoubleClick={() => m.id && setEditingBlock(m)}
                              >
                                <div style={{ display: "inline-flex", alignItems: "center", background: sc.badgeBg, color: "#fff", borderRadius: 4, padding: "4px 12px", fontSize: 13, fontWeight: 900, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 3 }}>
                                  {code || name}
                                </div>
                                {m.section && <div style={{ fontSize: 11.5, color: sc.accentColor, fontWeight: 700 }}>{m.section}</div>}
                                <div style={{ fontSize: 11.5, color: "#475569" }}>{m.room}</div>
                                <div style={{ fontSize: 11.5, color: sc.accentColor, fontWeight: 700 }}>{lb ? "🔬 Lab" : "📖 Lec"}</div>
                                {m.id && (
                                  <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3 }}>✥ drag</div>
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
            )}
          </div>
        );
      })}
    </div>
  );
}








/* ════════ PAGE CONTENT ════════ */
/* ════════ DRAG-DROP INLINE SCHEDULE GRID — FACULTY ════════ */


  

/* ════════ DRAG-DROP INLINE SCHEDULE GRID — STUDENT ════════ */
/* ════════ DRAG-DROP INLINE SCHEDULE GRID — STUDENT ════════ */
/* ════════ DRAG-DROP INLINE SCHEDULE GRID — STUDENT ════════
   Rebuilt to match the faculty (InlineScheduleGrid) print layout 1:1:
   - Same print page size (12.5in x 8in on 13in x 8.5in paper)
   - Same header dimensions, stats bar, TIME:AM / TIME:PM split rows
   - Same fixed-row-height cell system (printCellBox / PRINT_ROW_H)
   - Same muted subject-color system (getSubjectColor) instead of the
     old GE/theme gradient badges
   - Same on-screen (non-printed) table font sizes / colgroup widths
   - Adds the SubjectColorLegend strip, same as the faculty view
   ════════════════════════════════════════════════════════════ */
/* ════════ DRAG-DROP INLINE SCHEDULE GRID — STUDENT ════════
   Rebuilt to match the faculty (InlineScheduleGrid) print layout 1:1:
   - Same print page size (12.5in x 8in on 13in x 8.5in paper)
   - Same header dimensions, stats bar, TIME:AM / TIME:PM split rows
   - Same fixed-row-height cell system (printCellBox / PRINT_ROW_H)
   - Same muted subject-color system (getSubjectColor) instead of the
     old GE/theme gradient badges
   - Same on-screen (non-printed) table font sizes / colgroup widths
   - Adds the SubjectColorLegend strip, same as the faculty view
   ════════════════════════════════════════════════════════════ */
function InlineStudentGrid({ schedules, allSchedules, academicYear, semester, onMoveBlock, onCheckMove, theme, codeMap, instructorPool = [] }) {
  const [dragBlock, setDragBlock] = useState(null);
  const [dragOver, setDragOver]   = useState(null);
  const [toast, setToast]         = useState(null);
  const [collapsed, setCollapsed] = useState({});
  const [editingBlock, setEditingBlock] = useState(null);
  const real     = schedules.filter(s => !s.is_break);
  const sections = [...new Set(real.filter(s => s.section?.trim()).map(s => s.section))].sort();

  useEffect(() => {
    setCollapsed(prev => {
      const next = { ...prev };
      let changed = false;
      sections.forEach(sec => { if (!(sec in next)) { next[sec] = true; changed = true; } });
      return changed ? next : prev;
    });
  }, [sections.join("|")]);

  const formatPrintTime = (start, end) => {
    const formatted = fmtRange(start, end).replace(/\s(?:AM|PM)\b/gi, "");
    // Add AM/PM based on start time
    const isAM = start < 12;
    return formatted + (isAM ? " AM" : " PM");
  };

  const handlePrint = (section) => {
    const win = window.open("", "_blank");
    const content = document.getElementById(`inline-student-print-${section}`)?.innerHTML || "";
    if (!win) return;
    if (!content) { win.close(); return; }

    win.document.write(`<!DOCTYPE html>
<html>
  <head>
    <title>Class Schedule - ${section}</title>
    <style>
      :root {
        --page-width: 100%;
        --page-height: auto;
        --time-column-width: 18%;
        --day-column-width: calc((100% - 18%) / 7);
        --base-font-size: 11pt;
      }
      
      * { box-sizing: border-box; margin: 0; padding: 0; }
      
      html, body { 
        width: 100%;
        margin: 0;
        padding: 0;
        font-family: Arial, sans-serif;
        color: #000;
        background: #fff;
      }
      
      body { 
        font-size: var(--base-font-size);
      }

      .print-page {
        width: 100%;
        padding: 0.2in;
        background: white;
      }

      .print-inner { 
        width: 100%;
      }

      .print-table {
        width: 100%;
        overflow-x: auto;
        margin-bottom: 0.15in;
      }

      .print-table table {
        width: 100% !important;
        border-collapse: collapse;
        table-layout: fixed !important;
      }

      .print-table table col:first-child { 
        width: var(--time-column-width) !important; 
      }

      .print-table table col:not(:first-child) { 
        width: var(--day-column-width) !important; 
      }

      .print-table table th:first-child,
      .print-table table td:first-child {
        width: var(--time-column-width) !important;
        min-width: var(--time-column-width) !important;
        max-width: var(--time-column-width) !important;
      }

      .print-table table thead { 
        display: table-header-group; 
      }

      .print-table table tr,
      .print-table table td,
      .print-table table th {
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .print-header { 
        width: 100%;
        margin-bottom: 0.15in;
      }

      .print-header > div:first-child { 
        padding-bottom: 6px !important;
        margin-bottom: 6px !important;
        border-bottom: 3px double #000;
      }

      .print-header > div:first-child > div { 
        gap: 12px !important;
      }

      .print-header > div:first-child img { 
        width: 45px !important;
        height: 45px !important;
      }

      .print-header > div:first-child > div > div:nth-child(2) > div:nth-child(1) { 
        font-size: 13pt !important;
        font-weight: 900;
      }

      .print-header > div:first-child > div > div:nth-child(2) > div:nth-child(2) { 
        font-size: 10pt !important;
        margin-top: 1px !important;
      }

      .print-header > div:first-child > div > div:nth-child(2) > div:nth-child(3) { 
        font-size: 9pt !important;
        margin-top: 1px !important;
      }

      .print-header > div:nth-child(2) { 
        font-size: 16pt !important;
        font-weight: bold;
        margin: 6px 0 3px !important;
        text-align: center;
      }

      .print-header > div:nth-child(3) { 
        font-size: 10pt !important;
        margin-bottom: 4px !important;
        text-align: center;
      }

      .print-header > div:last-child { 
        font-size: 9pt !important;
        padding: 6px 10px !important;
        margin-bottom: 6px !important;
        gap: 15px !important;
      }

      .print-table table thead th {
        padding: 5px 3px !important;
        font-size: 8.5pt !important;
        font-weight: bold;
        white-space: normal !important;
        word-break: break-word;
      }

      .print-table table thead th:first-child {
        font-size: 8pt !important;
      }

      .print-table table tbody td:first-child {
        font-size: 7.5pt !important;
        font-weight: bold;
        padding: 2px 3px !important;
        white-space: normal !important;
        word-break: break-word;
      }

      .print-table table tbody td:not(:first-child) {
        font-size: 7.5pt !important;
        padding: 3px !important;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .subject-badge {
        display: inline-block;
        padding: 1px 5px !important;
        border-radius: 2px;
        font-size: 7.5pt !important;
        font-weight: bold;
        margin-bottom: 1px !important;
      }

      .subject-code {
        font-size: 7.5pt !important;
        font-weight: bold;
        line-height: 1.1;
      }

      .subject-instructor {
        font-size: 7pt !important;
        line-height: 1.1;
        margin-top: 0;
      }

      .subject-room {
        font-size: 7pt !important;
        line-height: 1.1;
        margin-top: 0;
      }

      .subject-type {
        font-size: 7pt !important;
        font-weight: bold;
        margin-top: 0;
      }

      .break-cell {
        font-size: 8pt !important;
        font-weight: bold;
        padding: 2px !important;
      }

      /* COMPACT SIGNATURE BLOCK */
      .signature-block {
        width: 100%;
        margin-top: 0.5in;
        padding: 0;
        margin-bottom: 0.1in;
      }

      .signature-row {
        display: flex;
        justify-content: space-between;
        margin-bottom: 0.03in;
        gap: 40px;
      }

      .signature-item {
        flex: 1;
        text-align: center;
      }

      .signature-line {
        border-bottom: 1px solid #000;
        width: 40%;
        height: 0;
        margin: 0 auto 0.01in auto;
      }

      .signature-label {
        font-size: 7pt !important;
        color: #666;
        margin-bottom: 0.01in;
        display: none;
      }

      .signature-name {
        font-size: 7.5pt !important;
        font-weight: bold;
        margin-top: 0;
        line-height: 1;
      }

      .signature-title {
        font-size: 6.5pt !important;
        color: #555;
        margin-top: 0;
        line-height: 1;
      }

      @page { 
        size: A4 landscape;
        margin: 0.15in;
      }

      @media print {
        html, body { 
          width: 100%;
          margin: 0;
          padding: 0;
        }
        
        .print-page { 
          width: 100%;
          padding: 0.15in;
          page-break-after: auto;
        }

        body { 
          -webkit-print-color-adjust: exact; 
          print-color-adjust: exact; 
        }
      }
    </style>
  </head>
  <body>
    <div class="print-page">
      <div class="print-inner" id="printInner">${content}</div>
    </div>
    <script>
      (function () {
        var printed = false;

        function printOnce() {
          if (printed) return;
          printed = true;
          
          var images = Array.prototype.slice.call(document.images);
          var pending = images.filter(function (image) { return !image.complete; }).length;

          if (!pending) {
            doPrint();
          } else {
            var finished = 0;
            function imageDone() { 
              finished += 1; 
              if (finished >= pending) doPrint(); 
            }
            images.forEach(function (image) {
              image.addEventListener("load", imageDone, { once: true });
              image.addEventListener("error", imageDone, { once: true });
            });
            setTimeout(doPrint, 2000);
          }
        }

        function doPrint() {
          setTimeout(function () { 
            window.print(); 
            window.close(); 
          }, 100);
        }

        requestAnimationFrame(printOnce);
      }());
    </script>
  </body>
</html>`);
    win.document.close();
    win.focus();
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
    if (!(newStart < newEnd)) { setDragBlock(null); return; }
    if (newStart === dragBlock.start && day === dragBlock.day) { setDragBlock(null); return; }

    const target = { day, start: newStart, end: newEnd, room: dragBlock.room };
    const { conflicts, moved, others } = onCheckMove(dragBlock, target);

    if (conflicts.length > 0) {
      setToast({
        conflicts: conflicts.map(c => ({ ...c, suggestions: findSuggestions(c, others || allSchedules, instructorPool) })),
        movedBlock: moved,
      });
      setDragBlock(null);
      return;
    }

    await onMoveBlock(dragBlock, target);
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
          onMoveSchedule={async (block, sg) => {
            const target = toast?.movedBlock || block;
            const targetRoom  = sg.room || target.room;
            const targetStart = Number(sg.start);
            const targetEnd   = Number(sg.end);
            if (!targetRoom || targetStart === undefined || targetEnd === undefined || targetStart >= targetEnd) return;
            const payload = { day: sg.day, start: targetStart, end: targetEnd, room: targetRoom };
            if (sg.instructor) payload.instructor = sg.instructor;
            await onMoveBlock(target, payload);
            setToast(null);
          }}
          instructorPool={instructorPool}
        />
      )}

   {editingBlock && (
  <EditModal
    block={editingBlock}
    theme={theme}
    onClose={() => setEditingBlock(null)}
    onSave={async (updated) => {
      await onMoveBlock(editingBlock, { day: updated.day, start: updated.start, end: updated.end, room: updated.room });
      setEditingBlock(null);
    }}
    allSchedules={allSchedules}            // ✅ Use allSchedules prop
    instructorPool={instructorPool}
  />
)}

      <div style={{ marginBottom: 12 }}>
        <SubjectColorLegend blocks={schedules} codeMap={codeMap} />
      </div>

      {sections.length === 0 && (
        <div style={{ textAlign: "center", padding: "48px 0", color: "#94a3b8", fontSize: 14 }}>
          No student schedules yet. Add schedules in <strong>Student Load</strong>.
        </div>
      )}

      {sections.map(sec => {
        const rawCls = schedules
          .filter(s => s.section === sec)
          .map(b => ({ ...b, start: Number(b.start), end: Number(b.end) }));
        
        // Don't insert automatic breaks - use only what's in the data
        const cls = rawCls;
        
        const realCls = cls.filter(s => !s.is_break);
        const total   = realCls.reduce((s, c) => s + (c.end - c.start), 0);
        const labH    = realCls.filter(c => c.roomType === "Laboratory").reduce((s, c) => s + (c.end - c.start), 0);
        const lecH    = realCls.filter(c => c.roomType === "Lecture").reduce((s, c) => s + (c.end - c.start), 0);
        const timeSlots = buildPrintTimeSlots(cls);

        return (
          <div key={sec} style={{ marginBottom: 28, border: `1px solid ${theme.border}`, borderRadius: 10, overflow: "hidden" }}>
            {/* Section header */}
            <div
              style={{ background: theme.primary, color: "#fff", padding: "9px 16px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", cursor: "pointer", userSelect: "none" }}
              onClick={() => setCollapsed(prev => ({ ...prev, [sec]: !prev[sec] }))}
            >
              <span style={{ fontWeight: 700, fontSize: 14 }}>🎓 {sec}</span>
              <span style={{ fontSize: 11, opacity: 0.8 }}>⏱ {total} hrs total</span>
              <span style={{ fontSize: 11, opacity: 0.8 }}>📖 Lecture: {lecH}h</span>
              <span style={{ fontSize: 11, opacity: 0.8 }}>🔬 Lab: {labH}h</span>
              <button
                onClick={e => { e.stopPropagation(); handlePrint(sec); }}
                style={{ padding: "6px 16px", background: "rgba(255,255,255,0.15)", color: "#fff", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 600 }}
              >
                🖨 Print
              </button>
              <span style={{ marginLeft: "auto", fontSize: 12, opacity: 0.85 }}>{collapsed[sec] ? "▶ Show" : "▼ Hide"}</span>
            </div>

            {/* Hidden printable schedule */}
            <div id={`inline-student-print-${sec}`} style={{ display: "none" }}>
              <div className="print-header">
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 20, maxWidth: 900 }}>
                    <DeptLogo code={theme.code} style={{ width: 60, height: 60, objectFit: "contain", flexShrink: 0 }} alt={theme.code}/>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 13, fontWeight: 900, textTransform: "uppercase" }}>Passi City College</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: theme.primary, marginTop: 1 }}>{theme.shortName}</div>
                      <div style={{ fontSize: 9, color: "#555", marginTop: 1 }}>Barangay Bacuranan, Passi City, Iloilo</div>
                    </div>
                    <img src={PCCLogo} style={{ width: 60, height: 60, objectFit: "contain", flexShrink: 0 }} alt="PCC"/>
                  </div>
                </div>
                <div style={{ textTransform: "uppercase" }}>Class Schedule — {sec}</div>
                {academicYear && semester && <div style={{ color: theme.primary }}>A.Y. {academicYear} · {semester}</div>}
                <div style={{ background: theme.primary, color: theme.light, padding: "5px 8px", display: "flex", gap: 12, flexWrap: "wrap", borderRadius: 4 }}>
                  <span>⏱ Total: <strong style={{ color: "#fff" }}>{total} hrs</strong></span>
                  <span>📖 Lecture: <strong style={{ color: "#fff" }}>{lecH} hrs</strong></span>
                  <span>🔬 Lab: <strong style={{ color: "#fff" }}>{labH} hrs</strong></span>
                </div>
              </div>

              <div className="print-table">
                <table style={{ width: "100%" }}>
                  <colgroup>
                    <col style={{ width: "18%" }} />
                    {DAYS.map(d => <col key={d} style={{ width: "calc((100% - 18%) / 7)" }} />)}
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={{ background: theme.primary3 || theme.primary, color: "#fff", border: `1px solid ${theme.primary}` }}>TIME</th>
                      {DAYS.map(d => <th key={d} style={{ background: theme.primary, color: "#fff", border: `1px solid ${theme.primary3 || theme.primary}` }}>{d}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {timeSlots.map(t => {
                      const nextT = timeSlots[timeSlots.indexOf(t) + 1] ?? (t + 1);
                      return (
                        <tr key={t}>
                          <td style={{ background: theme.light, border: "1px solid #ddd", textAlign: "center", color: theme.primary, fontWeight: 700 }}>
                            {formatPrintTime(t, nextT)}
                          </td>
                          {DAYS.map(day => {
                            const info = getCellSpanInfo(cls, day, t, timeSlots);
                            if (info.kind === "covered") return null;

                            if (info.kind === "empty") return (
                              <td key={day} style={{ border: "1px solid #ddd", background: "#fff" }} />
                            );

                            const m = info.block;
                            const rowSpan = info.span;

                            if (m.is_break) return (
                              <td key={day} rowSpan={rowSpan} style={{ border: "1px solid #ddd", textAlign: "center", background: "#fef9c3" }} className="break-cell">
                                ☕ Break
                              </td>
                            );

                            const lb = m.roomType === "Laboratory";
                            const { code, name, type } = resolveSubjectDisplay(m, codeMap);
                            const sc = getSubjectColor(m.subject, type, m.roomType);

                            return (
                              <td
                                key={day}
                                rowSpan={rowSpan}
                                style={{
                                  border: `1px solid #ddd`,
                                  borderLeft: `3px solid ${sc.cellBorder}`,
                                  textAlign: "center",
                                  verticalAlign: "middle",
                                  background: sc.cellBg,
                                }}
                              >
                                <div className="subject-badge" style={{ background: sc.badgeBg, color: "#fff" }}>
                                  {code || name}
                                </div>
                                {m.instructor && <div className="subject-instructor" style={{ color: sc.accentColor }}>{m.instructor}</div>}
                                <div className="subject-room" style={{ color: "#475569" }}>{m.room}</div>
                                <div className="subject-type" style={{ color: sc.accentColor }}>{lb ? "🔬 Lab" : "📖 Lec"}</div>
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

            {!collapsed[sec] && (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: 15 }}>
                  <colgroup>
                    <col style={{ width: "160px" }} />
                    {DAYS.map(d => <col key={d} style={{ width: "calc((100% - 160px) / 7)" }} />)}
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={{ background: theme.primary, color: "#fff", padding: "14px 16px", border: `1px solid ${theme.primary3 || theme.primary}`, textAlign: "center", fontSize: 14 }}>Time</th>
                      {DAYS.map(d => (
                        <th key={d} style={{ background: theme.primary, color: "#fff", padding: "14px 12px", border: `1px solid ${theme.primary3 || theme.primary}`, textAlign: "center", fontSize: 14 }}>{d}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {timeSlots.map(t => {
                      const nextT = timeSlots[timeSlots.indexOf(t) + 1] ?? (t + 1);
                      return (
                        <tr key={t}>
                          <td style={{ background: theme.light, border: "1px solid #ddd", padding: "10px 12px", fontWeight: 700, fontSize: 13, textAlign: "center", verticalAlign: "middle", color: theme.primary, whiteSpace: "nowrap" }}>{fmtRange(t, nextT)}</td>
                          {DAYS.map(day => {
                            const info = getCellSpanInfo(cls, day, t, timeSlots);
                            if (info.kind === "covered") return null;

                            const isDragTarget = dragOver?.day === day && dragOver?.time === t;

                            if (info.kind === "empty") return (
                              <td
                                key={day}
                                style={{
                                  border: `2px solid ${isDragTarget ? theme.primary : "#ddd"}`,
                                  padding: "10px 12px",
                                  verticalAlign: "middle",
                                  background: isDragTarget ? theme.light2 : "#fff",
                                  transition: "all 0.12s",
                                  cursor: dragBlock ? "copy" : "default",
                                }}
                                onDragOver={e => handleDragOver(e, day, t)}
                                onDragLeave={() => setDragOver(null)}
                                onDrop={e => handleDrop(e, day, t, sec)}
                              >
                                {isDragTarget && (
                                  <div style={{ fontSize: 11, color: theme.primary, fontWeight: 700, textAlign: "center", padding: 4 }}>
                                    Drop here
                                  </div>
                                )}
                              </td>
                            );

                            const m = info.block;
                            const rowSpan = info.span;

                            if (m.is_break) return (
                              <td key={day} rowSpan={rowSpan} style={{ border: "1px solid #ddd", textAlign: "center", verticalAlign: "middle", padding: "10px 12px", background: "#fef9c3" }}>
                                <span style={{ fontSize: 14, color: "#854d0e", fontWeight: 700 }}>☕ Break</span>
                              </td>
                            );

                            const isDragging = dragBlock && m.id === dragBlock.id;
                            const lb = m.roomType === "Laboratory";
                            const { code, name, type } = resolveSubjectDisplay(m, codeMap);
                            const sc = getSubjectColor(m.subject, type, m.roomType);

                            return (
                              <td
                                key={day}
                                rowSpan={rowSpan}
                                style={{
                                  border: `1px solid #ddd`,
                                  borderLeft: `4px solid ${sc.cellBorder}`,
                                  textAlign: "center",
                                  verticalAlign: "middle",
                                  padding: "10px 12px",
                                  background: isDragging ? "rgba(0,0,0,0.04)" : sc.cellBg,
                                  opacity: isDragging ? 0.45 : 1,
                                  cursor: m.id ? "grab" : "default",
                                  transition: "all 0.12s",
                                  outline: isDragging ? `2px dashed ${theme.primary}` : "none",
                                }}
                                draggable={!!m.id}
                                onDragStart={e => m.id && handleDragStart(e, m)}
                                onDragOver={e => handleDragOver(e, day, t)}
                                onDragLeave={() => setDragOver(null)}
                                onDrop={e => handleDrop(e, day, t, sec)}
                                onDoubleClick={() => m.id && setEditingBlock(m)}
                              >
                                <div style={{ display: "inline-flex", alignItems: "center", background: sc.badgeBg, color: "#fff", borderRadius: 4, padding: "4px 12px", fontSize: 13, fontWeight: 900, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 3 }}>
                                  {code || name}
                                </div>
                                {m.instructor && <div style={{ fontSize: 11.5, color: sc.accentColor, fontWeight: 700 }}>{m.instructor}</div>}
                                <div style={{ fontSize: 11.5, color: "#475569" }}>{m.room}</div>
                                <div style={{ fontSize: 11.5, color: sc.accentColor, fontWeight: 700 }}>{lb ? "🔬 Lab" : "📖 Lec"}</div>
                                {m.id && (
                                  <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3 }}>✥ drag</div>
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
            )}
          </div>
        );
      })}
    </div>
  );
}


/* ════════ DRAG-DROP INLINE ROOM GRID ════════ */
/* ════════ DRAG-DROP INLINE ROOM GRID ════════ */
function InlineRoomGrid({ instructorSchedules, studentSchedules, allSchedules, academicYear, semester, onMoveBlock, onCheckMove, theme, codeMap, instructorPool = [] }) {
  const [dragBlock, setDragBlock] = useState(null);
  const [dragOver, setDragOver]   = useState(null);
  const [toast, setToast]         = useState(null);
  const [selectedRoom, setSelectedRoom] = useState("All");
  const [collapsed, setCollapsed] = useState({});
  const [editingBlock, setEditingBlock] = useState(null);
  
  const allBlocks  = buildRoomBlocks(instructorSchedules, studentSchedules);
  const usedRooms  = ALL_ROOMS.filter(r => allBlocks.some(b => b.room === r));
  const displayRooms = selectedRoom === "All" ? usedRooms : (usedRooms.includes(selectedRoom) ? [selectedRoom] : []);

  // ✅ FIX: Changed from `sections` (doesn't exist) to `usedRooms`
  useEffect(() => {
    setCollapsed(prev => {
      const next = { ...prev };
      let changed = false;
      usedRooms.forEach(r => { if (!(r in next)) { next[r] = true; changed = true; } });
      return changed ? next : prev;
    });
  }, [usedRooms.join("|")]);

  // ✅ CHANGE #1: Simplified time formatting - no special lunch handling needed
  const formatPrintTime = (start, end) => {
    const formatted = fmtRange(start, end).replace(/\s(?:AM|PM)\b/gi, "");
    const isAM = start < 12;
    return formatted + (isAM ? " AM" : " PM");
  };

  const handleDragStart = (e, block) => {
    setDragBlock(block);
    e.dataTransfer.effectAllowed = "move";
  };

  // ✅ CHANGE #3: All timeslots now valid drop targets (no lunch restrictions)
  const handleDrop = async (e, day, time, room) => {
    e.preventDefault();
    if (!dragBlock) return;
    setDragOver(null);
    const dur      = dragBlock.end - dragBlock.start;
    const newStart = time;
    const newEnd   = time + dur;
    if (!(newStart < newEnd)) { setDragBlock(null); return; }
    if (newStart === dragBlock.start && day === dragBlock.day && room === dragBlock.room) { setDragBlock(null); return; }

    const target = { day, start: newStart, end: newEnd, room, roomType: getRoomType(room) };
    const { conflicts, moved } = onCheckMove(dragBlock, target);

    if (conflicts.length > 0) {
      setToast({
        conflicts: conflicts.map(c => ({ ...c, suggestions: findSuggestions(c, allSchedules, instructorPool) })),
        movedBlock: moved,
      });
      setDragBlock(null);
      return;
    }

    await onMoveBlock(dragBlock, target);
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
    if (!win) return;
    if (!content) { win.close(); return; }

    win.document.write(`<!DOCTYPE html>
<html>
  <head>
    <title>Room Schedule - ${room}</title>
    <style>
      :root {
        --page-width: 100%;
        --page-height: auto;
        --time-column-width: 18%;
        --day-column-width: calc((100% - 18%) / 7);
        --base-font-size: 11pt;
      }
      
      * { box-sizing: border-box; margin: 0; padding: 0; }
      
      html, body { 
        width: 100%;
        margin: 0;
        padding: 0;
        font-family: Arial, sans-serif;
        color: #000;
        background: #fff;
      }
      
      body { 
        font-size: var(--base-font-size);
      }

      .print-page {
        width: 100%;
        padding: 0.2in;
        background: white;
      }

      .print-inner { 
        width: 100%;
      }

      .print-table {
        width: 100%;
        overflow-x: auto;
        margin-bottom: 0.15in;
      }

      .print-table table {
        width: 100% !important;
        border-collapse: collapse;
        table-layout: fixed !important;
      }

      .print-table table col:first-child { 
        width: var(--time-column-width) !important; 
      }

      .print-table table col:not(:first-child) { 
        width: var(--day-column-width) !important; 
      }

      .print-table table th:first-child,
      .print-table table td:first-child {
        width: var(--time-column-width) !important;
        min-width: var(--time-column-width) !important;
        max-width: var(--time-column-width) !important;
      }

      .print-table table thead { 
        display: table-header-group; 
      }

      .print-table table tr,
      .print-table table td,
      .print-table table th {
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .print-header { 
        width: 100%;
        margin-bottom: 0.15in;
      }

      .print-header > div:first-child { 
        padding-bottom: 6px !important;
        margin-bottom: 6px !important;
        border-bottom: 3px double #000;
      }

      .print-header > div:first-child > div { 
        gap: 12px !important;
      }

      .print-header > div:first-child img { 
        width: 45px !important;
        height: 45px !important;
      }

      .print-header > div:first-child > div > div:nth-child(2) > div:nth-child(1) { 
        font-size: 13pt !important;
        font-weight: 900;
      }

      .print-header > div:first-child > div > div:nth-child(2) > div:nth-child(2) { 
        font-size: 10pt !important;
        margin-top: 1px !important;
      }

      .print-header > div:first-child > div > div:nth-child(2) > div:nth-child(3) { 
        font-size: 9pt !important;
        margin-top: 1px !important;
      }

      .print-header > div:nth-child(2) { 
        font-size: 16pt !important;
        font-weight: bold;
        margin: 6px 0 3px !important;
        text-align: center;
      }

      .print-header > div:nth-child(3) { 
        font-size: 10pt !important;
        margin-bottom: 4px !important;
        text-align: center;
      }

      .print-header > div:nth-child(4) { 
        font-size: 10pt !important;
        margin-bottom: 4px !important;
        text-align: center;
      }

      .print-header > div:last-child { 
        font-size: 9pt !important;
        padding: 6px 10px !important;
        margin-bottom: 6px !important;
        gap: 15px !important;
      }

      .print-table table thead th {
        padding: 5px 3px !important;
        font-size: 8.5pt !important;
        font-weight: bold;
        white-space: normal !important;
        word-break: break-word;
      }

      .print-table table thead th:first-child {
        font-size: 8pt !important;
      }

      .print-table table tbody td:first-child {
        font-size: 7.5pt !important;
        font-weight: bold;
        padding: 2px 3px !important;
        white-space: normal !important;
        word-break: break-word;
      }

      .print-table table tbody td:not(:first-child) {
        font-size: 7.5pt !important;
        padding: 3px !important;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .subject-badge {
        display: inline-block;
        padding: 1px 5px !important;
        border-radius: 2px;
        font-size: 7.5pt !important;
        font-weight: bold;
        margin-bottom: 1px !important;
      }

      .subject-code {
        font-size: 7.5pt !important;
        font-weight: bold;
        line-height: 1.1;
      }

      .subject-instructor {
        font-size: 7pt !important;
        line-height: 1.1;
        margin-top: 0;
      }

      .subject-section {
        font-size: 7pt !important;
        line-height: 1.1;
        margin-top: 0;
      }

      .subject-type {
        font-size: 7pt !important;
        font-weight: bold;
        margin-top: 0;
      }

      .break-cell {
        font-size: 8pt !important;
        font-weight: bold;
        padding: 2px !important;
      }

      /* ✅ CHANGE #6: Signature block (lunch styling completely removed) */
      .signature-block {
        width: 100%;
        margin-top: 0.5in;
        padding: 0;
        margin-bottom: 0.1in;
      }

      .signature-row {
        display: flex;
        justify-content: space-between;
        margin-bottom: 0.03in;
        gap: 40px;
      }

      .signature-item {
        flex: 1;
        text-align: center;
      }

      .signature-line {
        border-bottom: 1px solid #000;
        width: 40%;
        height: 0;
        margin: 0 auto 0.01in auto;
      }

      .signature-label {
        font-size: 7pt !important;
        color: #666;
        margin-bottom: 0.01in;
        display: none;
      }

      .signature-name {
        font-size: 7.5pt !important;
        font-weight: bold;
        margin-top: 0;
        line-height: 1;
      }

      .signature-title {
        font-size: 6.5pt !important;
        color: #555;
        margin-top: 0;
        line-height: 1;
      }

      @page { 
        size: A4 landscape;
        margin: 0.15in;
      }

      @media print {
        html, body { 
          width: 100%;
          margin: 0;
          padding: 0;
        }
        
        .print-page { 
          width: 100%;
          padding: 0.15in;
          page-break-after: auto;
        }

        body { 
          -webkit-print-color-adjust: exact; 
          print-color-adjust: exact; 
        }
      }
    </style>
  </head>
  <body>
    <div class="print-page">
      <div class="print-inner" id="printInner">${content}</div>
    </div>
    <script>
      (function () {
        var printed = false;

        function printOnce() {
          if (printed) return;
          printed = true;
          
          var images = Array.prototype.slice.call(document.images);
          var pending = images.filter(function (image) { return !image.complete; }).length;

          if (!pending) {
            doPrint();
          } else {
            var finished = 0;
            function imageDone() { 
              finished += 1; 
              if (finished >= pending) doPrint(); 
            }
            images.forEach(function (image) {
              image.addEventListener("load", imageDone, { once: true });
              image.addEventListener("error", imageDone, { once: true });
            });
            setTimeout(doPrint, 2000);
          }
        }

        function doPrint() {
          setTimeout(function () { 
            window.print(); 
            window.close(); 
          }, 100);
        }

        requestAnimationFrame(printOnce);
      }());
    </script>
  </body>
</html>`);
    win.document.close();
    win.focus();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Toast for conflicts */}
      {toast && (
        <ConflictToast
          conflicts={toast.conflicts}
          allSchedules={allSchedules}
          onClose={() => setToast(null)}
          onMoveSchedule={async (block, sg) => {
            const target = toast?.movedBlock || block;
            const targetRoom  = sg.room || target.room;
            const targetStart = Number(sg.start);
            const targetEnd   = Number(sg.end);
            if (!targetRoom || targetStart === undefined || targetEnd === undefined || targetStart >= targetEnd) return;
            const payload = { day: sg.day, start: targetStart, end: targetEnd, room: targetRoom, roomType: getRoomType(targetRoom) };
            if (sg.instructor) payload.instructor = sg.instructor;
            await onMoveBlock(target, payload);
            setToast(null);
          }}
          instructorPool={instructorPool}
        />
      )}

     {editingBlock && (
  <EditModal
    block={editingBlock}
    theme={theme}
    onClose={() => setEditingBlock(null)}
    onSave={async (updated) => {
      await onMoveBlock(editingBlock, { day: updated.day, start: updated.start, end: updated.end, room: updated.room });
      setEditingBlock(null);
    }}
    allSchedules={allSchedules}            // ✅ Use allSchedules prop
    instructorPool={instructorPool}
  />
)}
      {/* Legend */}
      <div style={{ marginBottom: 12 }}>
        <SubjectColorLegend blocks={allBlocks} codeMap={codeMap} />
      </div>

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

      {/* Empty state */}
      {usedRooms.length === 0 && (
        <div style={{ textAlign: "center", padding: "48px 0", color: "#94a3b8", fontSize: 14 }}>
          No room data yet. Add instructor or student schedules first.
        </div>
      )}

      {/* Room cards */}
      {displayRooms.map(room => {
        const isLab   = LAB_ROOMS.includes(room);
        const rawBlocks = allBlocks.filter(b => b.room === room).map(b => ({ ...b, start: Number(b.start), end: Number(b.end) }));
        
        // ✅ CHANGE #2: No automatic break insertion — use only what's in the data
        // Previously: const blocks = DAYS.flatMap(day => { ... insertBreaks(dayBlocks) ... });
        const blocks = rawBlocks;
        
        const realBlocks = blocks.filter(s => !s.is_break);
        const total = realBlocks.reduce((s, c) => s + (c.end - c.start), 0);
        const labH  = realBlocks.filter(c => c.roomType === "Laboratory").reduce((s, c) => s + (c.end - c.start), 0);
        const lecH  = realBlocks.filter(c => c.roomType === "Lecture").reduce((s, c) => s + (c.end - c.start), 0);
        const timeSlots = buildPrintTimeSlots(blocks);

        return (
          <div key={room} style={{ border: `1px solid ${theme.border}`, borderRadius: 10, overflow: "hidden" }}>
            {/* Room header */}
            <div
              style={{ background: isLab ? theme.primary : "#16a34a", color: "#fff", padding: "9px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", cursor: "pointer", userSelect: "none" }}
              onClick={() => setCollapsed(prev => ({ ...prev, [room]: !prev[room] }))}
            >
              <span style={{ fontSize: 18 }}>{isLab ? "🔬" : "📖"}</span>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{room}</span>
              <span style={{ fontSize: 11, opacity: 0.8 }}>{isLab ? "Laboratory" : "Lecture Room"}</span>
              <span style={{ fontSize: 11, opacity: 0.7 }}>· {realBlocks.length} subject(s)</span>
              <span style={{ fontSize: 11, opacity: 0.8 }}>⏱ {total} hrs total</span>
              <span style={{ fontSize: 11, opacity: 0.8 }}>📖 Lecture: {lecH}h</span>
              <span style={{ fontSize: 11, opacity: 0.8 }}>🔬 Lab: {labH}h</span>
              <button
                onClick={e => { e.stopPropagation(); handlePrint(room); }}
                style={{ padding: "5px 14px", background: "rgba(255,255,255,0.15)", color: "#fff", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 600 }}
              >
                🖨 Print
              </button>
              <span style={{ marginLeft: "auto", fontSize: 12, opacity: 0.85 }}>{collapsed[room] ? "▶ Show" : "▼ Hide"}</span>
            </div>

            {/* Hidden printable area */}
            <div id={`inline-room-print-${room.replace(/\s/g, "-")}`} style={{ display: "none" }}>
              <div className="print-header">
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 20, maxWidth: 900 }}>
                    <DeptLogo code={theme.code} style={{ width: 60, height: 60, objectFit: "contain", flexShrink: 0 }} alt={theme.code}/>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 13, fontWeight: 900, textTransform: "uppercase" }}>Passi City College</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: theme.primary, marginTop: 1 }}>{theme.shortName}</div>
                      <div style={{ fontSize: 9, color: "#555", marginTop: 1 }}>Barangay Bacuranan, Passi City, Iloilo</div>
                    </div>
                    <img src={PCCLogo} style={{ width: 60, height: 60, objectFit: "contain", flexShrink: 0 }} alt="PCC"/>
                  </div>
                </div>
                <div style={{ textTransform: "uppercase" }}>Room Schedule — {room}</div>
                <div style={{ fontSize: 10, color: "#666" }}>{isLab ? "🔬 Laboratory" : "📖 Lecture Room"}</div>
                {academicYear && semester && <div style={{ color: theme.primary, textAlign: "center" }}>A.Y. {academicYear} · {semester}</div>}
                <div style={{ background: theme.primary, color: theme.light, padding: "5px 8px", display: "flex", gap: 12, flexWrap: "wrap", borderRadius: 4 }}>
                  <span>⏱ Total: <strong style={{ color: "#fff" }}>{total} hrs</strong></span>
                  <span>📖 Lecture: <strong style={{ color: "#fff" }}>{lecH} hrs</strong></span>
                  <span>🔬 Lab: <strong style={{ color: "#fff" }}>{labH} hrs</strong></span>
                </div>
              </div>

              <div className="print-table">
                <table style={{ width: "100%" }}>
                  <colgroup>
                    <col style={{ width: "18%" }} />
                    {DAYS.map(d => <col key={d} style={{ width: "calc((100% - 18%) / 7)" }} />)}
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={{ background: theme.primary3 || theme.primary, color: "#fff", border: `1px solid ${theme.primary}` }}>TIME</th>
                      {DAYS.map(d => <th key={d} style={{ background: theme.primary, color: "#fff", border: `1px solid ${theme.primary3 || theme.primary}` }}>{d}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {timeSlots.map(t => {
                      const nextT = timeSlots[timeSlots.indexOf(t) + 1] ?? (t + 1);
                      return (
                        <tr key={t}>
                          <td style={{ background: theme.light, border: "1px solid #ddd", textAlign: "center", color: theme.primary, fontWeight: 700 }}>
                            {formatPrintTime(t, nextT)}
                          </td>
                          {DAYS.map(day => {
                            const info = getCellSpanInfo(blocks, day, t, timeSlots);
                            if (info.kind === "covered") return null;

                            if (info.kind === "empty") return (
                              <td key={day} style={{ border: "1px solid #ddd", background: "#fff" }} />
                            );

                            const m = info.block;
                            const rowSpan = info.span;

                            // ✅ CHANGE #5: Breaks only shown when explicitly marked as is_break
                            if (m.is_break) return (
                              <td key={day} rowSpan={rowSpan} style={{ border: "1px solid #ddd", textAlign: "center", background: "#fef9c3" }} className="break-cell">
                                ☕ Break
                              </td>
                            );

                            const lb = m.roomType === "Laboratory";
                            const { code, name, type } = resolveSubjectDisplay(m, codeMap);
                            const sc = getSubjectColor(m.subject, type, m.roomType);

                            return (
                              <td
                                key={day}
                                rowSpan={rowSpan}
                                style={{
                                  border: `1px solid #ddd`,
                                  borderLeft: `3px solid ${sc.cellBorder}`,
                                  textAlign: "center",
                                  verticalAlign: "middle",
                                  background: sc.cellBg,
                                }}
                              >
                                <div className="subject-badge" style={{ background: sc.badgeBg, color: "#fff" }}>
                                  {code || name}
                                </div>
                                {m.instructor && <div className="subject-instructor" style={{ color: sc.accentColor }}>{m.instructor}</div>}
                                {m.section && <div className="subject-section" style={{ color: "#475569" }}>{m.section}</div>}
                                <div className="subject-type" style={{ color: sc.accentColor }}>{lb ? "🔬 Lab" : "📖 Lec"}</div>
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
            
            {/* Display grid (on-screen table) */}
            {!collapsed[room] && (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: 12 }}>
                  <colgroup>
                    <col style={{ width: "160px" }} />
                    {DAYS.map(d => <col key={d} style={{ width: "calc((100% - 160px) / 7)" }} />)}
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={{ background: isLab ? theme.primary : "#16a34a", color: "#fff", padding: "14px 16px", border: `1px solid ${isLab ? theme.primary3 || theme.primary : "#15803d"}`, textAlign: "center", fontSize: 14 }}>Time</th>
                      {DAYS.map(d => (
                        <th key={d} style={{ background: isLab ? theme.primary : "#16a34a", color: "#fff", padding: "14px 12px", border: `1px solid ${isLab ? theme.primary3 || theme.primary : "#15803d"}`, textAlign: "center", fontSize: 14 }}>{d}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {timeSlots.map(t => {
                      const nextT = timeSlots[timeSlots.indexOf(t) + 1] ?? (t + 1);
                      return (
                        <tr key={t}>
                          <td style={{ background: theme.light, border: "1px solid #ddd", padding: "10px 12px", fontWeight: 700, fontSize: 13, textAlign: "center", verticalAlign: "middle", color: theme.primary, whiteSpace: "nowrap" }}>{fmtRange(t, nextT)}</td>
                          {DAYS.map(day => {
                            const info = getCellSpanInfo(blocks, day, t, timeSlots);
                            if (info.kind === "covered") return null;

                            const isDragTarget = dragOver?.day === day && dragOver?.time === t;

                            // ✅ CHANGE #3: All empty slots now valid drop targets
                            if (info.kind === "empty") return (
                              <td
                                key={day}
                                style={{
                                  border: `2px solid ${isDragTarget ? (isLab ? theme.primary : "#16a34a") : "#ddd"}`,
                                  padding: "10px 12px",
                                  verticalAlign: "middle",
                                  background: isDragTarget ? theme.light2 : "#fff",
                                  transition: "all 0.12s",
                                  cursor: dragBlock ? "copy" : "default",
                                }}
                                onDragOver={e => handleDragOver(e, day, t)}
                                onDragLeave={() => setDragOver(null)}
                                onDrop={e => handleDrop(e, day, t, room)}
                              >
                                {isDragTarget && (
                                  <div style={{ fontSize: 11, color: theme.primary, fontWeight: 700, textAlign: "center", padding: 4 }}>
                                    Drop here
                                  </div>
                                )}
                              </td>
                            );

                            const m = info.block;
                            const rowSpan = info.span;

                            if (m.is_break) return (
                              <td key={day} rowSpan={rowSpan} style={{ border: "1px solid #ddd", textAlign: "center", verticalAlign: "middle", padding: "10px 12px", background: "#fef9c3" }}>
                                <span style={{ fontSize: 14, color: "#854d0e", fontWeight: 700 }}>☕ Break</span>
                              </td>
                            );

                            const isDragging = dragBlock && m.id === dragBlock.id;
                            const lb = m.roomType === "Laboratory";
                            const { code, name, type } = resolveSubjectDisplay(m, codeMap);
                            const sc = getSubjectColor(m.subject, type, m.roomType);

                            return (
                              <td
                                key={day}
                                rowSpan={rowSpan}
                                style={{
                                  border: `1px solid #ddd`,
                                  borderLeft: `4px solid ${sc.cellBorder}`,
                                  textAlign: "center",
                                  verticalAlign: "middle",
                                  padding: "10px 12px",
                                  background: isDragging ? "rgba(0,0,0,0.04)" : sc.cellBg,
                                  opacity: isDragging ? 0.45 : 1,
                                  cursor: m.id ? "grab" : "default",
                                  transition: "all 0.12s",
                                  outline: isDragging ? `2px dashed ${theme.primary}` : "none",
                                }}
                                draggable={!!m.id}
                                onDragStart={e => m.id && handleDragStart(e, m)}
                                onDragOver={e => handleDragOver(e, day, t)}
                                onDragLeave={() => setDragOver(null)}
                                onDrop={e => handleDrop(e, day, t, room)}
                                onDoubleClick={() => m.id && setEditingBlock(m)}
                              >
                                <div style={{ display: "inline-flex", alignItems: "center", background: sc.badgeBg, color: "#fff", borderRadius: 4, padding: "4px 12px", fontSize: 13, fontWeight: 900, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 3 }}>
                                  {code || name}
                                </div>
                                {m.instructor && <div style={{ fontSize: 11.5, color: sc.accentColor, fontWeight: 700 }}>{m.instructor}</div>}
                                {m.section && <div style={{ fontSize: 11.5, color: "#475569" }}>{m.section}</div>}
                                <div style={{ fontSize: 11.5, color: sc.accentColor, fontWeight: 700 }}>{lb ? "🔬 Lab" : "📖 Lec"}</div>
                                {m.id && (
                                  <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3 }}>✥ drag</div>
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
            )}
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

 // ── NEW: whenever the user opens Schedule Output or Room Schedule, pull the
  // freshest DB rows for BOTH tables. This guarantees the Instructor tab,
  // Student tab, and Room Schedule all read from the exact same up-to-date
  // dataset — including any auto-linked rows created by Instructor Load /
  // Student Load saves, or moves made from a different tab/session.
  useEffect(() => {
    if (activePage !== "Schedule Output" && activePage !== "Room Schedule") return;
    let cancelled = false;
    Promise.all([
      fetch("/api/schedules", { credentials: "include" }).then(r => r.ok ? r.json() : []),
      fetch("/api/student-schedules", { credentials: "include" }).then(r => r.ok ? r.json() : []),
    ]).then(([instRows, studRows]) => {
      if (cancelled) return;
      const allInst = Array.isArray(instRows) ? instRows : [];
      const allStud = Array.isArray(studRows) ? studRows : [];
      const filteredInst = deptCode ? allInst.filter(s => !s.dept_code || s.dept_code === deptCode) : allInst;
      const filteredStud = deptCode ? allStud.filter(s => !s.dept_code || s.dept_code === deptCode) : allStud;
      setData(p => ({ ...p, schedules: filteredInst, studentSchedules: filteredStud }));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [activePage, deptCode]);

  const saveEdit=(updated)=>{ setData(p=>({...p,schedules:p.schedules.map(s=>s.id===updated.id?updated:s)})); setEditBlock(null); };

  const allRealSchedules = [
    ...data.schedules.filter(s=>!s.is_break),
    ...data.studentSchedules.filter(s=>!s.is_break),
  ];


  
 // ── LINKED MOVE: updates the source block AND any matching block in the OTHER table ──
  // "Matching" = same subject + same day + same original start/end, and (same section OR same instructor)
const findLinkedBlock = (block, otherList) => {
  // Tier 1: same subject + same day, and every identifying field that is
  // present on BOTH sides must match — not just one. The old logic used OR,
  // so a matching section with a *different* instructor was still treated
  // as "the same class," which caused drags to silently move the wrong
  // instructor's/section's record.
  const strictMatch = (s) => {
    const bothHaveSection    = block.section && s.section;
    const bothHaveInstructor = block.instructor && s.instructor;
    if (!bothHaveSection && !bothHaveInstructor) return false; // nothing safe to compare
    if (bothHaveSection && normName(block.section) !== normName(s.section)) return false;
    if (bothHaveInstructor && normName(block.instructor) !== normName(s.instructor)) return false;
    return true;
  };

  const pickClosest = (list) => list.reduce((best, c) => {
    const bestDiff = Math.abs(Number(best.start) - Number(block.start)) + Math.abs(Number(best.end) - Number(block.end));
    const diff     = Math.abs(Number(c.start)    - Number(block.start)) + Math.abs(Number(c.end)    - Number(block.end));
    return diff < bestDiff ? c : best;
  });

  const tier1 = otherList.filter(s =>
    !s.is_break &&
    normName(s.subject) === normName(block.subject) &&
    s.day === block.day &&
    strictMatch(s)
  );
  if (tier1.length === 1) return tier1[0];
  if (tier1.length > 1) return pickClosest(tier1);

  // Tier 2 (recovery fallback): pair may have desynced onto different days
  // from an earlier bad move. Ignore day, but still require BOTH section
  // AND instructor to match — never link on a partial match.
  const tier2 = otherList.filter(s =>
    !s.is_break &&
    normName(s.subject) === normName(block.subject) &&
    block.section && s.section && normName(block.section) === normName(s.section) &&
    block.instructor && s.instructor && normName(block.instructor) === normName(s.instructor)
  );
  if (tier2.length === 0) return null;
  if (tier2.length === 1) return tier2[0];
  return pickClosest(tier2);
};

  const patchSchedule = async (id, payload) => {
    const res = await fetch(`/api/schedules/${id}`, {
      method:"PUT", credentials:"include",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload),
    });
    return res.json();
  };
  const patchStudentSchedule = async (id, payload) => {
    const res = await fetch(`/api/student-schedules/${id}`, {
      method:"PUT", credentials:"include",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload),
    });
    return res.json();
  };

  // sourceTable: "instructor" | "student" | "room" (room can match either)
// NEW
const handleLinkedMove = async (block, suggestion, sourceTable) => {
    const payload = {
      day: suggestion.day,
      start: Number(suggestion.start),
      end: Number(suggestion.end),
      room: suggestion.room || block.room,
      roomType: getRoomType(suggestion.room || block.room),
    };
    if (suggestion.instructor) payload.instructor = suggestion.instructor;

    let updatedInstructor = null;
    let updatedStudent    = null;

    // ── FIX: trust the caller-supplied sourceTable (and block._src for the
    // room grid) instead of guessing by scanning both tables for a matching
    // id. The instructor and student schedule tables have independent
    // auto-increment ids, so the same numeric id can exist in BOTH tables
    // at once. The old check (`data.schedules.some(s => s.id === block.id)`)
    // would match on that coincidental collision and patch the wrong table —
    // which is why dragging Francis Ray's block could silently update an
    // unrelated instructor row (Jerahmeel's) while Francis Ray's own row
    // never changed.
    let isInstructorRow, isStudentRow;
    if (sourceTable === "instructor") { isInstructorRow = true;  isStudentRow = false; }
    else if (sourceTable === "student") { isInstructorRow = false; isStudentRow = true; }
    else if (sourceTable === "room") {
      // Room grid blocks are tagged with _src by buildRoomBlocks.
      isInstructorRow = block._src === "instructor";
      isStudentRow    = block._src === "student";
    } else {
      // Last-resort fallback only — still unreliable, kept only in case
      // sourceTable is ever omitted.
      isInstructorRow = data.schedules.some(s => s.id === block.id);
      isStudentRow    = !isInstructorRow && data.studentSchedules.some(s => s.id === block.id);
    }

    const originalBlock = isInstructorRow
      ? data.schedules.find(s => s.id === block.id)
      : data.studentSchedules.find(s => s.id === block.id);

    if (!originalBlock) { alert("Could not locate the original schedule block to move."); return; }

    try {
      if (isInstructorRow) {
        updatedInstructor = await patchSchedule(block.id, payload);
        if (updatedInstructor.error) { alert("Move failed: " + updatedInstructor.error); return; }
      } else if (isStudentRow) {
        updatedStudent = await patchStudentSchedule(block.id, payload);
        if (updatedStudent.error) { alert("Move failed: " + updatedStudent.error); return; }
      } else {
        return;
      }

      // Find + update the linked block using the ORIGINAL position for matching
      if (isInstructorRow) {
        const linked = findLinkedBlock(originalBlock, data.studentSchedules);
        if (linked) {
          const ls = await patchStudentSchedule(linked.id, payload);
          if (!ls.error) updatedStudent = ls;
        }
      } else {
        const linked = findLinkedBlock(originalBlock, data.schedules);
        if (linked) {
          const li = await patchSchedule(linked.id, payload);
          if (!li.error) updatedInstructor = li;
        }
      }

      setData(p => ({
        ...p,
        schedules: updatedInstructor ? p.schedules.map(s => s.id === updatedInstructor.id ? updatedInstructor : s) : p.schedules,
        studentSchedules: updatedStudent ? p.studentSchedules.map(s => s.id === updatedStudent.id ? updatedStudent : s) : p.studentSchedules,
      }));
      setToast(null);
    } catch { alert("Network error while moving schedule."); }
  };
  

  // Backward-compatible wrappers used by existing call sites
  // Backward-compatible wrappers used by existing call sites
  const handleMoveSchedule    = (block, suggestion) => handleLinkedMove(block, suggestion, "instructor");
  const handleMoveInstructorL = (block, suggestion) => handleLinkedMove(block, suggestion, "instructor");
  const handleMoveStudentL    = (block, suggestion) => handleLinkedMove(block, suggestion, "student");

  // ── NEW: Link-aware conflict check used by every drag-and-drop move.
  // This finds the dragged block's linked twin (instructor-side ↔ student-side
  // record of the same class) FIRST, then excludes BOTH rows — by id, not by
  // day/time/room — from the comparison set before running detectConflicts.
  // This guarantees a class can never be flagged as conflicting with its own
  // paired record, no matter how far apart their day/time/room may have
  // drifted from earlier moves or break insertion.
  const computeMoveConflicts = (block, sourceTable, target) => {
    const room     = target.room || block.room;
    const roomType = getRoomType(room);

    let ownList, otherList;
    if (sourceTable === "student" || (sourceTable === "room" && block._src === "student")) {
      ownList = data.studentSchedules; otherList = data.schedules;
    } else {
      ownList = data.schedules; otherList = data.studentSchedules;
    }

    const originalOwn = ownList.find(s => s.id === block.id) || block;
    const linked      = findLinkedBlock(originalOwn, otherList);

    const moved       = { ...originalOwn, day: target.day, start: Number(target.start), end: Number(target.end), room, roomType };
    const movedLinked = linked ? { ...linked, day: target.day, start: Number(target.start), end: Number(target.end), room, roomType } : null;

    const excludeIds = new Set([originalOwn.id, linked?.id].filter(id => id !== undefined && id !== null));
    const others = allRealSchedules.filter(s => !s.is_break && !excludeIds.has(s.id));

    const combined  = movedLinked ? [...others, moved, movedLinked] : [...others, moved];
    const conflicts = detectConflicts(combined);

    const relevantIds = new Set([moved.id, movedLinked?.id].filter(id => id !== undefined && id !== null));
    const relevant = conflicts.filter(c => relevantIds.has(c.blockA?.id) || relevantIds.has(c.blockB?.id));

    // `others` is returned so suggestion generation can use the SAME
    // exclusion-aware list — otherwise findSuggestions would see the class's
    // own (excluded) entries and wrongly treat its own room/time as occupied.
    return { conflicts: relevant, moved, movedLinked, others };
  };

  if (activePage==="Subject Setup")         return <SubjectSetupPage theme={theme} activeSemester={activeSemester} allSchedules={allRealSchedules}/>;
if (activePage==="Instructor Pool")       return <InstructorPoolPage theme={theme} activeSemester={activeSemester} allSchedules={data.schedules.filter(s=>!s.is_break)}/>;
if (activePage==="Instructor Assignment") return <InstructorAssignmentPage theme={theme} activeSemester={activeSemester}/>;
if (activePage==="Instructor Preferences") return <InstructorPreferencesPage theme={theme} activeSemester={activeSemester} />;  // ← NEW
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
    if(!ay.trim()) return alert("Please select an Academic Year.");
    try {
      const res=await fetch("/api/academic",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({year:ay,semester:sem})});
      const s=await res.json();
      setData(prev=>({...prev,academicYear:s.year||ay,semester:s.semester||sem,academicYearId:s.id}));
    } catch {setData(prev=>({...prev,academicYear:ay,semester:sem}));}
    alert("Academic setup saved!");
  };

  const generateYearOptions = () => {
    const options = [];
    for (let year = 2026; year < 2090; year++) {
      const option = `${year}–${year + 1}`;
      options.push(option);
    }
    return options;
  };

  const yearOptions = generateYearOptions();

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
          <select value={ay} onChange={e=>setAy(e.target.value)} style={{width:"100%",boxSizing:"border-box",fontSize:15,fontWeight:600,border:`2px solid ${theme.border}`,borderRadius:10,padding:"12px 16px",background:"#fff",cursor:"pointer",color:"#0f172a",appearance:"none",paddingRight:40,backgroundImage:`url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23374151' stroke-width='2'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`,backgroundRepeat:"no-repeat",backgroundPosition:"right 10px center",backgroundSize:"20px"}}>
            <option value="" style={{color:"#94a3b8"}}>-- Select Academic Year --</option>
            {yearOptions.map(year => (
              <option key={year} value={year} style={{color:"#0f172a",background:"#fff"}}>{year}</option>
            ))}
          </select>
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

      // ── MODIFIED: capture the server's response (rows with real DB ids)
      // instead of pushing the id-less local `blocks` into state. Without a
      // real id, `draggable={!!m.id}` disables drag on the new blocks and
      // handleLinkedMove can't locate them (`data.schedules.find(s=>s.id===block.id)`
      // fails), which is why brand-new schedules looked "unsynced" and
      // un-draggable in Instructor/Student/Room output. If the endpoint
      // doesn't hand back inserted rows, fall back to a full refetch.
      let savedInstructorRows = null;
      try {
        const res = await fetch("/api/schedules", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ schedules: realBlocks, academicYearId: data.academicYearId || null }),
        });
        const saved = res.ok ? await res.json() : null;
        if (!res.ok) { alert((saved && saved.error) || "Failed to save instructor schedule."); return; }
        savedInstructorRows = Array.isArray(saved) ? saved : (Array.isArray(saved?.schedules) ? saved.schedules : null);
      } catch { alert("Network error while saving instructor schedule."); return; }

      if (savedInstructorRows && savedInstructorRows.length) {
        setData(p => ({ ...p, schedules: [...p.schedules, ...savedInstructorRows] }));
      } else {
        try {
          const refetch = await fetch("/api/schedules", { credentials: "include" });
          const allRows = refetch.ok ? await refetch.json() : [];
          const filtered = deptCode ? allRows.filter(s => !s.dept_code || s.dept_code === deptCode) : allRows;
          setData(p => ({ ...p, schedules: Array.isArray(filtered) ? filtered : p.schedules }));
          savedInstructorRows = Array.isArray(filtered) ? filtered : realBlocks;
        } catch { savedInstructorRows = realBlocks; }
      }

      // ── auto-create the matching STUDENT-side rows so Student Load & Room Schedule stay in sync ──
      try {
        const studentBlocksToCreate = [];
        for (const rb of savedInstructorRows) {
          if (!rb.section?.trim()) continue;
          const existingLinked = findLinkedBlock(rb, data.studentSchedules);
          if (existingLinked) continue;
          studentBlocksToCreate.push({
            section: rb.section, subject: rb.subject, day: rb.day,
            start: rb.start, end: rb.end, room: rb.room, roomType: rb.roomType,
            instructor: selectedInstructor, is_break: false,
          });
        }
        if (studentBlocksToCreate.length) {
          const sres = await fetch("/api/student-schedules", {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ schedules: studentBlocksToCreate, academicYearId: data.academicYearId || null }),
          });
          const ssaved = sres.ok ? await sres.json() : null;
          const insertedStudentRows = Array.isArray(ssaved) ? ssaved : (Array.isArray(ssaved?.schedules) ? ssaved.schedules : null);
          if (insertedStudentRows && insertedStudentRows.length) {
            setData(p => ({ ...p, studentSchedules: [...p.studentSchedules, ...insertedStudentRows] }));
          } else {
            const refetchS = await fetch("/api/student-schedules", { credentials: "include" });
            const allSRows = refetchS.ok ? await refetchS.json() : [];
            const filteredS = deptCode ? allSRows.filter(s => !s.dept_code || s.dept_code === deptCode) : allSRows;
            setData(p => ({ ...p, studentSchedules: Array.isArray(filteredS) ? filteredS : p.studentSchedules }));
          }
        }
        alert("✅ Instructor schedule saved!");
      } catch { /* linked creation is non-fatal; instructor schedule already saved */ }
      setGrid({});
    };

    // Filter to ONLY show instructors from the current department
const departmentInstructors = instructorPoolList.filter(i => 
  !i.department || i.department === theme.code || i.department.toUpperCase() === theme.code
);

const regular  = departmentInstructors.filter(i => !i.employment_type || i.employment_type === "Regular" || i.employment_type === "Permanent");
const parttime = departmentInstructors.filter(i => i.employment_type === "Part-time");

    return (
      <div style={cardStyle}>
        {toast && (
          <ConflictToast
            conflicts={toast}
            allSchedules={allRealSchedules}
            onClose={() => setToast(null)}
            onMoveSchedule={async (block, sg) => {
              if (block.id) {
                await handleLinkedMove(block, sg, "instructor");
              } else {
                moveGridBlock(setGrid, block, sg, { section: block.section || "" });
              }
              setToast(null);
            }}
            instructorPool={instructorPoolList}
          />
        )}
        <div style={{background:theme.headerBg,borderRadius:10,padding:"16px 22px",marginBottom:4,display:"flex",alignItems:"center",gap:14}}>
          <div style={{fontSize:28}}>📋</div>
          <div><div style={{color:"#fff",fontWeight:800,fontSize:16}}>Instructor Load</div><div style={{color:"rgba(255,255,255,0.65)",fontSize:12,marginTop:2}}>Enter weekly schedule per instructor — {theme.code}</div></div>
          {data.semester && <span style={{marginLeft:"auto",background:"rgba(255,255,255,0.15)",color:"#fff",borderRadius:20,padding:"4px 14px",fontSize:11,fontWeight:600}}>📅 {data.semester}</span>}
        </div>
        <div style={{maxWidth:480}}>
          <label style={{fontSize:13,fontWeight:600,color:"#374151",display:"block",marginBottom:6}}>Select Instructor</label>
          {departmentInstructors.length > 0 ? (
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
        ⚠ No instructors found for {theme.code}. Go to <strong>Instructor Pool</strong> to add instructors to this department first.
            </div>
          )}
          {selectedInstructor && (
            <div style={{marginTop:8,padding:"8px 14px",background:theme.light2,border:`1px solid ${theme.border}`,borderRadius:7,fontSize:12,color:theme.text,display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:16}}>👨‍🏫</span>
              <span>Entering schedule for <strong>{selectedInstructor}</strong></span>
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
        {selectedInstructor && (
          <WeeklyGrid
            grid={grid}
            setGrid={setGrid}
            theme={theme}
            selectedInstructor={selectedInstructor}
            activeSemester={activeSemester}
            sectionPoolList={sectionPoolList}
          />
        )}
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
         if (subDef && false) {
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

      // Use exactly what the user entered — no automatic break/lunch insertion on save.
      const realBlocks = rawBlocks;
      const combined=[...allRealSchedules,...realBlocks];
      const allConflicts=detectConflicts(combined);
      const newConflicts=allConflicts.filter(c=>realBlocks.some(b=>(b.section===c.blockA?.section&&b.day===c.blockA?.day&&b.start===c.blockA?.start)||(b.section===c.blockB?.section&&b.day===c.blockB?.day&&b.start===c.blockB?.start)||(b.room===c.blockA?.room&&b.day===c.blockA?.day&&b.start===c.blockA?.start)||(b.room===c.blockB?.room&&b.day===c.blockB?.day&&b.start===c.blockB?.start)));
      if(newConflicts.length>0){setToast(newConflicts);return;}

      // ── MODIFIED: same fix as saveSchedule — use the DB rows returned by
      // the server (with real ids) so these new blocks are immediately
      // draggable and linkable, instead of the id-less local `blocks`.
      // ── NEW: auto-create the matching INSTRUCTOR-side rows so Instructor Load & Room Schedule stay in sync ──
      // ── Save the section's own schedule blocks first (this was missing) ──
  
 // ── auto-create the matching INSTRUCTOR-side rows so Instructor Load & Room Schedule stay in sync ──
 // ── Save the section's own schedule blocks first (this was missing) ──
      let savedStudentRows = null;
      try {
        const res = await fetch("/api/student-schedules", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ schedules: realBlocks, academicYearId: data.academicYearId || null }),
        });
        const saved = res.ok ? await res.json() : null;
        if (!res.ok) { alert((saved && saved.error) || "Failed to save student schedule."); return; }
        savedStudentRows = Array.isArray(saved) ? saved : (Array.isArray(saved?.schedules) ? saved.schedules : null);
      } catch { alert("Network error while saving student schedule."); return; }

      if (savedStudentRows && savedStudentRows.length) {
        setData(p => ({ ...p, studentSchedules: [...p.studentSchedules, ...savedStudentRows] }));
      } else {
        try {
          const refetch = await fetch("/api/student-schedules", { credentials: "include" });
          const allRows = refetch.ok ? await refetch.json() : [];
          const filtered = deptCode ? allRows.filter(s => !s.dept_code || s.dept_code === deptCode) : allRows;
          setData(p => ({ ...p, studentSchedules: Array.isArray(filtered) ? filtered : p.studentSchedules }));
          savedStudentRows = Array.isArray(filtered) ? filtered : realBlocks;
        } catch { savedStudentRows = realBlocks; }
      }

      // ── auto-create the matching INSTRUCTOR-side rows so Instructor Load & Room Schedule stay in sync ──
      try {
        const instructorBlocksToCreate = [];
        for (const rb of savedStudentRows) {
          if (!rb.instructor?.trim()) continue;
          const existingLinked = findLinkedBlock(rb, data.schedules);
          if (existingLinked) continue;
          instructorBlocksToCreate.push({
            instructor: rb.instructor, subject: rb.subject, day: rb.day,
            start: rb.start, end: rb.end, room: rb.room, roomType: rb.roomType,
            section: selectedSection, is_break: false,
          });
        }
        if (instructorBlocksToCreate.length) {
          const ires = await fetch("/api/schedules", {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ schedules: instructorBlocksToCreate, academicYearId: data.academicYearId || null }),
          });
          const isaved = ires.ok ? await ires.json() : null;
          const insertedInstructorRows = Array.isArray(isaved) ? isaved : (Array.isArray(isaved?.schedules) ? isaved.schedules : null);
          if (insertedInstructorRows && insertedInstructorRows.length) {
            setData(p => ({ ...p, schedules: [...p.schedules, ...insertedInstructorRows] }));
          } else {
            const refetchI = await fetch("/api/schedules", { credentials: "include" });
            const allIRows = refetchI.ok ? await refetchI.json() : [];
            const filteredI = deptCode ? allIRows.filter(s => !s.dept_code || s.dept_code === deptCode) : allIRows;
            setData(p => ({ ...p, schedules: Array.isArray(filteredI) ? filteredI : p.schedules }));
          }
        }
        alert("✅ Student schedule saved!");
      } catch { /* linked creation is non-fatal; student schedule already saved */ }
       setStudentGrid({});
        setSelectedSection("");
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
    // Sections that already have a saved schedule — shown disabled so they
    // can't be picked again and silently overwritten.
    const scheduledSectionNames = new Set(
      data.studentSchedules.filter(s => !s.is_break && s.section?.trim()).map(s => normName(s.section))
    );

// In StudentLoad, when displaying instructor selector:

const InstructorSelectWithAvailability = ({ value, onChange, style, availableInstructors }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    <select style={style} value={value} onChange={onChange}>
      <option value="">— Instructor —</option>
      {availableInstructors.map(i => (
        <option key={i.id} value={i.name}>
          {i.name}
        </option>
      ))}
    </select>
    {value && (() => {
      const inst = availableInstructors.find(i => i.name === value);
      if (!inst || !inst.prefMatch) return null;
      const badge = inst.prefMatch >= 80 ? "🟢" : inst.prefMatch >= 50 ? "🟡" : "🔴";
      return (
        <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b" }}>
          {badge} {inst.prefMatch}% preferred time match
        </span>
      );
    })()}
  </div>
);














    return (
      <div style={cardStyle}>
       {toast && (
          <ConflictToast
            conflicts={toast}
            allSchedules={allRealSchedules}
            onClose={() => setToast(null)}
            onMoveSchedule={async (block, sg) => {
              if (block.id) {
                await handleLinkedMove(block, sg, "student");
              } else {
                moveGridBlock(setStudentGrid, block, sg, { instructor: block.instructor || "" });
              }
              setToast(null);
            }}
            instructorPool={instructorPoolList}
          />
        )}
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
                    {list.map(s => {
                      const already = scheduledSectionNames.has(normName(s.section_name));
                      return (
                        <option key={s.id} value={s.section_name} disabled={already}>
                          {already ? `✓ ${s.section_name} (already scheduled)` : s.section_name}
                        </option>
                      );
                    })}
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

 const handleMoveInstructor = (block, suggestion) => handleLinkedMove(block, suggestion, "instructor");
  

 // NEW
const handleMoveStudent = (block, suggestion) => handleLinkedMove(block, suggestion, "student");

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
     {/* Inline drag-drop grids */}
     {outputTab === "instructor" && (
        <InlineScheduleGrid
          schedules={data.schedules}
          allSchedules={allRealSchedules}
          academicYear={data.academicYear}
          semester={data.semester}
          onMoveBlock={handleMoveInstructor}
          onCheckMove={(block, target) => computeMoveConflicts(block, "instructor", target)}
          theme={theme}
          codeMap={codeMap}
          instructorPool={instructorPoolList}
        />
      )}
      {outputTab === "student" && (
        <InlineStudentGrid
          schedules={data.studentSchedules}
          allSchedules={allRealSchedules}
          academicYear={data.academicYear}
          semester={data.semester}
          onMoveBlock={handleMoveStudent}
          onCheckMove={(block, target) => computeMoveConflicts(block, "student", target)}
          theme={theme}
          codeMap={codeMap}
          instructorPool={instructorPoolList}
        />
      )}
    </div>
  );
}
  /* ── ROOM SCHEDULE ── */
  /* ── ROOM SCHEDULE ── */
 if (activePage==="Room Schedule") {
    const handleMoveRoom = (block, suggestion) => handleLinkedMove(block, suggestion, "room");
    return (
      <div style={{width:"100%",maxWidth:1300,alignSelf:"flex-start"}}>
        <InlineRoomGrid
          instructorSchedules={data.schedules}
          studentSchedules={data.studentSchedules}
          allSchedules={allRealSchedules}
          academicYear={data.academicYear}
          semester={data.semester}
          onMoveBlock={handleMoveRoom}
          onCheckMove={(block, target) => computeMoveConflicts(block, "room", target)}
          theme={theme}
          codeMap={codeMap}
          instructorPool={instructorPoolList}
        />
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