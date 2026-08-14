# Unified Multi-Dashboard Chat

## Overview
Users can ask questions across all Power BI dashboards in a single chat panel, without opening dashboards one-by-one.

## Architecture
**Serial Router**: Question → classify intent → identify relevant dashboards (fast tier, catalog only) → fetch snapshots → answer with full context.

### Key Benefits
- **Token Efficient**: Only fetches relevant dashboards, skipping irrelevant ones.
- **Multi-Turn**: Conversation history maintained per user, not per-dashboard.
- **Cross-Reference**: Answers show which dashboards were queried and why.
- **Drill-Down**: Users can ask for details and the same question is re-routed.

## Data Flow

```
User Question
    ↓
[Client] Classify Intent
    ↓
[Server] Dashboard Relevance Classifier (catalog only, ~1k tokens)
    ↓
[Dashboard IDs]
    ↓
[Client] Fetch Snapshots from Power BI (per dashboard_id)
    ↓
POST /api/ai/unified/ask { question, conversationId, snapshots }
    ↓
[Server] Merge Contexts + Call Gemini (tier-based)
    ↓
[Response] answer + dashboards_used + conversation_id
    ↓
Store in ai_unified_turns (per conversation)
```

## API Endpoints

### POST /api/ai/unified/ask
Ask a question across multiple dashboards.

**Request:**
```json
{
  "question": "bandingkan produksi vs defect minggu ini?",
  "conversationId": 42,
  "snapshots": [
    {
      "dashboard_id": 1,
      "snapshot": { "visuals": [...], "pagesRead": [0], ... }
    },
    {
      "dashboard_id": 2,
      "snapshot": { "visuals": [...], "pagesRead": [0], ... }
    }
  ]
}
```

**Response:**
```json
{
  "answer": "Produksi minggu ini... Sumber data: ...",
  "dashboards_used": [
    { "id": 1, "title": "Produksi Harian", "reason": "data dari Produksi Harian", "confidence": 1 }
  ],
  "conversation_id": 42,
  "turn_id": "42-1",
  "tokens": { "totalTokenCount": 3400 },
  "tier": "standar"
}
```

### GET /api/ai/unified/conversations
List all conversations for the user.

**Response:**
```json
{
  "conversations": [
    { "id": 42, "created_at": "2026-08-14T10:30:00Z", "updated_at": "2026-08-14T11:45:00Z" }
  ]
}
```

### GET /api/ai/unified/conversations/:id/turns
Get all turns from a conversation (history).

**Response:**
```json
{
  "turns": [
    {
      "turn_number": 1,
      "question": "berapa produksi hari ini?",
      "answer": "Produksi hari ini...",
      "dashboards_queried": [{ "id": 1, "title": "Produksi Harian" }],
      "created_at": "2026-08-14T10:30:00Z"
    }
  ]
}
```

### DELETE /api/ai/unified/conversations/:id
Clear conversation history.

## Frontend Integration

### Step 1: Collect Snapshots
Use existing `powerbiData.js` logic to capture snapshots from each relevant dashboard. The frontend knows which dashboards are open and can fetch their visuals on demand.

### Step 2: Call unifiedAsk
```javascript
import { askUnified } from '@/services/unifiedChatApi';

const result = await askUnified(
  "berapa total produksi minggu ini?",
  conversationId,
  [
    { dashboard_id: 1, snapshot: { visuals: [...], ... } },
    { dashboard_id: 2, snapshot: { visuals: [...], ... } }
  ]
);
```

### Step 3: Render Response
Use `UnifiedChatPanel` component which handles:
- Message history (user + assistant)
- Dashboard attribution cards
- Conversation persistence

## Performance Notes
- **Dashboard Relevance Classification**: ~1k tokens, fast tier (Gemini Flash)
- **Answer Generation**: Tier-based on question complexity (cepat/standar/mendalam)
- **Snapshot Merging**: Adaptive per-dashboard budgets (TIER_CHAR_BUDGET / num_dashboards)
- **Total Latency**: ~5-8 seconds end-to-end for typical 2-3 dashboard questions

## Token Budget (per tier)
- **Cepat**: 8,000 chars (simple lookups: "berapa total?")
- **Standar**: 18,000 chars (comparisons: "bandingkan Q3 vs Q4")
- **Mendalam**: 40,000 chars (root cause: "kenapa ada anomali?")

## Database Schema

**ai_unified_conversations**
```sql
id INT PRIMARY KEY
user_id INT (FK users.id)
created_at TIMESTAMP
updated_at TIMESTAMP
metadata JSON
```

**ai_unified_turns**
```sql
id INT PRIMARY KEY
conversation_id INT (FK ai_unified_conversations.id)
turn_number INT
question TEXT
dashboards_queried JSON
answer LONGTEXT
tokens_used JSON
created_at TIMESTAMP
UNIQUE(conversation_id, turn_number)
```

## Security
- Conversations owned by user_id — no cross-user leakage
- Dashboard access filtered server-side before answering (getCatalogForUser)
- Snapshots are user-captured (not fetched by server) — reduces attack surface
- Rate-limited per user (60s window, 10 requests max by default)

## Future Enhancements
- [ ] Parameter filtering (date ranges, departments) passed to Power BI
- [ ] Drill-down modal showing full details from a specific dashboard
- [ ] Voice input for questions
- [ ] Export conversation to PDF
- [ ] Scheduled reports based on unified chat queries
