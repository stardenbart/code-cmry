/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cimoryBlue: "#1B3A6F",
        cimoryRed: "#E63946",
        cimoryLight: "#F8FAFC",
        cimoryGray: "#E5E7EB",
      },
      animation: {
        "gradient-slow": "gradientBG 10s ease infinite",
        "float-slow": "float 15s ease-in-out infinite",
        "float-fast": "float 8s ease-in-out infinite",
        // Toast: masuk dari kanan, keluar memudar.
        "toast-in": "toastIn 180ms ease-out",
        "toast-out": "toastOut 150ms ease-in forwards",
        // Kelas animate-fade-in sudah dipakai di App.jsx tetapi keyframes-nya
        // tidak pernah didefinisikan, jadi selama ini tidak berefek apa pun.
        "fade-in": "fadeIn 200ms ease-out",
      },
      keyframes: {
        gradientBG: {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-20px)" },
        },
        toastIn: {
          from: { opacity: "0", transform: "translateX(16px)" },
          to:   { opacity: "1", transform: "translateX(0)" },
        },
        toastOut: {
          from: { opacity: "1", transform: "translateX(0)" },
          to:   { opacity: "0", transform: "translateX(16px)" },
        },
        fadeIn: {
          from: { opacity: "0" },
          to:   { opacity: "1" },
        },
      },
      backgroundSize: {
        "200%": "200% 200%",
      },
    },
  },
  plugins: [],
};
