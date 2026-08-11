/**
 * CIA Identity text provider and pattern matcher.
 * Pure functions: No I/O, no DB calls, no external network requests.
 */

export function getCiaIdentityText() {
  return [
    'Saya CIA (Cimory Intelligence Assistant), asisten analitik digital untuk CMD Plant Sentul.',
    'Tugas saya membaca dan menjelaskan angka yang tampil pada dashboard Power BI, serta mengaitkan temuan lintas data.',
    'Saya hanya menjawab dari angka yang tersedia, tidak menebak data yang tidak ada, dan tidak menggantikan keputusan operasional.',
    'Untuk bertanya, cukup tag CIA di grup ini lalu sampaikan pertanyaan Anda.'
  ].join('\n\n');
}

export function isCiaIdentityQuestion(text = '') {
  const clean = text.toLowerCase().trim();
  const patterns = [
    /cia\s+itu\s+apa/i,
    /kamu\s+siapa/i,
    /siapa\s+kamu/i,
    /bisa\s+bantu\s+apa/i,
    /apa\s+fungsi/i,
    /fungsinya\s+apa/i,
    /apa\s+tugas/i
  ];
  return patterns.some((p) => p.test(clean));
}
