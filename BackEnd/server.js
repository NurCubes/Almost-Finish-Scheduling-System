require("dotenv").config();

const express = require("express");
const cors = require("cors");
const pool = require("./database");
const { CAPACITY } = require("./database");
const db = pool;  // ← Add this!
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const session = require("express-session");
const bcrypt = require("bcrypt");
const BCRYPT_ROUNDS = 12;
const MAX_PIN_ATTEMPTS = 5;
const MAX_PASS_ATTEMPTS = 5;
const LOCK_DURATION_SEC = 15 * 60;


const app = express();
app.use(cors({ origin: "http://localhost:5173", credentials: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || "change_me_in_dotenv",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: false, maxAge: 8 * 60 * 60 * 1000 },
}));


const pythonCmd = process.platform === "win32" ? "python" : "python3";

function normName(s) {
  return (s || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function ensureLogos() {
  const roots = [
    path.join(__dirname, "..", "FRONTEND", "src"),
    path.join(__dirname, "..", "frontend", "src"),
    path.join(__dirname, "..", "src"),
    path.join(__dirname, "..", "public"),
    path.join(__dirname),
  ];
  for (const logo of ["IT.png", "pcc.png"]) {
    const dest = path.join(__dirname, logo);
    if (fs.existsSync(dest)) continue;
    for (const root of roots) {
      const src = path.join(root, logo);
      if (fs.existsSync(src)) {
        try { fs.copyFileSync(src, dest); break; } catch (_) {}
      }
    }
  }
}
ensureLogos();

// ── Auth helpers ─────────────────────────────────────────────────────────────

async function getAdmin(email) {
  const { rows } = await pool.query(
    "SELECT * FROM local_auth WHERE email = $1", [email]
  );
  return rows[0] || null;
}

function isAuthenticated(req, res, next) {
  if (req.session?.userId) return next();
  res.status(401).json({ message: "Unauthorized" });
}

function isPinVerified(req, res, next) {
  if (req.session?.pinVerified) return next();
  res.status(401).json({ message: "PIN not verified" });
}

function isSuperAdmin(req, res, next) {
  if (req.session?.role === "superadmin") return next();
  res.status(403).json({ message: "Super admin access required." });
}

// ── MODIFIED: replaces old getSchema(). Returns a numeric department_id,
//    or null when a superadmin is viewing the global (all-departments) view. ──
function getDeptId(req) {
  if (req.session?.role === "superadmin") {
    if (req.session?.previewDeptId) return req.session.previewDeptId;
    return null;
  }
  return req.session?.departmentId || null;
}

async function seedAdminIfNeeded() {
  if (process.env.SEED_ADMIN !== "1") return;
  const { ADMIN_EMAIL: email, ADMIN_NAME: name = "Super Admin", ADMIN_PIN: pin, ADMIN_PASS: pass } = process.env;
  if (!email || !pin || !pass) { console.warn("SEED_ADMIN=1 but vars missing."); return; }
  const existing = await pool.query("SELECT id FROM local_auth WHERE email=$1", [email]);
  if (existing.rows.length > 0) return;
  const [pinHash, passHash] = await Promise.all([
    bcrypt.hash(String(pin), BCRYPT_ROUNDS),
    bcrypt.hash(pass, BCRYPT_ROUNDS),
  ]);
  await pool.query(
    "INSERT INTO local_auth (email,name,pin_hash,pass_hash,role,department_id) VALUES ($1,$2,$3,$4,'superadmin',NULL)",
    [email, name, pinHash, passHash]
  );
  console.log(`Super admin seeded: ${email}`);
}

/* ══════════════════════════ AUTH ══════════════════════════ */

app.post("/auth/verify-pin", async (req, res) => {
  try {
    const { email, pin } = req.body;
    if (!email || !pin) return res.status(400).json({ message: "Email and PIN required." });
    const admin = await getAdmin(email);
    if (!admin) return res.status(401).json({ message: "Invalid credentials." });
    const now = Math.floor(Date.now() / 1000);
    if (admin.locked_until > now) {
      return res.status(429).json({ message: `Account locked. Try again in ${Math.ceil((admin.locked_until - now) / 60)} minute(s).` });
    }
    const match = await bcrypt.compare(String(pin), admin.pin_hash);
    if (!match) {
      const attempts = admin.failed_pin_attempts + 1;
      if (attempts >= MAX_PIN_ATTEMPTS) {
        await pool.query("UPDATE local_auth SET failed_pin_attempts=0, locked_until=$1 WHERE email=$2", [now + LOCK_DURATION_SEC, email]);
        return res.status(429).json({ message: "Too many failed attempts. Locked for 15 minutes." });
      }
      await pool.query("UPDATE local_auth SET failed_pin_attempts=$1 WHERE email=$2", [attempts, email]);
      return res.status(401).json({ message: "Incorrect PIN.", attemptsLeft: MAX_PIN_ATTEMPTS - attempts });
    }
    await pool.query("UPDATE local_auth SET failed_pin_attempts=0, locked_until=0 WHERE email=$1", [email]);
    req.session.pinVerified = true;
    req.session.pinEmail = email;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post("/auth/login", isPinVerified, async (req, res) => {
  try {
    const { password } = req.body;
    const email = req.session.pinEmail;
    if (!password || !email) return res.status(400).json({ message: "Password required." });
    const admin = await getAdmin(email);
    if (!admin) return res.status(401).json({ message: "Invalid credentials." });
    const now = Math.floor(Date.now() / 1000);
    if (admin.locked_until > now) {
      return res.status(429).json({ message: `Account locked. Try again in ${Math.ceil((admin.locked_until - now) / 60)} minute(s).` });
    }
    const match = await bcrypt.compare(password, admin.pass_hash);
    if (!match) {
      const attempts = admin.failed_pass_attempts + 1;
      if (attempts >= MAX_PASS_ATTEMPTS) {
        await pool.query("UPDATE local_auth SET failed_pass_attempts=0, locked_until=$1 WHERE email=$2", [now + LOCK_DURATION_SEC, email]);
        return res.status(429).json({ message: "Too many failed attempts. Locked for 15 minutes." });
      }
      await pool.query("UPDATE local_auth SET failed_pass_attempts=$1 WHERE email=$2", [attempts, email]);
      return res.status(401).json({ message: "Incorrect password.", attemptsLeft: MAX_PASS_ATTEMPTS - attempts });
    }
    await pool.query("UPDATE local_auth SET failed_pass_attempts=0, locked_until=0 WHERE email=$1", [email]);
    let deptCode = null, deptName = null;
    if (admin.department_id) {
      const deptRes = await pool.query("SELECT code, name FROM departments WHERE id=$1", [admin.department_id]);
      if (deptRes.rows[0]) { deptCode = deptRes.rows[0].code; deptName = deptRes.rows[0].name; }
    }
    req.session.userId = admin.id;
    req.session.userEmail = admin.email;
    req.session.userName = admin.name;
    req.session.role = admin.role;
    req.session.departmentId = admin.department_id || null;
    req.session.deptCode = deptCode;
    req.session.deptName = deptName;
    req.session.pinVerified = false;
    delete req.session.pinEmail;
    res.json({ ok:true, name:admin.name, email:admin.email, role:admin.role, departmentId:admin.department_id||null, deptCode, deptName });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get("/api/auth/me", (req, res) => {
  if (req.session?.userId)
    return res.json({ id:req.session.userId, email:req.session.userEmail, name:req.session.userName, role:req.session.role, departmentId:req.session.departmentId, deptCode:req.session.deptCode, deptName:req.session.deptName });
  res.status(401).json({ message:"Not logged in" });
});

app.post("/auth/logout", (req, res) => { req.session.destroy(() => res.json({ ok:true })); });

/* ══════════════════════════ DEPARTMENTS ══════════════════════════ */

app.get("/api/departments", isAuthenticated, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM departments ORDER BY code");
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MODIFIED: now resolves the dept CODE the frontend sends into a department_id
//    and stores that id in session (previewDeptId), instead of a schema name. ──
app.post("/api/set-preview-dept", isAuthenticated, isSuperAdmin, async (req, res) => {
  try {
    const { deptCode } = req.body;
    if (!deptCode) { req.session.previewDeptId = null; req.session.previewDeptCode = null; return res.json({ ok: true }); }
    const { rows } = await pool.query("SELECT id, code FROM departments WHERE code=$1", [deptCode.toUpperCase()]);
    if (!rows[0]) return res.status(404).json({ error: "Department not found." });
    req.session.previewDeptId = rows[0].id;
    req.session.previewDeptCode = rows[0].code;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════ ADMIN ACCOUNTS ══════════════════════════ */

app.get("/api/admin-accounts", isAuthenticated, isSuperAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT la.id, la.email, la.name, la.role, la.department_id,
             la.locked_until, d.code AS dept_code, d.name AS dept_name
      FROM local_auth la
      LEFT JOIN departments d ON la.department_id = d.id
      ORDER BY la.role DESC, d.code
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin-accounts", isAuthenticated, isSuperAdmin, async (req, res) => {
  try {
    const { email, name, pin, password, department_id, role = "dept_admin" } = req.body;
    if (!email || !name || !pin || !password) return res.status(400).json({ error: "All fields required." });
    if (role === "dept_admin" && !department_id) return res.status(400).json({ error: "Department required." });
    const existing = await pool.query("SELECT id FROM local_auth WHERE email=$1", [email]);
    if (existing.rows.length > 0) return res.status(409).json({ error: "Email already registered." });
    const [pinHash, passHash] = await Promise.all([bcrypt.hash(String(pin), BCRYPT_ROUNDS), bcrypt.hash(password, BCRYPT_ROUNDS)]);
    const { rows } = await pool.query(
      "INSERT INTO local_auth (email,name,pin_hash,pass_hash,role,department_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [email, name.trim(), pinHash, passHash, role, department_id || null]
    );
    res.json({ id:rows[0].id, email, name, role, department_id: department_id||null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/admin-accounts/:id", isAuthenticated, isSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { pin, password, name, department_id } = req.body;
    const existing = await pool.query("SELECT * FROM local_auth WHERE id=$1", [id]);
    if (!existing.rows[0]) return res.status(404).json({ error: "Account not found." });
    const acc = existing.rows[0];
    const pinHash = pin ? await bcrypt.hash(String(pin), BCRYPT_ROUNDS) : acc.pin_hash;
    const passHash = password ? await bcrypt.hash(password, BCRYPT_ROUNDS) : acc.pass_hash;
    await pool.query(
      `UPDATE local_auth SET pin_hash=$1, pass_hash=$2,
       name=COALESCE($3,name), department_id=COALESCE($4,department_id),
       failed_pin_attempts=0, failed_pass_attempts=0, locked_until=0 WHERE id=$5`,
      [pinHash, passHash, name||null, department_id||null, id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/admin-accounts/:id", isAuthenticated, isSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (Number(id) === req.session.userId) return res.status(400).json({ error: "Cannot delete your own account." });
    await pool.query("DELETE FROM local_auth WHERE id=$1", [id]);
    res.json({ deleted: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin-accounts/:id/unlock", isAuthenticated, isSuperAdmin, async (req, res) => {
  try {
    await pool.query(
      "UPDATE local_auth SET locked_until=0, failed_pin_attempts=0, failed_pass_attempts=0 WHERE id=$1",
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════ CAPACITY ══════════════════════════ */

// ── MODIFIED: single table, filtered by department_id when present ──
app.get("/api/capacity", isAuthenticated, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    const q = async (sql, params) => parseInt((await pool.query(sql, params)).rows[0].c);
    const where = deptId ? "WHERE department_id = $1" : "";
    const params = deptId ? [deptId] : [];
    res.json({
      limits: CAPACITY,
      instructors:     await q(`SELECT COUNT(*) AS c FROM instructors ${where}`, params),
      scheduleBlocks:  await q(`SELECT COUNT(*) AS c FROM schedules ${where ? where + " AND" : "WHERE"} is_break=FALSE`, params),
      studentBlocks:   await q(`SELECT COUNT(*) AS c FROM student_schedules ${where ? where + " AND" : "WHERE"} is_break=FALSE`, params),
      sections:        await q(`SELECT COUNT(DISTINCT section) AS c FROM student_schedules ${where}`, params),
      academicYears:   await q(`SELECT COUNT(*) AS c FROM academic_years ${where}`, params),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════ INSTRUCTOR REGISTRATION ══════════════════════════ */

// ── MODIFIED: one query (optionally scoped), instead of looping schemas ──
app.get("/api/instructor-registration", isAuthenticated, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    const where = deptId ? "WHERE i.department_id = $1" : "";
    const params = deptId ? [deptId] : [];
    const { rows: instructors } = await pool.query(`
      SELECT i.id, i.name, i.name_lower, i.email, d.code AS dept_code
      FROM instructors i
      JOIN departments d ON i.department_id = d.id
      ${where}
      ORDER BY i.name
    `, params);
    for (const inst of instructors) {
      const { rows } = await pool.query(
        `SELECT id, subject_name FROM instructor_subjects WHERE instructor_id=$1 ORDER BY subject_name`,
        [inst.id]
      );
      inst.subjects = rows;
    }
    res.json(instructors);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/instructor-registration/all-names", isAuthenticated, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    const where = deptId ? "WHERE department_id = $1" : "";
    const params = deptId ? [deptId] : [];
    const { rows } = await pool.query(`SELECT name FROM instructors ${where} ORDER BY name`, params);
    res.json(rows.map(r => r.name));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/instructor-registration/subjects-for/:instructorName", isAuthenticated, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    const nameLower = normName(decodeURIComponent(req.params.instructorName));
    const where = deptId ? "AND department_id = $2" : "";
    const params = deptId ? [nameLower, deptId] : [nameLower];
    const { rows: instRows } = await pool.query(
      `SELECT id FROM instructors WHERE name_lower=$1 ${where}`, params
    );
    if (!instRows[0]) return res.json([]);
    const { rows } = await pool.query(
      `SELECT subject_name FROM instructor_subjects WHERE instructor_id=$1 ORDER BY subject_name`,
      [instRows[0].id]
    );
    res.json(rows.map(r => r.subject_name));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/instructor-registration", isAuthenticated, async (req, res) => {
  try {
    const deptId = getDeptId(req) || req.body.department_id;
    if (!deptId) return res.status(400).json({ error: "Department could not be determined." });
    let { name, email = "" } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Instructor name is required." });
    name = name.trim().replace(/\s+/g, " ");
    const nameLower = normName(name);
    email = (email || "").trim();
    const existing = await pool.query(
      `SELECT id, name FROM instructors WHERE department_id=$1 AND name_lower=$2`, [deptId, nameLower]
    );
    if (existing.rows[0]) return res.status(409).json({ error: `"${existing.rows[0].name}" is already registered.` });
    const countRes = await pool.query(`SELECT COUNT(*) AS c FROM instructors WHERE department_id=$1`, [deptId]);
    if (parseInt(countRes.rows[0].c) >= CAPACITY.instructors)
      return res.status(400).json({ error: `Instructor limit reached (${CAPACITY.instructors}).` });
    const { rows } = await pool.query(
      `INSERT INTO instructors (department_id,name,name_lower,email) VALUES ($1,$2,$3,$4) RETURNING id`,
      [deptId, name, nameLower, email]
    );
    res.json({ id:rows[0].id, name, email });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/instructor-registration/:id/subjects", isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;
    let { subject_name } = req.body;
    if (!subject_name?.trim()) return res.status(400).json({ error: "Subject name is required." });
    subject_name = subject_name.trim().replace(/\s+/g, " ");
    const subjectLower = normName(subject_name);
    const countRes = await pool.query(`SELECT COUNT(*) AS c FROM instructor_subjects WHERE instructor_id=$1`, [id]);
    if (parseInt(countRes.rows[0].c) >= CAPACITY.subjects_per_inst)
      return res.status(400).json({ error: `Subject limit reached (${CAPACITY.subjects_per_inst}).` });
    const { rows } = await pool.query(
      `INSERT INTO instructor_subjects (instructor_id,subject_name,subject_lower) VALUES ($1,$2,$3) RETURNING id`,
      [id, subject_name, subjectLower]
    );
    res.json({ id:rows[0].id, subject_name });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: `"${req.body.subject_name}" is already assigned.` });
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/instructor-registration/subjects/:subjectId", isAuthenticated, async (req, res) => {
  try {
    await pool.query(`DELETE FROM instructor_subjects WHERE id=$1`, [req.params.subjectId]);
    res.json({ deleted: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/instructor-registration/:id", isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;
    const usedRes = await pool.query(
      `SELECT COUNT(*) AS c FROM schedules WHERE instructor_id=$1 AND is_break=FALSE`, [id]
    );
    if (parseInt(usedRes.rows[0].c) > 0)
      return res.status(400).json({ error: `Cannot delete — ${usedRes.rows[0].c} schedule block(s) linked.` });
    await pool.query(`DELETE FROM instructor_subjects WHERE instructor_id=$1`, [id]);
    await pool.query(`DELETE FROM instructors WHERE id=$1`, [id]);
    res.json({ deleted: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════ ACADEMIC YEAR ══════════════════════════ */

app.post("/api/academic", isAuthenticated, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!deptId) return res.status(400).json({ error: "Department could not be determined." });
    const { year, semester } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO academic_years (department_id,year,semester) VALUES ($1,$2,$3) RETURNING *`,
      [deptId, year, semester]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/academic", isAuthenticated, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    const where = deptId ? "WHERE department_id = $1" : "";
    const params = deptId ? [deptId] : [];
    const { rows } = await pool.query(`SELECT * FROM academic_years ${where} ORDER BY id DESC`, params);
    res.json(rows[0] || null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════ INSTRUCTORS (basic) ══════════════════════════ */

app.post("/api/instructors", isAuthenticated, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!deptId) return res.status(400).json({ error: "Department could not be determined." });
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Name required." });
    const clean = name.trim().replace(/\s+/g, " ");
    const nameLower = normName(clean);
    const { rows } = await pool.query(
      `INSERT INTO instructors (department_id,name,name_lower) VALUES ($1,$2,$3)
       ON CONFLICT (department_id, name_lower) DO UPDATE SET name=EXCLUDED.name RETURNING *`,
      [deptId, clean, nameLower]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/instructors", isAuthenticated, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    const where = deptId ? "WHERE department_id = $1" : "";
    const params = deptId ? [deptId] : [];
    const { rows } = await pool.query(`SELECT * FROM instructors ${where} ORDER BY name`, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════ INSTRUCTOR SCHEDULES ══════════════════════════ */

// ── MODIFIED: one JOIN query, filtered by department_id when scoped ──
app.get("/api/schedules", isAuthenticated, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    const where = deptId ? "WHERE s.department_id = $1" : "";
    const params = deptId ? [deptId] : [];
    const { rows } = await pool.query(`
      SELECT s.id, i.name AS instructor, s.subject, s.section, s.day,
             s.start_time AS start, s.end_time AS end,
             s.room, s.room_type AS "roomType", s.is_break,
             s.academic_year_id,
             d.code AS dept_code
      FROM schedules s
      JOIN instructors i  ON s.instructor_id = i.id
      JOIN departments d  ON s.department_id = d.id
      ${where}
      ORDER BY i.name, s.day, s.start_time
    `, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/schedules", isAuthenticated, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!deptId) return res.status(400).json({ error: "Department could not be determined." });
    const { schedules, academicYearId } = req.body;
    if (!schedules?.length) return res.status(400).json({ error: "No schedules provided." });
    const totalRes = await pool.query(`SELECT COUNT(*) AS c FROM schedules WHERE department_id=$1 AND is_break=FALSE`, [deptId]);
    const totalNow = parseInt(totalRes.rows[0].c);
    const incoming = schedules.filter(s => !s.is_break).length;
    if (totalNow + incoming > CAPACITY.total_schedule_blocks)
      return res.status(400).json({ error: `Schedule block limit reached (${CAPACITY.total_schedule_blocks}).` });
    for (const s of schedules) {
      const nameLower = normName(s.instructor);
      await pool.query(
        `INSERT INTO instructors (department_id,name,name_lower) VALUES ($1,$2,$3)
         ON CONFLICT (department_id, name_lower) DO NOTHING`,
        [deptId, s.instructor.trim(), nameLower]
      );
      const instRes = await pool.query(
        `SELECT id FROM instructors WHERE department_id=$1 AND name_lower=$2`, [deptId, nameLower]
      );
      await pool.query(
        `INSERT INTO schedules
         (department_id,instructor_id,subject,section,day,start_time,end_time,room,room_type,is_break,academic_year_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [deptId, instRes.rows[0].id, s.subject, s.section||"", s.day, s.start, s.end,
         s.room, s.roomType||"Lecture", s.is_break||false, academicYearId||null]
      );
    }
    res.json({ saved: schedules.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// NEW
app.put("/api/schedules/:id", isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;
    const { day, room, roomType } = req.body;
    const start = Number(req.body.start);
    const end   = Number(req.body.end);
    if (!day || Number.isNaN(start) || Number.isNaN(end) || !room || !roomType)
      return res.status(400).json({ error: "Missing required fields." });
    if (start >= end) return res.status(400).json({ error: "Start time must be before end time." });
    const existRes = await pool.query(`SELECT id FROM schedules WHERE id=$1`, [id]);
    if (!existRes.rows[0]) return res.status(404).json({ error: "Schedule not found." });
    await pool.query(
      `UPDATE schedules SET day=$1,start_time=$2,end_time=$3,room=$4,room_type=$5 WHERE id=$6`,
      [day, start, end, room, roomType, id]
    );
    const { rows } = await pool.query(`
      SELECT s.id, i.name AS instructor, s.subject, s.section, s.day,
             s.start_time AS start, s.end_time AS end,
             s.room, s.room_type AS "roomType", s.is_break, s.academic_year_id
      FROM schedules s
      JOIN instructors i ON s.instructor_id=i.id
      WHERE s.id=$1
    `, [id]);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MODIFIED: only delete schedules, NOT instructors ──
app.delete("/api/schedules", isAuthenticated, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (deptId) {
      await pool.query(`DELETE FROM schedules WHERE department_id=$1`, [deptId]);
    } else {
      await pool.query(`DELETE FROM schedules`);
    }
    res.json({ deleted: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════ STUDENT SCHEDULES ══════════════════════════ */

app.get("/api/student-schedules", isAuthenticated, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    const where = deptId ? "WHERE ss.department_id = $1" : "";
    const params = deptId ? [deptId] : [];
    const { rows } = await pool.query(`
      SELECT ss.id, ss.section, ss.subject, ss.instructor, ss.day,
             ss.start_time AS start, ss.end_time AS end,
             ss.room, ss.room_type AS "roomType", ss.is_break, ss.academic_year_id,
             d.code AS dept_code
      FROM student_schedules ss
      JOIN departments d ON ss.department_id = d.id
      ${where}
      ORDER BY ss.section, ss.day, ss.start_time
    `, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/student-schedules", isAuthenticated, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!deptId) return res.status(400).json({ error: "Department could not be determined." });
    const { schedules, academicYearId } = req.body;
    if (!schedules?.length) return res.status(400).json({ error: "No schedules provided." });
    const totalRes = await pool.query(`SELECT COUNT(*) AS c FROM student_schedules WHERE department_id=$1 AND is_break=FALSE`, [deptId]);
    const totalNow = parseInt(totalRes.rows[0].c);
    const incoming = schedules.filter(s => !s.is_break).length;
    if (totalNow + incoming > CAPACITY.student_schedule_blocks)
      return res.status(400).json({ error: `Student schedule limit reached (${CAPACITY.student_schedule_blocks}).` });
    for (const s of schedules) {
      await pool.query(
        `INSERT INTO student_schedules
         (department_id,section,subject,instructor,instructor_lower,day,start_time,end_time,room,room_type,is_break,academic_year_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [deptId, s.section, s.subject, s.instructor||"", normName(s.instructor||""),
         s.day, s.start, s.end, s.room, s.roomType||"Lecture", s.is_break||false, academicYearId||null]
      );
    }
    res.json({ saved: schedules.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// NEW
app.put("/api/student-schedules/:id", isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;
    const { day, room, roomType } = req.body;
    const start = Number(req.body.start);
    const end   = Number(req.body.end);
    if (!day || Number.isNaN(start) || Number.isNaN(end) || !room)
      return res.status(400).json({ error: "Missing required fields." });
    if (start >= end)
      return res.status(400).json({ error: "Start time must be before end time." });
    const existRes = await pool.query(
      `SELECT id FROM student_schedules WHERE id=$1`, [id]
    );
    if (!existRes.rows[0])
      return res.status(404).json({ error: "Student schedule not found." });
    const rt = roomType || (["Lab A","Lab B","Lab C"].includes(room) ? "Laboratory" : "Lecture");
    await pool.query(
      `UPDATE student_schedules
       SET day=$1, start_time=$2, end_time=$3, room=$4, room_type=$5
       WHERE id=$6`,
      [day, start, end, room, rt, id]
    );
    const { rows } = await pool.query(
      `SELECT id, section, subject, instructor, day,
              start_time AS start, end_time AS end,
              room, room_type AS "roomType", is_break, academic_year_id
       FROM student_schedules WHERE id=$1`,
      [id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/student-schedules", isAuthenticated, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (deptId) {
      await pool.query(`DELETE FROM student_schedules WHERE department_id=$1`, [deptId]);
    } else {
      await pool.query(`DELETE FROM student_schedules`);
    }
    res.json({ deleted: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════ AUTO-GENERATE FACULTY ══════════════════════════ */

app.post("/api/generate-faculty-from-students", isAuthenticated, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!deptId) return res.status(400).json({ error: "Department could not be determined." });
    const { rows: studentBlocks } = await pool.query(`
      SELECT section, subject, instructor, instructor_lower, day,
             start_time AS start, end_time AS end,
             room, room_type AS "roomType", is_break, academic_year_id
      FROM student_schedules
      WHERE department_id=$1 AND is_break=FALSE AND instructor != ''
      ORDER BY instructor_lower, day, start_time
    `, [deptId]);
    if (!studentBlocks.length)
      return res.status(400).json({ error: "No student schedules with instructors found." });
    let added = 0, skipped = 0;
    for (const b of studentBlocks) {
      const nameLower = normName(b.instructor);
      await pool.query(
        `INSERT INTO instructors (department_id,name,name_lower) VALUES ($1,$2,$3)
         ON CONFLICT (department_id, name_lower) DO NOTHING`,
        [deptId, b.instructor.trim(), nameLower]
      );
      const instRes = await pool.query(
        `SELECT id FROM instructors WHERE department_id=$1 AND name_lower=$2`, [deptId, nameLower]
      );
      const instId = instRes.rows[0].id;
      const existRes = await pool.query(
        `SELECT COUNT(*) AS c FROM schedules
         WHERE instructor_id=$1 AND subject=$2 AND section=$3 AND day=$4
         AND start_time=$5 AND end_time=$6 AND is_break=FALSE`,
        [instId, b.subject, b.section, b.day, b.start, b.end]
      );
      if (parseInt(existRes.rows[0].c) > 0) { skipped++; continue; }
    await pool.query(
        `INSERT INTO schedules
         (department_id,instructor_id,subject,section,day,start_time,end_time,room,room_type,is_break,academic_year_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,FALSE,$10)`,
        [deptId, instId, b.subject, b.section, b.day, b.start, b.end, b.room, b.roomType, b.academic_year_id]
      );
      added++;
    }
    const totalRes = await pool.query(`SELECT COUNT(*) AS c FROM schedules WHERE department_id=$1 AND is_break=FALSE`, [deptId]);
    const instRes = await pool.query(`SELECT COUNT(*) AS c FROM instructors WHERE department_id=$1`, [deptId]);
    res.json({ generated:added, skipped, total:parseInt(totalRes.rows[0].c), instructors:parseInt(instRes.rows[0].c) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════ OVERVIEW ══════════════════════════ */

// ── MODIFIED: single GROUP BY query instead of looping schemas per department ──
app.get("/api/overview", isAuthenticated, isSuperAdmin, async (req, res) => {
  try {
    const { rows: depts } = await pool.query("SELECT * FROM departments ORDER BY code");
    const result = await Promise.all(depts.map(async d => {
      const q = async (sql, params) => { try { return parseInt((await pool.query(sql, params)).rows[0].c); } catch(_){ return 0; } };
      const instructors = await q(`SELECT COUNT(*) AS c FROM instructors WHERE department_id=$1`, [d.id]);
      const schedBlocks = await q(`SELECT COUNT(*) AS c FROM schedules WHERE department_id=$1 AND is_break=FALSE`, [d.id]);
      const studBlocks  = await q(`SELECT COUNT(*) AS c FROM student_schedules WHERE department_id=$1 AND is_break=FALSE`, [d.id]);
      const sections    = await q(`SELECT COUNT(DISTINCT section) AS c FROM student_schedules WHERE department_id=$1`, [d.id]);
      const adminRes = await pool.query("SELECT name,email FROM local_auth WHERE department_id=$1 AND role='dept_admin'", [d.id]);
      return { ...d, instructors, schedBlocks, studBlocks, sections, adminAccount: adminRes.rows[0]||null };
    }));
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════ SUPERADMIN DATABASE VIEWER ══════════════════════ */

app.get("/api/superadmin/schedules", isAuthenticated, isSuperAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.id, i.name AS instructor, s.subject, s.section, s.day,
             s.start_time AS start, s.end_time AS end, s.room,
             s.room_type AS "roomType", s.is_break,
             d.code AS dept_code
      FROM schedules s
      JOIN instructors i  ON s.instructor_id = i.id
      JOIN departments d  ON s.department_id = d.id
      ORDER BY i.name, s.day, s.start_time
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/superadmin/student-schedules", isAuthenticated, isSuperAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT ss.*, d.code AS dept_code
      FROM student_schedules ss
      JOIN departments d ON ss.department_id = d.id
      ORDER BY ss.section, ss.day, ss.start_time
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/superadmin/instructors", isAuthenticated, isSuperAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT i.*,
             d.code AS dept_code,
             (SELECT COUNT(*) FROM instructor_subjects WHERE instructor_id=i.id) AS subject_count
      FROM instructors i
      JOIN departments d ON i.department_id = d.id
      ORDER BY i.name
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════ SUBJECTS ══════════════════════════ */

app.get("/api/subjects", isAuthenticated, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!deptId) return res.status(400).json({ error: "Department could not be determined." });
    const { semester } = req.query;
    const params = [deptId];
    let whereClause = "WHERE department_id = $1";
    if (semester) {
      params.push(semester);
      whereClause += ` AND semester = $${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT id, subject_name, subject_code, subject_description,
              subject_type, semester, year_level, units,
              COALESCE(hour_load, 0) AS hour_load
       FROM subjects
       ${whereClause}
       ORDER BY year_level, subject_type, subject_name`,
      params
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/subjects", isAuthenticated, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!deptId) return res.status(400).json({ error: "Department could not be determined." });
    let {
      subject_name,
      subject_code        = "",
      subject_description = "",
      subject_type        = "Major",
      semester             = "1st Semester",
      year_level           = 1,
      units                = 3,
      hour_load            = 0,
    } = req.body;

    if (!subject_name?.trim())
      return res.status(400).json({ error: "Subject name is required." });

    subject_name        = subject_name.trim().replace(/\s+/g, " ");
    subject_code        = (subject_code || "").trim().toUpperCase();
    subject_description = (subject_description || "").trim();

    const dupName = await pool.query(
      `SELECT id FROM subjects WHERE department_id=$1 AND LOWER(subject_name) = LOWER($2) AND semester=$3`,
      [deptId, subject_name, semester]
    );
    if (dupName.rows[0])
      return res.status(409).json({ error: `"${subject_name}" already exists in this department.` });

    if (subject_code) {
      const dupCode = await pool.query(
        `SELECT id FROM subjects WHERE department_id=$1 AND subject_code = $2`,
        [deptId, subject_code]
      );
      if (dupCode.rows[0])
        return res.status(409).json({ error: `Subject code "${subject_code}" is already used.` });
    }

    const { rows } = await pool.query(
      `INSERT INTO subjects
         (department_id, subject_name, subject_code, subject_description, subject_type, semester, year_level, units, hour_load)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        deptId,
        subject_name,
        subject_code        || null,
        subject_description || "",
        subject_type,
        semester,
        parseInt(year_level),
        parseInt(units),
        parseInt(hour_load) || 0,
      ]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "This subject (or its code) already exists in this department." });
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/subjects/:id", isAuthenticated, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    const { id } = req.params;
    let {
      subject_name,
      subject_code        = "",
      subject_description = "",
      subject_type,
      semester,
      year_level,
      units,
      hour_load            = 0,
    } = req.body;

    if (!subject_name?.trim())
      return res.status(400).json({ error: "Subject name is required." });

    subject_name        = subject_name.trim().replace(/\s+/g, " ");
    subject_code        = (subject_code || "").trim().toUpperCase();
    subject_description = (subject_description || "").trim();

    const dupName = await pool.query(
      `SELECT id FROM subjects WHERE department_id=$1 AND LOWER(subject_name) = LOWER($2) AND semester=$3 AND id != $4`,
      [deptId, subject_name, semester, id]
    );
    if (dupName.rows[0])
      return res.status(409).json({ error: `"${subject_name}" already exists in this department.` });

    if (subject_code) {
      const dupCode = await pool.query(
        `SELECT id FROM subjects WHERE department_id=$1 AND subject_code = $2 AND id != $3`,
        [deptId, subject_code, id]
      );
      if (dupCode.rows[0])
        return res.status(409).json({ error: `Subject code "${subject_code}" is already used.` });
    }

    const { rows } = await pool.query(
      `UPDATE subjects
       SET subject_name        = $1,
           subject_code        = $2,
           subject_description = $3,
           subject_type        = $4,
           semester             = $5,
           year_level           = $6,
           units                = $7,
           hour_load            = $8
       WHERE id = $9 AND department_id = $10
       RETURNING *`,
      [
        subject_name,
        subject_code        || null,
        subject_description || "",
        subject_type,
        semester,
        parseInt(year_level),
        parseInt(units),
        parseInt(hour_load) || 0,
        id,
        deptId,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: "Subject not found." });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/subjects/:id", isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;
    const inUse = await pool.query(
      `SELECT COUNT(*) AS c FROM instructor_assignments WHERE subject_id=$1`, [id]
    );
    if (parseInt(inUse.rows[0].c) > 0)
      return res.status(400).json({ error: "Cannot delete — subject has instructor assignments. Remove assignments first." });
    await pool.query(`DELETE FROM subjects WHERE id=$1`, [id]);
    res.json({ deleted: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});




// ════════════════════════════════════════════════════════════
// INSTRUCTOR PREFERENCES ENDPOINTS
// ════════════════════════════════════════════════════════════

// GET all preferences for an instructor in a semester

 
// Add/Replace these endpoints in your server.js file
// These should be in the section with other instructor-related endpoints

// ════════════════════════════════════════════════════════════
// FIX 1: Make sure this endpoint exists in server.js
// GET all instructors (used by dropdown)
// ════════════════════════════════════════════════════════════

app.get("/api/instructors", isAuthenticated, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    const where = deptId ? "WHERE department_id = $1" : "";
    const params = deptId ? [deptId] : [];
    const { rows } = await pool.query(`SELECT id, name, email FROM instructors ${where} ORDER BY name`, params);
    console.log("Instructors endpoint - returning:", rows);
    res.json(rows);
  } catch (e) { 
    console.error("Error fetching instructors:", e);
    res.status(500).json({ error: e.message }); 
  }
});




























/* ══════════════════════════ INSTRUCTOR POOL ══════════════════════════ */

app.get("/api/instructor-pool", isAuthenticated, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    const where = deptId ? "WHERE i.department_id = $1" : "";
    const params = deptId ? [deptId] : [];
    const { rows } = await pool.query(`
      SELECT i.id, i.name, i.email,
             d.code AS department,
             i.employment_type,
             COALESCE(i.active_semesters::text, 'Both') AS active_semesters,
             COALESCE(i.max_load, 0) AS max_load,
             d.code AS dept_code
      FROM instructors i
      JOIN departments d ON i.department_id = d.id
      ${where}
      ORDER BY i.name
    `, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/instructor-pool", isAuthenticated, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!deptId) return res.status(400).json({ error: "Department could not be determined." });
    let { name, email = "", employment_type = "Regular", active_semesters = null, max_load = 0 } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Instructor name is required." });
    name = name.trim().replace(/\s+/g, " ");
    const nameLower = normName(name);
    email = (email || "").trim();

    const existing = await pool.query(
      `SELECT id FROM instructors WHERE department_id=$1 AND name_lower=$2`, [deptId, nameLower]
    );
    if (existing.rows[0]) return res.status(409).json({ error: `"${name}" is already registered.` });

    const countRes = await pool.query(`SELECT COUNT(*) AS c FROM instructors WHERE department_id=$1`, [deptId]);
    if (parseInt(countRes.rows[0].c) >= CAPACITY.instructors)
      return res.status(400).json({ error: `Instructor limit reached (${CAPACITY.instructors}).` });

    const { rows } = await pool.query(
      `INSERT INTO instructors (department_id, name, name_lower, email, employment_type, active_semesters, max_load)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, name, email, employment_type, active_semesters, max_load`,
      [deptId, name, nameLower, email, employment_type, active_semesters, parseInt(max_load) || 0]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/instructor-pool/:id", isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, employment_type, active_semesters, max_load } = req.body;

    const existing = await pool.query(`SELECT * FROM instructors WHERE id=$1`, [id]);
    if (!existing.rows[0]) return res.status(404).json({ error: "Instructor not found." });

    if (name) {
      const clean = name.trim().replace(/\s+/g, " ");
      const nameLower = normName(clean);
      const dup = await pool.query(
        `SELECT id FROM instructors WHERE department_id=$1 AND name_lower=$2 AND id!=$3`,
        [existing.rows[0].department_id, nameLower, id]
      );
      if (dup.rows[0]) return res.status(409).json({ error: `"${clean}" already exists.` });

      const { rows } = await pool.query(
        `UPDATE instructors
         SET name=$1, name_lower=$2,
             email=COALESCE($3, email),
             employment_type=COALESCE($4, employment_type),
             active_semesters=COALESCE($5, active_semesters),
             max_load=COALESCE($6, max_load)
         WHERE id=$7
         RETURNING id, name, email, employment_type, active_semesters, max_load`,
        [clean, nameLower, email||null, employment_type||null, active_semesters||null, max_load != null ? parseInt(max_load) : null, id]
      );
      return res.json(rows[0]);
    }

    const { rows } = await pool.query(
      `UPDATE instructors
       SET email=COALESCE($1, email),
           employment_type=COALESCE($2, employment_type),
           active_semesters=COALESCE($3, active_semesters),
           max_load=COALESCE($4, max_load)
       WHERE id=$5
       RETURNING id, name, email, employment_type, active_semesters, max_load`,
      [email||null, employment_type||null, active_semesters||null, max_load != null ? parseInt(max_load) : null, id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/instructor-pool/:id", isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;

    const usedInSched = await pool.query(
      `SELECT COUNT(*) AS c FROM schedules WHERE instructor_id=$1 AND is_break=FALSE`, [id]
    );
    if (parseInt(usedInSched.rows[0].c) > 0)
      return res.status(400).json({ error: `Cannot delete — ${usedInSched.rows[0].c} schedule block(s) linked.` });

    await pool.query(`DELETE FROM instructor_assignments WHERE instructor_id=$1`, [id]);
    await pool.query(`DELETE FROM instructor_subjects WHERE instructor_id=$1`, [id]);
    await pool.query(`DELETE FROM instructors WHERE id=$1`, [id]);
    res.json({ deleted: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════ INSTRUCTOR ASSIGNMENTS ══════════════════════════ */

app.get("/api/instructor-assignments", isAuthenticated, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    const { semester, instructor_name } = req.query;

    let whereClause = deptId ? "WHERE i.department_id = $1" : "WHERE 1=1";
    const params = deptId ? [deptId] : [];
    if (semester) { params.push(semester); whereClause += ` AND ia.semester = $${params.length}`; }
    if (instructor_name) { params.push(normName(instructor_name)); whereClause += ` AND i.name_lower = $${params.length}`; }

    const { rows } = await pool.query(`
      SELECT ia.id, ia.semester,
             i.id AS instructor_id, i.name AS instructor_name,
             COALESCE(i.employment_type::text,'Regular') AS employment_type,
             s.id AS subject_id, s.subject_name, s.subject_code,
             s.subject_description, s.subject_type, s.year_level, s.units,
             d.code AS dept_code
      FROM instructor_assignments ia
      JOIN instructors i  ON ia.instructor_id = i.id
      JOIN subjects s     ON ia.subject_id    = s.id
      JOIN departments d  ON i.department_id  = d.id
      ${whereClause}
      ORDER BY i.name, s.subject_name
    `, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/instructor-assignments", isAuthenticated, async (req, res) => {
  try {
    const { instructor_id, subject_id, semester } = req.body;
    if (!instructor_id || !subject_id || !semester)
      return res.status(400).json({ error: "instructor_id, subject_id, and semester are required." });

    const instCheck = await pool.query(`SELECT id, name FROM instructors WHERE id=$1`, [instructor_id]);
    if (!instCheck.rows[0]) return res.status(404).json({ error: "Instructor not found." });

    const subCheck = await pool.query(`SELECT id, subject_name FROM subjects WHERE id=$1`, [subject_id]);
    if (!subCheck.rows[0]) return res.status(404).json({ error: "Subject not found." });

    const { rows } = await pool.query(
      `INSERT INTO instructor_assignments (instructor_id, subject_id, semester)
       VALUES ($1,$2,$3)
       ON CONFLICT (instructor_id, subject_id, semester) DO NOTHING
       RETURNING id`,
      [instructor_id, subject_id, semester]
    );
    if (!rows[0]) return res.status(409).json({ error: "This assignment already exists." });

    const { rows: full } = await pool.query(`
      SELECT ia.id, ia.semester,
             i.id AS instructor_id, i.name AS instructor_name,
             COALESCE(i.employment_type::text,'Regular') AS employment_type,
             s.id AS subject_id, s.subject_name, s.subject_code,
             s.subject_description, s.subject_type, s.year_level, s.units
      FROM instructor_assignments ia
      JOIN instructors i ON ia.instructor_id = i.id
      JOIN subjects s    ON ia.subject_id    = s.id
      WHERE ia.id=$1
    `, [rows[0].id]);
    res.json(full[0]);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "This assignment already exists." });
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/instructor-assignments/:id", isAuthenticated, async (req, res) => {
  try {
    await pool.query(`DELETE FROM instructor_assignments WHERE id=$1`, [req.params.id]);
    res.json({ deleted: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════ SECTIONS ══════════════════════════ */

app.get("/api/sections", isAuthenticated, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!deptId) return res.status(400).json({ error: "Department could not be determined." });
    const { semester } = req.query;
    const params = [deptId];
    let where = "WHERE department_id = $1";
    if (semester) { params.push(semester); where += ` AND semester = $${params.length}`; }
    const { rows } = await pool.query(
      `SELECT id, section_name, year_level, semester FROM sections ${where} ORDER BY year_level, section_name`,
      params
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/sections", isAuthenticated, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!deptId) return res.status(400).json({ error: "Department could not be determined." });
    const { section_name, year_level = 1, semester = "1st Semester" } = req.body;
    if (!section_name?.trim())
      return res.status(400).json({ error: "Section name is required." });
    const clean = section_name.trim().replace(/\s+/g, " ");
    const dup = await pool.query(
      `SELECT id FROM sections WHERE department_id=$1 AND LOWER(section_name)=LOWER($2) AND semester=$3`,
      [deptId, clean, semester]
    );
    if (dup.rows[0])
      return res.status(409).json({ error: `"${clean}" already exists for ${semester}.` });
    const { rows } = await pool.query(
      `INSERT INTO sections (department_id, section_name, year_level, semester)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [deptId, clean, parseInt(year_level), semester]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/sections/:id", isAuthenticated, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    const { id } = req.params;
    const { section_name, year_level, semester } = req.body;
    if (!section_name?.trim())
      return res.status(400).json({ error: "Section name is required." });
    const clean = section_name.trim().replace(/\s+/g, " ");
    const dup = await pool.query(
      `SELECT id FROM sections WHERE department_id=$1 AND LOWER(section_name)=LOWER($2) AND semester=$3 AND id!=$4`,
      [deptId, clean, semester, id]
    );
    if (dup.rows[0])
      return res.status(409).json({ error: `"${clean}" already exists for ${semester}.` });
    const { rows } = await pool.query(
      `UPDATE sections SET section_name=$1, year_level=$2, semester=$3
       WHERE id=$4 AND department_id=$5 RETURNING *`,
      [clean, parseInt(year_level), semester, id, deptId]
    );
    if (!rows[0]) return res.status(404).json({ error: "Section not found." });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/sections/:id", isAuthenticated, async (req, res) => {
  try {
    await pool.query(`DELETE FROM sections WHERE id=$1`, [req.params.id]);
    res.json({ deleted: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════ GENERATE EXCEL ══════════════════════════ */

app.post("/api/generate", isAuthenticated, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    const type = req.body.type === "student" ? "student" : "instructor";
    const table = type === "student" ? "student_schedules" : "schedules";
    const where = deptId ? "WHERE department_id=$1 AND is_break=FALSE" : "WHERE is_break=FALSE";
    const params = deptId ? [deptId] : [];
    const res2 = await pool.query(`SELECT COUNT(*) AS c FROM ${table} ${where}`, params);
    if (parseInt(res2.rows[0].c) === 0)
      return res.status(400).json({ error: `No ${type} schedules in database.` });
    ensureLogos();
    const script = type === "student" ? "generate_student.py" : "generate.py";
    exec(`${pythonCmd} ${script}`, { cwd: __dirname }, (error, stdout, stderr) => {
      if (error) return res.status(500).json({ error: stderr || error.message });
      res.json({ message: "Generated successfully!" });
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════ DOWNLOAD ══════════════════════════ */

app.get("/api/download", isAuthenticated, (req, res) => {
  const type = req.query.type === "student" ? "student" : "instructor";
  const filename = type === "student" ? "student_schedule_output.xlsx" : "schedule_output.xlsx";
  const label = type === "student" ? "SmartSched_Student_Schedule.xlsx" : "SmartSched_Faculty_Schedule.xlsx";
  const file = path.join(__dirname, filename);
  if (!fs.existsSync(file)) return res.status(404).json({ error: "File not found. Generate first." });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${label}"`);
  res.download(file, label, err => { if (err) console.error("Download error:", err.message); });
});

/* ══════════════════════════ BACKUP ══════════════════════════ */

app.get("/api/backup", isAuthenticated, isSuperAdmin, async (req, res) => {
  try {
    const label = `SmartSched_Backup_${new Date().toISOString().slice(0,10)}.sql`;
    const dumpFile = path.join(__dirname, label);
    exec(
      `pg_dump -U ${process.env.DB_USER} -d ${process.env.DB_NAME} -f ${dumpFile}`,
      { env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD } },
      (error) => {
        if (error) return res.status(500).json({ error: "Backup failed." });
        res.setHeader("Content-Disposition", `attachment; filename="${label}"`);
        res.download(dumpFile, label, () => fs.unlinkSync(dumpFile));
      }
    );
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════ STATUS ══════════════════════════ */

app.get("/db-status", async (req, res) => {
  try {
    const schedules          = parseInt((await pool.query(`SELECT COUNT(*) AS c FROM schedules WHERE is_break=FALSE`)).rows[0].c);
    const student_schedules  = parseInt((await pool.query(`SELECT COUNT(*) AS c FROM student_schedules WHERE is_break=FALSE`)).rows[0].c);
    const instructors        = parseInt((await pool.query(`SELECT COUNT(*) AS c FROM instructors`)).rows[0].c);
    const academic_years     = parseInt((await pool.query(`SELECT COUNT(*) AS c FROM academic_years`)).rows[0].c);
    res.json({ schedules, student_schedules, instructors, academic_years });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════ START ══════════════════════════ */

seedAdminIfNeeded().then(async () => {
  const sc  = parseInt((await pool.query(`SELECT COUNT(*) AS c FROM schedules WHERE is_break=FALSE`)).rows[0].c);
  const ssc = parseInt((await pool.query(`SELECT COUNT(*) AS c FROM student_schedules WHERE is_break=FALSE`)).rows[0].c);
  const ic  = parseInt((await pool.query(`SELECT COUNT(*) AS c FROM instructors`)).rows[0].c);
  const dc  = parseInt((await pool.query("SELECT COUNT(*) AS c FROM departments")).rows[0].c);
  app.listen(5000, () => {
    console.log("SmartSched backend running on http://localhost:5000");
    console.log(`Departments: ${dc} | Instructors: ${ic} | Instructor blocks: ${sc} | Student blocks: ${ssc}`);
  });
});