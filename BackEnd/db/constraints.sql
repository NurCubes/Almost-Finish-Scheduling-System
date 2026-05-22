-- Add FK/PK constraints to existing tables (idempotent via DO blocks)

CREATE OR REPLACE FUNCTION smartsched_ensure_department_constraints(p_schema TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  -- instructor_subjects → instructors
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = p_schema AND t.relname = 'instructor_subjects'
      AND c.conname = 'instructor_subjects_instructor_fk'
  ) THEN
    EXECUTE format($sql$
      ALTER TABLE %I.instructor_subjects
        ADD CONSTRAINT instructor_subjects_instructor_fk
        FOREIGN KEY (instructor_id) REFERENCES %I.instructors (id)
        ON DELETE CASCADE ON UPDATE CASCADE
    $sql$, p_schema, p_schema);
  END IF;

  -- instructor_assignments → instructors, subjects
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = p_schema AND t.relname = 'instructor_assignments'
      AND c.conname = 'instructor_assignments_instructor_fk'
  ) THEN
    EXECUTE format($sql$
      ALTER TABLE %I.instructor_assignments
        ADD CONSTRAINT instructor_assignments_instructor_fk
        FOREIGN KEY (instructor_id) REFERENCES %I.instructors (id)
        ON DELETE CASCADE ON UPDATE CASCADE
    $sql$, p_schema, p_schema);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = p_schema AND t.relname = 'instructor_assignments'
      AND c.conname = 'instructor_assignments_subject_fk'
  ) THEN
    EXECUTE format($sql$
      ALTER TABLE %I.instructor_assignments
        ADD CONSTRAINT instructor_assignments_subject_fk
        FOREIGN KEY (subject_id) REFERENCES %I.subjects (id)
        ON DELETE RESTRICT ON UPDATE CASCADE
    $sql$, p_schema, p_schema);
  END IF;

  -- schedules → instructors, academic_years
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = p_schema AND t.relname = 'schedules'
      AND c.conname = 'schedules_instructor_fk'
  ) THEN
    EXECUTE format($sql$
      ALTER TABLE %I.schedules
        ADD CONSTRAINT schedules_instructor_fk
        FOREIGN KEY (instructor_id) REFERENCES %I.instructors (id)
        ON DELETE CASCADE ON UPDATE CASCADE
    $sql$, p_schema, p_schema);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = p_schema AND t.relname = 'schedules'
      AND c.conname = 'schedules_academic_year_fk'
  ) THEN
    EXECUTE format($sql$
      ALTER TABLE %I.schedules
        ADD CONSTRAINT schedules_academic_year_fk
        FOREIGN KEY (academic_year_id) REFERENCES %I.academic_years (id)
        ON DELETE SET NULL ON UPDATE CASCADE
    $sql$, p_schema, p_schema);
  END IF;

  -- student_schedules → academic_years, instructors
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = p_schema AND table_name = 'student_schedules' AND column_name = 'instructor_id'
  ) THEN
    EXECUTE format('ALTER TABLE %I.student_schedules ADD COLUMN instructor_id INTEGER', p_schema);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = p_schema AND t.relname = 'student_schedules'
      AND c.conname = 'student_schedules_academic_year_fk'
  ) THEN
    EXECUTE format($sql$
      ALTER TABLE %I.student_schedules
        ADD CONSTRAINT student_schedules_academic_year_fk
        FOREIGN KEY (academic_year_id) REFERENCES %I.academic_years (id)
        ON DELETE SET NULL ON UPDATE CASCADE
    $sql$, p_schema, p_schema);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = p_schema AND t.relname = 'student_schedules'
      AND c.conname = 'student_schedules_instructor_fk'
  ) THEN
    EXECUTE format($sql$
      ALTER TABLE %I.student_schedules
        ADD CONSTRAINT student_schedules_instructor_fk
        FOREIGN KEY (instructor_id) REFERENCES %I.instructors (id)
        ON DELETE SET NULL ON UPDATE CASCADE
    $sql$, p_schema, p_schema);
  END IF;
END;
$$;

-- public.local_auth → departments
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'local_auth_department_fk'
  ) THEN
    ALTER TABLE public.local_auth
      ADD CONSTRAINT local_auth_department_fk
      FOREIGN KEY (department_id) REFERENCES public.departments (id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

SELECT smartsched_ensure_department_constraints('bsit');
SELECT smartsched_ensure_department_constraints('crim');
SELECT smartsched_ensure_department_constraints('bsba');
SELECT smartsched_ensure_department_constraints('bshm');
SELECT smartsched_ensure_department_constraints('bsed');
SELECT smartsched_ensure_department_constraints('beed');
