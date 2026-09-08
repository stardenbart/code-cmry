import React, { useEffect, useState, useRef } from "react";
import { ArrowLeft, PlusCircle, Save, XCircle, Edit3, Trash2, X, Mail, Link2, CheckCircle2, AlertTriangle
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import API from "../api/api";
import { useConfirm } from "./ConfirmProvider";
import { useToast } from "./ToastProvider";

// ── Tag-input for PIC emails ──────────────────────────────────────────────────
function EmailTagInput({ emails, onChange }) {
  const [input, setInput] = useState("");
  const inputRef = useRef(null);

  const addEmail = () => {
    const val = input.trim().toLowerCase();
    if (val && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val) && !emails.includes(val)) {
      onChange([...emails, val]);
    }
    setInput("");
  };

  const remove = (email) => onChange(emails.filter(e => e !== email));

  const onKeyDown = (e) => {
    if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
      e.preventDefault();
      addEmail();
    } else if (e.key === "Backspace" && !input && emails.length) {
      remove(emails[emails.length - 1]);
    }
  };

  return (
    <div
      className="flex flex-wrap gap-1.5 items-center border border-gray-300 rounded-lg px-2 py-1.5 min-h-[42px] w-full focus-within:ring-2 focus-within:ring-sky-400 bg-white cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      {emails.map(email => (
        <span key={email} className="flex items-center gap-1 bg-sky-100 text-sky-800 text-xs font-medium px-2 py-1 rounded-full">
          <Mail size={10} />
          {email}
          <button type="button" onClick={() => remove(email)} className="hover:text-red-500 ml-0.5">
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={addEmail}
        placeholder={emails.length === 0 ? "Type email, press Enter..." : ""}
        className="outline-none text-sm flex-1 min-w-[140px] bg-transparent"
      />
    </div>
  );
}

const toEmailArray = (str) =>
  (str || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);

const toEmailString = (arr) => arr.join(",");

// ── Report ID validation ──────────────────────────────────────────────────────
// Export Mode and Ask AI need a real report GUID. A public "view?r=..." link is
// NOT usable: the token inside it is a share key, not the report ID.
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const reportIdState = (value) => {
  const raw = (value || "").trim();
  if (!raw) return { level: "empty", message: "Kosong. Export Mode dan CIA tidak aktif untuk dashboard ini." };
  if (GUID_RE.test(raw)) return { level: "ok", message: "Report GUID valid. Export Mode dan CIA aktif." };
  if (/[?&]reportId=([0-9a-f-]{36})/i.test(raw)) {
    const guid = raw.match(/[?&]reportId=([0-9a-f-]{36})/i)[1];
    return { level: "warn", message: `Terdeteksi URL. GUID-nya: ${guid}. Sebaiknya isi GUID-nya saja.` };
  }
  return {
    level: "error",
    message: 'Bukan Report GUID. Jangan pakai link "view?r=...". Ambil GUID dari URL report: app.powerbi.com/groups/.../reports/<GUID>/...',
  };
};

const HINT_COLOR = { ok: "text-green-600", warn: "text-amber-600", error: "text-red-600", empty: "text-gray-400" };

function ReportIdHint({ value }) {
  const { level, message } = reportIdState(value);
  return <p className={`text-[10.5px] mt-0.5 ${HINT_COLOR[level]}`}>{message}</p>;
}

// ── Shared form field ─────────────────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-500 font-medium">{label}</label>
      {children}
    </div>
  );
}

const inputCls = "border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-sky-400 text-sm w-full";

// ── Main component ────────────────────────────────────────────────────────────
const DashboardManager = () => {
  const confirm = useConfirm();
  const toast = useToast();
  const [dashboards, setDashboards]               = useState([]);
  const [newDashboard, setNewDashboard]           = useState({ title: "", url: "", report_id: "", department: "", description: "", pic_emails: "" });
  const [newEmails, setNewEmails]                 = useState([]);
  const [editingDashboard, setEditingDashboard]   = useState(null);
  const [editEmails, setEditEmails]               = useState([]);
  const [plants, setPlants]                       = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    API.get("/api/dashboards")
      .then((res) => {
        if (Array.isArray(res.data))       setDashboards(res.data);
        else if (Array.isArray(res.data.data)) setDashboards(res.data.data);
        else setDashboards([]);
      })
      .catch((err) => console.error("Error fetching dashboards:", err));
    API.get("/api/plants")
      .then((res) => setPlants(Array.isArray(res.data) ? res.data : []))
      .catch((err) => console.error("Error fetching plants:", err));
  }, []);

  // Dropdown Plant + Department dependen. Menyetel plant_id/department_id dan
  // menyinkronkan `department` (nama) untuk kompatibilitas kolom lama.
  const plantDeptFields = (obj, setObj) => {
    const selectedPlant = plants.find((p) => Number(p.id) === Number(obj.plant_id));
    const depts = selectedPlant?.departments || [];
    return (
      <>
        <Field label="Plant">
          <select
            value={obj.plant_id || ""}
            onChange={(e) => setObj({ ...obj, plant_id: e.target.value ? Number(e.target.value) : "", department_id: "", department: "" })}
            className={inputCls}
          >
            <option value="">Pilih Plant</option>
            {plants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Department">
          <select
            value={obj.department_id || ""}
            disabled={!obj.plant_id}
            onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : "";
              const d = depts.find((x) => Number(x.id) === id);
              setObj({ ...obj, department_id: id, department: d?.name || "" });
            }}
            className={inputCls}
          >
            <option value="">Pilih Department</option>
            {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
      </>
    );
  };

  const handleDelete = async (id, judul) => {
    const setuju = await confirm({
      judul: "Hapus dashboard",
      pesan: `"${judul}" akan dihapus dari daftar. Laporan Power BI aslinya tidak terpengaruh.`,
      labelKonfirmasi: "Hapus",
      destruktif: true,
    });
    if (!setuju) return;
    try {
      await API.delete(`/api/dashboards/${id}`);
      setDashboards((prev) => prev.filter((d) => d.id !== id));
      toast.success(`Dashboard "${judul}" dihapus`);
    } catch (err) {
      // Dulu hanya console.error, sehingga hapus yang gagal tidak menampilkan
      // apa pun dan user mengira berhasil.
      console.error("Error deleting:", err);
      toast.error(err?.response?.data?.message || "Gagal menghapus dashboard");
    }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...newDashboard, pic_emails: toEmailString(newEmails) };
      const res = await API.post("/api/dashboards", payload);
      setDashboards((prev) => [...prev, { ...payload, id: res.data.id }]);
      setNewDashboard({ title: "", url: "", department: "", description: "", pic_emails: "" });
      setNewEmails([]);
    } catch (err) { console.error("Error adding dashboard:", err); }
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...editingDashboard, pic_emails: toEmailString(editEmails) };
      await API.put(`/api/dashboards/${editingDashboard.id}`, payload);
      setDashboards((prev) => prev.map((d) => (d.id === editingDashboard.id ? payload : d)));
      setEditingDashboard(null);
      setEditEmails([]);
    } catch (err) { console.error("Error updating dashboard:", err); }
  };

  const startEdit = (d) => {
    setEditingDashboard(d);
    setEditEmails(toEmailArray(d.pic_emails));
  };

  const formCard = "bg-white/80 backdrop-blur-sm border border-sky-200 shadow-md rounded-2xl p-5 sm:p-6 mb-8";

  return (
    <div className="min-h-screen bg-gradient-to-br from-cimoryBlue/10 via-white to-cimoryRed/10 relative overflow-hidden">
      <div className="absolute inset-0 bg-[url('/images/bg_pattern_cimory.svg')] bg-cover bg-center opacity-10 pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-8 py-7 sm:py-10">

        {/* ── Page header ── */}
        <div className="flex items-center justify-between mb-7 sm:mb-10 gap-4 flex-wrap">
          <button
            onClick={() => navigate("/App")}
            className="flex items-center gap-2 text-cimoryBlue font-semibold hover:text-cimoryRed transition text-sm sm:text-base shrink-0"
          >
            <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" />
            Back to App
          </button>
          <h1 className="text-2xl sm:text-3xl font-bold text-cimoryBlue tracking-tight drop-shadow-sm">
            Dashboard Manager
          </h1>
        </div>

        {/* ── Add form ── */}
        {!editingDashboard && (
          <form onSubmit={handleAdd} className={formCard}>
            <h2 className="text-base font-semibold text-cimoryBlue mb-4">Add New Dashboard</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Field label="Title">
                <input type="text" placeholder="Title" value={newDashboard.title}
                  onChange={(e) => setNewDashboard({ ...newDashboard, title: e.target.value })}
                  className={inputCls} required />
              </Field>

	      <Field label="Public Embed URL">
	        <input type="text" placeholder="https://app.powerbi.com/view?r=..." 
	          value={newDashboard.url}
	          onChange={(e) => setNewDashboard({ ...newDashboard, url: e.target.value })}
	          className={inputCls} />
	      </Field>

	      <Field label="Report ID (Export Mode & CIA)">
	        <input type="text" placeholder="contoh: 60f4984e-db53-4948-8bb3-0f6b932958c3"
	          value={newDashboard.report_id}
	          onChange={(e) => setNewDashboard({ ...newDashboard, report_id: e.target.value })}
	          className={inputCls} />
	        <ReportIdHint value={newDashboard.report_id} />
	      </Field>

              {plantDeptFields(newDashboard, setNewDashboard)}

              <Field label="Description">
                <input type="text" placeholder="Description" value={newDashboard.description}
                  onChange={(e) => setNewDashboard({ ...newDashboard, description: e.target.value })}
                  className={inputCls} />
              </Field>

              <div className="sm:col-span-2 lg:col-span-2">
                <Field label={
                  <span className="flex items-center gap-1">
                    <Mail size={11} /> PIC Emails
                    <span className="text-gray-400 font-normal">(access request recipients)</span>
                  </span>
                }>
                  <EmailTagInput emails={newEmails} onChange={setNewEmails} />
                </Field>
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button type="submit"
                className="flex items-center gap-2 bg-cimoryBlue text-white font-semibold px-5 py-2.5 rounded-lg hover:bg-cimoryRed transition text-sm">
                <PlusCircle className="w-4 h-4" /> Add Dashboard
              </button>
            </div>
          </form>
        )}

        {/* ── Edit form ── */}
        {editingDashboard && (
          <form onSubmit={handleEditSubmit} className={formCard}>
            <h2 className="text-base font-semibold text-cimoryBlue mb-4">Edit Dashboard</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Field label="Title">
                <input type="text" placeholder="Title" value={editingDashboard.title}
                  onChange={(e) => setEditingDashboard({ ...editingDashboard, title: e.target.value })}
                  className={inputCls} />
              </Field>

	      <Field label="Public Embed URL">
	        <input type="text" placeholder="https://app.powerbi.com/view?r=..."
	          value={editingDashboard.url}
	          onChange={(e) => setEditingDashboard({ ...editingDashboard, url: e.target.value })}
	          className={inputCls} />
	      </Field>

              <Field label="Report ID (Export Mode & CIA)">
	        <input type="text" placeholder="contoh: 60f4984e-db53-4948-8bb3-0f6b932958c3"
	          value={editingDashboard.report_id || ""}
	          onChange={(e) => setEditingDashboard({ ...editingDashboard, report_id: e.target.value })}
	          className={inputCls} />
	        <ReportIdHint value={editingDashboard.report_id} />
	      </Field>

              {plantDeptFields(editingDashboard, setEditingDashboard)}

              <Field label="Description">
                <input type="text" placeholder="Description" value={editingDashboard.description}
                  onChange={(e) => setEditingDashboard({ ...editingDashboard, description: e.target.value })}
                  className={inputCls} />
              </Field>

              <div className="sm:col-span-2 lg:col-span-2">
                <Field label={<span className="flex items-center gap-1"><Mail size={11} /> PIC Emails</span>}>
                  <EmailTagInput emails={editEmails} onChange={setEditEmails} />
                </Field>
              </div>
            </div>

            <div className="mt-5 flex gap-3 justify-end">
              <button type="submit"
                className="flex items-center gap-2 bg-sky-600 text-white px-4 py-2 rounded-lg hover:bg-sky-700 text-sm">
                <Save className="w-4 h-4" /> Save
              </button>
              <button type="button" onClick={() => { setEditingDashboard(null); setEditEmails([]); }}
                className="flex items-center gap-2 bg-gray-300 px-4 py-2 rounded-lg hover:bg-gray-400 text-sm">
                <XCircle className="w-4 h-4" /> Cancel
              </button>
            </div>
          </form>
        )}

        {/* ── Table ── */}
        <div className="bg-white/80 backdrop-blur-sm border border-gray-200 rounded-2xl shadow-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[640px]">
              <thead className="bg-gradient-to-r from-cimoryBlue to-cimoryRed text-white">
                <tr>
                  <th className="p-3 text-left font-medium text-sm">Title</th>
                  <th className="p-3 text-left font-medium text-sm">Department</th>
                  <th className="p-3 text-left font-medium text-sm">Public URL</th>
                  <th className="p-3 text-left font-medium text-sm">Report ID</th>
                  <th className="p-3 text-left font-medium text-sm">PIC Emails</th>
                  <th className="p-3 text-center font-medium text-sm">Action</th>
                </tr>
              </thead>
              <tbody>
                {dashboards.length > 0 ? (
                  dashboards.map((d) => (
                    <tr key={d.id} className="border-b hover:bg-sky-50 transition-colors">
                      <td className="p-3 font-medium text-sm">{d.title}</td>
                      <td className="p-3 text-sm">{d.department}</td>
                      <td className="p-3 font-mono text-xs text-gray-500 truncate max-w-[150px]" title={d.url}>
		         {d.url
                            ? <Link2 size={14} className="text-green-600" aria-label="URL terisi" />
                            : <span className="text-gray-300 text-xs">Belum diisi</span>}
		      </td>
		      <td className="p-3 font-mono text-xs text-gray-500 max-w-[150px]" title={d.report_id}>
		         {(() => {
		           const { level, message } = reportIdState(d.report_id);
		           if (level === "ok")    return <CheckCircle2 size={14} className="text-green-600" aria-label="Report GUID valid" />;
		           if (level === "warn")  return <AlertTriangle size={14} className="text-amber-600" aria-label={message} />;
		           if (level === "error") return <XCircle size={14} className="text-red-600" aria-label={message} />;
		           return <span className="text-gray-300 text-xs">Belum diisi</span>;
		         })()}
		       </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          {toEmailArray(d.pic_emails).length > 0
                            ? toEmailArray(d.pic_emails).map(email => (
                              <span key={email} className="inline-flex items-center gap-1 bg-sky-100 text-sky-800 text-xs px-2 py-0.5 rounded-full whitespace-nowrap">
                                <Mail size={9} />{email}
                              </span>
                            ))
                            : <span className="text-gray-400 text-xs italic">None</span>
                          }
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex gap-2 justify-center">
                          <button onClick={() => startEdit(d)}
                            className="text-sky-600 hover:text-sky-800 flex items-center gap-1 text-xs sm:text-sm whitespace-nowrap">
                            <Edit3 className="w-3.5 h-3.5" /> Edit
                          </button>
                          <button onClick={() => handleDelete(d.id, d.title)}
                            className="text-red-600 hover:text-red-800 flex items-center gap-1 text-xs sm:text-sm whitespace-nowrap">
                            <Trash2 className="w-3.5 h-3.5" /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="5" className="p-6 text-center text-gray-500 text-sm">No dashboards found</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
};

export default DashboardManager;
