export const CIA_REGRESSION_CASES = Object.freeze([
  {
    id: "overtime-breakdown",
    question: "jelaskan breakdown lembur harian per departemen dikarenakan alasan dan kategori apa",
    expects: ["overtime"],
  },
  {
    id: "cmd3-deviation",
    question: "breakdown perihal deviasi cmd 3, jelaskan issue deviasi yang terjadi",
    expects: ["deviation_cmd3"],
  },
  {
    id: "overtime-po-correlation",
    question: "apakah lembur produksi A tinggi karena PO naik, produk apa dan kenapa",
    expects: ["overtime", "ppic_po"],
  },
  {
    id: "last-month",
    question: "bandingkan lembur bulan lalu dengan bulan ini",
    expectsPeriods: 2,
  },
  {
    id: "last-year",
    question: "bagaimana deviasi tahun lalu dibanding aktual",
    expectsPeriods: 2,
  },
]);

// Corpus yang disetujui untuk pipeline hybrid. Kasus lama di atas tetap
// dipertahankan karena dipakai oleh contract test yang sudah ada.
export const CIA_HYBRID_REGRESSION_CASES = Object.freeze([
  { id: "downtime-tetra-running-hours", question: "waktu downtime tetra pak line 3 dan 6 ini berapa jam ya? dan jika dipersenkan dengan running hoursnya, downtimenya berapa persen?", expectsConcepts: ["downtime", "running hours"], expectsEntities: ["tetra pak line 3", "tetra pak line 6"], expectsOperations: ["calculation"], expectsPeriodKind: "current" },
  { id: "production-po-achievement", question: "rekapkan berapa achievement produksi dan fulfillment PO minggu ini per hari kamis", expectsConcepts: ["production", "purchase order"], expectsEntities: [], expectsOperations: ["breakdown", "calculation"], expectsPeriodKind: "current_week" },
  { id: "downtime-pasuruan-highest", question: "jelasin downtime pada mesin di plant Pasuruan paling tinggi", expectsConcepts: ["downtime"], expectsEntities: ["plant pasuruan"], expectsOperations: ["ranking", "explanation"] },
  { id: "output-uht-week", question: "output uht milk 250ml week ini berapa totalnya?", expectsConcepts: ["production output"], expectsEntities: ["uht milk 250ml"], expectsOperations: ["calculation"], expectsPeriodKind: "current_week" },
  { id: "snapshot-today", question: "bisa susun reportnya khusus snapshot data hari ini aja ga? gua mau liat update dan analisa fokus hari ini", expectsConcepts: [], expectsEntities: [], expectsOperations: ["breakdown"], expectsPeriodKind: "today" },
  { id: "cmd3-deviation-detail", question: "coba rincian deviasi cmd 3 kalo gitu", expectsConcepts: ["deviation"], expectsEntities: ["cmd 3"], expectsOperations: ["breakdown"] },
  { id: "operational-downtime-trigger", question: "pemicu tingginya operasional downtime apa?", expectsConcepts: ["downtime"], expectsEntities: [], expectsOperations: ["explanation"] },
  { id: "serac-issue-downtime", question: "detail issue kenapa downtime di serac blow moulding paling tinggi terjadi karena apa?", expectsConcepts: ["downtime"], expectsEntities: ["serac blow moulding"], expectsOperations: ["ranking", "explanation"] },
  { id: "serac-sbl18-action", question: "Kenapa downtime pada Serac Blow Moulding Line 2_SBL18 mencapai 360 dan bagaimana rincian tindakan penanganannya?", expectsConcepts: ["downtime"], expectsEntities: ["serac blow moulding line 2_sbl18"], expectsOperations: ["breakdown", "explanation"] },
  { id: "overtime-weekend-cutoff", question: "coba rekap overtime di hari sabtu minggu selama periode cutoff bulan juli", expectsConcepts: ["overtime"], expectsEntities: [], expectsOperations: ["breakdown"], expectsPeriodKind: "named_month" },
  { id: "overtime-holiday-cutoff-1", question: "coba jelaskan berapa overtime di hari libur selama periode cutoff bulan juli", expectsConcepts: ["overtime"], expectsEntities: [], expectsOperations: ["calculation", "explanation"], expectsPeriodKind: "named_month" },
  { id: "overtime-holiday-cutoff-2", question: "coba jelaskan berapa overtime di hari libur selama periode cutoff bulan juli", expectsConcepts: ["overtime"], expectsEntities: [], expectsOperations: ["calculation", "explanation"], expectsPeriodKind: "named_month" },
  { id: "overtime-cost-department", question: "berapa biaya estimasi lembur pada tanggal 2 Agustus kemarin dan dept mana yang lembur paling banyak, buat pecahan cost per deptnya?", expectsConcepts: ["overtime", "overtime cost"], expectsEntities: ["2 agustus"], expectsOperations: ["breakdown", "calculation", "ranking"], expectsPeriodKind: "explicit_date" },
  { id: "production-issue-today", question: "apakah produksi hari ini ada kendala?", expectsConcepts: ["production"], expectsEntities: [], expectsOperations: ["explanation"], expectsPeriodKind: "today" },
  { id: "production-issue-today-detail", question: "jelaskan kendala di produksi hari ini", expectsConcepts: ["production"], expectsEntities: [], expectsOperations: ["explanation"], expectsPeriodKind: "today" },
  { id: "technical-downtime-only", question: "coba jelaskan techical downtime nya saja", expectsConcepts: ["downtime"], expectsEntities: [], expectsOperations: ["explanation"], expectsPeriodKind: "follow_up" },
  { id: "serac-cyd65-issue", question: "jelaskan in detail serac line 3 CYD 65ml (Filler) itu masalahnya apa?", expectsConcepts: [], expectsEntities: ["serac line 3 cyd 65ml"], expectsOperations: ["breakdown", "explanation"] },
  { id: "evergreen-repair-status", question: "kenapa downtime pada evergreen esl 950ml tinggi sekali, gimana status perbaikannya?", expectsConcepts: ["downtime"], expectsEntities: ["evergreen esl 950ml"], expectsOperations: ["explanation"] },
  { id: "cmd3-deviation-cause", question: "jelaskan mengenai penyebab deviasi cmd 3 yang mencapai angka 260 juga", expectsConcepts: ["deviation"], expectsEntities: ["cmd 3"], expectsOperations: ["explanation"] },
  { id: "nc-deviation-source", question: "ambil sumber dari dashboard nc dan deviasi saja, produk apa yang mengalami issue deviasi paling tinggi, dan apa nama kategorinya?", expectsConcepts: ["deviation"], expectsEntities: [], expectsOperations: ["breakdown", "ranking"], expectsSource: ["nc", "deviasi"] },
  { id: "cmd3-highest-deviation", question: "deviasi apa yang paling tinggi terjadi di cmd 3 dan kenapa?", expectsConcepts: ["deviation"], expectsEntities: ["cmd 3"], expectsOperations: ["ranking", "explanation"] },
  { id: "output-uht-yesterday", question: "output uht milk 250ml kemarin berapa pcs?", expectsConcepts: ["production output"], expectsEntities: ["uht milk 250ml"], expectsOperations: ["calculation"], expectsPeriodKind: "yesterday" },
  { id: "cmd1-downtime-cause", question: "jelaskan rincian penyebab downtime di cmd1", expectsConcepts: ["downtime"], expectsEntities: ["cmd 1"], expectsOperations: ["breakdown", "explanation"] },
  { id: "production-output-po-yesterday", question: "berapa achivement production output dibandingkan dengan total PO nya kemarin", expectsConcepts: ["production", "production output", "purchase order"], expectsEntities: [], expectsOperations: ["calculation", "comparison"], expectsPeriodKind: "yesterday" },
  { id: "planning-output-august", question: "jelaskan tentang planning dan output 10 agustus kemarin", expectsConcepts: ["planning", "production output"], expectsEntities: ["10 agustus"], expectsOperations: ["comparison", "explanation"], expectsPeriodKind: "explicit_date" },
  { id: "evergreen-routine-downtime", question: "mana routine downtime tertinggi untuk evergreen di rentang tanggal 10-16 agustus kemarin", expectsConcepts: ["downtime", "routine downtime"], expectsEntities: ["evergreen", "10-16 agustus"], expectsOperations: ["ranking"], expectsPeriodKind: "explicit_range" },
  { id: "evergreen-routine-downtime-day-issue", question: "jelaskan routine downtime tertinggi untuk evergreen di rentang tanggal 10-16 agustus kemarin di hari apa dan issuenya apa", expectsConcepts: ["downtime", "routine downtime"], expectsEntities: ["evergreen", "10-16 agustus"], expectsOperations: ["breakdown", "explanation", "ranking"], expectsPeriodKind: "explicit_range" },
]);

