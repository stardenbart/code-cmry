import db from '../config/db.js';

const sql = db.promise();

/**
 * Create a new unified conversation for a user.
 */
export async function createConversation(userId) {
  const [result] = await sql.query(
    'INSERT INTO ai_unified_conversations (user_id, metadata) VALUES (?, ?)',
    [userId, JSON.stringify({ initiated_at: new Date().toISOString() })]
  );
  return {
    id: result.insertId,
    user_id: userId,
    created_at: new Date(),
  };
}

/**
 * Add a turn (question + answer) to a conversation.
 */
export async function addTurn(conversationId, turnNumber, question, dashboards, answer, tokenCounts) {
  const [result] = await sql.query(
    `INSERT INTO ai_unified_turns
     (conversation_id, turn_number, question, dashboards_queried, answer, tokens_used)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      conversationId,
      turnNumber,
      question,
      JSON.stringify(dashboards),
      answer,
      JSON.stringify(tokenCounts),
    ]
  );
  return {
    id: result.insertId,
    turn_number: turnNumber,
  };
}

/**
 * Get the last N turns from a conversation (for context building).
 */
export async function getTurns(conversationId, limit = 6) {
  const [rows] = await sql.query(
    `SELECT turn_number, question, answer, dashboards_queried, created_at
     FROM ai_unified_turns
     WHERE conversation_id = ?
     ORDER BY turn_number ASC
     LIMIT ?`,
    [conversationId, limit]
  );

  return rows.map(row => ({
    turn_number: row.turn_number,
    question: row.question,
    answer: row.answer,
    dashboards_queried: row.dashboards_queried ? JSON.parse(row.dashboards_queried) : [],
    created_at: row.created_at,
  }));
}

/**
 * Clear all turns from a conversation.
 */
export async function clearConversation(conversationId) {
  await sql.query(
    'DELETE FROM ai_unified_turns WHERE conversation_id = ?',
    [conversationId]
  );
}

/**
 * Get conversation metadata by ID.
 */
export async function getConversation(conversationId, userId) {
  const [rows] = await sql.query(
    `SELECT id, user_id, created_at, updated_at, metadata
     FROM ai_unified_conversations
     WHERE id = ? AND user_id = ?`,
    [conversationId, userId]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    user_id: row.user_id,
    created_at: row.created_at,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
  };
}

/**
 * List all conversations for a user.
 */
export async function getUserConversations(userId, limit = 10) {
  const [rows] = await sql.query(
    `SELECT id, created_at, updated_at
     FROM ai_unified_conversations
     WHERE user_id = ?
     ORDER BY updated_at DESC
     LIMIT ?`,
    [userId, limit]
  );
  return rows;
}
