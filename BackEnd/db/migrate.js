#!/usr/bin/env node
/**
 * Apply SmartSched schema (PKs + FKs).
 *
 *   node db/migrate.js          # safe: CREATE IF NOT EXISTS + repair orphans + add FKs
 *   node db/migrate.js --fresh  # DROP all dept data + public auth, then recreate
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const DEPTS = ["bsit", "crim", "bsba", "bshm", "bsed", "beed"];
const FRESH = process.argv.includes("--fresh");

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  user: process.env.DB_USER || "smartsched_user",
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "smartsched",
});

async function run(sql, label) {
  if (label) console.log(`→ ${label}`);
  await pool.query(sql);
}

async function dropDepartmentSchema(schema) {
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
}

async function repairOrphans(schema) {
  const s = schema;
  // Remove rows that would violate FKs before constraints are added
  await pool.query(`
    DELETE FROM ${s}.instructor_subjects isub
    WHERE NOT EXISTS (SELECT 1 FROM ${s}.instructors i WHERE i.id = isub.instructor_id)
  `);
  await pool.query(`
    DELETE FROM ${s}.instructor_assignments ia
    WHERE NOT EXISTS (SELECT 1 FROM ${s}.instructors i WHERE i.id = ia.instructor_id)
       OR NOT EXISTS (SELECT 1 FROM ${s}.subjects sub WHERE sub.id = ia.subject_id)
  `);
  await pool.query(`
    DELETE FROM ${s}.schedules sch
    WHERE NOT EXISTS (SELECT 1 FROM ${s}.instructors i WHERE i.id = sch.instructor_id)
  `);
  await pool.query(`
    UPDATE ${s}.schedules SET academic_year_id = NULL
    WHERE academic_year_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM ${s}.academic_years ay WHERE ay.id = schedules.academic_year_id)
  `);
  await pool.query(`
    UPDATE ${s}.student_schedules SET academic_year_id = NULL
    WHERE academic_year_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM ${s}.academic_years ay
        WHERE ay.id = student_schedules.academic_year_id
      )
  `);
  await pool.query(`
    UPDATE ${s}.student_schedules SET instructor_id = NULL
    WHERE instructor_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM ${s}.instructors i WHERE i.id = student_schedules.instructor_id)
  `);
  // Link student_schedules.instructor_id from name when possible
  await pool.query(`
    UPDATE ${s}.student_schedules ss
    SET instructor_id = i.id
    FROM ${s}.instructors i
    WHERE ss.instructor_id IS NULL
      AND ss.instructor_lower <> ''
      AND i.name_lower = ss.instructor_lower
  `);
  await pool.query(`
    DELETE FROM public.local_auth la
    WHERE la.department_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.departments d WHERE d.id = la.department_id)
  `);
}

async function ensureStudentInstructorIdColumn(schema) {
  const col = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = 'student_schedules' AND column_name = 'instructor_id'`,
    [schema]
  );
  if (col.rows.length === 0) {
    await pool.query(`ALTER TABLE ${schema}.student_schedules ADD COLUMN instructor_id INTEGER`);
  }
}

async function main() {
  console.log("SmartSched database migration");
  console.log(`Mode: ${FRESH ? "FRESH (destructive)" : "upgrade (safe)"}\n`);

  if (FRESH) {
    for (const d of DEPTS) await dropDepartmentSchema(d);
    await run(`DROP TABLE IF EXISTS public.local_auth CASCADE`, "drop local_auth");
    await run(`DROP TABLE IF EXISTS public.departments CASCADE`, "drop departments");
  }

  const schemaSql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await run(schemaSql, "apply schema.sql");

  const constraintsSql = fs.readFileSync(path.join(__dirname, "constraints.sql"), "utf8");
  await run(constraintsSql, "apply constraints.sql");

  for (const d of DEPTS) {
    await ensureStudentInstructorIdColumn(d);
    await repairOrphans(d);
    console.log(`✓ repaired orphans in ${d}`);
  }
  await repairOrphans("public");

  console.log("\nDone. All department schemas use PRIMARY KEY + FOREIGN KEY constraints.");
  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
