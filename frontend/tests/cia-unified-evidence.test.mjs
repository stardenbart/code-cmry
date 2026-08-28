import fs from "fs";

let failed = 0;
function check(name, condition) {
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${name}`);
  if (!condition) failed += 1;
}

const api = fs.readFileSync("src/services/unifiedChatApi.js", "utf8");
const panel = fs.readFileSync("src/components/UnifiedChatPanel.jsx", "utf8");
const message = fs.readFileSync("src/components/ChatMessage.jsx", "utf8");
const meta = fs.readFileSync("src/components/chat/CiaEvidenceMeta.jsx", "utf8");

console.log("\n=== Multi-Chat memakai live evidence sebagai jalur utama ===");
check("API mengirim preferredDashboardIds", /preferredDashboardIds/.test(api));
check("snapshot legacy bersifat opsional", /legacySnapshots/.test(api));
check("panel tidak memblokir kirim karena capture", !/pendingCaptureIds\.length > 0/.test(panel));
check("pilihan dashboard dikirim sebagai hint", /preferredDashboardIds:\s*idsTerpilih/.test(panel));
check("snapshot fallback default mati", /VITE_CIA_LEGACY_SNAPSHOT_FALLBACK/.test(panel)
  && /===\s*["']true["']/.test(panel));

console.log("\n=== Sumber dan warning evidence terlihat ===");
check("komponen metadata evidence tersedia", /export function CiaEvidenceMeta/.test(meta));
check("menampilkan retrieval method", /retrievalMethod/.test(meta));
check("menampilkan sources", /sources/.test(meta));
check("menampilkan warnings", /warnings/.test(meta));
check("ChatMessage merender metadata", /CiaEvidenceMeta/.test(message));
check("riwayat memulihkan metadata evidence", /retrievalMethod:\s*t\.retrieval_method/.test(panel));

console.log(failed ? `\n${failed} gagal` : "\nSemua lulus");
process.exit(failed ? 1 : 0);
