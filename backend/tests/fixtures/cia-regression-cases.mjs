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

