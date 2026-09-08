import React, { useState, useEffect } from "react";
import { UserPlus, Eye, EyeOff, ChevronDown, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import API from "../api/api"
import { useToast } from "./ToastProvider";

export default function RegisterPage() {
  const toast = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    nama: "",
    plantId: "",
    departemen: "",
    tipe_akses: "Department Access Only",
    nik: "",
    email: "",
    username: "",
    password: "",
  });
  const [plants, setPlants] = useState([]);
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    API.get("/api/plants")
      .then((res) => setPlants(Array.isArray(res.data) ? res.data : []))
      .catch(() => setPlants([]));
  }, []);

  // Department menyesuaikan plant yang dipilih.
  const selectedPlant = plants.find((p) => String(p.id) === String(form.plantId));
  const departments = (selectedPlant?.departments || []).map((d) => d.name);

  const accessTypes = ["Department Access Only"];

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    setErrors({ ...errors, [e.target.name]: "" });
  };

  const validateForm = () => {
    const newErrors = {};
    Object.entries(form).forEach(([key, value]) => {
      if (!value.trim()) {
        newErrors[key] = "This field is required.";
      }
    });
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleRegister = async () => {
    if (!validateForm()) {
      toast.warning("Lengkapi dulu semua kolom wajib");
      return;
    }

    setLoading(true);
    try {
      const res = await API.post("/api/register", form);
      const data = res.data;
      setLoading(false);

      if (data.error) {
        toast.error(data.message || "Pendaftaran gagal");
        return;
      }

      toast.success("Pendaftaran berhasil. Tunggu persetujuan admin.");

      setForm({
        nama: "",
        departemen: "",
        tipe_akses: "Department Access Only",
        nik: "",
        email: "",
        username: "",
        password: "",
      });

      navigate("/login");
    } catch (err) {
      console.error(err);
      setLoading(false);
      toast.error(err.response?.data?.message || "Terjadi kesalahan di server");
    }
  };

  return (
    <div className="relative h-screen flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-cimoryBlue via-sky-200 to-cimoryRed animate-gradient-slow"></div>

      <div className="absolute top-10 left-10 w-72 h-72 bg-cimoryBlue/20 blur-3xl rounded-full animate-float-slow"></div>
      <div className="absolute bottom-10 right-10 w-96 h-96 bg-cimoryRed/20 blur-3xl rounded-full animate-float-fast"></div>

      <div className="relative z-10 bg-white/20 backdrop-blur-xl border border-white/30 p-10 rounded-3xl shadow-2xl w-[480px]">
        <h2 className="text-3xl font-extrabold text-center text-cimoryBlue drop-shadow-md mb-6">
          Register User
        </h2>

        <div className="space-y-4">
          <div>
            <input
              type="text"
              name="nama"
              placeholder="Fullname"
              value={form.nama}
              onChange={handleChange}
              className={`w-full p-3 border ${
                errors.nama ? "border-red-400" : "border-white/30"
              } bg-white/60 text-gray-800 rounded-xl focus:ring-2 focus:ring-cimoryBlue hover:border-cimoryBlue transition-all outline-none`}
            />
            {errors.nama && (
              <p className="text-red-500 text-xs mt-1">{errors.nama}</p>
            )}
          </div>

          <div className="relative">
            <select
              name="plantId"
              value={form.plantId}
              onChange={(e) => { setForm({ ...form, plantId: e.target.value, departemen: "" }); setErrors({ ...errors, plantId: "" }); }}
              className={`w-full appearance-none p-3 border ${
                errors.plantId ? "border-red-400" : "border-white/30"
              } bg-white/60 text-gray-800 rounded-xl outline-none pr-10 focus:ring-2 focus:ring-cimoryBlue hover:border-cimoryBlue`}
            >
              <option value="">Choose Plant</option>
              {plants.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
              ))}
            </select>
            <ChevronDown size={20} className="absolute right-3 top-3 text-gray-500 pointer-events-none" />
            {errors.plantId && (<p className="text-red-500 text-xs mt-1">{errors.plantId}</p>)}
          </div>

          <div className="relative">
            <select
              name="departemen"
              value={form.departemen}
              onChange={handleChange}
              disabled={!form.plantId}
              className={`w-full appearance-none p-3 border ${
                errors.departemen ? "border-red-400" : "border-white/30"
              } bg-white/60 text-gray-800 rounded-xl outline-none pr-10 focus:ring-2 focus:ring-cimoryBlue hover:border-cimoryBlue disabled:opacity-50`}
            >
              <option value="">{form.plantId ? "Choose Department" : "Pilih plant dulu"}</option>
              {departments.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
            <ChevronDown
              size={20}
              className="absolute right-3 top-3 text-gray-500 pointer-events-none"
            />
            {errors.departemen && (
              <p className="text-red-500 text-xs mt-1">{errors.departemen}</p>
            )}
          </div>

          <div className="relative">
            <select
              name="tipe_akses"
              value={form.tipe_akses}
              onChange={handleChange}
              className={`w-full appearance-none p-3 border ${
                errors.tipe_akses ? "border-red-400" : "border-white/30"
              } bg-white/60 text-gray-800 rounded-xl outline-none pr-10 focus:ring-2 focus:ring-cimoryBlue hover:border-cimoryBlue`}
            >
              {accessTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <ChevronDown
              size={20}
              className="absolute right-3 top-3 text-gray-500 pointer-events-none"
            />
            {errors.tipe_akses && (
              <p className="text-red-500 text-xs mt-1">{errors.tipe_akses}</p>
            )}
          </div>

          <div>
            <input
              type="text"
              name="nik"
              placeholder="NIK"
              value={form.nik}
              onChange={handleChange}
              className={`w-full p-3 border ${
                errors.nik ? "border-red-400" : "border-white/30"
              } bg-white/60 text-gray-800 rounded-xl focus:ring-2 focus:ring-cimoryBlue hover:border-cimoryBlue outline-none`}
            />
            {errors.nik && (
              <p className="text-red-500 text-xs mt-1">{errors.nik}</p>
            )}
          </div>

          <div>
            <input
              type="email"
              name="email"
              placeholder="Email"
              value={form.email}
              onChange={handleChange}
              className={`w-full p-3 border ${
                errors.email ? "border-red-400" : "border-white/30"
              } bg-white/60 text-gray-800 rounded-xl focus:ring-2 focus:ring-cimoryBlue hover:border-cimoryBlue outline-none`}
            />
            {errors.email && (
              <p className="text-red-500 text-xs mt-1">{errors.email}</p>
            )}
          </div>

          <div>
            <input
              type="text"
              name="username"
              placeholder="Username"
              value={form.username}
              onChange={handleChange}
              className={`w-full p-3 border ${
                errors.username ? "border-red-400" : "border-white/30"
              } bg-white/60 text-gray-800 rounded-xl focus:ring-2 focus:ring-cimoryBlue hover:border-cimoryBlue outline-none`}
            />
            {errors.username && (
              <p className="text-red-500 text-xs mt-1">{errors.username}</p>
            )}
          </div>

          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              name="password"
              placeholder="Password"
              value={form.password}
              onChange={handleChange}
              className={`w-full p-3 border ${
                errors.password ? "border-red-400" : "border-white/30"
              } bg-white/60 text-gray-800 rounded-xl focus:ring-2 focus:ring-cimoryBlue hover:border-cimoryBlue outline-none pr-10`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-3 text-gray-500 hover:text-cimoryBlue transition-colors"
            >
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
            {errors.password && (
              <p className="text-red-500 text-xs mt-1">{errors.password}</p>
            )}
          </div>

          <button
            onClick={handleRegister}
            disabled={loading}
            className={`w-full flex items-center justify-center gap-2 text-white font-semibold py-3 rounded-xl transition-all duration-300 shadow-md ${
              loading
                ? "bg-gray-400"
                : "bg-gradient-to-r from-cimoryBlue to-cimoryRed hover:opacity-90"
            }`}
          >
            <UserPlus size={18} />
            <span>{loading ? "Registering..." : "Register"}</span>
          </button>

          <button
            onClick={() => navigate("/login")}
            className="w-full flex items-center justify-center gap-2 mt-2 text-cimoryBlue font-medium py-2 rounded-xl border border-cimoryBlue hover:bg-cimoryBlue hover:text-white transition-all duration-300"
          >
            <ArrowLeft size={18} />
            Back to Login
          </button>
        </div>
      </div>

      <footer className="absolute bottom-5 text-sm text-cimoryBlue/90 text-center">
        © Powered by{" "}
        <span className="font-semibold text-cimoryBlue">
          Digital Transformation Plant Sentul
        </span>
      </footer>
    </div>
  );
}
