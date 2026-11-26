import "./polyfills";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/design/base.css";
import "./styles/design/components.css";
import "./styles/design/theme.css";
import "./index.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
