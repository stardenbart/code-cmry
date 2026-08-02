import mysql from "mysql2";
import { DB_CONFIG } from "./config.js";

const db = mysql.createConnection(DB_CONFIG);

db.connect((err) => {
  if (err) {
    console.error("❌ Database connection failed:", err);
  } else {
    console.log("✅ MySQL Connected (Central of Digitalization)");
  }
});

export default db;
