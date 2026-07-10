require("dotenv").config();
const { Client } = require("pg");

const client = new Client({
  connectionString: `postgresql://postgres.vnkyvizpyrsqarhcnkyo:${process.env.DB_PASSWORD}@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});

client.connect()
  .then(() => {
    console.log("✅ Connected!");
    return client.query("SELECT NOW()");
  })
  .then(r => {
    console.log("Time:", r.rows[0].now);
    client.end();
  })
  .catch(err => {
    console.error("❌ Failed:", err.message);
    console.error("Code:", err.code);
  });