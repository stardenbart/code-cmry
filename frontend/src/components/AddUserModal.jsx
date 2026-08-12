import React, { useState, useEffect } from "react";
import { Loader, EyeIcon, EyeOffIcon } from "lucide-react";
import API from "../api/api"
import { useToast } from "./ToastProvider";

export default function AddUserModal({ onClose }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: "",
    department: "",
    access: "Department Access Only",
    role: "user",
    ciaAccess: false,
    nik: "",
    email: "",
    username: "",
    password: "",
  });
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = "auto";
    };
  }, []);

  const departments = [
    "Plant",
    "Dairy Service",
    "Engineering",
    "PPIC",
    "Production",
    "Warehouse",
    "Quality Control",
    "HRDGA",
    "Quality Assurance",
    "Performance Excellence",
    "Finance & Accounting",
    "Research & Innovation",
    "Project"
  ];

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const payload = {
        nama: form.name,
        departemen: form.department,
        tipe_akses: form.access,
        role: form.role,
        ciaAccess: form.ciaAccess,
        nik: form.nik,
        email: form.email,
        username: form.username,
        password: form.password,
      };
      const res = await API.post("/api/add-user", payload);
      if (res.status === 200) {
        toast.success("User berhasil ditambahkan");
        onClose();
      }
    } catch (err) {
      console.error(err);
      toast.error("Gagal menambahkan user");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50">
      <div className="bg-white p-6 w-[400px] shadow-xl">
        <h2 className="text-lg font-semibold mb-4 text-cimoryBlue">Add New User</h2>
        {["name", "department", "access", "role", "nik", "email", "username", "password"].map((key) => (
          <div key={key} className="mb-3">
            <label className="block text-sm font-medium capitalize mb-1">{key}</label>

            {key === "department" ? (
              <select
                className="border w-full p-2 rounded-lg"
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
              >
                <option value="">Select Department</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            ) : key === "access" ? (
              <select
                className="border w-full p-2 rounded-lg"
                value={form.access}
                onChange={(e) => setForm({ ...form, access: e.target.value })}
              >
                <option>Department Access Only</option>
                <option>All Access</option>
              </select>
            ) : key === "role" ? (
              // Wajib select, bukan input teks. Lewat teks bebas, admin bisa
              // menulis "Admin" dengan A besar: server menolaknya sebagai tidak
              // valid, dan kalaupun lolos, requireAdmin tidak akan mengenalinya.
              <select
                className="border w-full p-2 rounded-lg"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            ) : key === "password" ? (
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  className="border w-full p-2 rounded-lg pr-10"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-gray-500 hover:text-gray-700"
                >
                  {showPassword ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
                </button>
              </div>
            ) : (
              <input
                type="text"
                className="border w-full p-2 rounded-lg"
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            )}
          </div>
        ))}

        {/* Akses CIA. Di luar perulangan field karena ini checkbox, bukan input
            teks, dan memaksakannya masuk perulangan berarti perulangan itu harus
            tahu tipe tiap field. */}
        <div className="mb-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={Boolean(form.ciaAccess)}
              onChange={(e) => setForm({ ...form, ciaAccess: e.target.checked })}
            />
            Boleh memakai CIA
          </label>
          <p className="text-[12px] text-gray-500 mt-1">
            Bawaannya tidak. Fitur CIA memakai kuota AI bersama dan menampilkan
            analisa operasional, jadi dibuka satu per satu.
          </p>
        </div>

        <div className="flex justify-end space-x-2 mt-4">
          <button className="px-4 py-2 rounded-lg border hover:bg-gray-100" onClick={onClose}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-4 py-2 bg-cimoryBlue text-white rounded-lg hover:bg-blue-700 transition"
          >
            {loading ? <Loader className="animate-spin" size={18} /> : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
