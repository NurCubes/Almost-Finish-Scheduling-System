# SmartSched database

PostgreSQL schema with proper **primary keys** and **foreign keys**.

## Entity relationships

```
public.departments (id PK)
    ↑
public.local_auth.department_id (FK, ON DELETE SET NULL)

Per department schema (bsit, crim, bsba, bshm, bsed, beed):

academic_years (id PK)
    ↑
schedules.academic_year_id (FK, ON DELETE SET NULL)
student_schedules.academic_year_id (FK, ON DELETE SET NULL)

instructors (id PK)
    ↑
instructor_subjects.instructor_id (FK, ON DELETE CASCADE)
instructor_assignments.instructor_id (FK, ON DELETE CASCADE)
schedules.instructor_id (FK, ON DELETE CASCADE)
student_schedules.instructor_id (FK, ON DELETE SET NULL)

subjects (id PK)
    ↑
instructor_assignments.subject_id (FK, ON DELETE RESTRICT)
```

## Commands

From `BackEnd/`:

```bash
# Safe upgrade (keeps data, fixes orphans, adds missing tables/constraints)
node db/migrate.js

# Wipe and recreate (destroys all schedule + auth data)
node db/migrate.js --fresh
```

Requires `.env` with `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.
