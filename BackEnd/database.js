require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  host:     process.env.DB_HOST     || "localhost",
  port:     parseInt(process.env.DB_PORT) || 5432,
  user:     process.env.DB_USER     || "postgres",
  password: process.env.DB_PASSWORD || "SmartSched2025!",
  database: process.env.DB_NAME     || "postgres",
});

const CAPACITY = {
  instructors:              200,
  subjects_per_inst:         30,
  sections:                 100,
  total_schedule_blocks:   5000,
  student_schedule_blocks: 5000,
  academic_years:            20,
};

pool.schema = (deptCode) => {
  if (!deptCode) return "public";
  return deptCode.toLowerCase();
};

pool.query("SELECT NOW()").then(() => {
  console.log("PostgreSQL connected successfully.");
}).catch(err => {
  console.error("PostgreSQL connection failed:", err.message);
  process.exit(1);
});

module.exports = pool;
module.exports.CAPACITY = CAPACITY;