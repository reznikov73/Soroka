import { invoke } from "@tauri-apps/api/core";

interface AppInfo { name: string; version: string; git_hash: string; }
interface PingResult { ok: boolean; time: number; }
interface MessageHeader { uid: number; seq: number; from: string; subject: string; date: string; }
interface FolderInfo { name: string; }
interface SyncPayload { total: number; fetched: number; offline: boolean; error?: string | null; }
interface CacheInfo { total: number; fetched: number; }

const statusVersion = document.querySelector<HTMLElement>("#status-version");
const statusPing = document.querySelector<HTMLElement>("#status-ping");
const statusMail = document.querySelector<HTMLElement>("#status-mail");
const pingBtn = document.querySelector<HTMLButtonElement>("#ping-btn");
const mailBtn = document.querySelector<HTMLButtonElement>("#mail-btn");
const folderList = document.querySelector<HTMLUListElement>("#folder-list");
const folderEmpty = document.querySelector<HTMLElement>("#folder-empty");
const messagesList = document.querySelector<HTMLUListElement>("#messages");
const messagesEmpty = document.querySelector<HTMLElement>("#messages-empty");
const details = document.querySelector<HTMLElement>("#message-details");
const dFrom = document.querySelector<HTMLElement>("#d-from");
const dSubject = document.querySelector<HTMLElement>("#d-subject");
const dDate = document.querySelector<HTMLElement>("#d-date");
const dUid = document.querySelector<HTMLElement>("#d-uid");
const messageEmpty = document.querySelector<HTMLElement>("#message-empty");
const toast = document.querySelector<HTMLElement>("#toast");

let toastTimer: number | undefined;
let currentMessages: MessageHeader[] = [];

function showToast(text: string): void {
  if (!toast) return;
  toast.textContent = text;
  toast.classList.remove("hidden");
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.add("hidden"), 5000);
}

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

function renderFolders(folders: FolderInfo[]): void {
  if (!folderList || !folderEmpty) return;
  folderList.innerHTML = "";
  folderEmpty.classList.toggle("hidden", folders.length > 0);
  for (const f of folders) {
    const li = document.createElement("li");
    li.textContent = f.name;
    li.title = f.name;
    folderList.appendChild(li);
  }
}

function renderMessages(): void {
  if (!messagesList || !messagesEmpty) return;
  messagesList.innerHTML = "";
  messagesEmpty.classList.toggle("hidden", currentMessages.length > 0);
  currentMessages.forEach((m, idx) => {
    const li = document.createElement("li");

    const subj = document.createElement("div");
    subj.className = "subject";
    subj.textContent = m.subject;

    const meta = document.createElement("div");
    meta.className = "meta";
    const fromEl = document.createElement("span");
    fromEl.textContent = m.from;
    const dateEl = document.createElement("span");
    dateEl.textContent = m.date;
    meta.append(fromEl, dateEl);

    li.append(subj, meta);
    li.addEventListener("click", () => selectMessage(idx));
    messagesList.appendChild(li);
  });
}

function selectMessage(idx: number): void {
  const m = currentMessages[idx];
  if (!m) return;
  if (dFrom) dFrom.textContent = m.from;
  if (dSubject) dSubject.textContent = m.subject;
  if (dDate) dDate.textContent = m.date;
  if (dUid) dUid.textContent = String(m.uid);
  details?.classList.remove("hidden");
  messageEmpty?.classList.add("hidden");
  document
    .querySelectorAll("#messages li")
    .forEach((el, i) => el.classList.toggle("selected", i === idx));
}

async function refreshMail(): Promise<void> {
  const folders = await invoke<FolderInfo[]>("get_folders");
  renderFolders(folders);
  currentMessages = await invoke<MessageHeader[]>("get_messages");
  renderMessages();
}

async function checkMail(): Promise<void> {
  if (statusMail) statusMail.textContent = "почта: синхронизация…";
  if (mailBtn) mailBtn.disabled = true;
  try {
    const res = await invoke<SyncPayload>("sync_inbox");
    if (res.offline) {
      if (statusMail) statusMail.textContent = `почта: офлайн, писем ${res.total}`;
      showToast(`Сорока вернулась ни с чем (${res.error ?? "нет сети"}) — показываю кэш`);
    } else {
      if (statusMail) statusMail.textContent = `почта: писем ${res.total}`;
      showToast(`Сорока на хвосте принесла — ${res.fetched} писем`);
    }
    await refreshMail();
  } catch (err) {
    if (statusMail) statusMail.textContent = "почта: ошибка";
    showToast(`Сорока вернулась ни с чем: ${String(err)}`);
  } finally {
    if (mailBtn) mailBtn.disabled = false;
  }
}

async function initMail(): Promise<void> {
  // мгновенный показ из кэша, затем синхронизация
  try {
    const info = await invoke<CacheInfo | null>("load_cache");
    if (info) {
      if (statusMail) statusMail.textContent = `почта: писем ${info.total} (кэш)`;
      await refreshMail();
    }
  } catch {
    /* кэша нет или ошибка — не мешаем основной синхронизации */
  }
  window.setTimeout(() => void checkMail(), 400);
}

window.addEventListener("DOMContentLoaded", () => {
  pingBtn?.addEventListener("click", () => void checkBackend());
  mailBtn?.addEventListener("click", () => void checkMail());
  void loadAppInfo();
  void checkBackend();
  void initMail();
});