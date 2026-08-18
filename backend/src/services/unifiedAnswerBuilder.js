/**
 * Format a unified chat answer with attribution to source dashboards.
 *
 * @param {string} answer - The answer text from Gemini
 * @param {Array} dashboards - [{ id, title, reason, confidence }]
 * @param {object} historyContext - (reserved for future: summary of previous turns)
 * @returns {{ formatted_answer: string, dashboard_refs: Array }}
 */
export function formatUnifiedAnswer(answer, dashboards, historyContext = null) {
  const refs = dashboards.map(d => ({
    id: d.id,
    title: d.title,
    reason: d.reason || '',
    confidence: d.confidence || 1,
  }));

  let formatted = answer;

  // Add source attribution footer
  if (refs.length > 0) {
    formatted += '\n\n---\n**Sumber data:**\n';
    refs.forEach((ref) => {
      formatted += `- ${ref.title}`;
      if (ref.reason) formatted += ` (${ref.reason})`;
      formatted += '\n';
    });
  } else {
    formatted += '\n\n---\n*Tidak ada data dashboard yang digunakan untuk pertanyaan ini.*\n';
  }

  return {
    formatted_answer: formatted,
    dashboard_refs: refs,
  };
}
