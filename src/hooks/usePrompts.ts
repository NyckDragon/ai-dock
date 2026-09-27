import { useCallback, useEffect, useRef, useState } from "react";
import { scanPrompts } from "../lib/tauri";
import { t, tr } from "../lib/i18n";
import type { PromptItem } from "../types";

const RESCAN_MS = 3 * 60 * 1000;

function errorText(error: unknown) {
  if (typeof error === "string") return tr(error);
  if (error instanceof Error) return tr(error.message);
  return t("Não foi possível ler a pasta de prompts.");
}

/** Reads the Obsidian folder and reads it again whenever the panel opens and every 3 min while open. */
export function usePrompts(path: string | null, panelOpen: boolean) {
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pathRef = useRef(path);
  pathRef.current = path;

  const rescan = useCallback(async () => {
    const target = pathRef.current;
    if (!target) {
      setPrompts([]);
      return;
    }
    setScanning(true);
    try {
      const next = await scanPrompts(target);
      if (pathRef.current === target) {
        setPrompts(next);
        setError(null);
      }
    } catch (reason) {
      if (pathRef.current === target) setError(errorText(reason));
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    void rescan();
  }, [path, rescan]);

  useEffect(() => {
    if (!panelOpen || !path) return;
    void rescan();
    const timer = window.setInterval(() => void rescan(), RESCAN_MS);
    return () => window.clearInterval(timer);
  }, [panelOpen, path, rescan]);

  return { prompts, scanning, error, rescan };
}
