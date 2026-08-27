import { useCallback, useEffect, useState } from "react";
import { useConfirm } from "../ConfirmProvider.jsx";
import * as ciaAdminApi from "../../services/ciaAdminApi.js";

// Editor detail KPI. Nama measure teknis hanya tampil sebagai informasi sekunder
// (monospace) pada daftar binding - TIDAK bisa diedit di sini karena binding
// diisi oleh sync. Setiap Save/Confirm/Restore WAJIB menyertakan reason.
//
// Optimistic rule: Save menunggu API sebelum menutup; bila versi sudah berubah
// (409) tampilkan pesan reload, jangan menimpa diam-diam.
const STATUSES = ["draft", "confirmed", "deprecated"];

function toLines(list) { return (list || []).join("\n"); }
function fromLines(text) {
  return String(text || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

export default function CiaKpiEditor({ kpiId, onClose, onChanged }) {
  const confirm = useConfirm();
  const [kpi, setKpi] = useState(null);
  const [form, setForm] = useState(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [revisions, setRevisions] = useState(null);

  const load = useCallback(() => {
    setError("");
    ciaAdminApi.getKpiDetail(kpiId)
      .then((data) => {
        setKpi(data);
        setForm({
          humanName: data.humanName || "",
          definition: data.definition || "",
          businessFunction: data.businessFunction || "",
          domain: data.domain || "",
          unit: data.unit || "",
          numberFormat: data.numberFormat || "",
          status: data.status || "draft",
          synonyms: toLines(data.synonyms),
          answerableQuestions: toLines(data.answerableQuestions),
        });
      })
      .catch(() => setError("Gagal memuat detail KPI."));
  }, [kpiId]);

  useEffect(() => { load(); }, [load]);

  const requireReason = () => {
    if (!reason.trim()) { setError("Alasan (reason) wajib diisi."); return false; }
    return true;
  };

  const handleSave = async () => {
    setError(""); setNotice("");
    if (!requireReason()) return;
    setSaving(true);
    try {
      const updated = await ciaAdminApi.updateKpi(kpiId, {
        reason: reason.trim(),
        expectedVersion: kpi.version,
        humanName: form.humanName,
        definition: form.definition,
        businessFunction: form.businessFunction,
        domain: form.domain,
        unit: form.unit,
        numberFormat: form.numberFormat,
        status: form.status,
        synonyms: fromLines(form.synonyms),
        answerableQuestions: fromLines(form.answerableQuestions),
      });
      setKpi(updated);
      setReason("");
      setNotice("Perubahan tersimpan.");
      onChanged?.(updated);
    } catch (err) {
      if (err?.response?.status === 409) {
        setError("Versi KPI sudah berubah. Muat ulang dahulu sebelum menyimpan.");
      } else {
        setError(err?.response?.data?.message || "Gagal menyimpan KPI.");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleConfirm = async () => {
    setError(""); setNotice("");
    if (!requireReason()) return;
    const okToGo = await confirm({
      title: "Konfirmasi KPI",
      message: "Tandai KPI ini sebagai confirmed? Sync otomatis tidak akan menimpa metadata bisnisnya.",
    });
    if (!okToGo) return;
    setSaving(true);
    try {
      const updated = await ciaAdminApi.confirmKpi(kpiId, reason.trim());
      setKpi(updated);
      setForm((f) => ({ ...f, status: updated.status }));
      setReason("");
      setNotice("KPI dikonfirmasi.");
      onChanged?.(updated);
    } catch (err) {
      setError(err?.response?.data?.message || "Gagal mengonfirmasi KPI.");
    } finally {
      setSaving(false);
    }
  };

  const openRevisions = async () => {
    setError("");
    try { setRevisions(await ciaAdminApi.getKpiRevisions(kpiId)); }
    catch { setError("Gagal memuat riwayat revisi."); }
  };

  const handleRestore = async (revisionId) => {
    setError(""); setNotice("");
    if (!requireReason()) return;
    const okToGo = await confirm({
      title: "Pulihkan revisi",
      message: "Pulihkan snapshot revisi ini sebagai VERSI BARU? Histori lama tetap tersimpan.",
    });
    if (!okToGo) return;
    setSaving(true);
    try {
      const updated = await ciaAdminApi.restoreKpiRevision(kpiId, revisionId, reason.trim());
      setKpi(updated);
      setReason("");
      setNotice("Revisi dipulihkan sebagai versi baru.");
      await openRevisions();
      load();
      onChanged?.(updated);
    } catch (err) {
      setError(err?.response?.data?.message || "Gagal memulihkan revisi.");
    } finally {
      setSaving(false);
    }
  };

  if (error && !kpi) {
    return (
      <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
        <p>{error}</p>
        <button type="button" onClick={load} className="mt-3 rounded bg-red-700 px-3 py-1 text-white">Coba lagi</button>
      </div>
    );
  }
  if (!kpi || !form) return <p className="text-slate-500">Memuat detail KPI...</p>;

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{kpi.humanName}</h3>
          <p className="text-xs text-slate-500">
            versi {kpi.version} · status {kpi.status} · <span className="font-mono">{kpi.slug}</span>
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100">Tutup</button>
      </div>

      {error && <div role="alert" className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</div>}
      {notice && <div className="mb-3 rounded bg-green-50 p-2 text-sm text-green-700">{notice}</div>}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Nama KPI (manusia)
          <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={form.humanName} onChange={set("humanName")} />
        </label>
        <label className="text-sm">Status
          <select className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={form.status} onChange={set("status")}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="text-sm">Domain
          <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={form.domain} onChange={set("domain")} />
        </label>
        <label className="text-sm">Unit
          <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={form.unit} onChange={set("unit")} />
        </label>
        <label className="text-sm">Format angka
          <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={form.numberFormat} onChange={set("numberFormat")} />
        </label>
        <label className="text-sm">Fungsi bisnis
          <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={form.businessFunction} onChange={set("businessFunction")} />
        </label>
        <label className="text-sm sm:col-span-2">Definisi
          <textarea rows={2} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={form.definition} onChange={set("definition")} />
        </label>
        <label className="text-sm sm:col-span-2">Sinonim (satu per baris)
          <textarea rows={3} className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs" value={form.synonyms} onChange={set("synonyms")} />
        </label>
        <label className="text-sm sm:col-span-2">Pertanyaan yang dapat dijawab (satu per baris)
          <textarea rows={3} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={form.answerableQuestions} onChange={set("answerableQuestions")} />
        </label>
      </div>

      <label className="mt-3 block text-sm font-medium">Alasan perubahan (wajib)
        <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={reason}
          onChange={(e) => setReason(e.target.value)} placeholder="mis. perjelas definisi lembur" />
      </label>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={saving} onClick={handleSave}
          className="rounded bg-cimoryBlue px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Simpan</button>
        <button type="button" disabled={saving} onClick={handleConfirm}
          className="rounded bg-green-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Konfirmasi</button>
        <button type="button" onClick={openRevisions}
          className="rounded border border-slate-300 px-3 py-2 text-sm">Riwayat revisi</button>
      </div>

      {/* Binding teknis: read-only, measure sebagai secondary monospace. */}
      <div className="mt-4">
        <h4 className="mb-2 text-sm font-semibold">Binding teknis (dari sync, read-only)</h4>
        {(kpi.bindings || []).length === 0 && <p className="text-sm text-slate-500">Belum ada binding.</p>}
        <ul className="space-y-1">
          {(kpi.bindings || []).map((b) => (
            <li key={b.id} className="rounded border border-slate-100 bg-slate-50 px-2 py-1 text-xs">
              <span className="font-mono text-slate-700">{b.semanticModel}[{b.measureName}]</span>
              <span className="ml-2 text-slate-500">
                {b.dashboardName ? `dashboard: ${b.dashboardName}` : "model-level"} · {b.verificationStatus}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {revisions && (
        <div className="mt-4">
          <h4 className="mb-2 text-sm font-semibold">Riwayat revisi</h4>
          <table className="w-full text-left text-xs">
            <thead><tr className="text-slate-500"><th>Versi</th><th>Aksi</th><th>Alasan</th><th></th></tr></thead>
            <tbody>
              {revisions.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="py-1">{r.version}</td>
                  <td>{r.action}</td>
                  <td className="max-w-xs truncate">{r.reason}</td>
                  <td className="text-right">
                    <button type="button" disabled={saving} onClick={() => handleRestore(r.id)}
                      className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-50">Pulihkan</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
