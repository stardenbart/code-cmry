import { ok, section } from "./harness.mjs";
import { cacheKey } from "../src/services/aiCache.js";

// Perbaikan Critical #1: temuan user A tidak boleh bocor ke user B lewat cache
// jawaban. Dua user dengan pertanyaan dan snapshot IDENTIK harus mendapat kunci
// cache BERBEDA ketika jawabannya memuat konteks temuan pribadi, supaya cache
// tidak pernah dibagi lintas user untuk jawaban semacam itu.

const SNAPSHOT = {
  pagesRead: ["Ringkasan"],
  filters: ["Tanggal = 2026-08-11"],
  slicers: [],
  visuals: [{ title: "Downtime", pageName: "Ringkasan", rows: [["Line 1", 12]], columns: ["Line", "Jam"] }],
};

section("Konteks temuan ada -> userScope WAJIB membedakan kunci");

const kunciA = cacheKey({
  dashboardId: 45, question: "berapa downtime tertinggi?", snapshot: SNAPSHOT, tier: "standar",
  userScope: 101,
});
const kunciB = cacheKey({
  dashboardId: 45, question: "berapa downtime tertinggi?", snapshot: SNAPSHOT, tier: "standar",
  userScope: 202,
});
ok("user A dan user B dengan konteks temuan menghasilkan kunci berbeda", kunciA !== kunciB, `${kunciA} vs ${kunciB}`);

section("Tanpa konteks temuan -> kunci tetap sama, cache masih bisa dibagi");

const kunciSharedA = cacheKey({
  dashboardId: 45, question: "berapa downtime tertinggi?", snapshot: SNAPSHOT, tier: "standar",
});
const kunciSharedB = cacheKey({
  dashboardId: 45, question: "berapa downtime tertinggi?", snapshot: SNAPSHOT, tier: "standar",
});
ok("dua pertanyaan biasa tanpa userScope menghasilkan kunci sama",
  kunciSharedA === kunciSharedB, `${kunciSharedA} vs ${kunciSharedB}`);
ok("kunci tanpa userScope berbeda dari kunci yang diberi userScope",
  kunciSharedA !== kunciA, `${kunciSharedA} vs ${kunciA}`);
