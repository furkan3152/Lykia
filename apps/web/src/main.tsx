// Must stay the first import (see the module).
import "./app/state/bootstrapStorage";
import "./styles/global.css";

import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";

import { queryClient } from "./app/queryClient";
import { AppRouter } from "./app/router";
import { installUiDocumentSync } from "./app/state/documentSync";
import { installTextures } from "./mosaic/textures";

// Theme, motion and visibility attributes on <html> before the first render (index.html painted the first frame).
installUiDocumentSync();
installTextures();

const root = document.getElementById("root");
if (!root) throw new Error("Lykia needs a #root element");

// /embed/* runs inside a <lykia-*> element on another site: no shell, no router, its own small chunk.
if (window.location.pathname.startsWith("/embed/")) {
  const EmbedApp = React.lazy(() => import("./embed/EmbedApp"));
  document.documentElement.dataset.embed = "true";
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <React.Suspense fallback={null}>
        <EmbedApp />
      </React.Suspense>
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
