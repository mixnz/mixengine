import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/fira-code/400.css";
import "@fontsource/fira-code/500.css";
import "@fontsource/fira-code/600.css";
import "@fontsource/fira-code/700.css";
import App from "./shell/App";
import ErrorBoundary from "./components/ErrorBoundary";
import { I18nProvider } from "./i18n";
import { blockNativeContextMenu } from "./core/nativeContextMenu";
import { logError } from "./core/log";

blockNativeContextMenu();

// Beyond what an Error Boundary can reach: an error in an event handler, a setTimeout, a promise
// nobody awaited. Logging only — the UI (the Error Boundary) is what handles showing something.
window.addEventListener("error", (e) => void logError("window", e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => void logError("promise", e.reason));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <ErrorBoundary variant="app">
        <App />
      </ErrorBoundary>
    </I18nProvider>
  </React.StrictMode>,
);
