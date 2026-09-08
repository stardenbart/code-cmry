import React, { useEffect, useState } from "react";
import API from "../api/api";
import { X, Plus, Trash2, Factory, Building2 } from "lucide-react";
import { useToast } from "./ToastProvider";
import { useConfirm } from "./ConfirmProvider.jsx";

// Admin: kelola Plant & Department (per-plant). Semua mutasi lewat /api/plants
// (requireAdmin di server). Non-destruktif terhadap dashboard/user existing.
export default function PlantManager({ onClose }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [plants, setPlants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newPlant, setNewPlant] = useState({ name: "", code: "" });
  const [newDept, setNewDept] = useState({}); // plantId -> name

  const load = async () => {
    setLoading(true);
    try {
      const res = await API.get("/api/plants");
      setPlants(Array.isArray(res.data) ? res.data : []);
    } catch {
      toast.error("Gagal memuat plant");
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const addPlant = async (e) => {
    e.preventDefault();
    if (!newPlant.name.trim() || !newPlant.code.trim()) return;
    try {
      await API.post("/api/plants", newPlant);
      setNewPlant({ name: "", code: "" });
      await load();
      toast.success("Plant ditambahkan");
    } catch (err) { toast.error(err?.response?.data?.message || "Gagal menambah plant"); }
  };

  const removePlant = async (p) => {
    const ok = await confirm({
      judul: "Hapus plant", destruktif: true, labelKonfirmasi: "Hapus",
      pesan: `Plant "${p.name}" beserta department-nya akan dihapus. Dashboard yang terkait akan kehilangan pemetaan plant.`,
    });
    if (!ok) return;
    try { await API.delete(`/api/plants/${p.id}`); await load(); toast.success("Plant dihapus"); }
    catch (err) { toast.error(err?.response?.data?.message || "Gagal menghapus plant"); }
  };

  const addDept = async (plantId) => {
    const name = (newDept[plantId] || "").trim();
    if (!name) return;
    try {
      await API.post(`/api/plants/${plantId}/departments`, { name });
      setNewDept((s) => ({ ...s, [plantId]: "" }));
      await load();
    } catch (err) { toast.error(err?.response?.data?.message || "Gagal menambah department"); }
  };

  const removeDept = async (dep) => {
    const ok = await confirm({
      judul: "Hapus department", destruktif: true, labelKonfirmasi: "Hapus",
      pesan: `Department "${dep.name}" akan dihapus.`,
    });
    if (!ok) return;
    try { await API.delete(`/api/plants/departments/${dep.id}`); await load(); }
    catch (err) { toast.error(err?.response?.data?.message || "Gagal menghapus department"); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex justify-center items-start z-50 overflow-y-auto p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-8">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Factory size={20} /> Kelola Plant & Department
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100"><X size={18} /></button>
        </div>

        <div className="p-5">
          <form onSubmit={addPlant} className="flex flex-wrap items-end gap-2 mb-5">
            <div>
              <label className="block text-xs text-gray-500">Nama Plant</label>
              <input value={newPlant.name} onChange={(e) => setNewPlant({ ...newPlant, name: e.target.value })}
                className="border rounded-lg px-3 py-2 w-44" placeholder="mis. Cikupa" />
            </div>
            <div>
              <label className="block text-xs text-gray-500">Kode</label>
              <input value={newPlant.code} onChange={(e) => setNewPlant({ ...newPlant, code: e.target.value })}
                className="border rounded-lg px-3 py-2 w-28" placeholder="mis. 1002" />
            </div>
            <button type="submit" className="rounded-lg bg-cimoryBlue text-white px-3 py-2 text-sm flex items-center gap-1">
              <Plus size={16} /> Tambah Plant
            </button>
          </form>

          {loading && <p className="text-gray-500 text-sm">Memuat...</p>}
          {!loading && plants.length === 0 && <p className="text-gray-500 text-sm">Belum ada plant.</p>}

          <ul className="space-y-4">
            {plants.map((p) => (
              <li key={p.id} className="border rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium flex items-center gap-2">
                    <Factory size={16} /> {p.name} <span className="text-xs text-gray-400">({p.code})</span>
                  </span>
                  <button onClick={() => removePlant(p)} className="text-red-600 hover:bg-red-50 rounded p-1" aria-label={`Hapus plant ${p.name}`}>
                    <Trash2 size={16} />
                  </button>
                </div>
                <ul className="ml-1 space-y-1 mb-2">
                  {(p.departments || []).map((dep) => (
                    <li key={dep.id} className="flex items-center justify-between text-sm bg-gray-50 rounded px-2 py-1">
                      <span className="flex items-center gap-1.5"><Building2 size={13} className="text-gray-400" /> {dep.name}</span>
                      <button onClick={() => removeDept(dep)} className="text-red-500 hover:bg-red-50 rounded p-0.5" aria-label={`Hapus department ${dep.name}`}>
                        <Trash2 size={13} />
                      </button>
                    </li>
                  ))}
                  {(p.departments || []).length === 0 && <li className="text-xs text-gray-400">Belum ada department.</li>}
                </ul>
                <div className="flex items-center gap-2">
                  <input
                    value={newDept[p.id] || ""}
                    onChange={(e) => setNewDept((s) => ({ ...s, [p.id]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDept(p.id); } }}
                    className="border rounded-lg px-2 py-1 text-sm flex-1" placeholder="Department baru" />
                  <button onClick={() => addDept(p.id)} className="rounded-lg border px-2 py-1 text-sm flex items-center gap-1">
                    <Plus size={14} /> Dept
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
