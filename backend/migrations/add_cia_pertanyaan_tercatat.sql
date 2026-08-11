-- Pertanyaan yang belum bisa dijawab CIA.
--
-- Aman diulang.
--
-- Alasan tabel ini ada: balasan CIA mengatakan pertanyaannya dicatat supaya
-- cakupan datanya ditambah. Tanpa tabel ini, kalimat itu tidak pernah benar, dan
-- bot mengucapkannya berulang kali ke orang yang sama tanpa ada yang berubah.
-- Isi tabel ini adalah daftar kerja nyata untuk memperluas knowledge, bukan log
-- yang tidak pernah dibuka.
--
-- Teks pertanyaan disimpan apa adanya karena itulah gunanya. Nomor pengirim
-- TIDAK disimpan: yang dibutuhkan untuk memperbaiki cakupan adalah pertanyaannya,
-- bukan siapa yang bertanya.

CREATE TABLE IF NOT EXISTS cia_pertanyaan_tercatat (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  group_jid   VARCHAR(120) NOT NULL,
  pertanyaan  VARCHAR(400) NOT NULL,
  jenis       VARCHAR(24)  NOT NULL DEFAULT 'di_luar_konteks',
  dicatat_pada DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cia_tercatat_waktu (dicatat_pada),
  KEY idx_cia_tercatat_jenis (jenis)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
