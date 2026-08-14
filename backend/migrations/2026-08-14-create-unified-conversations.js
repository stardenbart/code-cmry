// backend/migrations/2026-08-14-create-unified-conversations.js
export async function up(db) {
  await db.promise().query(`
    CREATE TABLE IF NOT EXISTS ai_unified_conversations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      metadata JSON,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX (user_id, created_at)
    )
  `);

  await db.promise().query(`
    CREATE TABLE IF NOT EXISTS ai_unified_turns (
      id INT AUTO_INCREMENT PRIMARY KEY,
      conversation_id INT NOT NULL,
      turn_number INT NOT NULL,
      question TEXT NOT NULL,
      dashboards_queried JSON,
      answer LONGTEXT NOT NULL,
      tokens_used JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES ai_unified_conversations(id) ON DELETE CASCADE,
      UNIQUE KEY (conversation_id, turn_number),
      INDEX (conversation_id, created_at)
    )
  `);
}

export async function down(db) {
  await db.promise().query(`DROP TABLE IF EXISTS ai_unified_turns`);
  await db.promise().query(`DROP TABLE IF EXISTS ai_unified_conversations`);
}