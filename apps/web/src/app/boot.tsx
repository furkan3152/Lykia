/**
 * The app itself, imported by main.tsx once the interface language is
 * loaded (so every module, constants included, reads its catalogue).
 */
import "../styles/global.css";

import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";

import { queryClient } from "./queryClient";
import { detectCity } from "../city/detect";
import { AppRouter } from "./router";
import { installUiDocumentSync } from "./state/documentSync";
import { installTextures } from "../mosaic/textures";
import { installDocumentText } from "../i18n/document";
import { t } from "../i18n";

// Theme, motion and visibility attributes on <html> before the first render (index.html painted the first frame).
installUiDocumentSync();
installDocumentText();
installTextures();

const root = document.getElementById("root");
if (!root) throw new Error(t("main.lykiaNeedsARootElement"));

const city = window.location.pathname.startsWith("/embed/") ? null : detectCity(window.location, import.meta.env.VITE_LYKIA_ROOT_DOMAIN as string | undefined);

// /embed/* runs inside a <lykia-*> element on another site: no shell, no router, its own small chunk.
if (window.location.pathname.startsWith("/embed/")) {
  const EmbedApp = React.lazy(() => import("../embed/EmbedApp"));
  document.documentElement.dataset.embed = "true";
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <React.Suspense fallback={null}>
        <EmbedApp />
      </React.Suspense>
    </React.StrictMode>,
  );
} else if (city) {
  // A League city on its own host (pay.<root domain>), or /c/<slug> and ?city=<slug> anywhere: the city's own shell.
  const CityApp = React.lazy(() => import("../city/CityApp"));
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <React.Suspense fallback={null}>
          <CityApp target={city} />
        </React.Suspense>
      </QueryClientProvider>
    </React.StrictMode>,
  );
} else {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <AppRouter />
      </QueryClientProvider>
    </React.StrictMode>,
  );
}
