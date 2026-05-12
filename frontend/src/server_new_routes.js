/* ══════════════════════════════════════════════════════════════════
   ADD THESE ROUTES TO server.js
   Place them BEFORE the "START" section (before app.listen)
   ══════════════════════════════════════════════════════════════════ */

/* ══════════════════════════ SUPERADMIN — ALL-DEPT DATA VIEWS ════════════════ */

// All instructor schedules across ALL departments (superadmin only)
app.get("/api/superadmin/schedules", isAuthenticated, isSuperAdmin, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        s.id,
        i.name       AS instructor,
        s.subject,
        s.section,
        s.day,
        s.start_time AS start,
        s.end_time   AS end,
        s.room,
        s.room_type  AS roomType,
        s.is_break,
        s.academic_year_id,
        s.department_id,
        d.code       AS dept_code,
        d.name       AS dept_name
      FROM schedules s
      JOIN instructors i ON s.instructor_id = i.id
      LEFT JOIN departments d ON s.department_id = d.id
      ORDER BY d.code, i.name COLLATE NOCASE, s.day, s.start_time
    `).all();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// All student schedules across ALL departments (superadmin only)
app.get("/api/superadmin/student-schedules", isAuthenticated, isSuperAdmin, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        ss.id,
        ss.section,
        ss.subject,
        ss.instructor,
        ss.day,
        ss.start_time AS start,
        ss.end_time   AS end,
        ss.room,
        ss.room_type  AS roomType,
        ss.is_break,
        ss.academic_year_id,
        ss.department_id,
        d.code        AS dept_code,
        d.name        AS dept_name
      FROM student_schedules ss
      LEFT JOIN departments d ON ss.department_id = d.id
      ORDER BY d.code, ss.section, ss.day, ss.start_time
    `).all();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// All instructors across ALL departments with subject counts (superadmin only)
app.get("/api/superadmin/instructors", isAuthenticated, isSuperAdmin, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        i.id,
        i.name,
        i.department,
        i.email,
        i.department_id,
        d.code  AS dept_code,
        d.name  AS dept_name,
        COUNT(DISTINCT subj.id) AS subject_count
      FROM instructors i
      LEFT JOIN departments d ON i.department_id = d.id
      LEFT JOIN instructor_subjects subj ON subj.instructor_id = i.id
      GROUP BY i.id
      ORDER BY d.code, i.name COLLATE NOCASE
    `).all();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});