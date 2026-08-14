const API_BASE = '/api/ai/unified';

export async function askUnified(question, conversationId = null, snapshots = []) {
  const response = await fetch(`${API_BASE}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, conversationId, snapshots }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `API error: ${response.status}`);
  }

  return response.json();
}

export async function getConversations() {
  const response = await fetch(`${API_BASE}/conversations`);
  if (!response.ok) throw new Error(`Failed to load conversations`);
  return response.json();
}

export async function getConversationTurns(conversationId) {
  const response = await fetch(`${API_BASE}/conversations/${conversationId}/turns`);
  if (!response.ok) throw new Error(`Failed to load conversation`);
  return response.json();
}

export async function deleteConversation(conversationId) {
  const response = await fetch(`${API_BASE}/conversations/${conversationId}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error(`Failed to delete conversation`);
  return response.json();
}
