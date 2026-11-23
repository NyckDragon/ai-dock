import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/dock.css";
import "./styles/panel.css";
import "./styles/prompts.css";
import "./styles/settings.css";
import "./styles/costs.css";
import App from "./App";

async function start() {
  const params = new URLSearchParams(location.search);
  if (import.meta.env.DEV && params.has("demo")) {
    (await import("./dev/mockTauri")).installDemoBridge();
    const design = params.get("design");
    if (design) {
      await import("./dev/designs.css");
      document.documentElement.dataset.design = design;
    }
  }
  createRoot(document.getElementById("root")!).render(<App />);
}

void start();
