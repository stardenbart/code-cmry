import { askGemini } from '../config/gemini.js';

/**
 * Given a user question and their accessible dashboards, determine which
 * dashboards are relevant to answer the question.
 *
 * Uses a lightweight Gemini call with catalog only (no data) — fast tier.
 *
 * Kuncinya WAJIB dioper dari controller lewat resolveKey, tidak diambil sendiri
 * di sini: kunci milik user selalu didahulukan atas kunci universal, dan aturan
 * itu hanya diketahui resolveKey. Versi sebelumnya memanggil askGemini tanpa
 * apiKey sama sekali, jadi setiap klasifikasi jatuh ke classifier_error dan
 * saran dashboard SELALU kosong tanpa satu pun pesan galat sampai ke user.
 *
 * @param {string} question - User's question in Indonesian
 * @param {Array} userDashboards - [{ id, title, department, description, hasAccess }]
 * @param {string} apiKey - kunci Gemini hasil resolveKey
 * @returns {Promise<{ dashboards: [{id, title, reason, confidence}], routerDecision: string }>}
 */
export async function classifyRelevantDashboards(question, userDashboards, apiKey) {
  if (!apiKey) return { dashboards: [], routerDecision: 'no_api_key' };
  if (!Array.isArray(userDashboards) || userDashboards.length === 0) {
    return { dashboards: [], routerDecision: 'no_dashboards_available' };
  }

  // Filter: only dashboards user can access
  const accessible = userDashboards.filter(d => d.hasAccess);
  if (accessible.length === 0) {
    return { dashboards: [], routerDecision: 'no_accessible_dashboards' };
  }

  // Build catalog for classifier prompt
  const catalogLines = ['=== KATALOG DASHBOARD CODE ==='];
  const byDept = new Map();
  for (const d of accessible) {
    if (!byDept.has(d.department)) byDept.set(d.department, []);
    byDept.get(d.department).push(d);
  }
  for (const [dept, items] of byDept) {
    catalogLines.push(`\n## ${dept}`);
    for (const d of items) {
      const desc = (d.description || '').replace(/<[^>]*>/g, ' ').slice(0, 150);
      catalogLines.push(`- [id:${d.id}] ${d.title}: ${desc}`);
    }
  }

  const catalog = catalogLines.join('\n');

  // Classifier prompt
  const systemPrompt = `Kamu adalah router dashboard untuk platform CODE.
Diberikan pertanyaan user dan katalog dashboard, tentukan dashboard mana yang PERLU DIAKSES untuk menjawab.

ATURAN:
1. Hanya sebutkan dashboard yang BENAR-BENAR RELEVAN. Jangan sebutkan dashboard "mungkin berguna".
2. Outputmu WAJIB JSON valid, tanpa markdown fence, tanpa teks lain.
3. Field "confidence" adalah angka 0-1 menunjukkan seberapa yakin dashboard ini relevan.
4. Field "reason" jelaskan singkat (satu kalimat) kenapa dashboard ini cocok untuk menjawab pertanyaan.
5. Jika ada pertanyaan lookup sederhana (berapa, siapa, kapan) fokus pada data yang paling spesifik.
6. Jika ada pertanyaan perbandingan, return semua dashboard yang diperlukan untuk perbandingan itu.
7. Jika tidak ada dashboard yang relevan, return array kosong.`;

  const userMessage = `Pertanyaan user: "${question}"

${catalog}

Berikan dashboard mana saja (dari katalog di atas) yang perlu diakses untuk menjawab pertanyaan ini. Format: JSON array dengan struktur [{ "id": number, "title": string, "reason": string, "confidence": number }]`;

  try {
    const { text } = await askGemini({
      apiKey,
      systemInstruction: systemPrompt,
      question: userMessage,
    });

    // Parse JSON from response
    let parsed = [];
    try {
      const jsonMatch = String(text || '').match(/\[\s*{[\s\S]*}\s*\]/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      }
    } catch {
      // Fallback: if parsing fails, return empty
      return { dashboards: [], routerDecision: 'parse_error' };
    }

    // Validate: ensure all ids exist in accessible dashboards
    const validDashboards = parsed.filter(d => {
      const dashboard = accessible.find(x => x.id === d.id);
      return dashboard && typeof d.confidence === 'number' && d.confidence > 0;
    });

    // Sort by confidence descending
    validDashboards.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

    return {
      dashboards: validDashboards,
      routerDecision: validDashboards.length > 0 ? 'success' : 'no_relevant_dashboards',
    };
  } catch (error) {
    console.error('dashboardRelevanceClassifier error:', error);
    return { dashboards: [], routerDecision: 'classifier_error', error: error.message };
  }
}
