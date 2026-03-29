const Database = require("better-sqlite3");
const path     = require("path");

// On Linux the DB lives next to server.js — no drive-letter issues
const DB_PATH = path.join(__dirname, "smartsched.db");
const db      = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS academic_years (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    year     TEXT    NOT NULL,
    semester TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS instructors (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT    NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS admins (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name  TEXT
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    instructor_id    INTEGER NOT NULL,
    subject          TEXT    NOT NULL,
    section          TEXT    NOT NULL DEFAULT '',
    day              TEXT    NOT NULL,
    start_time       INTEGER NOT NULL,
    end_time         INTEGER NOT NULL,
    room             TEXT    NOT NULL,
    room_type        TEXT    NOT NULL DEFAULT 'Lecture',
    academic_year_id INTEGER,
    FOREIGN KEY (instructor_id)    REFERENCES instructors(id),
    FOREIGN KEY (academic_year_id) REFERENCES academic_years(id)
  );

  CREATE TABLE IF NOT EXISTS student_schedules (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    section          TEXT    NOT NULL,
    subject          TEXT    NOT NULL,
    instructor       TEXT    NOT NULL DEFAULT '',
    day              TEXT    NOT NULL,
    start_time       INTEGER NOT NULL,
    end_time         INTEGER NOT NULL,
    room             TEXT    NOT NULL,
    room_type        TEXT    NOT NULL DEFAULT 'Lecture',
    academic_year_id INTEGER,
    FOREIGN KEY (academic_year_id) REFERENCES academic_years(id)
  );

  CREATE TABLE IF NOT EXISTS local_auth (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    email                TEXT    NOT NULL UNIQUE,
    name                 TEXT    NOT NULL DEFAULT 'Admin',
    pin_hash             TEXT    NOT NULL,
    pass_hash            TEXT    NOT NULL,
    failed_pin_attempts  INTEGER NOT NULL DEFAULT 0,
    failed_pass_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until         INTEGER NOT NULL DEFAULT 0
  );
`);

const migrations = [
  "ALTER TABLE schedules ADD COLUMN section TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE local_auth ADD COLUMN failed_pin_attempts  INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE local_auth ADD COLUMN failed_pass_attempts INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE local_auth ADD COLUMN locked_until         INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE student_schedules ADD COLUMN instructor       TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE student_schedules ADD COLUMN academic_year_id INTEGER",
];
for (const sql of migrations) {
  try { db.exec(sql); } catch (_) { }
}

module.exports = db;