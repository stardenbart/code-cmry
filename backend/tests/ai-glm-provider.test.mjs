// Provider GLM-5.2 dan pemilih provider.
//
// Seluruh uji di sini memakai klien dan dependensi suntikan, jadi tidak ada
// panggilan jaringan, tidak ada kuota terpakai, dan hasilnya tidak bergantung
// pada NVIDIA sedang hidup atau tidak.
//
// Yang dijaga paling ketat adalah dua hal yang kalau salah tidak menimbulkan
// error sama sekali: jalan pikir model ikut terkirim ke grup, dan kegagalan GLM
// membuat bot diam alih-alih beralih ke Gemini.
import { ok, section } from "./harness.mjs";
import {
  susunBody,
  bacaBalasan,
  askGlm,
  GlmError,
  GLM_MODEL,
} from "../src/config/glm.js";
import { tanyaModel, PROVIDER_SAH, PROVIDER_DEFAULT } from "../src/services/modelRouter.js";

section("Body permintaan berformat OpenAI");

const body = susunBody({
  systemInstruction: "kamu CIA",
  history: [
    { role: "user", text: "halo" },
    { role: "model", text: "hai" },
  ],
  question: "berapa downtime hari ini",
  maxOutputTokens: 512,
});

ok("model default terpasang", body.model === GLM_MODEL, body.model);
ok("stream dimatikan", body.stream === false, String(body.stream));
ok("max_tokens dipetakan", body.max_tokens === 512, String(body.max_tokens));
ok("pesan pertama system", body.messages[0].role === "system", body.messages[0].role);

// Gemini memakai "model" untuk giliran asisten, OpenAI memakai "assistant".
// Mengirim "model" ke endpoint ini membuat riwayat percakapan diabaikan diam-diam.
ok("giliran model diterjemahkan jadi assistant", body.messages[2].role === "assistant", body.messages[2].role);
ok("pertanyaan jadi pesan terakhir", body.messages.at(-1).content === "berapa downtime hari ini", body.messages.at(-1).content);

section("Parameter thinking hanya dikirim bila diminta");

ok("default tidak mengirim chat_template_kwargs", body.chat_template_kwargs === undefined, "terkirim padahal default mati");
const bodyThinking = susunBody({ question: "x", thinking: true });
ok("dikirim bila diminta", bodyThinking.chat_template_kwargs?.enable_thinking === true, "tidak terkirim");

section("Jalan pikir model TIDAK pernah ikut kembalian");

const dibaca = bacaBalasan({
  choices: [{ message: { content: "downtime 5 jam", reasoning_content: "pertama saya cek tabel lalu..." } }],
  usage: { total_tokens: 10 },
});
ok("teks terbaca", dibaca.text === "downtime 5 jam", dibaca.text);
ok("reasoning terbaca terpisah", /pertama saya cek/.test(dibaca.reasoning), "tidak terbaca");

const klienDenganReasoning = {
  post: async () => ({
    data: {
      choices: [{ message: { content: "jawaban bersih", reasoning_content: "RAHASIA jalan pikir" } }],
      usage: null,
    },
  }),
};
const hasilBersih = await askGlm({
  apiKey: "kunci-uji",
  question: "tes",
  client: klienDenganReasoning,
});
ok("kembalian hanya memuat teks jawaban", hasilBersih.text === "jawaban bersih", hasilBersih.text);
ok(
  "reasoning TIDAK ada di kembalian sama sekali",
  !JSON.stringify(hasilBersih).includes("RAHASIA"),
  JSON.stringify(hasilBersih)
);

section("Kesalahan dipetakan jadi kode yang bisa ditindaklanjuti");

async function tangkap(fn) {
  try {
    await fn();
    return null;
  } catch (err) {
    return err;
  }
}

const tanpaKunci = await tangkap(() => askGlm({ apiKey: "", question: "x" }));
ok("tanpa kunci ditolak", tanpaKunci instanceof GlmError && tanpaKunci.code === "NO_API_KEY", String(tanpaKunci?.code));

const kosong = await tangkap(() => askGlm({ apiKey: "k", question: "" }));
ok("pertanyaan kosong ditolak", kosong?.code === "EMPTY_QUESTION", String(kosong?.code));

const klienTimeout = { post: async () => { const e = new Error("timeout of 30000ms exceeded"); e.code = "ECONNABORTED"; throw e; } };
const timeout = await tangkap(() => askGlm({ apiKey: "k", question: "x", client: klienTimeout }));
ok("timeout dikenali", timeout?.code === "TIMEOUT", String(timeout?.code));

const klien429 = { post: async () => { const e = new Error("too many"); e.response = { status: 429, data: {} }; throw e; } };
const limit = await tangkap(() => askGlm({ apiKey: "k", question: "x", client: klien429 }));
ok("429 dikenali sebagai batas laju", limit?.code === "RATE_LIMIT", String(limit?.code));

const klienKosong = { post: async () => ({ data: { choices: [{ message: { content: "   " } }] } }) };
const balasanKosong = await tangkap(() => askGlm({ apiKey: "k", question: "x", client: klienKosong }));
ok("balasan kosong ditolak, bukan dikirim", balasanKosong?.code === "EMPTY_RESPONSE", String(balasanKosong?.code));

section("Parameter thinking yang ditolak diulang tanpa parameter itu");

// Endpoint ini tidak konsisten mendukung chat_template_kwargs. Menyerah pada
// penolakan pertama berarti kehilangan jawaban karena parameter opsional.
let panggilan = 0;
const klienTolakThinking = {
  post: async (_url, isi) => {
    panggilan += 1;
    if (isi.chat_template_kwargs) {
      const e = new Error("unsupported parameter");
      e.response = { status: 400, data: {} };
      throw e;
    }
    return { data: { choices: [{ message: { content: "berhasil tanpa thinking" } }] } };
  },
};
const setelahUlang = await askGlm({ apiKey: "k", question: "x", thinking: true, client: klienTolakThinking });
ok("diulang sekali", panggilan === 2, `${panggilan} panggilan`);
ok("jawabannya tetap didapat", setelahUlang.text === "berhasil tanpa thinking", setelahUlang.text);

section("Pemilih provider dan jalur cadangan");

ok("provider sah hanya dua", PROVIDER_SAH.join(",") === "glm,gemini", PROVIDER_SAH.join(","));
ok("default GLM", PROVIDER_DEFAULT === "glm", PROVIDER_DEFAULT);

const geminiPalsu = async () => ({ text: "dari gemini", model: "gemini-3.6-flash", usage: null });

const lewatGlm = await tanyaModel({
  question: "x",
  deps: {
    providerTerpilih: async () => "glm",
    bolehPakaiGlm: () => ({ boleh: true, alasan: "" }),
    askGlm: async () => ({ text: "dari glm", model: "z-ai/glm-5.2", usage: null }),
    askGemini: geminiPalsu,
  },
});
ok("dijawab GLM saat sehat", lewatGlm.provider === "glm" && lewatGlm.text === "dari glm", JSON.stringify(lewatGlm));
ok("tidak ditandai cadangan", lewatGlm.cadangan === false, String(lewatGlm.cadangan));

const glmGagal = await tanyaModel({
  question: "x",
  deps: {
    providerTerpilih: async () => "glm",
    bolehPakaiGlm: () => ({ boleh: true, alasan: "" }),
    askGlm: async () => { throw new GlmError("mati", 500, "GLM_ERROR"); },
    askGemini: geminiPalsu,
  },
});
ok("beralih ke Gemini saat GLM gagal", glmGagal.provider === "gemini", glmGagal.provider);
ok("ditandai cadangan", glmGagal.cadangan === true, String(glmGagal.cadangan));
ok("alasannya ikut dicatat", /GLM_ERROR/.test(glmGagal.alasanCadangan), glmGagal.alasanCadangan);

const kenaBatas = await tanyaModel({
  question: "x",
  deps: {
    providerTerpilih: async () => "glm",
    bolehPakaiGlm: () => ({ boleh: false, alasan: "batas laju GLM tercapai" }),
    askGlm: async () => { throw new Error("seharusnya tidak dipanggil"); },
    askGemini: geminiPalsu,
  },
});
ok("batas laju langsung ke Gemini tanpa memanggil GLM", kenaBatas.provider === "gemini", kenaBatas.provider);
ok("alasan batas laju disebut", /batas laju/.test(kenaBatas.alasanCadangan), kenaBatas.alasanCadangan);

const pilihGemini = await tanyaModel({
  question: "x",
  deps: {
    providerTerpilih: async () => "gemini",
    bolehPakaiGlm: () => { throw new Error("seharusnya tidak diperiksa"); },
    askGlm: async () => { throw new Error("seharusnya tidak dipanggil"); },
    askGemini: geminiPalsu,
  },
});
ok("pilihan admin dihormati", pilihGemini.provider === "gemini", pilihGemini.provider);
ok("bukan cadangan, memang dipilih", pilihGemini.cadangan === false, String(pilihGemini.cadangan));

section("Kegagalan GLM TIDAK menempel ke permintaan berikutnya");

// Kalau status "sedang rusak" menempel, satu kegagalan sesaat membuang seluruh
// sisa hari ke provider cadangan tanpa ada yang tahu.
let giliran = 0;
const depsBergantian = {
  providerTerpilih: async () => "glm",
  bolehPakaiGlm: () => ({ boleh: true, alasan: "" }),
  askGlm: async () => {
    giliran += 1;
    if (giliran === 1) throw new GlmError("sesaat", 500, "GLM_ERROR");
    return { text: "glm pulih", model: "z-ai/glm-5.2", usage: null };
  },
  askGemini: geminiPalsu,
};
const pertama = await tanyaModel({ question: "x", deps: depsBergantian });
const kedua = await tanyaModel({ question: "y", deps: depsBergantian });
ok("permintaan pertama jatuh ke Gemini", pertama.provider === "gemini", pertama.provider);
ok("permintaan kedua mencoba GLM lagi", kedua.provider === "glm", kedua.provider);
