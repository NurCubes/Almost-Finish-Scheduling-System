-- SmartSched canonical PostgreSQL schema
-- Run: node db/migrate.js
-- Fresh install: node db/migrate.js --fresh

-- ═══════════════════════════════════════════════════════════════════════════
-- PUBLIC (shared across departments)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.departments (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(16)  NOT NULL,
  name        VARCHAR(255) NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT departments_code_lower_chk CHECK (code = lower(code)),
  CONSTRAINT departments_code_unique UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS public.local_auth (
  id                   SERIAL PRIMARY KEY,
  email                VARCHAR(255) NOT NULL,
  name                 VARCHAR(255) NOT NULL,
  pin_hash             VARCHAR(255) NOT NULL,
  pass_hash            VARCHAR(255) NOT NULL,
  role                 VARCHAR(32)  NOT NULL DEFAULT 'dept_admin',
  department_id        INTEGER,
  failed_pin_attempts  INTEGER      NOT NULL DEFAULT 0,
  failed_pass_attempts INTEGER      NOT NULL DEFAULT 0,
  locked_until         BIGINT       NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT local_auth_email_unique UNIQUE (email),
  CONSTRAINT local_auth_role_chk CHECK (role IN ('superadmin', 'dept_admin')),
  CONSTRAINT local_auth_department_fk
    FOREIGN KEY (department_id) REFERENCES public.departments (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT local_auth_dept_admin_requires_dept_chk CHECK (
    role = 'superadmin' OR department_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_local_auth_department_id
  ON public.local_auth (department_id);

-- Seed departments (idempotent)
INSERT INTO public.departments (code, name) VALUES
  ('bsit', 'Bachelor of Science in Information Technology'),
  ('crim', 'Bachelor of Science in Criminology'),
  ('bsba', 'Bachelor of Science in Business Administration'),
  ('bshm', 'Bachelor of Science in Hospitality Management'),
  ('bsed', 'Bachelor of Secondary Education'),
  ('beed', 'Bachelor of Elementary Education')
ON CONFLICT (code) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- Per-department schema (bsit, crim, bsba, bshm, bsed, beed)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION smartsched_create_department_schema(p_schema TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', p_schema);

  -- academic_years
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %I.academic_years (
      id         SERIAL PRIMARY KEY,
      year       VARCHAR(32)  NOT NULL,
      semester   VARCHAR(32)  NOT NULL,
      created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      CONSTRAINT academic_years_year_semester_unique UNIQUE (year, semester)
    )
  $sql$, p_schema);

  -- instructors
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %I.instructors (
      id               SERIAL PRIMARY KEY,
      name             VARCHAR(255) NOT NULL,
      name_lower       VARCHAR(255) NOT NULL,
      department       VARCHAR(64)  NOT NULL DEFAULT 'ICT',
      email            VARCHAR(255) NOT NULL DEFAULT '',
      employment_type  VARCHAR(32)  NOT NULL DEFAULT 'Permanent',
      active_semesters VARCHAR(32)  NOT NULL DEFAULT 'Both',
      created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      CONSTRAINT instructors_name_unique UNIQUE (name),
      CONSTRAINT instructors_name_lower_unique UNIQUE (name_lower),
      CONSTRAINT instructors_employment_type_chk CHECK (
        employment_type IN ('Permanent', 'Part-Time', 'Contractual')
      ),
      CONSTRAINT instructors_active_semesters_chk CHECK (
        active_semesters IN ('1st Semester', '2nd Semester', 'Both')
      )
    )
  $sql$, p_schema);

  -- subjects (catalog)
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %I.subjects (
      id                  SERIAL PRIMARY KEY,
      subject_name        VARCHAR(255) NOT NULL,
      subject_code        VARCHAR(64),
      subject_description TEXT         NOT NULL DEFAULT '',
      subject_type        VARCHAR(32)  NOT NULL DEFAULT 'Major',
      semester            VARCHAR(32)  NOT NULL DEFAULT '1st Semester',
      year_level          SMALLINT     NOT NULL DEFAULT 1,
      units               SMALLINT     NOT NULL DEFAULT 3,
      created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      CONSTRAINT subjects_name_unique UNIQUE (subject_name),
      CONSTRAINT subjects_code_unique UNIQUE (subject_code),
      CONSTRAINT subjects_type_chk CHECK (
        subject_type IN ('Major', 'Minor', 'GE', 'Elective')
      ),
      CONSTRAINT subjects_year_level_chk CHECK (year_level BETWEEN 1 AND 6),
      CONSTRAINT subjects_units_chk CHECK (units BETWEEN 1 AND 12)
    )
  $sql$, p_schema);

  -- legacy free-text subjects per instructor (registration UI)
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %I.instructor_subjects (
      id             SERIAL PRIMARY KEY,
      instructor_id  INTEGER      NOT NULL,
      subject_name   VARCHAR(255) NOT NULL,
      subject_lower  VARCHAR(255) NOT NULL,
      created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      CONSTRAINT instructor_subjects_instructor_fk
        FOREIGN KEY (instructor_id) REFERENCES %I.instructors (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT instructor_subjects_instructor_subject_unique
        UNIQUE (instructor_id, subject_lower)
    )
  $sql$, p_schema, p_schema);

  -- instructor ↔ subject catalog assignments
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %I.instructor_assignments (
      id             SERIAL PRIMARY KEY,
      instructor_id  INTEGER      NOT NULL,
      subject_id     INTEGER      NOT NULL,
      semester       VARCHAR(32)  NOT NULL,
      created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      CONSTRAINT instructor_assignments_instructor_fk
        FOREIGN KEY (instructor_id) REFERENCES %I.instructors (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT instructor_assignments_subject_fk
        FOREIGN KEY (subject_id) REFERENCES %I.subjects (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT instructor_assignments_unique
        UNIQUE (instructor_id, subject_id, semester)
    )
  $sql$, p_schema, p_schema, p_schema);

  -- faculty schedule blocks
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %I.schedules (
      id                SERIAL PRIMARY KEY,
      instructor_id     INTEGER        NOT NULL,
      academic_year_id  INTEGER,
      subject           VARCHAR(255)   NOT NULL,
      section           VARCHAR(64)    NOT NULL DEFAULT '',
      day               VARCHAR(16)    NOT NULL,
      start_time        NUMERIC(4,1)   NOT NULL,
      end_time          NUMERIC(4,1)   NOT NULL,
      room              VARCHAR(64)    NOT NULL,
      room_type         VARCHAR(32)    NOT NULL DEFAULT 'Lecture',
      is_break          BOOLEAN        NOT NULL DEFAULT FALSE,
      created_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
      CONSTRAINT schedules_instructor_fk
        FOREIGN KEY (instructor_id) REFERENCES %I.instructors (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT schedules_academic_year_fk
        FOREIGN KEY (academic_year_id) REFERENCES %I.academic_years (id)
        ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT schedules_time_order_chk CHECK (start_time < end_time),
      CONSTRAINT schedules_room_type_chk CHECK (
        room_type IN ('Lecture', 'Laboratory', 'Break')
      ),
      CONSTRAINT schedules_day_chk CHECK (
        day IN ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')
      )
    )
  $sql$, p_schema, p_schema, p_schema);

  -- student schedule blocks
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %I.student_schedules (
      id                SERIAL PRIMARY KEY,
      academic_year_id  INTEGER,
      instructor_id     INTEGER,
      section           VARCHAR(64)    NOT NULL,
      subject           VARCHAR(255)   NOT NULL,
      instructor        VARCHAR(255)   NOT NULL DEFAULT '',
      instructor_lower  VARCHAR(255)   NOT NULL DEFAULT '',
      day               VARCHAR(16)    NOT NULL,
      start_time        NUMERIC(4,1)   NOT NULL,
      end_time          NUMERIC(4,1)   NOT NULL,
      room              VARCHAR(64)    NOT NULL,
      room_type         VARCHAR(32)    NOT NULL DEFAULT 'Lecture',
      is_break          BOOLEAN        NOT NULL DEFAULT FALSE,
      created_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
      CONSTRAINT student_schedules_academic_year_fk
        FOREIGN KEY (academic_year_id) REFERENCES %I.academic_years (id)
        ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT student_schedules_instructor_fk
        FOREIGN KEY (instructor_id) REFERENCES %I.instructors (id)
        ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT student_schedules_time_order_chk CHECK (start_time < end_time),
      CONSTRAINT student_schedules_room_type_chk CHECK (
        room_type IN ('Lecture', 'Laboratory', 'Break')
      ),
      CONSTRAINT student_schedules_day_chk CHECK (
        day IN ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')
      )
    )
  $sql$, p_schema, p_schema, p_schema);

  -- Indexes for FK columns and common filters
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_schedules_instructor ON %I.schedules (instructor_id)', p_schema, p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_schedules_academic_year ON %I.schedules (academic_year_id)', p_schema, p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_student_schedules_section ON %I.student_schedules (section)', p_schema, p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_student_schedules_instructor ON %I.student_schedules (instructor_id)', p_schema, p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_instructor_assignments_instructor ON %I.instructor_assignments (instructor_id)', p_schema, p_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_instructor_assignments_subject ON %I.instructor_assignments (subject_id)', p_schema, p_schema);
END;
$$;

SELECT smartsched_create_department_schema('bsit');
SELECT smartsched_create_department_schema('crim');
SELECT smartsched_create_department_schema('bsba');
SELECT smartsched_create_department_schema('bshm');
SELECT smartsched_create_department_schema('bsed');
SELECT smartsched_create_department_schema('beed');
