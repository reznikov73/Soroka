import { invoke } from "@tauri-apps/api/core";

interface AppInfo { name: string; version: string; git_hash: string; }
interface PingResult { ok: boolean; time: number; }
interface MessageHeader { uid: number; seq: number; from: string; subject: string; date: string; }
interface FolderInfo { name: string; }
interface SyncPayload { total: number; fetched: number; offline: boolean; error?: string | null; }
interface CacheInfo { total: number; fetched: number; }
interface BodyPayload {
  uid: number;
  text?: string | null;
  html?: string | null;
  from_cache: boolean;
  truncated: boolean;
}

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
const bodyStatus = document.querySelector<HTMLElement>("#body-status");
const bodyText = document.querySelector<HTMLElement>("#body-text");
const bodyFrame = document.querySelector<HTMLIFrameElement>("#body-frame");
const imagesBtn = document.querySelector<HTMLButtonElement>("#images-btn");
const messageEmpty = document.querySelector<HTMLElement>("#message-empty");
const toast = document.querySelector<HTMLElement>("#toast");
const composeBtn = document.querySelector<HTMLButtonElement>("#compose-btn");
const composeOverlay = document.querySelector<HTMLElement>("#compose-overlay");
const composeTo = document.querySelector<HTMLInputElement>("#compose-to");
const composeSubject = document.querySelector<HTMLInputElement>("#compose-subject");
const composeBody = document.querySelector<HTMLTextAreaElement>("#compose-body");
const composeSend = document.querySelector<HTMLButtonElement>("#compose-send");
const composeCancel = document.querySelector<HTMLButtonElement>("#compose-cancel");

let toastTimer: number | undefined;
let currentMessages: MessageHeader[] = [];
let currentFolder = "INBOX";
let bodySeq = 0;
let currentBody: BodyPayload | null = null;

function showToast(text: string): void {
  if (!toast) return;
  toast.textContent = text;
  toast.classList.remove("hidden");
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.add("hidden"), 5000);
}

async function loadBody(uid: number): Promise<void> {
  const seq = ++bodySeq;
  currentBody = null;
  imagesBtn?.classList.add("hidden");
  if (bodyStatus) bodyStatus.textContent = "Сорока несёт письмо…";
  if (bodyText) {
    bodyText.textContent = "";
    bodyText.classList.add("hidden");
  }
  if (bodyFrame) {
    bodyFrame.classList.add("hidden");
    bodyFrame.removeAttribute("srcdoc");
  }
  try {
    const res = await invoke<BodyPayload>("get_message_body", {
      folder: currentFolder,
      uid,
    });
    if (seq !== bodySeq) return;
    currentBody = res;
    renderBody(res);
  } catch (err) {
    if (seq !== bodySeq) return;
    if (bodyStatus) bodyStatus.textContent = `тело не удалось загрузить: ${String(err)}`;
  }
}

function renderBody(res: BodyPayload): void {
  if (res.html && bodyFrame) {
    if (bodyStatus) bodyStatus.textContent = res.from_cache ? "Из кэша." : "";
    bodyFrame.srcdoc = wrapHtml(res.html, false);
    bodyFrame.classList.remove("hidden");
    if (bodyText) bodyText.classList.add("hidden");
    imagesBtn?.classList.toggle("hidden", !/<img[^>]*\ssrc=/i.test(res.html));
    return;
  }
  if (res.text && bodyText) {
    if (bodyStatus) {
      bodyStatus.textContent =
        (res.truncated ? "Показана только часть письма (слишком большое). " : "") +
        (res.from_cache ? "Из кэша." : "");
    }
    bodyText.textContent = res.text;
    bodyText.classList.remove("hidden");
    if (bodyFrame) bodyFrame.classList.add("hidden");
    imagesBtn?.classList.add("hidden");
    return;
  }
  imagesBtn?.classList.add("hidden");
  if (bodyStatus) bodyStatus.textContent = "В письме нет текста (возможно, только вложения).";
}

function wrapHtml(html: string, showImages: boolean): string {
  const imgSrc = showImages ? "data: http: https:" : "data:";
  return [
    "<!doctype html><html><head><meta charset=\"utf-8\">",
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src ",
    imgSrc,
    ";\">",
    "<style>",
    "body { font-family: \"Segoe UI\", system-ui, sans-serif; font-size: 14px;",
    "color: #1f2430; margin: 12px; word-break: break-word; }",
    "img { max-width: 100%; }",
    "table { max-width: 100%; border-collapse: collapse; }",
    "td { padding: 2px 4px; }",
    "a { color: #2f6fd8; }",
    "</style></head><body>",
    html,
    "</body></html>",
  ].join("");
}

async function selectFolder(name: string): Promise<void> {
  currentFolder = name;
  document
    .querySelectorAll("#folder-list li")
    .forEach((el) => el.classList.toggle("selected", el.textContent === name));
  if (statusMail) statusMail.textContent = `почта: папка «${name}», загрузка…`;
  try {
    const res = await invoke<SyncPayload>("sync_folder", { folder: name });
    if (statusMail) statusMail.textContent = `почта: папка «${name}», писем ${res.total}`;
    await refreshMail();
  } catch (err) {
    if (statusMail) statusMail.textContent = `почта: ошибка (папка «${name}»)`;
    showToast(`Не удалось открыть папку «${name}»: ${String(err)}`);
  }
}

function openCompose(): void {
  composeOverlay?.classList.remove("hidden");
  composeTo?.focus();
}

function closeCompose(): void {
  composeOverlay?.classList.add("hidden");
}

async function sendCompose(): Promise<void> {
  const to = composeTo?.value.trim() ?? "";
  const subject = composeSubject?.value.trim() ?? "";
  const body = composeBody?.value ?? "";
  if (!to || !to.includes("@")) {
    showToast("Укажите адрес получателя — например: friend@mail.ru");
    composeTo?.focus();
    return;
  }
  if (composeSend) {
    composeSend.disabled = true;
    composeSend.textContent = "Отправляем…";
  }
  try {
    await invoke("send_mail", { to, subject, body });
    showToast(`Письмо улетело: ${to}`);
    if (composeTo) composeTo.value = "";
    if (composeSubject) composeSubject.value = "";
    if (composeBody) composeBody.value = "";
    closeCompose();
  } catch (err) {
    showToast(`Не удалось отправить: ${String(err)}`);
  } finally {
    if (composeSend) {
      composeSend.disabled = false;
      composeSend.textContent = "Отправить";
    }
  }
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
    li.classList.toggle("selected", f.name === currentFolder);
    li.addEventListener("click", () => void selectFolder(f.name));
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
  void loadBody(m.uid);
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
    currentFolder = "INBOX";
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
  composeBtn?.addEventListener("click", () => openCompose());
  composeCancel?.addEventListener("click", () => closeCompose());
  composeSend?.addEventListener("click", () => void sendCompose());
  imagesBtn?.addEventListener("click", () => {
    if (currentBody?.html && bodyFrame) {
      bodyFrame.srcdoc = wrapHtml(currentBody.html, true);
      imagesBtn.classList.add("hidden");
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCompose();
    if (e.ctrlKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      openCompose();
    }
    if (e.ctrlKey && e.key === "Enter" && !composeOverlay?.classList.contains("hidden")) {
      e.preventDefault();
      void sendCompose();
    }
  });
  void loadAppInfo();
  void checkBackend();
  void initMail();
});