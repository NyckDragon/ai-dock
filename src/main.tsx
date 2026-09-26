import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/dock.css";
import "./styles/panel.css";
import "./styles/prompts.css";
import "./styles/settings.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(<App />);
