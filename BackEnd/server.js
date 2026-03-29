require("dotenv").config();
const express   = require("express");
const cors      = require("cors");
const db        = require("./database");
const { exec }  = require("child_process");
const path      = require("path");
const fs        = require("fs");
const session   = require("express-session");
const bcrypt    = require("bcrypt");

const BCRYPT_ROUNDS     = 12;
const MAX_PIN_ATTEMPTS  = 5;
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

function ensureLogos() {
  const roots = [
    path.join(__dirname, "..", "FRONTEND", "src"),
    path.join(__dirname, "..", "frontend", "src"),
    path.join(__dirname, "..", "src"),
    path.join(__dirname, "..", "FRONTEND", "public"),
    path.join(__dirname, "..", "frontend", "public"),
    path.join(__dirname, "..", "public"),
    path.join(__dirname),
  ];
  for (const logo of ["IT.png", "pcc.png"]) {
    const dest = path.join(__dirname, logo);
    if (fs.existsSync(dest)) continue;
    for (const root of roots) {
      const src = path.join(root, logo);
      if (fs.existsSync(src)) {
        try { fs.copyFileSync(src, dest); console.log(`Copied ${logo}`); break; }
        catch (e) { console.warn(`Could not copy ${logo}: ${e.message}`); }
      }
    }
  }
}
ensureLogos();

function getAdmin(email) {
  return db.prepare("SELECT * FROM local_auth WHERE email = ?").get(email);
}


function isAuthenticated(req, res, next) {
  if (req.session?.userId) return next();
  res.status(401).json({ message: "Unauthorized" });
}
function isPinVerified(req, res, next) {
  if (req.session?.pinVerified) return next();
  res.status(401).json({ message: "PIN not verified" });
}


async function seedAdminIfNeeded() {
  if (process.env.SEED_ADMIN !== "1") return;
  const { ADMIN_EMAIL: email, ADMIN_NAME: name = "Admin", ADMIN_PIN: pin, ADMIN_PASS: pass } = process.env;
  if (!email || !pin || !pass) { console.warn("SEED_ADMIN=1 but vars missing."); return; }
  if (db.prepare("SELECT id FROM local_auth WHERE email=?").get(email)) {
    console.log("Admin already seeded."); return;
  }
  const [pinHash, passHash] = await Promise.all([
    bcrypt.hash(pin,  BCRYPT_ROUNDS),
    bcrypt.hash(pass, BCRYPT_ROUNDS),
  ]);
  db.prepare("INSERT INTO local_auth (email,name,pin_hash,pass_hash) VALUES (?,?,?,?)")
    .run(email, name, pinHash, passHash);
  console.log(`Admin seeded: ${email}`);
}


app.post("/auth/verify-pin", async (req, res) => {
  const { email, pin } = req.body;
  if (!email || !pin) return res.status(400).json({ message: "Email and PIN required." });
  const admin = getAdmin(email);
  if (!admin) return res.status(401).json({ message: "Invalid credentials." });
  const now = Math.floor(Date.now() / 1000);
  if (admin.locked_until > now) {
    const remaining = Math.ceil((admin.locked_until - now) / 60);
    return res.status(429).json({ message: `Account locked. Try again in ${remaining} minute(s).` });
  }
  const match = await bcrypt.compare(String(pin), admin.pin_hash);
  if (!match) {
    const attempts = admin.failed_pin_attempts + 1;
    if (attempts >= MAX_PIN_ATTEMPTS) {
      db.prepare("UPDATE local_auth SET failed_pin_attempts=0,locked_until=? WHERE email=?")
        .run(now + LOCK_DURATION_SEC, email);
      return res.status(429).json({ message: "Too many failed attempts. Locked for 15 minutes." });
    }
    db.prepare("UPDATE local_auth SET failed_pin_attempts=? WHERE email=?").run(attempts, email);
    return res.status(401).json({ message: "Incorrect PIN.", attemptsLeft: MAX_PIN_ATTEMPTS - attempts });
  }
  db.prepare("UPDATE local_auth SET failed_pin_attempts=0,locked_until=0 WHERE email=?").run(email);
  req.session.pinVerified = true;
  req.session.pinEmail    = email;
  res.json({ ok: true });
});

app.post("/auth/login", isPinVerified, async (req, res) => {
  const { password } = req.body;
  const email = req.session.pinEmail;
  if (!password || !email) return res.status(400).json({ message: "Password required." });
  const admin = getAdmin(email);
  if (!admin) return res.status(401).json({ message: "Invalid credentials." });
  const now = Math.floor(Date.now() / 1000);
  if (admin.locked_until > now) {
    const remaining = Math.ceil((admin.locked_until - now) / 60);
    return res.status(429).json({ message: `Account locked. Try again in ${remaining} minute(s).` });
  }
  const match = await bcrypt.compare(password, admin.pass_hash);
  if (!match) {
    const attempts = admin.failed_pass_attempts + 1;
    if (attempts >= MAX_PASS_ATTEMPTS) {
      db.prepare("UPDATE local_auth SET failed_pass_attempts=0,locked_until=? WHERE email=?")
        .run(now + LOCK_DURATION_SEC, email);
      return res.status(429).json({ message: "Too many failed attempts. Locked for 15 minutes." });
    }
    db.prepare("UPDATE local_auth SET failed_pass_attempts=? WHERE email=?").run(attempts, email);
    return res.status(401).json({ message: "Incorrect password.", attemptsLeft: MAX_PASS_ATTEMPTS - attempts });
  }
  db.prepare("UPDATE local_auth SET failed_pass_attempts=0,locked_until=0 WHERE email=?").run(email);
  req.session.userId      = admin.id;
  req.session.userEmail   = admin.email;
  req.session.userName    = admin.name;
  req.session.pinVerified = false;
  delete req.session.pinEmail;
  res.json({ ok: true, name: admin.name, email: admin.email });
});


app.get("/api/auth/me", (req, res) => {
  if (req.session?.userId)
    return res.json({ id: req.session.userId, email: req.session.userEmail, name: req.session.userName });
  res.status(401).json({
    message:     "Not logged in",
    pinVerified: !!req.session?.pinVerified,
    pinEmail:    req.session?.pinEmail || null,
  });
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.post("/api/academic", isAuthenticated, (req, res) => {
  const { year, semester } = req.body;
  const result = db.prepare("INSERT INTO academic_years (year, semester) VALUES (?, ?)").run(year, semester);
  res.json({ id: result.lastInsertRowid, year, semester });
});
app.get("/api/academic", isAuthenticated, (req, res) => {
  res.json(db.prepare("SELECT * FROM academic_years ORDER BY id DESC").all());
});


app.post("/api/instructors", isAuthenticated, (req, res) => {
  const { name } = req.body;
  try {
    const result = db.prepare("INSERT INTO instructors (name) VALUES (?)").run(name);
    res.json({ id: result.lastInsertRowid, name });
  } catch { /* ignore — duplicate */ }
});
app.get("/api/instructors", isAuthenticated, (req, res) => {
  res.json(db.prepare("SELECT * FROM instructors ORDER BY name").all());
});


app.get("/api/schedules", isAuthenticated, (req, res) => {
  try {
    res.json(db.prepare(`
      SELECT s.id, i.name AS instructor, s.subject, s.section, s.day,
             s.start_time AS start, s.end_time AS end,
             s.room, s.room_type AS roomType, s.academic_year_id
      FROM schedules s
      JOIN instructors i ON s.instructor_id = i.id
      ORDER BY i.name, s.day, s.start_time
    `).all());
  } catch { res.json([]); }
});

app.post("/api/schedules", isAuthenticated, (req, res) => {
  const { schedules, academicYearId } = req.body;
  if (!schedules?.length) return res.status(400).json({ error: "No schedules provided." });
  const insInst  = db.prepare("INSERT OR IGNORE INTO instructors (name) VALUES (?)");
  const getInst  = db.prepare("SELECT id FROM instructors WHERE name = ?");
  const insSched = db.prepare(`
    INSERT INTO schedules
      (instructor_id, subject, section, day, start_time, end_time, room, room_type, academic_year_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(items => {
    for (const s of items) {
      insInst.run(s.instructor);
      const inst = getInst.get(s.instructor);
      insSched.run(inst.id, s.subject, s.section || "", s.day, s.start, s.end,
                   s.room, s.roomType || "Lecture", academicYearId || null);
    }
  })(schedules);
  const total = db.prepare("SELECT COUNT(*) AS c FROM schedules").get().c;
  console.log(`Saved ${schedules.length} instructor block(s). DB total: ${total}`);
  res.json({ saved: schedules.length });
});

app.put("/api/schedules/:id", isAuthenticated, (req, res) => {
  const { id } = req.params;
  const { day, start, end, room, roomType } = req.body;
  if (!day || start === undefined || end === undefined || !room || !roomType)
    return res.status(400).json({ error: "Missing required fields." });
  if (start >= end)
    return res.status(400).json({ error: "Start time must be before end time." });
  try {
    const result = db.prepare(
      `UPDATE schedules SET day=?, start_time=?, end_time=?, room=?, room_type=? WHERE id=?`
    ).run(day, start, end, room, roomType, id);
    if (!result.changes) return res.status(404).json({ error: "Schedule not found." });
    res.json(db.prepare(`
      SELECT s.id, i.name AS instructor, s.subject, s.section, s.day,
             s.start_time AS start, s.end_time AS end,
             s.room, s.room_type AS roomType, s.academic_year_id
      FROM schedules s
      JOIN instructors i ON s.instructor_id = i.id
      WHERE s.id = ?
    `).get(id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/schedules", isAuthenticated, (req, res) => {
  db.prepare("DELETE FROM schedules").run();
  db.prepare("DELETE FROM instructors").run();
  console.log("All instructor schedules cleared");
  res.json({ deleted: true });
});


app.get("/api/student-schedules", isAuthenticated, (req, res) => {
  try {
    res.json(db.prepare(`
      SELECT id, section, subject, instructor, day,
             start_time AS start, end_time AS end,
             room, room_type AS roomType, academic_year_id
      FROM student_schedules
      ORDER BY section, day, start_time
    `).all());
  } catch { res.json([]); }
});

app.post("/api/student-schedules", isAuthenticated, (req, res) => {
  const { schedules, academicYearId } = req.body;
  if (!schedules?.length) return res.status(400).json({ error: "No schedules provided." });
  const ins = db.prepare(`
    INSERT INTO student_schedules
      (section, subject, instructor, day, start_time, end_time, room, room_type, academic_year_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(items => {
    for (const s of items)
      ins.run(s.section, s.subject, s.instructor || "", s.day,
              s.start, s.end, s.room, s.roomType || "Lecture", academicYearId || null);
  })(schedules);
  const total = db.prepare("SELECT COUNT(*) AS c FROM student_schedules").get().c;
  console.log(`Saved ${schedules.length} student block(s). DB total: ${total}`);
  res.json({ saved: schedules.length });
});

app.delete("/api/student-schedules", isAuthenticated, (req, res) => {
  db.prepare("DELETE FROM student_schedules").run();
  console.log("All student schedules cleared");
  res.json({ deleted: true });
});


app.post("/api/generate", isAuthenticated, (req, res) => {
  const type = req.body.type === "student" ? "student" : "instructor";

  if (type === "student") {
    const count = db.prepare("SELECT COUNT(*) AS c FROM student_schedules").get().c;
    if (count === 0)
      return res.status(400).json({ error: "No student schedules in database." });
    ensureLogos();
    exec(`${pythonCmd} generate_student.py`, { cwd: __dirname }, (error, stdout, stderr) => {
      if (error) {
        console.error("Python error:", stderr);
        return res.status(500).json({ error: stderr || error.message });
      }
      console.log("Student Excel generated");
      res.json({ message: "Generated successfully!" });
    });
  } else {
    const count = db.prepare("SELECT COUNT(*) AS c FROM schedules").get().c;
    if (count === 0)
      return res.status(400).json({ error: "No instructor schedules in database." });
    ensureLogos();
    exec(`${pythonCmd} generate.py`, { cwd: __dirname }, (error, stdout, stderr) => {
      if (error) {
        console.error("Python error:", stderr);
        return res.status(500).json({ error: stderr || error.message });
      }
      console.log("Instructor Excel generated");
      res.json({ message: "Generated successfully!" });
    });
  }
});


app.get("/api/download", isAuthenticated, (req, res) => {
  const type     = req.query.type === "student" ? "student" : "instructor";
  const filename = type === "student"
    ? "student_schedule_output.xlsx"
    : "schedule_output.xlsx";
  const label    = type === "student"
    ? "SmartSched_Student_Schedule.xlsx"
    : "SmartSched_Faculty_Schedule.xlsx";
  const file     = path.join(__dirname, filename);

  if (!fs.existsSync(file))
    return res.status(404).json({ error: "File not found. Please generate first." });

  
  res.setHeader("Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition",
    `attachment; filename="${label}"`);
  res.setHeader("Cache-Control", "no-cache");

  res.download(file, label, err => {
    if (err) console.error("Download error:", err.message);
  });
});


app.get("/logo-status", (req, res) => {
  const itOk  = fs.existsSync(path.join(__dirname, "IT.png"));
  const pccOk = fs.existsSync(path.join(__dirname, "pcc.png"));
  res.json({ "IT.png": itOk, "pcc.png": pccOk, ready: itOk && pccOk });
});

app.get("/db-status", (req, res) => {
  res.json({
    schedules:         db.prepare("SELECT COUNT(*) AS c FROM schedules").get().c,
    student_schedules: db.prepare("SELECT COUNT(*) AS c FROM student_schedules").get().c,
    instructors:       db.prepare("SELECT COUNT(*) AS c FROM instructors").get().c,
    academic_years:    db.prepare("SELECT COUNT(*) AS c FROM academic_years").get().c,
  });
});


seedAdminIfNeeded().then(() => {
  app.listen(5000, () => {
    const sc  = db.prepare("SELECT COUNT(*) AS c FROM schedules").get().c;
    const ssc = db.prepare("SELECT COUNT(*) AS c FROM student_schedules").get().c;
    const itOk  = fs.existsSync(path.join(__dirname, "IT.png"));
    const pccOk = fs.existsSync(path.join(__dirname, "pcc.png"));
    console.log("SmartSched backend running on http://localhost:5000");
    console.log(`Instructor schedules: ${sc} | Student schedules: ${ssc}`);
    console.log(`IT.png: ${itOk ? "FOUND" : "MISSING"}  pcc.png: ${pccOk ? "FOUND" : "MISSING"}`);
  });
});