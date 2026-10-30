import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorScreen } from "./components/ErrorScreen";
import { loadReport } from "./lib/data";
import { browserLang, STRINGS } from "./lib/i18n";
import "./index.css";

const loaded = loadReport();
const t = loaded.ok ? loaded.model.t : STRINGS[browserLang()];
document.documentElement.lang = t.htmlLang;
const root = document.getElementById("root");
if (root === null) throw new Error(t.noRoot);

createRoot(root).render(<StrictMode>{loaded.ok ? <App model={loaded.model} /> : <ErrorScreen message={loaded.error} t={t} />}</StrictMode>);
