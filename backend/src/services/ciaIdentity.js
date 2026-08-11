/**
 * CIA Identity text provider and pattern matcher.
 * Pure functions: No I/O, no DB calls, no external network requests.
 */

export function getCiaIdentityText() {
  return [
    'Saya CIA (Cimory Intelligence Assistant), asisten analitik digital untuk CMD Plant Sentul.',
    'Tugas saya membaca dan menjelaskan angka yang tampil pada dashboard Power BI, serta mengaitkan temuan lintas data.',
    'Untuk menjaga keamanan data, informasi sensitif akan disamarkan atau dihilangkan terlebih dahulu sebelum diproses oleh AI. Hasil analisis juga akan melalui proses sanitasi data agar informasi yang bersifat sensitif tetap terlindungi.',
    'Saya hanya menjawab dari angka yang tersedia, tidak menebak data yang tidak ada, dan tidak menggantikan keputusan operasional.',
    'Untuk bertanya, cukup tag CIA di grup ini lalu sampaikan pertanyaan Anda.'
  ].join('\n\n');
}

export function isCiaIdentityQuestion(text = '') {
  // Dipanggil paling awal di tryAnswerLocally untuk SETIAP pertanyaan, jadi
  // masukan rusak (null, undefined, angka, dll) harus pulang false dengan
  // tenang, bukan melempar dan menjatuhkan jalur tanya jawab yang tidak ada
  // hubungannya dengan identitas.
  // Mention dibuang lebih dulu. Di grup, pesannya selalu diawali tag, dan tag
  // itu bisa berupa nomor ("@628...") atau nama tampilan yang mengandung spasi.
  // Tanpa dibuang, "@CIA Bot siapa kamu" tidak pernah cocok pola mana pun.
  const clean = String(text ?? '')
    .replace(/@\S+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  // Sengaja SEMPIT. Pola yang terlalu lebar akan menyahut pertanyaan data:
  // "apa penyebab downtime" dan "apa saja kendala produksi hari ini" keduanya
  // diawali "apa", jadi tidak boleh ada pola yang hanya menuntut kata itu.
  const patterns = [
    // Siapa kamu
    /\b(?:kamu|km|anda)\s+siapa\b/,
    /\bsiapa\s+(?:kamu|km|anda|sih)\b/,
    /\bsiapa\s+itu\s+cia\b/,

    // Apa itu CIA
    /\bcia\s+itu\s+apa/,
    /\bapa\s+itu\s+cia\b/,
    /\bapa\s+(?:sih\s+)?cia\b/,
    /\bcia\s+apa(?:an)?\b/,

    // Perkenalan
    /\bperkenal(?:kan|an)\b/,
    /\bkenalan\b/,
    /\bintro(?:duksi)?\s+(?:diri|kamu)\b/,

    // Kemampuan
    /\bbisa\s+(?:bantu\s+)?apa(?:\s+aja(?:h)?|\s+saja)?\b/,
    /\b(?:kamu|km|anda)\s+bisa\s+apa\b/,
    /\bapa\s+fungsi/,
    /\bfungsi(?:nya|mu)\s+apa\b/,
    /\bapa\s+tugas/,
    /\btugas(?:nya|mu)\s+apa\b/,
    /\bgunanya\s+apa\b/,
  ];
  return patterns.some((p) => p.test(clean));
}