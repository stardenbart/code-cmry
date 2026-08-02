import React, { useState } from "react";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { useNavigate } from "react-router-dom";
import API from "../api/api";

export default function LoginPage({ onLogin }) {
  const [username, setUsername]       = useState("");
  const [password, setPassword]       = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading]         = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!username || !password) {
      alert("Username and Password may not be empty!");
      return;
    }
    setLoading(true);
    try {
      const res  = await API.post("/api/login", { username, password });
      const data = res.data;
      if (data.error) { alert(data.message || "Login gagal!"); return; }
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      onLogin && onLogin(data.user, data.token);
      navigate("/App");
    } catch (err) {
      console.error("Login error:", err);
      alert(err.response?.data?.message || "Error connection with server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden px-4 py-8">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-cimoryBlue via-sky-200 to-cimoryRed animate-gradient-slow" />
      <div className="absolute top-10 left-10 w-56 h-56 sm:w-72 sm:h-72 bg-cimoryBlue/20 blur-3xl rounded-full animate-float-slow" />
      <div className="absolute bottom-10 right-10 w-64 h-64 sm:w-96 sm:h-96 bg-cimoryRed/20 blur-3xl rounded-full animate-float-fast" />

      {/* Card */}
      <div className="relative z-10 bg-white/20 backdrop-blur-xl border border-white/30 p-6 sm:p-10 rounded-3xl shadow-2xl w-full max-w-sm sm:max-w-[440px]">
        <div className="text-center mb-6">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-cimoryBlue drop-shadow-md mb-2 leading-tight">
            Login Dashboard CODE
          </h2>
          <p className="text-cimoryBlue text-sm py-2">
            Welcome to the Central of Digitalization
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4 sm:space-y-5">
          <input
            type="text"
            placeholder="Username"
            value={username}
            autoFocus
            onChange={(e) => setUsername(e.target.value)}
            className="w-full p-3 border border-white/30 bg-white/60 text-gray-800 rounded-xl focus:ring-2 focus:ring-cimoryBlue focus:border-cimoryBlue hover:border-cimoryBlue transition-all outline-none text-sm sm:text-base"
          />

          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-3 border border-white/30 bg-white/60 text-gray-800 rounded-xl focus:ring-2 focus:ring-cimoryBlue focus:border-cimoryBlue hover:border-cimoryBlue transition-all outline-none pr-10 text-sm sm:text-base"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-3 text-gray-500 hover:text-cimoryBlue transition-colors"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          <button
            type="submit"
            disabled={loading}
            className={`w-full flex items-center justify-center gap-2 text-white font-semibold py-3 rounded-xl transition-all duration-300 shadow-md hover:shadow-lg text-sm sm:text-base ${
              loading
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-gradient-to-r from-cimoryBlue to-cimoryRed hover:opacity-90"
            }`}
          >
            <LogIn size={17} />
            <span>{loading ? "Logging in..." : "Login"}</span>
          </button>

          <button
            type="button"
            onClick={() => navigate("/Register")}
            className="text-xs sm:text-sm text-cimoryBlue transition-colors w-full text-center"
          >
            Not registered yet?{" "}
            <span className="font-semibold underline hover:text-cimoryRed transition-colors">
              Start your digitalization!
            </span>
          </button>
        </form>
      </div>

      {/* Footer */}
      <footer className="absolute bottom-4 text-xs sm:text-sm text-cimoryBlue/90 text-center px-4">
        © Powered by{" "}
        <span className="font-semibold text-cimoryBlue">
          Digital Transformation Plant Sentul 2025
        </span>
      </footer>
    </div>
  );
}
