import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorScreen } from "./components/ErrorScreen";
import { loadReport } from "./lib/data";
import "./index.css";

const loaded = loadReport();
const root = document.getElementById("root");
if (root === null) throw new Error("页面缺少 #root");

createRoot(root).render(<StrictMode>{loaded.ok ? <App model={loaded.model} /> : <ErrorScreen message={loaded.error} />}</StrictMode>);
