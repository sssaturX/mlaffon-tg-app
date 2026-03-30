import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ToastProvider } from "./context/ToastContext";
import { PlatformProvider } from "./context/PlatformContext";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <BrowserRouter>
        <PlatformProvider>
          <App />
        </PlatformProvider>
      </BrowserRouter>
    </ToastProvider>
  </StrictMode>
);
