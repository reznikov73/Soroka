import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

interface AppInfo { name: string; version: string; git_hash: string; }
interface PingResult { ok: boolean; time: number; }
interface MessageHeader { uid: number; seq: number; from: string; subject: string; date: string; seen: boolean; flagged: boolean; }
interface AiAnalysisData {
  summary: string;
  category: string;
  importance: string;
  dates: string[];
  tasks: string[];
  actions: string[];
}
interface AnalysisEntry { uid: number; analysis: AiAnalysisData; }
interface FolderInfo { name: string; }
interface SyncPayload { total: number; fetched: number; offline: boolean; error?: string | null; }
interface CacheInfo { total: number; fetched: number; }
interface AttachmentInfo {
  name: string;
  mime: string;
  size: number;
  index: number;
}
interface BodyPayload {
  uid: number;
  text?: string | null;
  html?: string | null;
  from_cache: boolean;
  truncated: boolean;
  attachments?: AttachmentInfo[];
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
const attachList = document.querySelector<HTMLElement>("#body-attachments");
const replyBtn = document.querySelector<HTMLButtonElement>("#reply-btn");
const forwardBtn = document.querySelector<HTMLButtonElement>("#forward-btn");
const composeTitle = document.querySelector<HTMLElement>("#compose-title");
const messageEmpty = document.querySelector<HTMLElement>("#message-empty");
const toast = document.querySelector<HTMLElement>("#toast");
const composeBtn = document.querySelector<HTMLButtonElement>("#compose-btn");
const composeOverlay = document.querySelector<HTMLElement>("#compose-overlay");
const composeTo = document.querySelector<HTMLInputElement>("#compose-to");
const composeSubject = document.querySelector<HTMLInputElement>("#compose-subject");
const composeBody = document.querySelector<HTMLTextAreaElement>("#compose-body");
const composeSend = document.querySelector<HTMLButtonElement>("#compose-send");
const composeCancel = document.querySelector<HTMLButtonElement>("#compose-cancel");
const composeFiles = document.querySelector<HTMLInputElement>("#compose-files");
const composeAttachList = document.querySelector<HTMLElement>("#compose-attach-list");
const searchBox = document.querySelector<HTMLInputElement>("#search-box");
const unreadBtn = document.querySelector<HTMLButtonElement>("#unread-btn");
const aiBtn = document.querySelector<HTMLButtonElement>("#ai-btn");
const aiSummary = document.querySelector<HTMLElement>("#ai-summary");
const aiSummaryText = document.querySelector<HTMLElement>("#ai-summary-text");
const aiBadges = document.querySelector<HTMLElement>("#ai-badges");
const aiFlagBtn = document.querySelector<HTMLButtonElement>("#ai-flag-btn");
const aiSpamBtn = document.querySelector<HTMLButtonElement>("#ai-spam-btn");
const statusAi = document.querySelector<HTMLElement>("#status-ai");

let toastTimer: number | undefined;
let currentMessages: MessageHeader[] = [];
let currentFolder = "INBOX";
let bodySeq = 0;
let currentBody: BodyPayload | null = null;
let currentMessage: MessageHeader | null = null;
let composeAttachments: { name: string; mime: string; dataB64: string; size: number }[] = [];
let searchQuery = "";
let analyses = new Map<number, AiAnalysisData>();

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
  renderAttachments(null);
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
    if (currentMessage && currentMessage.uid === uid && !currentMessage.seen) {
      void markSeen(uid, true);
    }
  } catch (err) {
    if (seq !== bodySeq) return;
    if (bodyStatus) bodyStatus.textContent = `тело не удалось загрузить: ${String(err)}`;
  }
}

function renderBody(res: BodyPayload): void {
  renderAttachments(res);
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

function renderAttachments(res: BodyPayload | null): void {
  if (!attachList) return;
  attachList.innerHTML = "";
  const items = res?.attachments ?? [];
  attachList.classList.toggle("hidden", items.length === 0);
  if (!res) return;
  for (const a of items) {
    const chip = document.createElement("span");
    chip.className = "attach-chip";
    chip.title = `${a.name} — сохранить в «Загрузки»`;
    const nameEl = document.createElement("span");
    nameEl.className = "name";
    nameEl.textContent = `📎 ${a.name}`;
    const sizeEl = document.createElement("span");
    sizeEl.className = "size";
    sizeEl.textContent = formatSize(a.size);
    chip.append(nameEl, sizeEl);
    chip.addEventListener("click", () => void saveAttachment(res.uid, a));
    attachList.appendChild(chip);
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

async function saveAttachment(uid: number, a: AttachmentInfo): Promise<void> {
  if (bodyStatus) bodyStatus.textContent = `Сохраняем «${a.name}»…`;
  try {
    const path = await invoke<string>("save_attachment", {
      folder: currentFolder,
      uid,
      index: a.index,
    });
    showToast(`Прилетело: ${path}`);
    if (bodyStatus) bodyStatus.textContent = "";
  } catch (err) {
    showToast(`Не удалось сохранить вложение: ${String(err)}`);
    if (bodyStatus) bodyStatus.textContent = "";
  }
}

async function markSeen(uid: number, seen: boolean): Promise<void> {
  try {
    await invoke("set_seen", { folder: currentFolder, uid, seen });
    const msg = currentMessages.find((x) => x.uid === uid);
    if (msg) msg.seen = seen;
    if (currentMessage && currentMessage.uid === uid) currentMessage.seen = seen;
    renderMessages();
  } catch (err) {
    showToast(`Не удалось пометить: ${String(err)}`);
  }
}

const CATEGORY_META: Record<string, { label: string; cls: string }> = {
  реклама: { label: "Реклама", cls: "cat-grey" },
  клиент: { label: "Клиент", cls: "cat-accent" },
  госорган: { label: "Госорган", cls: "cat-blue" },
  финансы: { label: "Финансы", cls: "cat-green" },
  уведомление: { label: "Уведомление", cls: "cat-neutral" },
  личное: { label: "Личное", cls: "cat-neutral" },
  мошенничество: { label: "Осторожно", cls: "cat-red" },
};

function categoryBadge(cat: string): { label: string; cls: string } | null {
  const c = cat.trim().toLowerCase();
  if (!c) return null;
  return CATEGORY_META[c] ?? { label: cat, cls: "cat-neutral" };
}

function renderAnalysisCard(a: AiAnalysisData | null): void {
  if (!aiSummary || !aiSummaryText) return;
  if (!a) {
    aiSummary.classList.add("hidden");
    return;
  }
  aiSummary.classList.remove("hidden");
  aiSummaryText.textContent = a.summary || "—";
  if (aiBadges) {
    aiBadges.innerHTML = "";
    const cat = categoryBadge(a.category);
    if (cat) {
      const bs = document.createElement("span");
      bs.className = `cat ${cat.cls}`;
      bs.textContent = cat.label;
      aiBadges.append(bs);
    }
    if (a.importance === "высокая") {
      const im = document.createElement("span");
      im.className = "cat cat-important";
      im.textContent = "⚠ Важное";
      aiBadges.append(im);
    }
  }
  if (aiFlagBtn && currentMessage) {
    aiFlagBtn.textContent = currentMessage.flagged ? "⚑ Снять важное" : "⚑ В важные";
  }
}

async function requestAnalysis(m: MessageHeader): Promise<void> {
  if (!aiSummary || !aiSummaryText) return;
  aiSummary.classList.remove("hidden");
  if (!analyses.has(m.uid)) aiSummaryText.textContent = "Сорока думает…";
  try {
    const a = await invoke<AiAnalysisData>("analyze_message", {
      folder: currentFolder,
      uid: m.uid,
      subject: m.subject,
    });
    analyses.set(m.uid, a);
    if (currentMessage && currentMessage.uid === m.uid) renderAnalysisCard(a);
    renderMessages();
  } catch (err) {
    aiSummaryText.textContent = `Не получилось: ${String(err)}`;
  }
}

async function toggleFlag(m: MessageHeader): Promise<void> {
  const next = !m.flagged;
  try {
    await invoke("set_flagged", { folder: currentFolder, uid: m.uid, flagged: next });
    m.flagged = next;
    if (currentMessage && currentMessage.uid === m.uid) currentMessage.flagged = next;
    renderAnalysisCard(analyses.get(m.uid) ?? null);
    renderMessages();
    showToast(next ? "Помечено важным" : "Важное снято");
  } catch (err) {
    showToast(`Не удалось пометить: ${String(err)}`);
  }
}

function extractDomain(from: string): string {
  const m = from.match(/@([A-Za-z0-9.-]+)/);
  return m ? m[1] : "";
}

async function moveToSpam(m: MessageHeader): Promise<void> {
  try {
    await invoke("move_to_spam", {
      folder: currentFolder,
      uid: m.uid,
      domain: extractDomain(m.from),
    });
    currentMessages = currentMessages.filter((x) => x.uid !== m.uid);
    if (currentMessage && currentMessage.uid === m.uid) {
      currentMessage = null;
      details?.classList.add("hidden");
      messageEmpty?.classList.remove("hidden");
    }
    renderMessages();
    showToast("Письмо перенесено в «Спам»");
  } catch (err) {
    showToast(`Не удалось перенести: ${String(err)}`);
  }
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
  searchQuery = "";
  if (searchBox) searchBox.value = "";
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
    const raw = String(err);
    const interrupted =
      raw.includes("Bye Response") || raw.includes("Connection Lost");
    showToast(
      interrupted
        ? `Не удалось открыть папку «${name}»: сервер прервал соединение — попробуйте ещё раз`
        : `Не удалось открыть папку «${name}»: ${raw}`,
    );
  }
}

function renderComposeAttachments(): void {
  if (!composeAttachList) return;
  composeAttachList.innerHTML = "";
  composeAttachList.classList.toggle("hidden", composeAttachments.length === 0);
  composeAttachments.forEach((a, i) => {
    const chip = document.createElement("span");
    chip.className = "attach-chip";
    const nameEl = document.createElement("span");
    nameEl.className = "name";
    nameEl.textContent = `📎 ${a.name}`;
    const sizeEl = document.createElement("span");
    sizeEl.className = "size";
    sizeEl.textContent = formatSize(a.size);
    const rm = document.createElement("span");
    rm.className = "remove";
    rm.textContent = "✕";
    rm.title = "Убрать";
    rm.addEventListener("click", () => {
      composeAttachments.splice(i, 1);
      renderComposeAttachments();
    });
    chip.append(nameEl, sizeEl, rm);
    composeAttachList.appendChild(chip);
  });
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result ?? "");
      const comma = res.indexOf(",");
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    reader.onerror = () => reject(reader.error ?? new Error("не прочитать файл"));
    reader.readAsDataURL(file);
  });
}

async function onFilesPicked(): Promise<void> {
  if (!composeFiles?.files) return;
  const maxFile = 15 * 1024 * 1024;
  const maxTotal = 20 * 1024 * 1024;
  for (const file of Array.from(composeFiles.files)) {
    if (file.size > maxFile) {
      showToast(`«${file.name}» больше 15 МБ — не прикрепляю`);
      continue;
    }
    const total = composeAttachments.reduce((s, a) => s + a.size, 0) + file.size;
    if (total > maxTotal) {
      showToast("Суммарный размер вложений больше 20 МБ");
      break;
    }
    try {
      const b64 = await readBase64(file);
      composeAttachments.push({
        name: file.name,
        mime: file.type || "application/octet-stream",
        dataB64: b64,
        size: file.size,
      });
    } catch (err) {
      showToast(`Не прочитать «${file.name}»: ${String(err)}`);
    }
  }
  composeFiles.value = "";
  renderComposeAttachments();
}

function extractAddress(from: string): string {
  const m = from.match(/<([^<>]+)>\s*$/);
  return (m ? m[1] : from).trim();
}

function prefixedSubject(subject: string, prefix: string): string {
  const trimmed = subject.trim();
  const re = new RegExp(`^${prefix}:`, "i");
  return re.test(trimmed) ? trimmed : `${prefix}: ${trimmed}`;
}

function htmlToText(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent ?? "";
}

function quotedOriginal(): string {
  const m = currentMessage;
  const src = currentBody?.text ?? (currentBody?.html ? htmlToText(currentBody.html) : "");
  const head = m ? `\n\n--- Исходное письмо ---\nОт: ${m.from}\nДата: ${fullDate(m.date)}\n\n` : "\n\n";
  return `${head}${src}`;
}

function openCompose(prefill?: { title?: string; to?: string; subject?: string; body?: string }): void {
  if (composeTitle) composeTitle.textContent = prefill?.title ?? "Новое письмо";
  if (composeTo) composeTo.value = prefill?.to ?? "";
  if (composeSubject) composeSubject.value = prefill?.subject ?? "";
  if (composeBody) composeBody.value = prefill?.body ?? "";
  composeAttachments = [];
  renderComposeAttachments();
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
    await invoke("send_mail", {
      to,
      subject,
      body,
      files: composeAttachments.map((a) => ({ name: a.name, mime: a.mime, dataB64: a.dataB64 })),
    });
    showToast(`Письмо улетело: ${to}`);
    if (composeTo) composeTo.value = "";
    if (composeSubject) composeSubject.value = "";
    if (composeBody) composeBody.value = "";
    composeAttachments = [];
    renderComposeAttachments();
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

const RU_MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const RU_MONTHS_FULL = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

function parseMailDate(date: string): Date | null {
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Короткая дата для списка: сегодня «13:27», вчера «вчера», этот год «13 окт», старше «13.10.25». */
function shortTime(date: string): string {
  const d = parseMailDate(date);
  if (!d) {
    const m = date.match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
    return m ? `${m[1].padStart(2, "0")}:${m[2]}` : date.slice(0, 14);
  }
  const now = new Date();
  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  ) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (
    d.getFullYear() === y.getFullYear() &&
    d.getMonth() === y.getMonth() &&
    d.getDate() === y.getDate()
  ) {
    return "вчера";
  }
  if (d.getFullYear() === now.getFullYear()) return `${d.getDate()} ${RU_MONTHS[d.getMonth()]}`;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear() % 100).padStart(2, "0");
  return `${dd}.${mm}.${yy}`;
}

/** Полная дата: «15 октября 2026, 13:27». */
function fullDate(date: string): string {
  const d = parseMailDate(date);
  if (!d) return date;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${RU_MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`;
}

function visibleMessages(): MessageHeader[] {
  if (!searchQuery) return currentMessages;
  return currentMessages.filter(
    (m) =>
      m.subject.toLowerCase().includes(searchQuery) ||
      m.from.toLowerCase().includes(searchQuery),
  );
}

function renderMessages(): void {
  if (!messagesList || !messagesEmpty) return;
  const rank = (m: MessageHeader): number =>
    analyses.get(m.uid)?.importance === "высокая" ? 1 : 0;
  const items = visibleMessages().slice().sort((a, b) => rank(b) - rank(a));
  messagesList.innerHTML = "";
  messagesEmpty.textContent = searchQuery
    ? "Сорока ничего не нашла"
    : "Сорока ещё в полёте — писем нет";
  messagesEmpty.classList.toggle("hidden", items.length > 0);
  items.forEach((m) => {
    const li = document.createElement("li");
    li.className = "m-row";
    li.title = m.date;
    li.dataset.uid = String(m.uid);
    li.classList.toggle("unread", !m.seen);

    const ai = analyses.get(m.uid);

    // линия 1: [бейдж категории] тема … ★ … дата
    const l1 = document.createElement("div");
    l1.className = "l1";
    const badge = ai ? categoryBadge(ai.category) : null;
    if (badge) {
      const bs = document.createElement("span");
      bs.className = `cat ${badge.cls}`;
      bs.textContent = badge.label;
      l1.append(bs);
    }
    const subj = document.createElement("span");
    subj.className = "subject";
    subj.textContent = m.subject;
    l1.append(subj);
    if (ai?.importance === "высокая") {
      const star = document.createElement("span");
      star.className = "star";
      star.textContent = "★";
      l1.append(star);
    }
    const time = document.createElement("span");
    time.className = "m-time";
    if (m.flagged) {
      const fl = document.createElement("span");
      fl.className = "flag";
      fl.textContent = "⚑";
      time.append(fl);
    }
    if (!m.seen) {
      const dot = document.createElement("span");
      dot.className = "dot";
      time.append(dot);
    }
    time.append(shortTime(m.date));
    l1.append(time);

    const fromEl = document.createElement("div");
    fromEl.className = "meta";
    const fromText = document.createElement("span");
    fromText.className = "from";
    fromText.textContent = m.from;
    fromEl.append(fromText);

    li.append(l1, fromEl);
    if (ai && ai.summary) {
      const aiLine = document.createElement("div");
      aiLine.className = "m-ai";
      aiLine.textContent = `✦ ${ai.summary}`;
      li.append(aiLine);
    }
    li.addEventListener("click", () => selectMessage(m));
    messagesList.appendChild(li);
  });
}

function selectMessage(m: MessageHeader): void {
  currentMessage = m;
  if (dFrom) dFrom.textContent = m.from;
  if (dSubject) dSubject.textContent = m.subject;
  if (dDate) dDate.textContent = fullDate(m.date);
  if (dUid) dUid.textContent = String(m.uid);
  details?.classList.remove("hidden");
  messageEmpty?.classList.add("hidden");
  document
    .querySelectorAll<HTMLElement>("#messages li")
    .forEach((el) => el.classList.toggle("selected", el.dataset.uid === String(m.uid)));
  renderAnalysisCard(analyses.get(m.uid) ?? null);
  void loadBody(m.uid);
}

async function refreshMail(): Promise<void> {
  const folders = await invoke<FolderInfo[]>("get_folders");
  renderFolders(folders);
  currentMessages = await invoke<MessageHeader[]>("get_messages");
  try {
    const entries = await invoke<AnalysisEntry[]>("get_analyses", { folder: currentFolder });
    analyses = new Map(entries.map((e) => [e.uid, e.analysis]));
  } catch {
    analyses = new Map();
  }
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
  const appWindow = getCurrentWindow();
  document
    .querySelector<HTMLButtonElement>("#win-min")
    ?.addEventListener("click", () => void appWindow.minimize());
  document
    .querySelector<HTMLButtonElement>("#win-max")
    ?.addEventListener("click", () => void appWindow.toggleMaximize());
  document
    .querySelector<HTMLButtonElement>("#win-close")
    ?.addEventListener("click", () => void appWindow.close());
  document.querySelector<HTMLElement>("#titlebar")?.addEventListener("dblclick", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest(".tb-btns")) return;
    void appWindow.toggleMaximize();
  });
  pingBtn?.addEventListener("click", () => void checkBackend());
  mailBtn?.addEventListener("click", () => void checkMail());
  composeBtn?.addEventListener("click", () => openCompose());
  replyBtn?.addEventListener("click", () => {
    if (!currentMessage) return;
    openCompose({
      title: "Ответ",
      to: extractAddress(currentMessage.from),
      subject: prefixedSubject(currentMessage.subject, "Re"),
      body: quotedOriginal(),
    });
  });
  forwardBtn?.addEventListener("click", () => {
    if (!currentMessage) return;
    openCompose({
      title: "Пересылка",
      to: "",
      subject: prefixedSubject(currentMessage.subject, "Fwd"),
      body: quotedOriginal(),
    });
  });
  composeCancel?.addEventListener("click", () => closeCompose());
  composeSend?.addEventListener("click", () => void sendCompose());
  composeFiles?.addEventListener("change", () => void onFilesPicked());
  unreadBtn?.addEventListener("click", () => {
    if (currentMessage) void markSeen(currentMessage.uid, false);
  });
  aiBtn?.addEventListener("click", () => {
    if (currentMessage) void requestAnalysis(currentMessage);
  });
  aiFlagBtn?.addEventListener("click", () => {
    if (currentMessage) void toggleFlag(currentMessage);
  });
  aiSpamBtn?.addEventListener("click", () => {
    if (currentMessage) void moveToSpam(currentMessage);
  });
  void listen<{ done: number; total: number }>("ai-progress", (e) => {
    if (statusAi) statusAi.textContent = `ИИ-разбор: ${e.payload.done}/${e.payload.total}`;
  });
  void listen<{ folder: string; uid: number; analysis: AiAnalysisData }>("ai-analyzed", (e) => {
    analyses.set(e.payload.uid, e.payload.analysis);
    if (e.payload.folder === currentFolder) renderMessages();
    if (currentMessage && currentMessage.uid === e.payload.uid) {
      renderAnalysisCard(e.payload.analysis);
    }
  });
  void listen<{ analyzed: number; important: number }>("ai-done", (e) => {
    if (statusAi) statusAi.textContent = "";
    if (e.payload.important > 0) {
      showToast(`Сорока нашла ${e.payload.important} важных писем`);
    }
  });
  let searchTimer: number | undefined;
  searchBox?.addEventListener("input", () => {
    if (searchTimer !== undefined) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      searchQuery = (searchBox?.value ?? "").trim().toLowerCase();
      renderMessages();
    }, 150);
  });
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