import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { ToastProvider } from "./context/ToastContext";
import { PlatformProvider } from "./context/PlatformContext";
import { registerMeDomain } from "./meDomain/registerMeDomain";
import { queryClient } from "./query/queryClient";
import { registerQueryDevInstrumentation } from "./query/queryDevInstrumentation";
import App from "./App";
import "./styles.css";

registerMeDomain();
registerQueryDevInstrumentation();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <PlatformProvider>
            <App />
          </PlatformProvider>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>
);
