import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useConfirm } from "../ConfirmProvider.jsx";
import * as ciaAdminApi from "../../services/ciaAdminApi.js";

export default function CiaAccessTab({ data }) {
  const confirm = useConfirm();
  const [users, setUsers] = useState(data?.users || []);
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setUsers(data?.users || []);
    setSelected(new Set());
  }, [data]);

  const departments = useMemo(() => [...new Set(users.map((user) => user.department).filter(Boolean))].sort(), [users]);
  const visibleUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users.filter((user) => {
      const matchesText = !needle || [user.name, user.username, user.department]
        .some((value) => String(value || "").toLowerCase().includes(needle));
      return matchesText && (!department || user.department === department);
    });
  }, [users, query, department]);

  const toggleOne = async (user, enabled) => {
    const previousUsers = users;
    setError("");
    setUsers((current) => current.map((item) => item.id === user.id ? { ...item, ciaAccess: enabled } : item));
    try {
      await ciaAdminApi.updateAccess(user.id, enabled);
    } catch {
      setUsers(previousUsers);
      setError(`Akses CIA untuk ${user.name} gagal diperbarui.`);
    }
  };

  const updateSelected = async (enabled) => {
    const targetIds = [...selected];
    if (!targetIds.length) return;
    const accepted = await confirm({
      judul: `${enabled ? "Aktifkan" : "Nonaktifkan"} akses CIA`,
      pesan: `Perubahan akan diterapkan ke ${targetIds.length} user terpilih.`,
      labelKonfirmasi: "Terapkan",
      destruktif: !enabled,
    });
    if (!accepted) return;

    const previousUsers = users;
    setSaving(true);
    setError("");
    setUsers((current) => current.map((user) => targetIds.includes(user.id) ? { ...user, ciaAccess: enabled } : user));
    try {
      await Promise.all(targetIds.map((id) => ciaAdminApi.updateAccess(id, enabled)));
      setSelected(new Set());
    } catch {
      setUsers(previousUsers);
      setError("Sebagian perubahan akses gagal. Seluruh tampilan dikembalikan ke kondisi sebelumnya.");
    } finally {
      setSaving(false);
    }
  };

  const toggleSelection = (id) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <label className="relative">
          <span className="sr-only">Cari user</span>
          <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari user, username, atau departemen" className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3" />
        </label>
        <select value={department} onChange={(event) => setDepartment(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2">
          <option value="">Semua departemen</option>
          {departments.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-500">{selected.size} user dipilih</span>
        <button type="button" disabled={!selected.size || saving} onClick={() => updateSelected(true)} className="rounded-lg bg-cimoryBlue px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Aktifkan CIA</button>
        <button type="button" disabled={!selected.size || saving} onClick={() => updateSelected(false)} className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-50">Nonaktifkan CIA</button>
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600"><tr><th className="p-3">Pilih</th><th className="p-3">Nama</th><th className="p-3">Departemen</th><th className="p-3">Role</th><th className="p-3">Approved</th><th className="p-3">Akses CIA</th></tr></thead>
          <tbody>
            {visibleUsers.map((user) => (
              <tr key={user.id} className="border-t border-slate-100">
                <td className="p-3"><input type="checkbox" aria-label={`Pilih ${user.name}`} checked={selected.has(user.id)} onChange={() => toggleSelection(user.id)} /></td>
                <td className="p-3"><div className="font-medium">{user.name}</div><div className="text-xs text-slate-500">{user.username}</div></td>
                <td className="p-3">{user.department || "-"}</td><td className="p-3">{user.role || "user"}</td>
                <td className="p-3">{user.approved ? "Approved" : "Belum approved"}</td>
                <td className="p-3"><label className="inline-flex items-center gap-2"><input type="checkbox" checked={Boolean(user.ciaAccess)} onChange={(event) => toggleOne(user, event.target.checked)} /><span>{user.ciaAccess ? "Aktif" : "Tidak aktif"}</span></label></td>
              </tr>
            ))}
            {!visibleUsers.length && <tr><td colSpan="6" className="p-6 text-center text-slate-500">User tidak ditemukan.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
