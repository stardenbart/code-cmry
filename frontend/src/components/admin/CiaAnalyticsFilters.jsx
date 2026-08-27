import { useEffect, useState } from "react";

const DAY_MS = 86400000;

function dateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function defaultDateRange(now = new Date()) {
  const today = new Date(now);
  const from = new Date(today);
  from.setDate(today.getDate() - 29);
  return { from: dateInput(from), to: dateInput(today) };
}

const EMPTY = {
  userId: "", department: "", dashboardId: "", surface: "",
  status: "", retrievalMethod: "",
};

export default function CiaAnalyticsFilters({ value = {}, options = {}, onApply }) {
  const [draft, setDraft] = useState({ ...defaultDateRange(), ...EMPTY, ...value });
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft({ ...defaultDateRange(), ...EMPTY, ...value });
  }, [value]);

  const change = (event) => {
    setDraft((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  const submit = () => {
    const from = new Date(`${draft.from}T00:00:00`);
    const to = new Date(`${draft.to}T00:00:00`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      setError("Rentang tanggal tidak valid.");
      return;
    }
    if (Math.floor((to - from) / DAY_MS) + 1 > 366) {
      setError("Rentang tanggal maksimal 366 hari.");
      return;
    }
    setError("");
    onApply(draft);
  };

  const reset = () => {
    const next = { ...defaultDateRange(), ...EMPTY };
    setDraft(next);
    setError("");
    onApply(next);
  };

  const keyDown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  };

  const fieldClass = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

  return (
    <div onKeyDown={keyDown} className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-xs font-medium text-slate-600">
          Dari tanggal
          <input className={fieldClass} type="date" name="from" value={draft.from} onChange={change} />
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-600">
          Sampai tanggal
          <input className={fieldClass} type="date" name="to" value={draft.to} onChange={change} />
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-600">
          User
          <select className={fieldClass} name="userId" value={draft.userId} onChange={change}>
            <option value="">Semua user</option>
            {(options.users || []).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-600">
          Departemen
          <select className={fieldClass} name="department" value={draft.department} onChange={change}>
            <option value="">Semua departemen</option>
            {(options.departments || []).map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-600">
          Dashboard
          <select className={fieldClass} name="dashboardId" value={draft.dashboardId} onChange={change}>
            <option value="">Semua dashboard</option>
            {(options.dashboards || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-600">
          Surface
          <select className={fieldClass} name="surface" value={draft.surface} onChange={change}>
            <option value="">Semua surface</option>
            {(options.surfaces || []).map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-600">
          Status
          <select className={fieldClass} name="status" value={draft.status} onChange={change}>
            <option value="">Semua status</option>
            {['success', 'partial', 'fallback', 'error'].map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-600">
          Retrieval
          <select className={fieldClass} name="retrievalMethod" value={draft.retrievalMethod} onChange={change}>
            <option value="">Semua metode</option>
            {['live_dax', 'mixed', 'snapshot', 'none'].map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
      </div>
      {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={reset} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">Reset</button>
        <button type="button" onClick={submit} className="rounded-lg bg-cimoryBlue px-4 py-2 text-sm font-medium text-white">Terapkan</button>
      </div>
    </div>
  );
}
