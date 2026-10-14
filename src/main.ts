import { invoke } from "@tauri-apps/api/core";

interface AppInfo {
  name: string;
  version: string;
  git_hash: string;
}

interface PingResult {
  ok: boolean;
  time: number;
}

const statusVersion = document.querySelector<HTMLElement>("#status-version");
const statusPing = document.querySelector<HTMLElement>("#status-ping");
const pingBtn = document.querySelector<HTMLButtonElement>("#ping-btn");

async function loadAppInfo(): Promise<void> {
  if (!statusVersion) return;
  try {
    const info = await invoke<AppInfo>("app_info");
    statusVersion.textContent = `Soroka v${info.version}+g${info.git_hash.slice(0, 7)}`;
  } catch (err) {
    statusVersion.textContent = `версия недоступна (${String(err)})`;
  }
}

async function checkBackend(): Promise<void> {
  if (!statusPing) return;
  statusPing.textContent = "проверяем…";
  try {
    const res = await invoke<PingResult>("ping");
    statusPing.textContent = res.ok ? "backend OK" : "backend ответил неожиданно";
  } catch (err) {
    statusPing.textContent = `backend недоступен (${String(err)})`;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  pingBtn?.addEventListener("click", () => {
    void checkBackend();
  });
  void loadAppInfo();
  void checkBackend();
});