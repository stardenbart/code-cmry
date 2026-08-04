import React, { useEffect, useState, useRef } from "react";
import {
  ArrowLeft, PlusCircle, Save, XCircle, Edit3, Trash2,
  Eye, EyeOff, Link2, ImagePlus, GripVertical,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import API from "../api/api";
import { useToast } from "./ToastProvider";
import { useConfirm } from "./ConfirmProvider";
import { normalkanUrlUnggahan } from "../utils/uploadUrl";

const EMPTY_FORM = { title: "", url: "", sort_order: 0, active: true };

// ── Image preview helper ──────────────────────────────────────────────────────
function ImageCell({ src, title }) {
  if (!src) return <span className="text-gray-300 text-xs italic">No image</span>;
  return (
    <img
      src={src}
      alt={title}
      className="w-12 h-12 object-contain rounded-lg border border-gray-200 bg-gray-50"
      onError={e => { e.target.style.display = "none"; }}
    />
  );
}

// ── File-input with preview ───────────────────────────────────────────────────
function ImageUpload({ currentUrl, onFileChange, onUrlChange }) {
  const [preview, setPreview] = useState(currentUrl || "");
  const fileRef = useRef(null);

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    onFileChange(file);
    setPreview(URL.createObjectURL(file));
  };

  const handleUrl = (e) => {
    setPreview(e.target.value);
    onUrlChange(e.target.value);
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Preview */}
      {preview && (
        <img
          src={preview}
          alt="preview"
          className="w-24 h-24 object-contain rounded-xl border border-gray-200 bg-gray-50 p-1"
          onError={e => { e.target.style.display = "none"; }}
        />
      )}
      {/* Upload file */}
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border border-dashed border-sky-400 text-sky-600 hover:bg-sky-50 transition w-fit"
      >
        <ImagePlus size={14} /> Upload image
      </button>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      {/* Or enter URL */}
      <input
        type="text"
        placeholder="…or paste image URL"
        value={preview.startsWith("blob:") ? "" : preview}
        onChange={handleUrl}
        className="border border-gray-300 rounded-lg p-2 text-xs focus:ring-2 focus:ring-sky-400 focus:outline-none w-full"
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function LandingPageManager() {
  const confirm = useConfirm();
  const toast = useToast();
  const [links, setLinks]               = useState([]);
  const [form, setForm]                 = useState(EMPTY_FORM);
  const [editingId, setEditingId]       = useState(null);
  const [imageFile, setImageFile]       = useState(null);
  const [imageUrl, setImageUrl]         = useState("");
  const [saving, setSaving]             = useState(false);
  const navigate = useNavigate();

  const authHeader = () => ({
    headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
  });

  // Fetch all (including hidden) for admin view
  const fetchLinks = async () => {
    try {
      const res = await API.get("/api/portal-links/all", authHeader());
      setLinks(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Failed to fetch portal links:", err);
    }
  };

  useEffect(() => { fetchLinks(); }, []);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setImageFile(null);
    setImageUrl("");
  };

  const startEdit = (link) => {
    setEditingId(link.id);
    setForm({ title: link.title, url: link.url, sort_order: link.sort_order, active: !!link.active });
    setImageFile(null);
    setImageUrl(link.image_url || "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const buildFormData = () => {
    const fd = new FormData();
    fd.append("title",      form.title);
    fd.append("url",        form.url);
    fd.append("sort_order", form.sort_order);
    fd.append("active",     form.active ? "1" : "0");
    if (imageFile)      fd.append("image", imageFile);
    else if (imageUrl)  fd.append("image_url", imageUrl);
    return fd;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title || !form.url) return;
    setSaving(true);
    try {
      const fd = buildFormData();
      if (editingId) {
        await API.put(`/api/portal-links/${editingId}`, fd, {
          ...authHeader(),
          headers: { ...authHeader().headers, "Content-Type": "multipart/form-data" },
        });
      } else {
        await API.post("/api/portal-links", fd, {
          ...authHeader(),
          headers: { ...authHeader().headers, "Content-Type": "multipart/form-data" },
        });
      }
      await fetchLinks();
      resetForm();
    } catch (err) {
      toast.error(err.response?.data?.message || "Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id, judul) => {
    const setuju = await confirm({
      judul: "Hapus tautan portal",
      pesan: `"${judul}" akan hilang dari halaman portal.`,
      labelKonfirmasi: "Hapus",
      destruktif: true,
    });
    if (!setuju) return;
    try {
      await API.delete(`/api/portal-links/${id}`, authHeader());
      setLinks(prev => prev.filter(l => l.id !== id));
      toast.success(`Tautan "${judul}" dihapus`);
    } catch (err) {
      toast.error(err.response?.data?.message || "Gagal menghapus");
    }
  };

  const toggleActive = async (link) => {
    try {
      const fd = new FormData();
      fd.append("title",      link.title);
      fd.append("url",        link.url);
      fd.append("sort_order", link.sort_order);
      fd.append("active",     link.active ? "0" : "1");
      if (link.image_url) fd.append("image_url", link.image_url);
      await API.put(`/api/portal-links/${link.id}`, fd, {
        ...authHeader(),
        headers: { ...authHeader().headers, "Content-Type": "multipart/form-data" },
      });
      setLinks(prev => prev.map(l => l.id === link.id ? { ...l, active: l.active ? 0 : 1 } : l));
    } catch (err) {
      toast.error("Gagal mengubah status tampil");
    }
  };

  const inputCls = "border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-sky-400 focus:outline-none w-full";

  return (
    <div className="min-h-screen bg-gradient-to-br from-cimoryBlue/10 via-white to-cimoryRed/10">
      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8">

        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
          <button
            onClick={() => navigate("/cop")}
            className="flex items-center gap-2 text-cimoryBlue font-semibold hover:text-cimoryRed transition text-sm shrink-0"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Portal
          </button>
          <h1 className="text-2xl sm:text-3xl font-bold text-cimoryBlue tracking-tight">
            Portal Link Manager
          </h1>
        </div>

        {/* ── Add / Edit form ── */}
        <form
          onSubmit={handleSubmit}
          className="bg-white/80 backdrop-blur-sm border border-sky-200 shadow-md rounded-2xl p-5 sm:p-6 mb-8"
        >
          <h2 className="text-base font-semibold text-cimoryBlue mb-4">
            {editingId ? "Edit Link" : "Add New Link"}
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Title */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Title *</label>
              <input
                type="text" placeholder="e.g. Production Performance"
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                className={inputCls} required
              />
            </div>

            {/* URL */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium flex items-center gap-1">
                <Link2 size={11} /> Destination URL *
              </label>
              <input
                type="url" placeholder="https://..."
                value={form.url}
                onChange={e => setForm({ ...form, url: e.target.value })}
                className={inputCls} required
              />
            </div>

            {/* Sort order */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium flex items-center gap-1">
                <GripVertical size={11} /> Sort Order
              </label>
              <input
                type="number" min="0"
                value={form.sort_order}
                onChange={e => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })}
                className={`${inputCls} w-28`}
              />
            </div>

            {/* Active toggle */}
            <div className="flex flex-col gap-1 justify-end">
              <label className="text-xs text-gray-500 font-medium">Visibility</label>
              <button
                type="button"
                onClick={() => setForm({ ...form, active: !form.active })}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition w-fit ${
                  form.active
                    ? "bg-green-100 text-green-700 hover:bg-green-200"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                }`}
              >
                {form.active ? <Eye size={14} /> : <EyeOff size={14} />}
                {form.active ? "Visible" : "Hidden"}
              </button>
            </div>

            {/* Image upload — spans full width */}
            <div className="sm:col-span-2 flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Icon / Image</label>
              <ImageUpload
                currentUrl={imageUrl}
                onFileChange={f => { setImageFile(f); setImageUrl(""); }}
                onUrlChange={url => { setImageUrl(url); setImageFile(null); }}
              />
            </div>
          </div>

          <div className="mt-5 flex gap-3 justify-end">
            {editingId && (
              <button
                type="button" onClick={resetForm}
                className="flex items-center gap-2 bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300 text-sm"
              >
                <XCircle size={15} /> Cancel
              </button>
            )}
            <button
              type="submit" disabled={saving}
              className="flex items-center gap-2 bg-cimoryBlue text-white font-semibold px-5 py-2.5 rounded-lg hover:bg-cimoryRed transition text-sm disabled:opacity-50"
            >
              {editingId
                ? <><Save size={15} /> {saving ? "Saving…" : "Save Changes"}</>
                : <><PlusCircle size={15} /> {saving ? "Adding…" : "Add Link"}</>
              }
            </button>
          </div>
        </form>

        {/* ── Links table ── */}
        <div className="bg-white/80 backdrop-blur-sm border border-gray-200 rounded-2xl shadow-md overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="font-semibold text-cimoryBlue text-sm">
              All Portal Links ({links.length})
            </span>
            <span className="text-xs text-gray-400">
              {links.filter(l => l.active).length} visible · {links.filter(l => !l.active).length} hidden
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[640px]">
              <thead className="bg-gradient-to-r from-cimoryBlue to-cimoryRed text-white text-sm">
                <tr>
                  <th className="p-3 text-left font-medium w-14">Icon</th>
                  <th className="p-3 text-left font-medium">Title</th>
                  <th className="p-3 text-left font-medium">URL</th>
                  <th className="p-3 text-center font-medium w-16">Order</th>
                  <th className="p-3 text-center font-medium w-20">Status</th>
                  <th className="p-3 text-center font-medium w-28">Actions</th>
                </tr>
              </thead>
              <tbody>
                {links.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-gray-400 text-sm">
                      No links yet. Add your first one above.
                    </td>
                  </tr>
                ) : links.map(link => (
                  <tr
                    key={link.id}
                    className={`border-b transition-colors ${
                      link.active ? "hover:bg-sky-50" : "bg-gray-50 opacity-60 hover:bg-gray-100"
                    }`}
                  >
                    <td className="p-3">
                      <ImageCell src={normalkanUrlUnggahan(link.image_url)} title={link.title} />
                    </td>
                    <td className="p-3 font-medium text-sm">{link.title}</td>
                    <td className="p-3 text-xs text-gray-500 max-w-[200px] truncate" title={link.url}>
                      {link.url}
                    </td>
                    <td className="p-3 text-center text-sm text-gray-500">{link.sort_order}</td>
                    <td className="p-3 text-center">
                      <button
                        onClick={() => toggleActive(link)}
                        className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium transition ${
                          link.active
                            ? "bg-green-100 text-green-700 hover:bg-green-200"
                            : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                        }`}
                      >
                        {link.active ? <Eye size={11} /> : <EyeOff size={11} />}
                        {link.active ? "Visible" : "Hidden"}
                      </button>
                    </td>
                    <td className="p-3 text-center">
                      <div className="flex gap-2 justify-center">
                        <button
                          onClick={() => startEdit(link)}
                          className="text-sky-600 hover:text-sky-800 flex items-center gap-1 text-xs"
                        >
                          <Edit3 size={13} /> Edit
                        </button>
                        <button
                          onClick={() => handleDelete(link.id, link.title)}
                          className="text-red-500 hover:text-red-700 flex items-center gap-1 text-xs"
                        >
                          <Trash2 size={13} /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
