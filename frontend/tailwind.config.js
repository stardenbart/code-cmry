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
      },
      backgroundSize: {
        "200%": "200% 200%",
      },
    },
  },
  plugins: [],
};
