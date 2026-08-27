// Legacy CIA telemetry backfill: dry-run safety, token mapping, and idempotency.
import { pathToFileURL } from "url";
import { ok, section, summary } from "./harness.mjs";
import db from "../src/config/db.js";
import {
  backfillChatLogs,
  backfillUnifiedTurns,
  mapUnifiedTokens,
} from "../scripts/backfill-cia-telemetry.mjs";

const sql = db.promise();

section("Token unified lama dipetakan tanpa mengarang rinciannya");

ok("format provider Gemini memisahkan input/output/total",
  JSON.stringify(mapUnifiedTokens({
    promptTokenCount: 7,
    candidatesTokenCount: 4,
    totalTokenCount: 11,
  })) === JSON.stringify({ input: 7, output: 4, total: 11 }));
ok("format historis classifier+gemini hanya membawa total yang tersedia",
  JSON.stringify(mapUnifiedTokens({ classifier: 2, gemini: 13 })) ===
    JSON.stringify({ input: 0, output: 0, total: 15 }));

section("Dry-run tidak menulis; apply dua kali tetap satu request per log");

let chatId = null;
let conversationId = null;
let turnId = null;

try {
  const [[user]] = await sql.query("SELECT id FROM users ORDER BY id LIMIT 1");
  ok("ada user untuk foreign key fixture", Boolean(user?.id));
  if (!user?.id) throw new Error("Fixture backfill membutuhkan minimal satu user");

  const marker = `cia-backfill-${Date.now()}`;
  const [chat] = await sql.query(
    `INSERT INTO ai_chat_logs
       (user_id, question, answer, model, prompt_tokens, output_tokens, total_tokens)
     VALUES (?, ?, 'jawaban fixture', 'fixture', 10, 5, 15)`,
    [user.id, `${marker}-dashboard`]
  );
  chatId = chat.insertId;

  const [conversation] = await sql.query(
    `INSERT INTO ai_unified_conversations (user_id, judul, metadata)
     VALUES (?, ?, JSON_OBJECT('fixture', true))`,
    [user.id, marker]
  );
  conversationId = conversation.insertId;

  const [turn] = await sql.query(
    `INSERT INTO ai_unified_turns
       (conversation_id, turn_number, question, dashboards_queried, answer, tokens_used)
     VALUES (?, 1, ?, JSON_ARRAY(), 'jawaban fixture', ?)`,
    [conversationId, `${marker}-multi`, JSON.stringify({
      promptTokenCount: 7,
      candidatesTokenCount: 4,
      totalTokenCount: 11,
    })]
  );
  turnId = turn.insertId;

  const chatDry = await backfillChatLogs(false, { restrictIds: [chatId] });
  const unifiedDry = await backfillUnifiedTurns(false, { restrictIds: [turnId] });
  const [[beforeApply]] = await sql.query(
    `SELECT COUNT(*) AS n FROM cia_requests
      WHERE (legacy_source = 'ai_chat_logs' AND legacy_id = ?)
         OR (legacy_source = 'ai_unified_turns' AND legacy_id = ?)`,
    [String(chatId), String(turnId)]
  );
  ok("dry-run menemukan kedua kandidat", chatDry.candidates === 1 && unifiedDry.candidates === 1);
  ok("dry-run tidak menulis cia_requests", Number(beforeApply.n) === 0, String(beforeApply.n));

  const chatFirst = await backfillChatLogs(true, { restrictIds: [chatId] });
  const unifiedFirst = await backfillUnifiedTurns(true, { restrictIds: [turnId] });
  const chatSecond = await backfillChatLogs(true, { restrictIds: [chatId] });
  const unifiedSecond = await backfillUnifiedTurns(true, { restrictIds: [turnId] });
  ok("apply pertama memasukkan dua request", chatFirst.inserted === 1 && unifiedFirst.inserted === 1,
    `${chatFirst.inserted}/${unifiedFirst.inserted}`);
  ok("apply kedua tidak menghitung duplicate sebagai insert",
    chatSecond.inserted === 0 && unifiedSecond.inserted === 0,
    `${chatSecond.inserted}/${unifiedSecond.inserted}`);

  const [requests] = await sql.query(
    `SELECT legacy_source, surface, input_tokens, output_tokens, total_tokens
       FROM cia_requests
      WHERE (legacy_source = 'ai_chat_logs' AND legacy_id = ?)
         OR (legacy_source = 'ai_unified_turns' AND legacy_id = ?)
      ORDER BY legacy_source`,
    [String(chatId), String(turnId)]
  );
  ok("tepat dua request legacy tersimpan", requests.length === 2, String(requests.length));
  const dashboard = requests.find((x) => x.legacy_source === "ai_chat_logs");
  const multi = requests.find((x) => x.legacy_source === "ai_unified_turns");
  ok("chat dashboard menyimpan token 10/5/15",
    dashboard?.surface === "dashboard" &&
    Number(dashboard.input_tokens) === 10 && Number(dashboard.output_tokens) === 5 &&
    Number(dashboard.total_tokens) === 15);
  ok("multi-chat menyimpan token 7/4/11",
    multi?.surface === "multi_chat" &&
    Number(multi.input_tokens) === 7 && Number(multi.output_tokens) === 4 &&
    Number(multi.total_tokens) === 11);
} finally {
  if (chatId != null || turnId != null) {
    await sql.query(
      `DELETE FROM cia_requests
        WHERE (legacy_source = 'ai_chat_logs' AND legacy_id = ?)
           OR (legacy_source = 'ai_unified_turns' AND legacy_id = ?)`,
      [String(chatId), String(turnId)]
    );
  }
  if (chatId != null) await sql.query("DELETE FROM ai_chat_logs WHERE id = ?", [chatId]);
  if (conversationId != null) {
    // ai_unified_turns follows via ON DELETE CASCADE.
    await sql.query("DELETE FROM ai_unified_conversations WHERE id = ?", [conversationId]);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(summary() ? 0 : 1);
}
