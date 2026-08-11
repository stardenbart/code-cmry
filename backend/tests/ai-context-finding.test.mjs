import { ok, section } from "./harness.mjs";
import { buildUserMessage } from "../src/services/aiContext.js";

section("buildUserMessage tanpa temuan tetap seperti sebelumnya");

const tanpa = buildUserMessage({ dataContext: "DATA", question: "berapa OEE?" });
ok("memuat snapshot", tanpa.includes("DATA SNAPSHOT DASHBOARD:"), tanpa);
ok("memuat pertanyaan", tanpa.includes("berapa OEE?"));
// Tidak boleh menyebut temuan bila tidak ada: menyebutnya membuat model
// mengomentari ketiadaan konteks yang tidak ditanyakan user.
ok("tidak menyebut temuan", !/TEMUAN DARI DASHBOARD LAIN/i.test(tanpa), tanpa);

section("Temuan disisipkan SEBELUM pertanyaan, sesudah snapshot");

const dengan = buildUserMessage({
  dataContext: "DATA",
  question: "berapa OEE?",
  konteksTemuan: "=== TEMUAN DARI DASHBOARD LAIN ===\n- Losses Report (2 jam lalu): naik",
});
ok("memuat blok temuan", dengan.includes("TEMUAN DARI DASHBOARD LAIN"), dengan);

const posSnapshot = dengan.indexOf("DATA SNAPSHOT DASHBOARD:");
const posTemuan = dengan.indexOf("TEMUAN DARI DASHBOARD LAIN");
const posTanya = dengan.indexOf("PERTANYAAN USER:");
// Urutannya penting: snapshot dashboard sekarang lebih dulu supaya itu yang
// jadi rujukan utama, temuan sebagai konteks tambahan, pertanyaan paling akhir
// supaya paling dekat dengan jawaban.
ok("snapshot sebelum temuan", posSnapshot < posTemuan, `${posSnapshot} vs ${posTemuan}`);
ok("temuan sebelum pertanyaan", posTemuan < posTanya, `${posTemuan} vs ${posTanya}`);

section("Konteks temuan kosong diperlakukan seperti tidak ada");

for (const kosong of ["", "   ", null, undefined]) {
  const m = buildUserMessage({ dataContext: "D", question: "q", konteksTemuan: kosong });
  ok(`konteks ${JSON.stringify(kosong)} tidak memunculkan blok`,
    !/TEMUAN DARI DASHBOARD LAIN/i.test(m));
}

