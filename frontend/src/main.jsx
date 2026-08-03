import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
// Diimpor statis, bukan lazy: harus siap sebelum komponen pertama memanggil
// useToast(), dan ukurannya di bawah 3 KB.
import ToastProvider from "./components/ToastProvider";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);
