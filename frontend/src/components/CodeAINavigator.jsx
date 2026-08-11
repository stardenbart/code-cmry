import React, { useEffect, useRef, useState } from "react";
import {
  Sparkles, X, Send, Loader2, AlertTriangle, ArrowRight, Lock, Compass, Copy, Check, Mail,
} from "lucide-react";
import API from "../api/api";

// Starter prompts that teach what this assistant is FOR — it finds dashboards,
// onboards newcomers, maps coverage and routes to the PIC; it deliberately
// cannot read dashboard numbers.
const starterPrompts = (user) => [
  "Saya mau lihat data downtime dan output, bisa lihat di mana ya?",
  user?.departemen
    ? `Saya baru di departemen ${user.departemen}, dashboard apa yang perlu saya pantau?`
    : "Saya karyawan baru, dashboard apa yang perlu saya pantau?",
  "Data apa saja yang tersedia di CODE?",
  "Siapa yang harus saya hubungi soal data downtime?",
  "Apa itu MTBF dan di dashboard mana saya bisa melihatnya?",
];

function CopyButton({ text, className = "" }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard API needs a secure context; fall back to a temporary textarea
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* give up silently */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <button
      onClick={copy}
      title={copied ? "Tersalin!" : "Salin jawaban"}
      className={`p-1 rounded hover:bg-gray-200 transition ${copied ? "text-green-600" : "text-gray-400"} ${className}`}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

export { CopyButton };

export default function CodeAINavigator({ user, onOpenDashboard, onRequestAccess, onRequestAccessBulk }) {
  const [open, setOpen]         = useState(false);
  const [question, setQuestion] = useState("");
  const [asking, setAsking]     = useState(false);
  const [messages, setMessages] = useState([]);   // { role, text, dashboards?, followUp?, error? }
  const [enabled, setEnabled]   = useState(null);
  const [bulkDone, setBulkDone] = useState({});   // messageIndex -> true

  const STARTERS = starterPrompts(user);

  const scrollRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => {
    if (!open || enabled !== null) return;
    API.get("/api/ai/status")
      .then(({ data }) => setEnabled(Boolean(data?.enabled)))
      .catch(() => setEnabled(false));
  }, [open, enabled]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150);
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, asking]);

  const ask = async (text) => {
    const q = (text ?? question).trim();
    if (!q || asking) return;

    setQuestion("");
    setMessages((prev) => [...prev, { role: "user", text: q }]);
    setAsking(true);

    try {
      const { data } = await API.post("/api/ai/navigate", { question: q });
      setMessages((prev) => [...prev, {
        role: "ai",
        text: data.answer,
        dashboards: data.dashboards || [],
        followUp: data.followUp || [],
        fromCache: data.fromCache,
      }]);
    } catch (err) {
      setMessages((prev) => [...prev, {
        role: "ai",
        error: true,
        text: err?.response?.data?.message || "Gagal menghubungi CIA Navigator.",
      }]);
    } finally {
      setAsking(false);
      inputRef.current?.focus();
    }
  };

  return (
    <>
      {/* Launcher — sits above the scroll-to-top button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 bg-gradient-to-r from-cimoryBlue to-cimoryRed text-white pl-3 pr-4 py-3 rounded-full shadow-lg hover:shadow-2xl hover:-translate-y-0.5 transition-all group"
          title="Tanya CIA: dashboard mana yang saya butuhkan?"
        >
          <Sparkles size={18} className="shrink-0" />
          <span className="text-sm font-medium hidden sm:inline">Tanya CIA</span>
        </button>
      )}

      {/* Window */}
      {open && (
        <div className="fixed bottom-6 right-6 z-40 w-[min(calc(100vw-3rem),22rem)] h-[min(calc(100vh-8rem),30rem)] flex flex-col bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">

          <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-cimoryBlue to-cimoryRed text-white shrink-0">
            <Compass size={16} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight">CIA</p>
              <p className="text-[10.5px] text-white/70 leading-tight">Cari dashboard &amp; istilah</p>
            </div>
            <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-white/20">
              <X size={16} />
            </button>
          </div>

          {enabled === false && (
            <div className="m-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11.5px] text-amber-800 shrink-0">
              <p className="flex items-start gap-1.5">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                CIA belum aktif. Simpan kunci akses lewat menu Pengaturan CIA di header.
              </p>
            </div>
          )}

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
            {messages.length === 0 && !asking && (
              <div className="text-center py-4">
                <Compass size={24} className="mx-auto text-cimoryBlue/40 mb-2" />
                <p className="text-[12.5px] font-medium text-gray-600">Bingung buka dashboard yang mana?</p>
                <p className="text-[10.5px] text-gray-400 mt-1 px-2">
                  Tanya di sini. Untuk analisa angkanya, buka dashboard-nya lalu pakai tombol CIA di dalamnya.
                </p>
                <div className="mt-3 flex flex-col gap-1.5">
                  {STARTERS.map((s) => (
                    <button
                      key={s}
                      onClick={() => ask(s)}
                      disabled={enabled === false}
                      className="text-left text-[11px] px-2.5 py-2 rounded-xl border border-gray-200 hover:border-cimoryBlue hover:bg-sky-50 text-gray-600 transition disabled:opacity-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[88%] bg-cimoryBlue text-white rounded-2xl rounded-br-sm px-3 py-2 text-[12px]">
                    {m.text}
                  </div>
                </div>
              ) : (
                <div key={i} className="space-y-1.5">
                  <div className={`rounded-2xl rounded-bl-sm px-3 py-2 text-[12px] leading-relaxed ${
                    m.error
                      ? "bg-red-50 border border-red-200 text-red-700"
                      : "bg-gray-50 border border-gray-200 text-gray-700"
                  }`}>
                    <p className="whitespace-pre-wrap">{m.text}</p>
                    {!m.error && (
                      <div className="flex items-center gap-1 mt-1 pt-1 border-t border-gray-200">
                        <CopyButton text={m.text} />
                        {m.fromCache && <span className="text-[9.5px] text-green-600">dari cache · 0 kuota</span>}
                      </div>
                    )}
                  </div>

                  {/* Interactive dashboard buttons */}
                  {m.dashboards?.length > 0 && (
                    <div className="space-y-1.5">
                      {m.dashboards.map((d) => (
                        <div key={d.id} className="border border-sky-200 rounded-xl overflow-hidden bg-sky-50/60">
                          <div className="px-2.5 pt-2">
                            <p className="text-[11.5px] font-semibold text-cimoryBlue leading-tight">{d.title}</p>
                            <p className="text-[10px] text-gray-500">{d.department}</p>
                            {d.reason && <p className="text-[10.5px] text-gray-600 mt-1">{d.reason}</p>}
                          </div>
                          <div className="flex gap-1 p-2">
                            {d.hasAccess ? (
                              <>
                                <button
                                  onClick={() => {
                                    // One tap does the whole journey: open the dashboard, expand the
                                    // CIA panel, and re-ask the question the user already typed
                                    // here — the navigator cannot see data, the panel can.
                                    const lastUser = [...messages].reverse().find((x) => x.role === "user");
                                    onOpenDashboard?.(d, {
                                      withAI: d.canAskAI,
                                      question: d.canAskAI ? lastUser?.text : undefined,
                                    });
                                    setOpen(false);
                                  }}
                                  title={d.canAskAI
                                    ? "Buka dashboard, panel CIA langsung terbuka dan pertanyaanmu diproses"
                                    : "Buka dashboard (dashboard ini belum mendukung analisa CIA)"}
                                  className="flex-1 flex items-center justify-center gap-1 bg-cimoryBlue text-white text-[10.5px] font-medium py-1.5 rounded-lg hover:bg-cimoryRed transition"
                                >
                                  {d.canAskAI && <Sparkles size={11} />}
                                  Buka &amp; analisa <ArrowRight size={11} />
                                </button>
                                {d.canAskAI && (
                                  <button
                                    onClick={() => { onOpenDashboard?.(d, { withAI: false }); setOpen(false); }}
                                    title="Buka dashboard saja, tanpa memanggil CIA (hemat kuota)"
                                    className="flex items-center justify-center bg-white border border-gray-300 text-gray-600 text-[10.5px] font-medium px-2 py-1.5 rounded-lg hover:bg-gray-100 transition"
                                  >
                                    Lihat saja
                                  </button>
                                )}
                              </>
                            ) : (
                              <button
                                onClick={() => { onRequestAccess?.(d); setOpen(false); }}
                                className="flex-1 flex items-center justify-center gap-1 bg-amber-500 text-white text-[10.5px] font-medium py-1.5 rounded-lg hover:bg-amber-600 transition"
                              >
                                <Lock size={11} /> Minta akses dulu
                              </button>
                            )}
                          </div>

                          {/* PIC comes from the database, never from the model */}
                          {d.pic?.length > 0 && (
                            <div className="px-2.5 pb-2 -mt-0.5 flex items-center gap-1 flex-wrap">
                              <Mail size={10} className="text-gray-400 shrink-0" />
                              <span className="text-[9.5px] text-gray-500">PIC:</span>
                              {d.pic.map((email) => (
                                <a
                                  key={email}
                                  href={`mailto:${email}?subject=${encodeURIComponent(`[CODE] Pertanyaan dashboard ${d.title}`)}`}
                                  className="text-[9.5px] text-sky-700 hover:underline break-all"
                                >
                                  {email}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}

                      {/* One tap to request everything they cannot open yet */}
                      {m.dashboards.filter((d) => !d.hasAccess).length > 1 && !bulkDone[i] && (
                        <button
                          onClick={async () => {
                            const missing = m.dashboards.filter((d) => !d.hasAccess);
                            await onRequestAccessBulk?.(missing);
                            setBulkDone((prev) => ({ ...prev, [i]: true }));
                          }}
                          className="w-full flex items-center justify-center gap-1.5 bg-amber-500 text-white text-[10.5px] font-medium py-1.5 rounded-lg hover:bg-amber-600 transition"
                        >
                          <Lock size={11} />
                          Minta akses ke semua {m.dashboards.filter((d) => !d.hasAccess).length} dashboard sekaligus
                        </button>
                      )}
                      {bulkDone[i] && (
                        <p className="text-[10px] text-green-600 text-center flex items-center justify-center gap-1">
            <Check size={11} /> Permintaan akses terkirim
          </p>
                      )}
                    </div>
                  )}

                  {m.followUp?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {m.followUp.map((f) => (
                        <button
                          key={f}
                          onClick={() => ask(f)}
                          className="text-[10px] px-2 py-1 rounded-full border border-gray-200 text-gray-500 hover:border-cimoryBlue hover:text-cimoryBlue transition"
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            )}

            {asking && (
              <div className="flex items-center gap-2 text-[11.5px] text-gray-500 px-1">
                <Loader2 size={13} className="animate-spin text-cimoryBlue" /> Mencari dashboard yang cocok…
              </div>
            )}
          </div>

          <div className="p-2.5 border-t border-gray-200 shrink-0">
            <div className="flex items-end gap-1.5">
              <textarea
                ref={inputRef}
                rows={1}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); }
                }}
                disabled={enabled === false}
                placeholder="Mau lihat data apa?"
                className="flex-1 resize-none border border-gray-300 rounded-xl px-2.5 py-2 text-[12px] focus:ring-2 focus:ring-cimoryBlue focus:outline-none disabled:bg-gray-100"
              />
              <button
                onClick={() => ask()}
                disabled={asking || enabled === false || !question.trim()}
                className="p-2 rounded-xl bg-cimoryBlue text-white hover:bg-cimoryRed transition disabled:opacity-40 shrink-0"
              >
                {asking ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
