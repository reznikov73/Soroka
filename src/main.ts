import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

interface AppInfo { name: string; version: string; git_hash: string; }
interface PingResult { ok: boolean; time: number; }
interface MessageHeader { uid: number; seq: number; from: string; subject: string; date: string; seen: boolean; flagged: boolean; has_attachments?: boolean; }
interface AiAnalysisData {
  summary: string;
  category: string;
  importance: string;
  dates: string[];
  tasks: string[];
  actions: string[];
}
interface AnalysisEntry { uid: number; analysis: AiAnalysisData; }
interface FolderInfo { name: string; delimiter?: string | null; is_drafts?: boolean; }
interface SyncPayload { total: number; fetched: number; offline: boolean; error?: string | null; }
interface FolderCache { messages: MessageHeader[]; total: number; unseen: number; }
interface UnreadCount { folder: string; unseen: number; }
interface FolderStatRow { folder: string; total: number; unseen: number; }
interface CacheInfo { total: number; fetched: number; account?: string | null; }
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
const bodyStatus = document.querySelector<HTMLElement>("#body-status");
const bodyText = document.querySelector<HTMLElement>("#body-text");
const bodyFrame = document.querySelector<HTMLIFrameElement>("#body-frame");
const imagesBtn = document.querySelector<HTMLButtonElement>("#images-btn");
const attachList = document.querySelector<HTMLElement>("#body-attachments");
const replyBtn = document.querySelector<HTMLButtonElement>("#reply-btn");
const forwardBtn = document.querySelector<HTMLButtonElement>("#forward-btn");
const draftBtn = document.querySelector<HTMLButtonElement>("#draft-btn");
const settingsBtn = document.querySelector<HTMLButtonElement>("#settings-btn");
const settingsOverlay = document.getElementById("settings-overlay");
const settingsProvider = document.getElementById("settings-provider");
const settingsProviderLabel = document.getElementById("settings-provider-label");
const settingsProviderMenu = document.getElementById("settings-provider-menu");
let providerId = "mailru";
const settingsHint = document.getElementById("settings-hint");
const settingsEmail = document.querySelector<HTMLInputElement>("#settings-email");
const settingsPassword = document.querySelector<HTMLInputElement>("#settings-password");
const settingsImapHost = document.querySelector<HTMLInputElement>("#settings-imap-host");
const settingsImapPort = document.querySelector<HTMLInputElement>("#settings-imap-port");
const settingsSmtpHost = document.querySelector<HTMLInputElement>("#settings-smtp-host");
const settingsSmtpPort = document.querySelector<HTMLInputElement>("#settings-smtp-port");
const settingsStatus = document.getElementById("settings-status");
const composeTitle = document.querySelector<HTMLElement>("#compose-title");
const messageEmpty = document.querySelector<HTMLElement>("#message-empty");
const toast = document.querySelector<HTMLElement>("#toast");
const composeBtn = document.querySelector<HTMLButtonElement>("#compose-btn");
const composeOverlay = document.querySelector<HTMLElement>("#compose-overlay");
const composeTo = document.querySelector<HTMLInputElement>("#compose-to");
const composeSubject = document.querySelector<HTMLInputElement>("#compose-subject");
const composeBody = document.querySelector<HTMLTextAreaElement>("#compose-body");
const composeSignature = document.querySelector<HTMLSelectElement>("#compose-signature");
const composeSend = document.querySelector<HTMLButtonElement>("#compose-send");
const composeCancel = document.querySelector<HTMLButtonElement>("#compose-cancel");
const composeFiles = document.querySelector<HTMLInputElement>("#compose-files");
const composeAttachList = document.querySelector<HTMLElement>("#compose-attach-list");
const composeDraftBtn = document.querySelector<HTMLButtonElement>("#compose-draft");
const composeSaved = document.querySelector<HTMLElement>("#compose-saved");
const searchBox = document.querySelector<HTMLInputElement>("#search-box");
const searchClear = document.querySelector<HTMLButtonElement>("#search-clear");
const unreadBtn = document.querySelector<HTMLButtonElement>("#unread-btn");
const aiBtn = document.querySelector<HTMLButtonElement>("#ai-btn");
const aiSummary = document.querySelector<HTMLElement>("#ai-summary");
const aiSummaryText = document.querySelector<HTMLElement>("#ai-summary-text");
const aiBadges = document.querySelector<HTMLElement>("#ai-badges");
const aiDates = document.querySelector<HTMLElement>("#ai-dates");
const aiTasks = document.querySelector<HTMLElement>("#ai-tasks");
const calendarView = document.getElementById("calendar-view");
const calendarBtn = document.querySelector<HTMLButtonElement>("#calendar-btn");
const calGrid = document.getElementById("cal-grid");
const calMonthEl = document.getElementById("cal-month");
const calDayTitle = document.getElementById("cal-day-title");
const calDayList = document.getElementById("cal-day-list");
const aiFlagBtn = document.querySelector<HTMLButtonElement>("#ai-flag-btn");
const aiSpamBtn = document.querySelector<HTMLButtonElement>("#ai-spam-btn");
const statusAi = document.querySelector<HTMLElement>("#status-ai");
const translateBtn = document.querySelector<HTMLButtonElement>("#translate-btn");
const translationCard = document.getElementById("translation-card");
const trBody = document.getElementById("tr-body");
const trNote = document.getElementById("tr-note");
const trToggle = document.querySelector<HTMLButtonElement>("#tr-toggle");
const trClose = document.querySelector<HTMLButtonElement>("#tr-close");
const trashBtn = document.querySelector<HTMLButtonElement>("#trash-btn");
const notspamBtn = document.querySelector<HTMLButtonElement>("#notspam-btn");
const emptyTrashBtn = document.querySelector<HTMLButtonElement>("#empty-trash");
const trashActions = document.getElementById("trash-actions");

let toastTimer: number | undefined;
let currentMessages: MessageHeader[] = [];
let currentFolder = "";
/** TASK-016: список ящиков и активный ящик. */
let accounts: AccountView[] = [];
let activeAccountId = "";
/** Ящик, который правим в мастере настройки (null — добавляем новый). */
let editingAccountId: string | null = null;
let bodySeq = 0;
let currentBody: BodyPayload | null = null;
let currentMessage: MessageHeader | null = null;
let composeAttachments: { name: string; mime: string; dataB64: string; size: number }[] = [];
/** TASK-022: черновик, который сейчас редактируется в окне письма. */
type DraftData = {
  account: string;
  id: string;
  folder: string;
  uid: number | null;
  to_addr: string;
  subject: string;
  body: string;
  updated_at: number;
};
let editingDraft: DraftData | null = null;
let currentDraftId = "";
let draftTimer: number | undefined;
let lastDraftPayload = "";
let searchQuery = "";
let analyses = new Map<number, AiAnalysisData>();

/* ===== TASK-020: общие настройки (категории, промпты, подписи) ===== */

type CategoryRuleData = { from_contains: string[]; subject_contains: string[] };
type CategoryData = {
  name: string;
  color: string;
  hint: string;
  rules: CategoryRuleData;
  builtin: boolean;
};
type PromptsData = { analysis: string; reply: string; improve: string; translate: string };
type SignatureData = { name: string; text: string; is_default: boolean };
type AppearanceData = { transparent: boolean };
type SettingsData = {
  categories: CategoryData[];
  prompts: PromptsData;
  signatures: SignatureData[];
  appearance: AppearanceData;
};

let settingsData: SettingsData | null = null;
/** Индекс категории в редакторе; null — создаём новую. */
let editingCategory: number | null = null;

async function loadSettings(): Promise<void> {
  try {
    settingsData = await invoke<SettingsData>("get_settings");
  } catch (err) {
    settingsData = null;
    console.warn("настройки не загрузились", err);
  }
}

async function persistSettings(): Promise<void> {
  if (!settingsData) return;
  try {
    await invoke("save_settings", { next: settingsData });
  } catch (err) {
    showToast(`Не удалось сохранить настройки: ${String(err)}`);
  }
}

function switchSettingsView(view: string): void {
  document
    .querySelectorAll<HTMLElement>(".settings-view")
    .forEach((el) => el.classList.add("hidden"));
  document.getElementById(`view-${view}`)?.classList.remove("hidden");
  document.querySelectorAll<HTMLElement>(".sn-item[data-view]").forEach((el) => {
    el.classList.toggle("on", el.dataset.view === view);
  });
  document.querySelectorAll<HTMLElement>("#settings-accounts .sn-item").forEach((el) => {
    el.classList.toggle("on", view === "account" && el.dataset.account === editingAccountId);
  });
}

function openSettingsShell(view: string): void {
  settingsOverlay?.classList.remove("hidden");
  renderSettingsAccounts();
  if (view === "categories") renderCategories();
  if (view === "prompts") renderPrompts();
  if (view === "signatures") renderSignatures();
  if (view === "appearance") renderAppearance();
  switchSettingsView(view);
}

function renderSettingsAccounts(): void {
  const box = document.getElementById("settings-accounts");
  if (!box) return;
  box.innerHTML = "";
  if (accounts.length === 0) {
    const p = document.createElement("div");
    p.className = "sn-item";
    p.textContent = "Ящиков пока нет";
    box.append(p);
    return;
  }
  for (const acc of accounts) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sn-item";
    b.dataset.account = acc.id;
    b.textContent = acc.email;
    b.title = acc.email;
    b.addEventListener("click", () => void openSettings(false, false, acc.id));
    box.append(b);
  }
}

function ruleText(c: CategoryData): string {
  const parts: string[] = [];
  if (c.rules.from_contains.length) parts.push("от: " + c.rules.from_contains.join(", "));
  if (c.rules.subject_contains.length) parts.push("тема: " + c.rules.subject_contains.join(", "));
  return parts.join(" · ");
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function renderCategories(): void {
  const list = document.getElementById("cat-list");
  if (!list || !settingsData) return;
  list.innerHTML = "";
  settingsData.categories.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "cat-row" + (editingCategory === i ? " on" : "");
    const sw = document.createElement("span");
    sw.className = "sw";
    sw.style.background = c.color;
    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = c.name;
    const cond = document.createElement("span");
    cond.className = "cond";
    cond.textContent = ruleText(c);
    const ops = document.createElement("span");
    ops.className = "ops";
    const up = document.createElement("button");
    up.type = "button";
    up.textContent = "↑";
    up.title = "Выше приоритет";
    up.disabled = i === 0;
    up.addEventListener("click", (e) => {
      e.stopPropagation();
      void moveCategory(i, -1);
    });
    const down = document.createElement("button");
    down.type = "button";
    down.textContent = "↓";
    down.title = "Ниже приоритет";
    down.disabled = i === settingsData!.categories.length - 1;
    down.addEventListener("click", (e) => {
      e.stopPropagation();
      void moveCategory(i, 1);
    });
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "✎";
    edit.title = "Изменить";
    edit.addEventListener("click", (e) => {
      e.stopPropagation();
      openCategoryEditor(i);
    });
    ops.append(up, down, edit);
    row.append(sw, nm, cond, ops);
    row.addEventListener("click", () => openCategoryEditor(i));
    list.append(row);
  });
}

async function moveCategory(index: number, delta: number): Promise<void> {
  if (!settingsData) return;
  const next = index + delta;
  if (next < 0 || next >= settingsData.categories.length) return;
  const [item] = settingsData.categories.splice(index, 1);
  settingsData.categories.splice(next, 0, item);
  await persistSettings();
  renderCategories();
}

function openCategoryEditor(index: number | null): void {
  const editor = document.getElementById("cat-editor");
  if (!editor || !settingsData) return;
  editingCategory = index;
  const c: CategoryData =
    index === null
      ? { name: "", color: "#60cdff", hint: "", rules: { from_contains: [], subject_contains: [] }, builtin: false }
      : settingsData.categories[index];
  const nameEl = document.getElementById("cat-name") as HTMLInputElement | null;
  const colorEl = document.getElementById("cat-color") as HTMLInputElement | null;
  const hintEl = document.getElementById("cat-hint") as HTMLInputElement | null;
  const fromEl = document.getElementById("cat-from") as HTMLInputElement | null;
  const subjEl = document.getElementById("cat-subject") as HTMLInputElement | null;
  if (nameEl) nameEl.value = c.name;
  if (colorEl) colorEl.value = /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : "#60cdff";
  if (hintEl) hintEl.value = c.hint;
  if (fromEl) fromEl.value = c.rules.from_contains.join(", ");
  if (subjEl) subjEl.value = c.rules.subject_contains.join(", ");
  const del = document.getElementById("cat-delete") as HTMLButtonElement | null;
  if (del) del.disabled = index === null;
  editor.classList.remove("hidden");
  renderCategories();
  nameEl?.focus();
}

function closeCategoryEditor(): void {
  document.getElementById("cat-editor")?.classList.add("hidden");
  editingCategory = null;
  renderCategories();
}

async function saveCategory(): Promise<void> {
  if (!settingsData) return;
  const name = (document.getElementById("cat-name") as HTMLInputElement | null)?.value.trim() ?? "";
  if (!name) {
    showToast("У категории должно быть название");
    return;
  }
  const color = (document.getElementById("cat-color") as HTMLInputElement | null)?.value ?? "#60cdff";
  const hint = (document.getElementById("cat-hint") as HTMLInputElement | null)?.value.trim() ?? "";
  const from = splitList((document.getElementById("cat-from") as HTMLInputElement | null)?.value ?? "");
  const subject = splitList((document.getElementById("cat-subject") as HTMLInputElement | null)?.value ?? "");
  const rules: CategoryRuleData = { from_contains: from, subject_contains: subject };
  const builtin = editingCategory === null ? false : settingsData.categories[editingCategory].builtin;
  const item: CategoryData = { name, color, hint, rules, builtin };
  if (editingCategory === null) settingsData.categories.push(item);
  else settingsData.categories[editingCategory] = item;
  await persistSettings();
  closeCategoryEditor();
}

async function deleteCategory(): Promise<void> {
  if (!settingsData || editingCategory === null) return;
  settingsData.categories.splice(editingCategory, 1);
  await persistSettings();
  closeCategoryEditor();
}

function renderPrompts(): void {
  if (!settingsData) return;
  const set = (id: string, value: string): void => {
    const el = document.getElementById(id) as HTMLTextAreaElement | null;
    if (el) el.value = value;
  };
  set("prompt-analysis", settingsData.prompts.analysis);
  set("prompt-reply", settingsData.prompts.reply);
  set("prompt-improve", settingsData.prompts.improve);
  set("prompt-translate", settingsData.prompts.translate);
}

async function savePrompts(): Promise<void> {
  if (!settingsData) return;
  const get = (id: string): string =>
    (document.getElementById(id) as HTMLTextAreaElement | null)?.value ?? "";
  settingsData.prompts = {
    analysis: get("prompt-analysis"),
    reply: get("prompt-reply"),
    improve: get("prompt-improve"),
    translate: get("prompt-translate"),
  };
  await persistSettings();
  showToast("Промпты сохранены");
}

async function resetAllSettings(): Promise<void> {
  try {
    settingsData = await invoke<SettingsData>("reset_settings");
    renderCategories();
    renderPrompts();
    renderSignatures();
    showToast("Настройки сброшены к стандартным");
  } catch (err) {
    showToast(`Не удалось сбросить: ${String(err)}`);
  }
}

function renderSignatures(): void {
  const list = document.getElementById("sig-list");
  if (!list || !settingsData) return;
  list.innerHTML = "";
  if (settingsData.signatures.length === 0) {
    const p = document.createElement("p");
    p.className = "sv-hint";
    p.textContent = "Подписей пока нет.";
    list.append(p);
    return;
  }
  settingsData.signatures.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "sig-row";
    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = s.name;
    const tx = document.createElement("span");
    tx.className = "tx";
    tx.textContent = s.text.replace(/\s+/g, " ").slice(0, 80);
    const ops = document.createElement("span");
    ops.className = "ops";
    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "✕";
    del.title = "Удалить подпись";
    del.addEventListener("click", () => {
      settingsData?.signatures.splice(i, 1);
      void persistSettings().then(renderSignatures);
    });
    ops.append(del);
    row.append(nm, tx, ops);
    list.append(row);
  });
}

async function addSignature(): Promise<void> {
  if (!settingsData) return;
  const name = (document.getElementById("sig-name") as HTMLInputElement | null)?.value.trim() ?? "";
  const text = (document.getElementById("sig-text") as HTMLTextAreaElement | null)?.value.trim() ?? "";
  if (!name || !text) {
    showToast("Заполните название и текст подписи");
    return;
  }
  settingsData.signatures.push({ name, text, is_default: settingsData.signatures.length === 0 });
  await persistSettings();
  const nameEl = document.getElementById("sig-name") as HTMLInputElement | null;
  const textEl = document.getElementById("sig-text") as HTMLTextAreaElement | null;
  if (nameEl) nameEl.value = "";
  if (textEl) textEl.value = "";
  renderSignatures();
}

/* ===== TASK-020: перевод письма ===== */

let translatedFor = 0;

async function translateCurrent(): Promise<void> {
  if (!currentMessage || !translationCard || !trBody) return;
  const m = currentMessage;
  translationCard.classList.remove("hidden");
  translatedFor = m.uid;
  if (trNote) trNote.textContent = "перевожу…";
  trBody.textContent = "";
  if (translateBtn) translateBtn.disabled = true;
  try {
    const text = await invoke<string>("translate_message", { folder: currentFolder, uid: m.uid });
    if (translatedFor !== m.uid) return;
    trBody.textContent = text;
    if (trNote) trNote.textContent = "GigaChat";
  } catch (err) {
    trBody.textContent = `Не удалось перевести: ${String(err)}`;
    if (trNote) trNote.textContent = "";
  } finally {
    if (translateBtn) translateBtn.disabled = false;
  }
}

function hideTranslation(): void {
  translationCard?.classList.add("hidden");
  translatedFor = 0;
}


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
    const before = currentMessages.find((x) => x.uid === uid)?.seen;
    await invoke("set_seen", { folder: currentFolder, uid, seen });
    const msg = currentMessages.find((x) => x.uid === uid);
    if (msg) msg.seen = seen;
    if (currentMessage && currentMessage.uid === uid) currentMessage.seen = seen;
    renderMessages();
    if (before !== undefined && before !== seen) {
      bumpUnread(currentFolder, seen ? -1 : 1);
    }
  } catch (err) {
    showToast(`Не удалось пометить: ${String(err)}`);
  }
}

/** Запасные цвета для разборов, сделанных до TASK-020. */
const CATEGORY_META: Record<string, { label: string; color: string }> = {
  реклама: { label: "Реклама", color: "#b9c2cf" },
  клиент: { label: "Клиент", color: "#60cdff" },
  госорган: { label: "Госорган", color: "#8fb8ff" },
  финансы: { label: "Финансы", color: "#7de3a8" },
  уведомление: { label: "Уведомление", color: "#9aa3b2" },
  личное: { label: "Личное", color: "#9aa3b2" },
  мошенничество: { label: "Осторожно", color: "#ff8a80" },
};

/** Бейдж категории: цвет и подпись берутся из общих настроек (TASK-020). */
function categoryBadge(cat: string): { label: string; color: string } | null {
  const c = cat.trim();
  if (!c) return null;
  const found = settingsData?.categories.find(
    (x) => x.name.trim().toLowerCase() === c.toLowerCase(),
  );
  if (found) return { label: found.name, color: found.color };
  const legacy = CATEGORY_META[c.toLowerCase()];
  if (legacy) return legacy;
  return { label: c, color: "#9aa3b2" };
}

function paintBadge(el: HTMLElement, badge: { label: string; color: string }): void {
  el.className = "cat";
  el.textContent = badge.label;
  el.style.color = badge.color;
  el.style.borderColor = `${badge.color}66`;
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
      paintBadge(bs, cat);
      aiBadges.append(bs);
    }
    if (a.importance === "высокая") {
      const im = document.createElement("span");
      im.className = "cat cat-important";
      im.textContent = "⚠ Важное";
      aiBadges.append(im);
    }
  }
  renderDatesAndTasks(a);
  if (aiFlagBtn && currentMessage) {
    aiFlagBtn.textContent = currentMessage.flagged ? "⚑ Снять важное" : "⚑ В важные";
  }
}

/** ---- TASK-013: даты и задачи → календарь (.ics) ---- */

const RU_MONTHS_GEN: Record<string, number> = {
  января: 0, февраля: 1, марта: 2, апреля: 3, мая: 4, июня: 5,
  июля: 6, августа: 7, сентября: 8, октября: 9, ноября: 10, декабря: 11,
};

interface ParsedEvent {
  label: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
}

interface OneDate {
  start: Date;
  end: Date | null;
  hasTime: boolean;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");
const isoDay = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const isoMinute = (d: Date): string => `${isoDay(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/** Год для даты без года: текущий; если дата уже давно прошла — следующий. */
function pickYear(month: number, day: number): number {
  const now = new Date();
  const y = now.getFullYear();
  const candidate = new Date(y, month, day, 23, 59);
  if (candidate.getTime() < now.getTime() - 30 * 86_400_000) return y + 1;
  return y;
}

/** Разбор одной даты из фразы («17-18 октября», «до 15 ноября», «15.10.2026», «завтра в 10:30»…). */
function parseOneDate(src: string): OneDate | null {
  const raw = src.trim();
  const s = raw.toLowerCase().replace(/[–—]/g, "-");
  const now = new Date();
  const tm = s.match(/(\d{1,2}):(\d{2})/);
  const hh = tm ? Number(tm[1]) : null;
  const mi = tm ? Number(tm[2]) : null;
  const hasTime = hh !== null && mi !== null && hh <= 23 && mi <= 59;
  const applyTime = (d: Date): Date => {
    if (!hasTime) return d;
    const c = new Date(d);
    c.setHours(hh as number, mi as number, 0, 0);
    return c;
  };

  if (/сегодня/.test(s)) return { start: applyTime(now), end: null, hasTime };
  if (/послезавтра/.test(s)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    return { start: applyTime(d), end: null, hasTime };
  }
  if (/завтра/.test(s)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return { start: applyTime(d), end: null, hasTime };
  }

  let m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:\s*-\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4}))?/);
  if (m) {
    const yr = (v: string): number => (v.length === 2 ? 2000 + Number(v) : Number(v));
    const start = new Date(yr(m[3]), Number(m[2]) - 1, Number(m[1]));
    const end = m[4] && m[5] && m[6] ? new Date(yr(m[6]), Number(m[5]) - 1, Number(m[4])) : null;
    return { start: applyTime(start), end: end ? applyTime(end) : null, hasTime };
  }

  m = s.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (m) {
    return { start: applyTime(new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]))), end: null, hasTime };
  }

  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{4}))?/);
  if (m) {
    const conv = (a: string, b: string): [number, number] => {
      const x = Number(a);
      const y = Number(b);
      if (x > 12) return [x, y - 1];
      return [y, x - 1];
    };
    const [d1, mo1] = conv(m[1], m[2]);
    const start = new Date(Number(m[3]), mo1, d1);
    let end: Date | null = null;
    if (m[4] && m[5] && m[6]) {
      const [d2, mo2] = conv(m[4], m[5]);
      end = new Date(Number(m[6]), mo2, d2);
    }
    return { start, end, hasTime: false };
  }

  m = s.match(/с\s+(\d{1,2})\s+по\s+(\d{1,2})\s+([а-яё]+)/);
  if (m) {
    const mo = RU_MONTHS_GEN[m[3]];
    if (mo !== undefined) {
      const y = pickYear(mo, Number(m[1]));
      return { start: new Date(y, mo, Number(m[1])), end: new Date(y, mo, Number(m[2])), hasTime };
    }
  }

  m = s.match(/(\d{1,2})\s*-\s*(\d{1,2})\s+([а-яё]+)/);
  if (m) {
    const mo = RU_MONTHS_GEN[m[3]];
    if (mo !== undefined) {
      const y = pickYear(mo, Number(m[1]));
      return { start: new Date(y, mo, Number(m[1])), end: new Date(y, mo, Number(m[2])), hasTime };
    }
  }

  const genRe = /(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?/g;
  let mg: RegExpExecArray | null;
  while ((mg = genRe.exec(s)) !== null) {
    const mo = RU_MONTHS_GEN[mg[2]];
    if (mo !== undefined) {
      const y = mg[3] ? Number(mg[3]) : pickYear(mo, Number(mg[1]));
      return { start: new Date(y, mo, Number(mg[1])), end: null, hasTime };
    }
  }

  return null;
}

/** Привести разобранную дату к событию ICS (весь день или со временем). */
function finalizeEvent(one: OneDate, label: string, title: string): ParsedEvent {
  if (one.hasTime) {
    const start = new Date(one.start);
    const end = new Date(start);
    end.setHours(end.getHours() + 1);
    return { label, title, start: isoMinute(start), end: isoMinute(end), allDay: false };
  }
  const start = new Date(one.start.getFullYear(), one.start.getMonth(), one.start.getDate());
  let end = new Date(start);
  end.setDate(end.getDate() + 1);
  if (one.end) {
    const e2 = new Date(one.end.getFullYear(), one.end.getMonth(), one.end.getDate());
    e2.setDate(e2.getDate() + 1);
    if (e2.getTime() > end.getTime()) end = e2;
  }
  return { label, title, start: isoDay(start), end: isoDay(end), allDay: true };
}

/** Подпись чипа: «📅 17 окт – 18 окт», «📅 15 ноя · срок», «📅 17 окт, 10:30». */
function prettyDateLabel(one: OneDate, raw: string): string {
  const d = one.start;
  const yy = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : "";
  let label = `📅 ${d.getDate()} ${RU_MONTHS[d.getMonth()]}${yy}`;
  if (one.end && one.end.getTime() !== one.start.getTime()) {
    label += ` – ${one.end.getDate()} ${RU_MONTHS[one.end.getMonth()]}`;
  }
  if (one.hasTime) label += `, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (/^до\b/.test(raw.trim().toLowerCase())) label += " · срок";
  return label;
}

/** Разбор элемента «Дат»: несколько дат через «;» — каждая становится событием. */
function parseDateItems(item: string): ParsedEvent[] {
  const parts = item.split(";").map((p) => p.trim()).filter((p) => p.length > 0);
  const out: ParsedEvent[] = [];
  for (const part of parts) {
    const one = parseOneDate(part);
    if (!one) continue;
    let title = "";
    const chunks = part.split(/\s+[—-]\s+/);
    if (chunks.length > 1) {
      const rest = chunks.slice(1).join(" — ").trim();
      if (rest && !/\d/.test(rest)) title = rest.slice(0, 80);
    }
    out.push(finalizeEvent(one, prettyDateLabel(one, part), title));
  }
  return out;
}

/** Сохранить событие в календарь (файл .ics в «Загрузки»). */
async function exportIcs(
  ev: ParsedEvent,
  sourceText: string,
  ctx?: { subject: string; from: string },
): Promise<void> {
  const subject = ctx?.subject ?? currentMessage?.subject ?? "Событие из письма";
  const from = ctx?.from ?? currentMessage?.from ?? "";
  const title = (ev.title || subject).slice(0, 120);
  const desc: string[] = [`Письмо: ${subject}`];
  if (from) desc.push(`От: ${from}`);
  if (sourceText && sourceText !== title) desc.push("", sourceText.slice(0, 300));
  try {
    const path = await invoke<string>("export_event_ics", {
      title,
      start: ev.start,
      end: ev.end,
      description: desc.join("\n").slice(0, 900),
    });
    showToast(
      `📅 Файл в «Загрузках»: ${path.split(/[\\/]/).pop()} — двойной щелчок добавит событие в календарь`,
    );
  } catch (err) {
    showToast(`Не получилось сохранить событие: ${String(err)}`);
  }
}

/** Блок «даты и задачи» в карточке разбора (TASK-013). */
function renderDatesAndTasks(a: AiAnalysisData): void {
  if (!aiDates || !aiTasks) return;
  aiDates.innerHTML = "";
  aiTasks.innerHTML = "";
  const dates = (a.dates ?? []).filter((d) => d.trim().length > 0);
  const tasks = (a.tasks ?? []).filter((t) => t.trim().length > 0);
  aiDates.classList.toggle("hidden", dates.length === 0);
  aiTasks.classList.toggle("hidden", tasks.length === 0);

  dates.forEach((item) => {
    const events = parseDateItems(item);
    if (events.length === 0) {
      const span = document.createElement("span");
      span.className = "ai-date-raw";
      span.textContent = item;
      span.title = "Сорока не смогла разобрать эту дату — в календарь не отправить";
      aiDates.append(span);
      return;
    }
    events.forEach((ev) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ai-date-chip";
      b.textContent = ev.label;
      b.title = "Добавить событие в календарь";
      b.addEventListener("click", () => openEventFormFromParsed(ev, item));
      aiDates.append(b);
    });
  });

  tasks.forEach((t) => {
    const row = document.createElement("div");
    row.className = "ai-task";
    const dot = document.createElement("span");
    dot.className = "ai-task-dot";
    dot.textContent = "•";
    const txt = document.createElement("span");
    txt.className = "ai-task-text";
    txt.textContent = t;
    row.append(dot, txt);
    const one = parseOneDate(t);
    if (one) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ai-task-cal";
      b.textContent = "📅";
      b.title = "Добавить событие в календарь";
      const ev = finalizeEvent(one, "", t);
      b.addEventListener("click", () => openEventFormFromParsed(ev, t));
      row.append(b);
    }
    aiTasks.append(row);
  });
}

/** ---- TASK-013 (часть E): форма события — человек подтверждает ---- */

interface EventFormSeed {
  title: string;
  start: string;
  end: string;
  time: string;
  description: string;
  folder: string;
  uid: number;
}

const eventOverlay = document.getElementById("event-overlay");
const eventTitle = document.querySelector<HTMLInputElement>("#event-title");
const eventStart = document.querySelector<HTMLInputElement>("#event-start");
const eventEnd = document.querySelector<HTMLInputElement>("#event-end");
const eventTime = document.querySelector<HTMLInputElement>("#event-time");
const eventDesc = document.querySelector<HTMLTextAreaElement>("#event-desc");

let eventSeed: EventFormSeed | null = null;

function openEventForm(seed: EventFormSeed): void {
  if (!eventOverlay || !eventTitle || !eventStart || !eventEnd || !eventTime || !eventDesc) return;
  eventSeed = seed;
  eventTitle.value = seed.title;
  eventStart.value = seed.start;
  eventEnd.value = seed.end;
  eventTime.value = seed.time;
  eventDesc.value = seed.description;
  eventOverlay.classList.remove("hidden");
  eventTitle.focus();
}

function closeEventForm(): void {
  eventOverlay?.classList.add("hidden");
  eventSeed = null;
}

/** Из чипа «📅 …» в карточке письма: предзаполнить форму и открыть её. */
function openEventFormFromParsed(ev: ParsedEvent, sourceText: string): void {
  const subject = (currentMessage?.subject ?? "").trim();
  const from = (currentMessage?.from ?? "").trim();
  const startDay = ev.start.slice(0, 10);
  const time = ev.allDay ? "" : ev.start.slice(11, 16);
  let endDay = "";
  if (ev.end) {
    const e0 = new Date(`${ev.end.slice(0, 10)}T00:00:00`);
    if (ev.allDay) e0.setDate(e0.getDate() - 1);
    const cand = isoDay(e0);
    if (cand > startDay) endDay = cand;
  }
  const descParts: string[] = [];
  if (sourceText.trim()) descParts.push(sourceText.trim());
  if (subject) descParts.push(`Из письма: ${subject}`);
  if (from) descParts.push(from);
  openEventForm({
    title: ev.title.trim() || subject,
    start: startDay,
    end: endDay,
    time,
    description: descParts.join("\n"),
    folder: currentFolder ?? "",
    uid: currentMessage?.uid ?? 0,
  });
}

async function saveEventForm(): Promise<void> {
  if (!eventTitle || !eventStart || !eventEnd || !eventTime || !eventDesc) return;
  const saveBtn = document.getElementById("event-save") as HTMLButtonElement | null;
  const start = eventStart.value.trim();
  if (!start) {
    showToast("Укажите дату события");
    return;
  }
  const endV = eventEnd.value.trim() && eventEnd.value.trim() > start ? eventEnd.value.trim() : null;
  const timeV = eventTime.value.trim() || null;
  const titleV = eventTitle.value.trim() || "Событие";
  if (saveBtn) saveBtn.disabled = true;
  try {
    await invoke<number>("add_calendar_event", {
      title: titleV,
      start,
      end: endV,
      time: timeV,
      description: eventDesc.value,
      folder: eventSeed?.folder || null,
      uid: eventSeed && eventSeed.uid > 0 ? eventSeed.uid : null,
    });
    closeEventForm();
    showToast(`✅ Событие «${titleV}» добавлено в календарь`);
    await reloadCalEvents();
  } catch (err) {
    showToast(`Не получилось добавить событие: ${String(err)}`);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

/** ---- TASK-013 (часть E): календарь — только события человека ---- */

interface SavedEvent {
  id: number;
  title: string;
  start: string;
  end: string;
  time: string | null;
  description: string;
  folder: string | null;
  uid: number | null;
}

interface CalEvent {
  id: number;
  y: number;
  m: number;
  d: number;
  time: string;
  title: string;
  description: string;
  folder: string | null;
  uid: number | null;
}

const CAL_MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

let calEvents: CalEvent[] = [];
let calCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let calSelectedDay = "";

function dayKey(y: number, m: number, d: number): string {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

/** Разложить сохранённые события по дням (диапазоны — на каждый день, до года). */
function buildSavedEvents(rows: SavedEvent[]): CalEvent[] {
  const out: CalEvent[] = [];
  rows.forEach((r) => {
    const sy = Number(r.start.slice(0, 4));
    const sm = Number(r.start.slice(5, 7)) - 1;
    const sd = Number(r.start.slice(8, 10));
    const first = new Date(sy, sm, sd);
    let last = new Date(sy, sm, sd);
    if (r.end && r.end.length === 10) {
      const e2 = new Date(Number(r.end.slice(0, 4)), Number(r.end.slice(5, 7)) - 1, Number(r.end.slice(8, 10)));
      if (e2.getTime() >= first.getTime() && e2.getTime() - first.getTime() < 370 * 86_400_000) last = e2;
    }
    const cur = new Date(first);
    let guard = 0;
    while (cur.getTime() <= last.getTime() && guard < 370) {
      out.push({
        id: r.id,
        y: cur.getFullYear(),
        m: cur.getMonth(),
        d: cur.getDate(),
        time: r.time ?? "",
        title: r.title,
        description: r.description,
        folder: r.folder,
        uid: r.uid,
      });
      cur.setDate(cur.getDate() + 1);
      guard += 1;
    }
  });
  return out;
}

function eventsOn(y: number, m: number, d: number): CalEvent[] {
  return calEvents
    .filter((e) => e.y === y && e.m === m && e.d === d)
    .sort((a, b) =>
      a.time === b.time ? a.title.localeCompare(b.title) : a.time.localeCompare(b.time),
    );
}

function renderCalendar(): void {
  if (!calGrid || !calMonthEl || !calDayTitle || !calDayList) return;
  const y = calCursor.getFullYear();
  const m = calCursor.getMonth();
  calMonthEl.textContent = `${CAL_MONTHS[m]} ${y}`;
  calGrid.innerHTML = "";
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = new Date();
  const tKey = dayKey(today.getFullYear(), today.getMonth(), today.getDate());
  if (!calSelectedDay) calSelectedDay = tKey;
  const totalCells = Math.ceil((lead + daysInMonth) / 7) * 7;
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - lead + 1;
    const dd = new Date(y, m, dayNum);
    const cy = dd.getFullYear();
    const cm = dd.getMonth();
    const cd = dd.getDate();
    const other = cm !== m;
    const key = dayKey(cy, cm, cd);
    const cell = document.createElement("div");
    cell.className = "cal-cell";
    if (other) cell.classList.add("other");
    if (key === tKey) cell.classList.add("today");
    if (key === calSelectedDay) cell.classList.add("sel");
    const num = document.createElement("div");
    num.className = "cal-num";
    num.textContent = String(cd);
    cell.append(num);
    const evs = eventsOn(cy, cm, cd);
    evs.slice(0, 3).forEach((e) => {
      const chip = document.createElement("div");
      chip.className = e.time ? "cal-chip" : "cal-chip dim";
      chip.textContent = `${e.time ? `${e.time} ` : ""}${e.title}`;
      chip.title = `${e.title}${e.description ? ` — ${e.description.split("\n")[0].slice(0, 90)}` : ""}`;
      cell.append(chip);
    });
    if (evs.length > 3) {
      const more = document.createElement("div");
      more.className = "cal-more";
      more.textContent = `+${evs.length - 3} ещё`;
      cell.append(more);
    }
    cell.addEventListener("click", () => {
      calSelectedDay = key;
      if (other) calCursor = new Date(cy, cm, 1);
      renderCalendar();
    });
    calGrid.append(cell);
  }
  renderCalDay();
}

function renderCalDay(): void {
  if (!calDayTitle || !calDayList) return;
  const [y, m, d] = calSelectedDay.split("-").map(Number);
  const today = new Date();
  const tKey = dayKey(today.getFullYear(), today.getMonth(), today.getDate());
  const label = `${d} ${RU_MONTHS_FULL[m - 1]} ${y}`;
  calDayTitle.textContent = calSelectedDay === tKey ? `Сегодня, ${label}` : label;
  calDayList.innerHTML = "";
  const evs = eventsOn(y, m - 1, d);
  if (evs.length === 0) {
    const p = document.createElement("div");
    p.className = "cal-empty";
    p.textContent =
      calEvents.length === 0
        ? "Событий пока нет. Откройте письмо, в карточке «✦ Разбор» нажмите кнопку с датой («📅 …») — Сорока предложит форму, и после подтверждения событие появится здесь."
        : "На этот день событий нет.";
    calDayList.append(p);
    return;
  }
  evs.forEach((e) => {
    const card = document.createElement("div");
    card.className = "cal-ev";
    const top = document.createElement("div");
    top.className = "cal-ev-top";
    const tm = document.createElement("span");
    tm.className = "cal-ev-time";
    tm.textContent = e.time || "весь день";
    const tt = document.createElement("span");
    tt.className = "cal-ev-title";
    tt.textContent = e.title;
    tt.title = e.title;
    top.append(tm, tt);
    card.append(top);
    if (e.description) {
      const desc = document.createElement("div");
      desc.className = "cal-ev-desc";
      desc.textContent = e.description;
      desc.title = e.description;
      card.append(desc);
    }
    const actions = document.createElement("div");
    actions.className = "cal-ev-actions";
    if (e.folder && e.uid) {
      const bOpen = document.createElement("button");
      bOpen.type = "button";
      bOpen.textContent = "Открыть письмо";
      bOpen.addEventListener(
        "click",
        () => void openLetterFromCalendar(e.folder as string, e.uid as number),
      );
      actions.append(bOpen);
    }
    const bIcs = document.createElement("button");
    bIcs.type = "button";
    bIcs.textContent = "Сохранить .ics";
    bIcs.title = "Файл-приглашение для календаря Windows";
    bIcs.addEventListener("click", () => void saveCalEventIcs(e));
    const bDel = document.createElement("button");
    bDel.type = "button";
    bDel.className = "danger";
    bDel.textContent = "Удалить";
    bDel.addEventListener("click", () => void deleteCalEvent(e));
    actions.append(bIcs, bDel);
    card.append(actions);
    calDayList.append(card);
  });
}

async function saveCalEventIcs(e: CalEvent): Promise<void> {
  const start = e.time ? `${dayKey(e.y, e.m, e.d)}T${e.time}` : dayKey(e.y, e.m, e.d);
  const end = e.time
    ? isoMinute(new Date(new Date(`${start}:00`).getTime() + 3_600_000))
    : isoDay(new Date(new Date(`${dayKey(e.y, e.m, e.d)}T00:00:00`).getTime() + 86_400_000));
  await exportIcs(
    { label: "", title: e.title, start, end, allDay: !e.time },
    e.description || e.title,
    { subject: e.title, from: "" },
  );
}

async function deleteCalEvent(e: CalEvent): Promise<void> {
  try {
    await invoke("delete_calendar_event", { id: e.id });
    showToast("Событие удалено из календаря");
    await reloadCalEvents();
  } catch (err) {
    showToast(`Не получилось удалить событие: ${String(err)}`);
  }
}

async function openLetterFromCalendar(folder: string, uid: number): Promise<void> {
  closeCalendar();
  if (currentFolder !== folder) {
    await selectFolder(folder);
  }
  const mm = currentMessages.find((x) => x.uid === uid);
  if (mm) {
    selectMessage(mm);
  } else {
    showToast("Письмо не в списке загруженных — обновите почту");
  }
}

function closeCalendar(): void {
  document.getElementById("app")?.classList.remove("hidden");
  calendarView?.classList.add("hidden");
  if (calendarBtn) calendarBtn.textContent = "Календарь";
}

async function reloadCalEvents(): Promise<void> {
  try {
    const rows = await invoke<SavedEvent[]>("get_calendar_events");
    calEvents = buildSavedEvents(rows);
  } catch (err) {
    calEvents = [];
    showToast(`Календарь: не удалось загрузить события (${String(err)})`);
  }
  if (calendarView && !calendarView.classList.contains("hidden")) renderCalendar();
}

async function openCalendar(): Promise<void> {
  document.getElementById("app")?.classList.add("hidden");
  calendarView?.classList.remove("hidden");
  if (calendarBtn) calendarBtn.textContent = "Почта";
  calSelectedDay = "";
  await reloadCalEvents();
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
      from: m.from,
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
    const spamFolder = await invoke<string>("move_to_spam", {
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
    showToast(`Письмо перенесено в «${spamFolder || "Спам"}»`);
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

/** TASK-016: ключ папки — "ящик::имя" (см. accounts.rs::folder_key). */
function folderKeyOf(accountId: string, name: string): string {
  return `${accountId}::${name}`;
}

/** Разбирает ключ папки обратно на ящик и имя. */
function splitFolderKey(key: string): { accountId: string; name: string } {
  const i = key.indexOf("::");
  if (i <= 0) return { accountId: "", name: key };
  return { accountId: key.slice(0, i), name: key.slice(i + 2) };
}

/** Значок папки по её имени. */
function folderIcon(name: string): string {
  if (name === "INBOX") return "📥";
  const l = name.toLowerCase();
  if (l.includes("отправл") || l.includes("sent")) return "📤";
  if (l.includes("корзин") || l.includes("trash") || l.includes("deleted")) return "🗑";
  if (l.includes("спам") || l.includes("spam") || l.includes("junk")) return "🚫";
  if (l.includes("черновик") || l.includes("draft")) return "📝";
  return "📁";
}

/** Подпись папки для человека: INBOX -> «Входящие». */
function folderDisplay(name: string): string {
  return name === "INBOX" ? "Входящие" : name;
}

/** Непрочитанные по папкам (TASK-019). */
const unreadByFolder = new Map<string, number>();
/** Всего писем по папкам (TASK-021). */
const totalsByFolder = new Map<string, number>();
/** Свёрнутые папки дерева (TASK-021). */
const collapsedFolders = new Set<string>(
  (() => {
    try {
      return JSON.parse(localStorage.getItem("soroka.foldersCollapsed") ?? "[]") as string[];
    } catch {
      return [];
    }
  })(),
);
let lastFolders: FolderInfo[] = [];

/** Сумма непрочитанных по папкам ящика. */
function sumUnread(accountId: string): number {
  let sum = 0;
  for (const f of lastFolders) {
    if (f.name.startsWith(`${accountId}::`)) sum += unreadByFolder.get(f.name) ?? 0;
  }
  return sum;
}

/** Локальная правка цифры (после «прочитано/непрочитано»). */
function bumpUnread(folder: string, delta: number): void {
  const cur = unreadByFolder.get(folder) ?? 0;
  unreadByFolder.set(folder, Math.max(0, cur + delta));
  renderFolders(lastFolders);
}

/** Локальная правка «всего» (TASK-021). */
function bumpTotals(folder: string, _unseen: number): void {
  if (!totalsByFolder.has(folder)) totalsByFolder.set(folder, 0);
}

/** Цифры из кэша — мгновенно, без сети. */
async function refreshUnread(): Promise<void> {
  try {
    const rows = await invoke<FolderStatRow[]>("get_folder_stats", { prefix: "" });
    unreadByFolder.clear();
    totalsByFolder.clear();
    for (const r of rows) {
      unreadByFolder.set(r.folder, r.unseen);
      totalsByFolder.set(r.folder, r.total);
    }
    renderFolders(lastFolders);
  } catch {
    /* кэш счётчиков недоступен */
  }
}

/** Точные цифры с сервера (IMAP STATUS) — фоном после синхронизации. */
async function refreshUnreadFromServer(): Promise<void> {
  if (!activeAccountId) return;
  try {
    const rows = await invoke<UnreadCount[]>("refresh_unread", { accountId: activeAccountId });
    for (const r of rows) {
      unreadByFolder.set(r.folder, r.unseen);
      bumpTotals(r.folder, r.unseen);
    }
    renderFolders(lastFolders);
  } catch {
    /* нет сети — остаются цифры из кэша */
  }
}

function closeAcctMenu(): void {
  document.getElementById("acct-menu")?.classList.add("hidden");
}

/** Меню ящика по правому клику: настройки, проверка, добавление (TASK-016.1). */
function openAcctMenu(x: number, y: number, account: AccountView): void {
  const menu = document.getElementById("acct-menu");
  if (!menu) return;
  menu.innerHTML = "";
  const add = (label: string, fn: () => void): void => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", () => {
      closeAcctMenu();
      fn();
    });
    menu.appendChild(b);
  };
  if (account.id !== activeAccountId) {
    add("Открыть ящик", () => void activateAccount(account.id));
  }
  add("Проверить почту", () => {
    void (async () => {
      if (account.id !== activeAccountId) await activateAccount(account.id);
      else await checkMail();
    })();
  });
  add("Настройки ящика…", () => void openSettings(false, false, account.id));
  add("Добавить ящик…", () => void openSettings(false, true));
  menu.classList.remove("hidden");
  menu.style.left = `${Math.min(x, window.innerWidth - 220)}px`;
  menu.style.top = `${Math.min(y + 8, window.innerHeight - 160)}px`;
  const first = menu.querySelector<HTMLButtonElement>("button");
  first?.focus();
}

/** Переключение активного ящика: его папки, его письма (TASK-016). */
async function activateAccount(id: string): Promise<void> {
  if (id === activeAccountId && currentFolder.startsWith(`${id}::`)) return;
  activeAccountId = id;
  currentFolder = folderKeyOf(id, "INBOX");
  currentMessages = [];
  currentBody = null;
  currentMessage = null;
  renderMessages();
  try {
    renderFolders(await invoke<FolderInfo[]>("get_folders"));
  } catch {
    /* папки придут после синхронизации */
  }
  if (statusMail) statusMail.textContent = "почта: переключаю ящик…";
  try {
    const res = await invoke<SyncPayload>("sync_inbox", { accountId: id });
    if (statusMail) statusMail.textContent = `почта: писем ${res.total}`;
    await refreshMail();
    void refreshUnreadFromServer();
  } catch (err) {
    showToast(`Не удалось открыть ящик: ${String(err)}`);
    // ящик мог исчезнуть из настроек — перечитаем список, чтобы панель не врала
    try {
      accounts = await invoke<AccountView[]>("get_accounts");
      if (accounts.length > 0 && !accounts.some((a) => a.id === activeAccountId)) {
        activeAccountId = accounts[0].id;
        currentFolder = folderKeyOf(activeAccountId, "INBOX");
      }
    } catch {
      /* оставим как есть */
    }
    await refreshMail();
  }
}

async function selectFolder(name: string): Promise<void> {
  currentFolder = name;
  searchQuery = "";
  clearMulti();
  if (searchBox) searchBox.value = "";
  document.querySelector<HTMLElement>("#search-clear")?.classList.add("hidden");
  document
    .querySelectorAll<HTMLElement>("#folder-list li.folder")
    .forEach((el) => el.classList.toggle("selected", el.dataset.folder === name));
  const label = folderDisplay(splitFolderKey(name).name);
  trashActions?.classList.toggle("hidden", !isTrashFolder(label));
  if (statusMail) statusMail.textContent = `почта: папка «${label}», загрузка…`;

  // 1) TASK-019: сразу показываем локальный кэш — без ожидания сервера.
  try {
    const cached = await invoke<FolderCache>("load_folder", { folder: name });
    if (currentFolder !== name) return;
    if (cached.messages.length > 0) {
      await refreshMail();
      if (statusMail) {
        statusMail.textContent = `почта: папка «${label}», писем ${cached.total} (кэш)`;
      }
    }
  } catch {
    /* кэша этой папки ещё нет — ждём сервер */
  }

  // 2) Тихо обновляем с сервера.
  try {
    const res = await invoke<SyncPayload>("sync_folder", { folder: name });
    if (currentFolder !== name) return;
    if (statusMail) statusMail.textContent = `почта: папка «${label}», писем ${res.total}`;
    await refreshMail();
    void refreshUnreadFromServer();
  } catch (err) {
    if (currentFolder !== name) return;
    if (statusMail) statusMail.textContent = `почта: ошибка (папка «${label}»)`;
    const raw = String(err);
    const interrupted = raw.includes("Bye Response") || raw.includes("Connection Lost");
    const serverFault = raw.includes("SERVERBUG") || raw.includes("Internal error");
    showToast(
      interrupted
        ? `Не удалось обновить папку «${label}»: сервер прервал соединение — показан кэш`
        : serverFault
          ? `Не удалось обновить папку «${label}»: сервер вернул ошибку на эту папку — показан кэш`
          : `Не удалось обновить папку «${label}»: ${raw}`,
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

/** TASK-015.1: окно письма двигается за заголовок и растягивается (правый нижний угол). */
function makeComposeMovable(): void {
  const card = composeOverlay?.querySelector<HTMLElement>(".compose-card");
  const handle = composeTitle;
  if (!card || !handle) return;
  let drag: { dx: number; dy: number } | null = null;
  const onMove = (e: MouseEvent): void => {
    if (!drag) return;
    const left = Math.min(Math.max(0, e.clientX - drag.dx), window.innerWidth - 120);
    const top = Math.min(Math.max(0, e.clientY - drag.dy), window.innerHeight - 48);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  };
  const onUp = (): void => {
    drag = null;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };
  handle.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const r = card.getBoundingClientRect();
    if (!card.classList.contains("floating")) {
      card.classList.add("floating");
      card.style.left = `${r.left}px`;
      card.style.top = `${r.top}px`;
      card.style.width = `${r.width}px`;
      card.style.height = `${r.height}px`;
      card.style.margin = "0";
    }
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    e.preventDefault();
  });
}

function resetComposeFrame(): void {
  const card = composeOverlay?.querySelector<HTMLElement>(".compose-card");
  if (!card) return;
  card.classList.remove("floating");
  card.style.left = "";
  card.style.top = "";
  card.style.width = "";
  card.style.height = "";
  card.style.margin = "";
}

function newDraftId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `d${Date.now()}${Math.floor(Math.random() * 1e6)}`;
}

/* ===== TASK-026: подписи и макросы в стиле The Bat! ===== */

let activeSignatureBlock = "";

/** Подпись по умолчанию: с галочкой, иначе первая. */
function defaultSignature(): SignatureData | null {
  const list = settingsData?.signatures ?? [];
  return list.find((s) => s.is_default) ?? list[0] ?? null;
}

/** Значения макросов для текущего письма. */
function composeMacros(to: string, subject: string): Record<string, string> {
  const acc = accounts.find((a) => a.id === activeAccountId) ?? accounts[0];
  const fromAddr = acc?.email ?? "";
  const fromName = fromAddr.includes("@") ? fromAddr.split("@")[0] : fromAddr;
  const toAddr = extractAddress(to);
  const toName =
    to
      .replace(/<[^>]*>/g, "")
      .replace(/[,;].*$/, "")
      .trim() || toAddr;
  const now = new Date();
  const date = now.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const time = now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return {
    FromName: fromName,
    FromAddr: fromAddr,
    ToName: toName,
    ToAddr: toAddr,
    Subject: subject,
    Date: date,
    Time: time,
    Quote: quotedOriginal(),
  };
}

/** Подставляет %FromName, %FromAddr и т.д.; %Cursor оставляем для позиции. */
function expandMacros(text: string, macros: Record<string, string>): string {
  return text.replace(/%(FromName|FromAddr|ToName|ToAddr|Subject|Date|Time|Quote)/g, (all, name: string) => {
    return macros[name] ?? all;
  });
}

/** Убирает ранее вставленную подпись, если её ещё не правили руками. */
function stripSignature(body: string, block: string): string {
  if (!block) return body;
  const idx = body.lastIndexOf(block);
  if (idx < 0) return body;
  return body.slice(0, idx).replace(/\s+$/, "");
}

function fillSignatureSelect(selected: string | null): void {
  if (!composeSignature) return;
  composeSignature.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "Без подписи";
  composeSignature.appendChild(none);
  (settingsData?.signatures ?? []).forEach((s) => {
    const o = document.createElement("option");
    o.value = s.name;
    o.textContent = s.name;
    composeSignature.appendChild(o);
  });
  composeSignature.value = selected ?? "";
}

/** Вставляет выбранную подпись в конец письма (с учётом %Cursor). */
function applySignature(name: string | null): void {
  if (!composeBody) return;
  const body = stripSignature(composeBody.value, activeSignatureBlock);
  activeSignatureBlock = "";
  if (!name) {
    composeBody.value = body;
    return;
  }
  const sig = (settingsData?.signatures ?? []).find((s) => s.name === name);
  if (!sig) {
    composeBody.value = body;
    return;
  }
  const macros = composeMacros(composeTo?.value ?? "", composeSubject?.value ?? "");
  let block = expandMacros(sig.text, macros);
  let cursor = -1;
  if (block.includes("%Cursor")) {
    cursor = block.indexOf("%Cursor");
    block = block.replace("%Cursor", "");
  }
  activeSignatureBlock = block;
  const sep = body.trim().length > 0 ? "\n\n" : "";
  composeBody.value = `${body.replace(/\s+$/, "")}${sep}${block}`;
  if (cursor >= 0) {
    const pos = composeBody.value.length - block.length + cursor;
    composeBody.setSelectionRange(pos, pos);
  } else {
    composeBody.setSelectionRange(composeBody.value.length, composeBody.value.length);
  }
}

function openCompose(prefill?: {
  title?: string;
  to?: string;
  subject?: string;
  body?: string;
  draft?: DraftData;
}): void {
  resetComposeFrame();
  editingDraft = prefill?.draft ?? null;
  currentDraftId = editingDraft?.id ?? newDraftId();
  lastDraftPayload = "";
  if (composeSaved) composeSaved.textContent = "";
  if (composeTitle) composeTitle.textContent = prefill?.title ?? "Новое письмо";
  if (composeTo) composeTo.value = prefill?.to ?? "";
  if (composeSubject) composeSubject.value = prefill?.subject ?? "";
  if (composeBody) composeBody.value = prefill?.body ?? "";
  activeSignatureBlock = "";
  const sig = prefill?.draft ? null : defaultSignature();
  fillSignatureSelect(sig?.name ?? null);
  if (!prefill?.draft) applySignature(sig?.name ?? null);
  composeAttachments = [];
  renderComposeAttachments();
  composeOverlay?.classList.remove("hidden");
  composeTo?.focus();
  startDraftAutosave();
}

/** TASK-022: автосохранение черновика каждые 20 секунд, пока окно открыто. */
function startDraftAutosave(): void {
  stopDraftAutosave();
  draftTimer = window.setInterval(() => void saveDraftNow(true), 20000);
}

function stopDraftAutosave(): void {
  if (draftTimer !== undefined) {
    window.clearInterval(draftTimer);
    draftTimer = undefined;
  }
}

/** Сохраняет письмо в папку черновиков (локально + IMAP APPEND). */
async function saveDraftNow(silent: boolean): Promise<void> {
  const to = normalizeRecipients(composeTo?.value ?? "");
  const subject = composeSubject?.value.trim() ?? "";
  const body = composeBody?.value ?? "";
  if (!to && !subject && !body) return;
  const payload = JSON.stringify([to, subject, body, composeAttachments.map((a) => a.name)]);
  if (payload === lastDraftPayload) {
    if (!silent) showToast("Черновик уже сохранён");
    return;
  }
  try {
    const rec = await invoke<DraftData>("save_draft", {
      accountId: activeAccountId || null,
      draft: {
        id: editingDraft?.id ?? currentDraftId,
        to,
        subject,
        body,
        files: composeAttachments.map((a) => ({ name: a.name, mime: a.mime, dataB64: a.dataB64 })),
      },
    });
    editingDraft = rec;
    currentDraftId = rec.id;
    lastDraftPayload = payload;
    if (composeSaved) {
      const now = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
      composeSaved.textContent = `✓ сохранено ${now}`;
    }
    if (!silent) showToast("Черновик сохранён");
  } catch (err) {
    if (!silent) showToast(`Не удалось сохранить черновик: ${String(err)}`);
    else if (composeSaved) composeSaved.textContent = "не сохранено";
  }
}

/// Убирает хвостовые разделители и лишние пробелы: «a@b.ru, » → «a@b.ru».
function normalizeRecipients(value: string): string {
  return value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join(", ");
}

function closeCompose(saveDraft = true): void {
  if (saveDraft) void saveDraftNow(true);
  stopDraftAutosave();
  composeOverlay?.classList.add("hidden");
}

async function sendCompose(): Promise<void> {
  const to = normalizeRecipients(composeTo?.value ?? "");
  if (composeTo && composeTo.value !== to) composeTo.value = to;
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
      accountId: activeAccountId || null,
      to,
      subject,
      body,
      files: composeAttachments.map((a) => ({ name: a.name, mime: a.mime, dataB64: a.dataB64 })),
    });
    showToast(`Письмо улетело: ${to}`);
    const sentDraftId = editingDraft?.id;
    if (sentDraftId) {
      try {
        await invoke("delete_draft", { accountId: activeAccountId, id: sentDraftId });
      } catch (err) {
        console.warn("черновик не удалился", err);
      }
    }
    editingDraft = null;
    lastDraftPayload = "";
    if (composeTo) composeTo.value = "";
    if (composeSubject) composeSubject.value = "";
    if (composeBody) composeBody.value = "";
    composeAttachments = [];
    renderComposeAttachments();
    closeCompose(false);
  } catch (err) {
    showToast(`Не удалось отправить: ${String(err)}`);
  } finally {
    if (composeSend) {
      composeSend.disabled = false;
      composeSend.textContent = "Отправить";
    }
  }
}

/** TASK-014: черновик ответа в моём стиле — ИИ предлагает, человек правит и отправляет. */
async function requestDraftReply(): Promise<void> {
  const m = currentMessage;
  if (!m) return;
  if (draftBtn) {
    draftBtn.disabled = true;
    draftBtn.textContent = "✍ Сорока пишет…";
  }
  try {
    const text = await invoke<string>("draft_reply", {
      folder: currentFolder,
      uid: m.uid,
      subject: m.subject,
      from: m.from,
    });
    openCompose({
      title: "Черновик ответа — проверьте и отправьте",
      to: extractAddress(m.from),
      subject: prefixedSubject(m.subject, "Re"),
      body: text,
    });
    showToast("Черновик готов — проверьте текст и отправьте");
  } catch (err) {
    showToast(`Не получилось написать черновик: ${String(err)}`);
  } finally {
    if (draftBtn) {
      draftBtn.disabled = false;
      draftBtn.textContent = "✍ Черновик";
    }
  }
}

/** TASK-015: настройка ящика — пресеты провайдеров или вручную. */
interface ProviderPreset {
  id: string;
  title: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  hint: string;
}

/** Ящик без пароля (TASK-016). */
interface AccountView {
  id: string;
  email: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
}

/** Ответ на сохранение ящика (TASK-016). */
interface SavedAccount {
  id: string;
  message: string;
}

let providerPresets: ProviderPreset[] = [];

function renderProviderMenu(): void {
  if (!settingsProviderMenu) return;
  settingsProviderMenu.innerHTML = "";
  providerPresets.forEach((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = p.title;
    if (p.id === providerId) b.classList.add("sel");
    b.addEventListener("click", () => {
      providerId = p.id;
      if (settingsProviderLabel) settingsProviderLabel.textContent = p.title;
      applyProviderPreset(p.id);
      settingsProviderMenu.classList.add("hidden");
    });
    settingsProviderMenu.append(b);
  });
}

function applyProviderPreset(id: string): void {
  const pr = providerPresets.find((p) => p.id === id);
  if (!pr) return;
  if (settingsImapHost) settingsImapHost.value = pr.imap_host;
  if (settingsImapPort) settingsImapPort.value = String(pr.imap_port);
  if (settingsSmtpHost) settingsSmtpHost.value = pr.smtp_host;
  if (settingsSmtpPort) settingsSmtpPort.value = String(pr.smtp_port);
  if (settingsHint) settingsHint.textContent = pr.hint;
}

async function openSettings(
  firstRun = false,
  forNew = false,
  accountId?: string,
): Promise<void> {
  if (!settingsOverlay) return;
  settingsOverlay.classList.remove("hidden");
  renderSettingsAccounts();
  switchSettingsView("account");
  if (providerPresets.length === 0) {
    try {
      providerPresets = await invoke<ProviderPreset[]>("mail_provider_presets");
    } catch (err) {
      providerPresets = [];
      showToast(`Не загрузить список провайдеров: ${String(err)}`);
    }
  }
  // TASK-016: правим активный ящик или добавляем новый.
  editingAccountId = forNew ? null : accountId || activeAccountId || null;
  const titleEl = document.getElementById("settings-title");
  if (titleEl) {
    titleEl.textContent = editingAccountId ? "Настройка почты" : "Новый ящик";
  }
  // Текущие настройки (если ящик уже настроен) — чтобы было видно, что менять.
  let details: AccountView | null = null;
  if (editingAccountId) {
    try {
      details = await invoke<AccountView | null>("mail_account_details", {
        accountId: editingAccountId,
      });
    } catch {
      details = null;
    }
  }
  if (details) {
    providerId = providerPresets.find((p) => p.imap_host === details?.imap_host)?.id ?? "other";
    if (settingsProviderLabel) {
      settingsProviderLabel.textContent =
        providerPresets.find((p) => p.id === providerId)?.title ?? "Другое (вручную)";
    }
    if (settingsEmail) settingsEmail.value = details.email;
    if (settingsPassword) {
      settingsPassword.value = "";
      settingsPassword.placeholder = "оставьте пустым, чтобы не менять";
    }
    if (settingsImapHost) settingsImapHost.value = details.imap_host;
    if (settingsImapPort) settingsImapPort.value = String(details.imap_port);
    if (settingsSmtpHost) settingsSmtpHost.value = details.smtp_host;
    if (settingsSmtpPort) settingsSmtpPort.value = String(details.smtp_port);
    const pr = providerPresets.find((p) => p.id === providerId);
    if (settingsHint) {
      settingsHint.textContent = pr
        ? pr.hint
        : "Заполните серверы вручную — их можно уточнить у почтового сервиса.";
    }
  } else {
    providerId = "mailru";
    if (settingsProviderLabel) settingsProviderLabel.textContent = "Mail.ru";
    applyProviderPreset("mailru");
    if (settingsEmail) settingsEmail.value = "";
    if (settingsPassword) {
      settingsPassword.value = "";
      settingsPassword.placeholder = "для Gmail и Яндекса — пароль приложения";
    }
  }
  renderProviderMenu();
  if (settingsStatus) {
    settingsStatus.className = "settings-status";
    settingsStatus.textContent = details
      ? `Ящик уже настроен: ${details.email}. Можно поменять серверы или ввести новый пароль.`
      : firstRun
        ? "Похоже, это первый запуск: выберите провайдера, укажите адрес и пароль."
        : "Новый ящик: выберите провайдера, укажите адрес и пароль.";
  }
  settingsOverlay.classList.remove("hidden");
  settingsEmail?.focus();
}

function closeSettings(): void {
  settingsOverlay?.classList.add("hidden");
}

async function saveMailSettings(): Promise<void> {
  if (
    !settingsEmail ||
    !settingsPassword ||
    !settingsImapHost ||
    !settingsImapPort ||
    !settingsSmtpHost ||
    !settingsSmtpPort
  ) {
    return;
  }
  const setStatus = (text: string, cls = ""): void => {
    if (settingsStatus) {
      settingsStatus.textContent = text;
      settingsStatus.className = `settings-status${cls ? ` ${cls}` : ""}`;
    }
  };
  const btn = document.getElementById("settings-save") as HTMLButtonElement | null;
  const email = settingsEmail.value.trim();
  const password = settingsPassword.value;
  if (!email.includes("@")) {
    setStatus("Укажите адрес почты — например: name@mail.ru", "err");
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Проверяю…";
  }
  setStatus("Подключаюсь к почтовому серверу…");
  try {
    const saved = await invoke<SavedAccount>("save_mail_account", {
      accountId: editingAccountId,
      email,
      password: password.length > 0 ? password : null,
      imapHost: settingsImapHost.value.trim(),
      imapPort: Number(settingsImapPort.value) || 993,
      smtpHost: settingsSmtpHost.value.trim(),
      smtpPort: Number(settingsSmtpPort.value) || 465,
      check: true,
    });
    setStatus(`✓ ${saved.message}`, "ok");
    try {
      accounts = await invoke<AccountView[]>("get_accounts");
    } catch {
      /* список обновится при следующем открытии */
    }
    if (saved.id) {
      activeAccountId = saved.id;
      currentFolder = folderKeyOf(saved.id, "INBOX");
    }
    showToast("Почта настроена — загружаю письма");
    window.setTimeout(() => {
      closeSettings();
      void checkMail();
    }, 900);
  } catch (err) {
    setStatus(String(err), "err");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Проверить и сохранить";
    }
  }
}

/** TASK-015.1: кнопка «Улучшить» — GigaChat переписывает набранный текст. */
async function improveComposeText(): Promise<void> {
  if (!composeBody) return;
  const text = composeBody.value.trim();
  if (text.length < 5) {
    showToast("Сначала наберите текст письма");
    return;
  }
  const btn = document.getElementById("compose-improve") as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "✨ Улучшаю…";
  }
  try {
    const better = await invoke<string>("improve_text", { text: composeBody.value });
    composeBody.value = better;
    showToast("Текст улучшен — проверьте и при необходимости поправьте");
  } catch (err) {
    showToast(`Не получилось улучшить текст: ${String(err)}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "✨ Улучшить";
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
  lastFolders = folders;
  folderList.innerHTML = "";
  const byAccount = new Map<string, FolderInfo[]>();
  for (const f of folders) {
    const { accountId } = splitFolderKey(f.name);
    if (!accountId) continue; // старый кэш без ящика
    const list = byAccount.get(accountId) ?? [];
    list.push(f);
    byAccount.set(accountId, list);
  }
  for (const a of accounts) {
    const isActive = a.id === activeAccountId;
    const li = document.createElement("li");
    li.className = isActive ? "acct active" : "acct";

    const head = document.createElement("div");
    head.className = isActive ? "acct-head active" : "acct-head";
    head.title = isActive ? "" : `Открыть ящик ${a.email}`;
    const caret = document.createElement("span");
    caret.className = "caret";
    caret.textContent = isActive ? "▼" : "▶";
    const dot = document.createElement("span");
    dot.className = "dot";
    const mail = document.createElement("span");
    mail.className = "mail";
    mail.textContent = a.email;
    head.append(caret, dot, mail);
    const badgeCount = sumUnread(a.id);
    if (badgeCount > 0) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = String(badgeCount);
      head.appendChild(badge);
    }
    head.addEventListener("click", () => void activateAccount(a.id));
    head.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openAcctMenu(e.clientX, e.clientY, a);
    });
    li.appendChild(head);

    if (isActive) {
      const ul = document.createElement("ul");
      ul.className = "acct-folders";
      const list = byAccount.get(a.id) ?? [];
      if (list.length === 0) {
        const hint = document.createElement("li");
        hint.className = "folder empty-hint";
        hint.textContent = "пока пусто — нажмите «Проверить почту»";
        ul.appendChild(hint);
      }
      // Разделитель берём у сервера: у Majordomo «.», у Mail.ru «/» (TASK-021).
      const items = list.map((f) => ({
        full: f.name,
        rel: splitFolderKey(f.name).name,
        delim: f.delimiter || "/",
      }));
      const byRel = new Map(items.map((it) => [it.rel, it]));
      const kidsOf = new Map<string, typeof items>();
      const roots: typeof items = [];
      for (const it of items) {
        const cut = it.rel.lastIndexOf(it.delim);
        const parentRel = cut > 0 ? it.rel.slice(0, cut) : "";
        if (parentRel && byRel.has(parentRel)) {
          const bucket = kidsOf.get(parentRel);
          if (bucket) bucket.push(it);
          else kidsOf.set(parentRel, [it]);
        } else {
          roots.push(it);
        }
      }
      const renderNode = (item: { full: string; rel: string; delim: string }, depth: number): void => {
        const selected = item.full === currentFolder;
        const unreadIn = unreadByFolder.get(item.full) ?? 0;
        const totalIn = totalsByFolder.get(item.full) ?? 0;
        const kids = kidsOf.get(item.rel) ?? [];
        const fli = document.createElement("li");
        fli.className = "folder";
        fli.classList.toggle("selected", selected);
        fli.classList.toggle("unread", unreadIn > 0);
        fli.title = item.rel;
        fli.dataset.folder = item.full;
        fli.style.paddingLeft = `${10 + depth * 14}px`;
        if (kids.length > 0) {
          const caret = document.createElement("span");
          caret.className = "folder-caret";
          caret.textContent = collapsedFolders.has(item.rel) ? "▶" : "▼";
          caret.addEventListener("click", (e) => {
            e.stopPropagation();
            if (collapsedFolders.has(item.rel)) collapsedFolders.delete(item.rel);
            else collapsedFolders.add(item.rel);
            try {
              localStorage.setItem(
                "soroka.foldersCollapsed",
                JSON.stringify([...collapsedFolders]),
              );
            } catch {
              /* приватный режим */
            }
            renderFolders(lastFolders);
          });
          fli.append(caret);
        }
        const ic = document.createElement("span");
        ic.className = "ic";
        ic.textContent = folderIcon(item.rel);
        const nm = document.createElement("span");
        nm.className = "name";
        nm.textContent = folderDisplay(item.rel.split(item.delim).pop() ?? item.rel);
        fli.append(ic, nm);
        if (totalIn > 0) {
          const tot = document.createElement("span");
          tot.className = "tot";
          tot.textContent = String(totalIn);
          fli.append(tot);
        }
        if (unreadIn > 0) {
          const cnt = document.createElement("span");
          cnt.className = "cnt";
          cnt.textContent = String(unreadIn);
          fli.append(cnt);
        }
        fli.addEventListener("click", () => void selectFolder(item.full));
        ul.appendChild(fli);
        if (kids.length > 0 && !collapsedFolders.has(item.rel)) {
          kids.forEach((k) => renderNode(k, depth + 1));
        }
      };
      if (roots.length > 0) roots.forEach((it) => renderNode(it, 0));
      else items.forEach((it) => renderNode(it, 0));
      li.appendChild(ul);
    }
    folderList.appendChild(li);
  }
  folderEmpty.classList.toggle("hidden", accounts.length > 0);
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

/** Дни недели по-русски, начиная с воскресенья (как у Date.getDay()). */
const RU_DAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Короткая дата для списка: «Сегодня 13:27», «Вчера 09:20», «Сб 12 окт», «12.10.25». */
function shortTime(date: string): string {
  const d = parseMailDate(date);
  if (!d) {
    const m = date.match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
    return m ? `${m[1].padStart(2, "0")}:${m[2]}` : date.slice(0, 14);
  }
  const now = new Date();
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (sameDay(d, now)) return `Сегодня ${hhmm}`;
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(d, y)) return `Вчера ${hhmm}`;
  if (d.getFullYear() === now.getFullYear()) {
    return `${RU_DAYS[d.getDay()]} ${d.getDate()} ${RU_MONTHS[d.getMonth()]}`;
  }
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear() % 100).padStart(2, "0");
  return `${dd}.${mm}.${yy}`;
}

/** Полная дата: «Сб, 15 октября 2026, 13:27». */
function fullDate(date: string): string {
  const d = parseMailDate(date);
  if (!d) return date;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${RU_DAYS[d.getDay()]}, ${d.getDate()} ${RU_MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`;
}

type LayoutPanelId = "folders" | "list" | "reading";

interface LayoutState {
  rows: LayoutPanelId[][];
  weights: Record<LayoutPanelId, number>;
  rowWeights: number[];
  collapsed: Record<LayoutPanelId, boolean>;
}

type LayoutDropTarget =
  | { kind: "in-row"; row: number; index: number }
  | { kind: "new-row"; index: number };

const LAYOUT_DEFAULTS: LayoutState = {
  rows: [["folders", "list", "reading"]],
  // Дефолт согласован с пользователем (окт 2026): [Папки|Письма|Письмо], узкие папки, широкое письмо.
  weights: { folders: 0.2827, list: 1.2443, reading: 2.023 },
  rowWeights: [1],
  collapsed: { folders: false, list: false, reading: false },
};

/** Свободная компоновка панелей: ряды, перетаскивание, сворачивание, хранение (TASK-012). */
function initLayout(): void {
  const appEl = document.getElementById("app");
  const foldersEl = document.getElementById("folder-tree");
  const listEl = document.getElementById("message-list");
  const readingEl = document.getElementById("message-view");
  if (!appEl || !foldersEl || !listEl || !readingEl) return;
  const app: HTMLElement = appEl;
  const els: Record<LayoutPanelId, HTMLElement> = {
    folders: foldersEl,
    list: listEl,
    reading: readingEl,
  };
  const PANEL_LIST: LayoutPanelId[] = ["folders", "list", "reading"];

  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

  function loadState(): LayoutState {
    try {
      const raw = localStorage.getItem("soroka.layout2");
      if (!raw) return clone(LAYOUT_DEFAULTS);
      const s = JSON.parse(raw) as Partial<LayoutState>;
      const rows = s.rows;
      const ok =
        Array.isArray(rows) &&
        rows.length >= 1 &&
        rows.every((r) => Array.isArray(r) && r.length >= 1) &&
        rows.flat().length === 3 &&
        new Set(rows.flat()).size === 3 &&
        rows.flat().every((p) => PANEL_LIST.includes(p));
      if (!ok) return clone(LAYOUT_DEFAULTS);
      return {
        rows: rows as LayoutPanelId[][],
        weights: { ...LAYOUT_DEFAULTS.weights, ...(s.weights ?? {}) },
        rowWeights: (rows as LayoutPanelId[][]).map((_, i) => s.rowWeights?.[i] || 1),
        collapsed: { ...LAYOUT_DEFAULTS.collapsed, ...(s.collapsed ?? {}) },
      };
    } catch {
      return clone(LAYOUT_DEFAULTS);
    }
  }
  const state = loadState();
  const save = (): void => {
    localStorage.setItem("soroka.layout2", JSON.stringify(state));
  };

  const ind: HTMLElement = document.getElementById("drop-indicator") ?? document.createElement("div");
  ind.id = "drop-indicator";
  ind.classList.add("hidden");

  const rowElAt = (i: number): HTMLElement | null =>
    app.querySelector<HTMLElement>(`.pane-row[data-row="${i}"]`);

  const applyAll = (): void => {
    state.rows.forEach((row, ri) => {
      const r = rowElAt(ri);
      if (!r) return;
      const anyExpanded = row.some((pid) => !state.collapsed[pid]);
      const solo = row.length === 1;
      r.classList.toggle("row-collapsed", solo && !anyExpanded);
      if (solo && !anyExpanded) {
        r.style.flexGrow = "0";
        r.style.flexShrink = "0";
        r.style.flexBasis = "36px";
      } else {
        r.style.flexGrow = String(state.rowWeights[ri] ?? 1);
        r.style.flexShrink = "1";
        r.style.flexBasis = "0px";
      }
      row.forEach((pid) => {
        const el = els[pid];
        const c = state.collapsed[pid];
        el.classList.toggle("strip", c && !solo);
        el.classList.toggle("plate", c && solo);
        if (c && solo) {
          el.style.flexGrow = "1";
          el.style.flexShrink = "1";
          el.style.flexBasis = "0px";
        } else if (c) {
          el.style.flexGrow = "0";
          el.style.flexShrink = "0";
          el.style.flexBasis = "46px";
        } else {
          el.style.flexGrow = String(state.weights[pid] ?? 1);
          el.style.flexShrink = "1";
          el.style.flexBasis = "0px";
        }
      });
    });
  };

  const renderStructure = (): void => {
    const scrollMsgs = messagesList?.scrollTop ?? 0;
    const folderListEl = document.getElementById("folder-list");
    const scrollFolders = folderListEl?.scrollTop ?? 0;
    const keepSrcdoc = bodyFrame && !bodyFrame.classList.contains("hidden") ? bodyFrame.srcdoc : null;

    while (app.firstChild) app.removeChild(app.firstChild);
    state.rows.forEach((row, ri) => {
      if (ri > 0) {
        const sh = document.createElement("div");
        sh.className = "splitter splitter-h";
        bindSplitH(sh, ri - 1);
        app.appendChild(sh);
      }
      const rowEl = document.createElement("div");
      rowEl.className = "pane-row";
      rowEl.dataset.row = String(ri);
      row.forEach((pid, pi) => {
        if (pi > 0) {
          const sv = document.createElement("div");
          sv.className = "splitter splitter-v";
          bindSplitV(sv, ri, pi - 1);
          rowEl.appendChild(sv);
        }
        rowEl.appendChild(els[pid]);
      });
      app.appendChild(rowEl);
    });
    app.appendChild(ind);
    applyAll();
    if (keepSrcdoc !== null && bodyFrame) bodyFrame.srcdoc = keepSrcdoc;
    if (messagesList) messagesList.scrollTop = scrollMsgs;
    if (folderListEl) folderListEl.scrollTop = scrollFolders;
  };

  const dragSplit = (ev: PointerEvent, dir: "v" | "h", ri: number, si: number): void => {
    const rowA = rowElAt(ri);
    if (!rowA) return;
    let elA: HTMLElement;
    let elB: HTMLElement;
    let sumW: number;
    let aId: LayoutPanelId | null = null;
    let bId: LayoutPanelId | null = null;
    if (dir === "v") {
      const a = state.rows[ri]?.[si];
      const b = state.rows[ri]?.[si + 1];
      if (!a || !b) return;
      elA = els[a];
      elB = els[b];
      aId = a;
      bId = b;
      sumW = (state.weights[a] ?? 1) + (state.weights[b] ?? 1);
    } else {
      const rowB = rowElAt(ri + 1);
      if (!rowB) return;
      elA = rowA;
      elB = rowB;
      sumW = (state.rowWeights[ri] ?? 1) + (state.rowWeights[ri + 1] ?? 1);
    }
    const rectA = elA.getBoundingClientRect();
    const rectB = elB.getBoundingClientRect();
    const sumPx = dir === "v" ? rectA.width + rectB.width : rectA.height + rectB.height;
    const startPx = dir === "v" ? rectA.width : rectA.height;
    const startX = ev.clientX;
    const startY = ev.clientY;
    app.classList.add("dragging");
    document.body.classList.add(dir === "v" ? "col-resize" : "row-resize");
    const move = (e: PointerEvent): void => {
      const d = dir === "v" ? e.clientX - startX : e.clientY - startY;
      const pa = Math.max(110, Math.min(sumPx - 110, startPx + d));
      const wa = (sumW * pa) / sumPx;
      if (dir === "v" && aId && bId) {
        state.weights[aId] = wa;
        state.weights[bId] = sumW - wa;
      } else if (dir === "h") {
        state.rowWeights[ri] = wa;
        state.rowWeights[ri + 1] = sumW - wa;
      }
      applyAll();
    };
    const up = (): void => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      app.classList.remove("dragging");
      document.body.classList.remove("col-resize", "row-resize");
      save();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };

  function bindSplitV(sv: HTMLElement, ri: number, si: number): void {
    sv.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      dragSplit(ev, "v", ri, si);
    });
    sv.addEventListener("dblclick", () => {
      const a = state.rows[ri]?.[si];
      const b = state.rows[ri]?.[si + 1];
      if (!a || !b) return;
      state.weights[a] = LAYOUT_DEFAULTS.weights[a];
      state.weights[b] = LAYOUT_DEFAULTS.weights[b];
      applyAll();
      save();
    });
  }

  function bindSplitH(sh: HTMLElement, ri: number): void {
    sh.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      dragSplit(ev, "h", ri, 0);
    });
    sh.addEventListener("dblclick", () => {
      state.rowWeights[ri] = 1;
      state.rowWeights[ri + 1] = 1;
      applyAll();
      save();
    });
  }

  function computeDrop(pid: LayoutPanelId, x: number, y: number): LayoutDropTarget | null {
    // Цель — ближайшая панель (кроме перетаскиваемой); у неё ищем ближайший край:
    // слева/справа — вставка в тот же ряд, сверху/снизу — новый ряд.
    let bestPid: LayoutPanelId | null = null;
    let bestRow = -1;
    let bestDist = Infinity;
    for (let ri = 0; ri < state.rows.length; ri++) {
      const row = state.rows[ri];
      for (let pi = 0; pi < row.length; pi++) {
        const p = row[pi];
        if (p === pid) continue;
        const r = els[p].getBoundingClientRect();
        const dx = Math.max(r.left - x, 0, x - r.right);
        const dy = Math.max(r.top - y, 0, y - r.bottom);
        const dist = Math.hypot(dx, dy);
        if (dist < bestDist) {
          bestDist = dist;
          bestPid = p;
          bestRow = ri;
        }
      }
    }
    if (!bestPid || bestRow < 0) return null;
    const rc = els[bestPid].getBoundingClientRect();
    const dl = x - rc.left;
    const dr = rc.right - x;
    const dt = y - rc.top;
    const db = rc.bottom - y;
    const m = Math.min(dl, dr, dt, db);
    if (m === dl || m === dr) {
      const items = state.rows[bestRow].filter((p) => p !== pid);
      const i = items.indexOf(bestPid);
      return { kind: "in-row", row: bestRow, index: m === dl ? i : i + 1 };
    }
    return { kind: "new-row", index: m === dt ? bestRow : bestRow + 1 };
  }

  function showIndicator(pid: LayoutPanelId, t: LayoutDropTarget | null): void {
    if (!t) {
      ind.classList.add("hidden");
      return;
    }
    const appRect = app.getBoundingClientRect();
    if (t.kind === "in-row") {
      const items = state.rows[t.row].filter((p) => p !== pid);
      const r = rowElAt(t.row);
      if (!r) return;
      const rc = r.getBoundingClientRect();
      let x: number;
      if (items.length === 0) {
        x = rc.left + rc.width / 2;
      } else if (t.index <= 0) {
        x = els[items[0]].getBoundingClientRect().left - 2;
      } else if (t.index >= items.length) {
        x = els[items[items.length - 1]].getBoundingClientRect().right + 2;
      } else {
        const l = els[items[t.index - 1]].getBoundingClientRect().right;
        const rr = els[items[t.index]].getBoundingClientRect().left;
        x = (l + rr) / 2;
      }
      ind.style.left = `${x - appRect.left - 1.5}px`;
      ind.style.top = `${rc.top - appRect.top + 4}px`;
      ind.style.width = "3px";
      ind.style.height = `${rc.height - 8}px`;
    } else {
      const first = rowElAt(0)?.getBoundingClientRect();
      const last = rowElAt(state.rows.length - 1)?.getBoundingClientRect();
      if (!first || !last) return;
      let y: number;
      if (t.index <= 0) {
        y = first.top - 3;
      } else if (t.index >= state.rows.length) {
        y = last.bottom + 3;
      } else {
        const a = rowElAt(t.index - 1)?.getBoundingClientRect();
        const b = rowElAt(t.index)?.getBoundingClientRect();
        if (!a || !b) return;
        y = (a.bottom + b.top) / 2;
      }
      ind.style.left = "10px";
      ind.style.top = `${y - appRect.top - 1.5}px`;
      ind.style.width = `${appRect.width - 20}px`;
      ind.style.height = "3px";
    }
    ind.classList.remove("hidden");
  }

  function applyDrop(pid: LayoutPanelId, t: LayoutDropTarget): void {
    let fromRow = -1;
    let fromIdx = -1;
    state.rows.forEach((r, ri) => {
      const i = r.indexOf(pid);
      if (i >= 0) {
        fromRow = ri;
        fromIdx = i;
      }
    });
    if (fromRow < 0) return;
    if (t.kind === "in-row") {
      let targetRow = t.row;
      let targetIdx = t.index;
      state.rows[fromRow].splice(fromIdx, 1);
      if (fromRow === targetRow && fromIdx < targetIdx) targetIdx -= 1;
      if (state.rows[fromRow].length === 0) {
        state.rows.splice(fromRow, 1);
        state.rowWeights.splice(fromRow, 1);
        if (fromRow < targetRow) targetRow -= 1;
      }
      targetRow = Math.max(0, Math.min(state.rows.length - 1, targetRow));
      targetIdx = Math.max(0, Math.min(state.rows[targetRow].length, targetIdx));
      state.rows[targetRow].splice(targetIdx, 0, pid);
    } else {
      state.rows[fromRow].splice(fromIdx, 1);
      let removedRow = false;
      if (state.rows[fromRow].length === 0) {
        state.rows.splice(fromRow, 1);
        state.rowWeights.splice(fromRow, 1);
        removedRow = true;
      }
      let idx = t.index;
      if (removedRow && fromRow < idx) idx -= 1;
      idx = Math.max(0, Math.min(state.rows.length, idx));
      state.rows.splice(idx, 0, [pid]);
      state.rowWeights.splice(idx, 0, 1);
    }
    while (state.rowWeights.length < state.rows.length) state.rowWeights.push(1);
    state.rowWeights.length = state.rows.length;
    const flat = state.rows.reduce((n, r) => n + r.length, 0);
    if (flat !== 3) {
      state.rows = clone(LAYOUT_DEFAULTS.rows);
      state.rowWeights = [1];
    }
  }

  function startPanelDrag(pid: LayoutPanelId, ev: PointerEvent): void {
    const el = els[pid];
    const startX = ev.clientX;
    const startY = ev.clientY;
    let active = false;
    let target: LayoutDropTarget | null = null;
    const move = (e: PointerEvent): void => {
      if (!active) {
        if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) < 6) return;
        active = true;
        el.classList.add("drag-src");
        app.classList.add("dragging");
        document.body.classList.add("dragging-panel");
      }
      target = computeDrop(pid, e.clientX, e.clientY);
      showIndicator(pid, target);
    };
    const up = (): void => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      if (active && target) {
        applyDrop(pid, target);
        renderStructure();
        save();
      }
      el.classList.remove("drag-src");
      app.classList.remove("dragging");
      document.body.classList.remove("dragging-panel");
      ind.classList.add("hidden");
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }

  function bindPanelDrag(): void {
    PANEL_LIST.forEach((pid) => {
      const el = els[pid];
      el.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0) return;
        const t = ev.target as HTMLElement;
        if (t.closest("button, input, a, select, textarea, iframe")) return;
        const stripped = el.classList.contains("strip") || el.classList.contains("plate");
        if (!stripped && !t.closest(".pane-head")) return;
        ev.preventDefault();
        startPanelDrag(pid, ev);
      });
    });
  }

  function bindToggles(): void {
    const pairs: Array<[string, LayoutPanelId]> = [
      ["fold-folders", "folders"],
      ["expand-folders", "folders"],
      ["fold-list", "list"],
      ["expand-list", "list"],
      ["fold-reading", "reading"],
      ["expand-reading", "reading"],
    ];
    pairs.forEach(([id, pid]) => {
      document.getElementById(id)?.addEventListener("click", () => {
        state.collapsed[pid] = !state.collapsed[pid];
        applyAll();
        save();
      });
    });
  }

  /** Пресеты раскладки и сброс (TASK-012, этап 2). */
  function bindLayoutPresets(): void {
    const MY_KEY = "soroka.layout2.my";

    const PRESETS: Record<string, LayoutState> = {
      classic: clone(LAYOUT_DEFAULTS),
      reading: {
        rows: [["folders", "list"], ["reading"]],
        weights: { folders: 0.3, list: 1.1, reading: 2.023 },
        rowWeights: [1, 1],
        collapsed: { folders: false, list: false, reading: false },
      },
    };

    const loadMy = (): LayoutState | null => {
      try {
        const raw = localStorage.getItem(MY_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw) as LayoutState;
        const ok =
          Array.isArray(s.rows) &&
          s.rows.length >= 1 &&
          s.rows.every((r) => Array.isArray(r) && r.length >= 1) &&
          s.rows.flat().length === 3 &&
          new Set(s.rows.flat()).size === 3 &&
          s.rows.flat().every((p) => PANEL_LIST.includes(p));
        return ok ? s : null;
      } catch {
        return null;
      }
    };

    const setLayout = (next: LayoutState): void => {
      state.rows = clone(next.rows);
      state.weights = { ...next.weights };
      state.rowWeights = [...next.rowWeights];
      state.collapsed = { ...next.collapsed };
      renderStructure();
      save();
    };

    const wrap = document.getElementById("layout-menu-wrap");
    const menu = document.getElementById("layout-menu");
    const myItem = document.querySelector<HTMLButtonElement>('#layout-menu [data-preset="my"]');

    const closeMenu = (): void => menu?.classList.add("hidden");
    const openMenu = (): void => {
      if (myItem) myItem.disabled = !localStorage.getItem(MY_KEY);
      menu?.classList.remove("hidden");
    };

    document.getElementById("layout-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (menu?.classList.contains("hidden")) openMenu();
      else closeMenu();
    });
    document.addEventListener("click", (e) => {
      if (wrap && !wrap.contains(e.target as Node)) closeMenu();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMenu();
    });

    document.querySelectorAll<HTMLButtonElement>("#layout-menu [data-preset]").forEach((b) => {
      b.addEventListener("click", () => {
        const name = b.dataset.preset;
        let next: LayoutState | null = null;
        let label = "";
        if (name === "classic") { next = clone(PRESETS.classic); label = "Раскладка: Классика"; }
        else if (name === "reading") { next = clone(PRESETS.reading); label = "Раскладка: Чтение"; }
        else if (name === "my") { next = loadMy(); label = "Раскладка: Моя"; }
        if (!next) return;
        setLayout(next);
        closeMenu();
        showToast(label);
      });
    });

    document.getElementById("layout-save-my")?.addEventListener("click", () => {
      localStorage.setItem(
        MY_KEY,
        JSON.stringify({
          rows: state.rows,
          weights: state.weights,
          rowWeights: state.rowWeights,
          collapsed: state.collapsed,
        }),
      );
      closeMenu();
      showToast("Моя раскладка сохранена — применится пунктом «Моя»");
    });

    document.getElementById("layout-reset")?.addEventListener("click", () => {
      setLayout(clone(LAYOUT_DEFAULTS));
      closeMenu();
      showToast("Компоновка сброшена к классической");
    });
  }

  bindToggles();
  bindPanelDrag();
  bindLayoutPresets();
  renderStructure();
}

function visibleMessages(): MessageHeader[] {
  if (!searchQuery) return currentMessages;
  return currentMessages.filter(
    (m) =>
      m.subject.toLowerCase().includes(searchQuery) ||
      m.from.toLowerCase().includes(searchQuery),
  );
}

/* ===== TASK-018: сортировка и группировка ===== */
type SortOrder = "date_desc" | "date_asc";
type GroupMode = "date" | "category" | "none";

interface SortState {
  order: SortOrder;
  group: GroupMode;
}

const SORT_KEY = "***";
const DATE_GROUPS = ["Сегодня", "Вчера", "На этой неделе", "В этом месяце", "Раньше", "Без даты"];

function loadSortState(): SortState {
  try {
    const raw = localStorage.getItem(SORT_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<SortState>;
      return {
        order: v.order === "date_asc" ? "date_asc" : "date_desc",
        group: v.group === "category" ? "category" : v.group === "none" ? "none" : "date",
      };
    }
  } catch {
    /* повреждённое значение — берём умолчание */
  }
  return { order: "date_desc", group: "date" };
}

let sortState: SortState = loadSortState();

function saveSortState(): void {
  try {
    localStorage.setItem(SORT_KEY, JSON.stringify(sortState));
  } catch {
    /* приватный режим — просто не запоминаем */
  }
}

function messageTime(m: MessageHeader): number {
  const d = parseMailDate(m.date);
  return d ? d.getTime() : 0;
}

function dayStart(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Подпись группы по дате письма. */
function dateGroupLabel(ts: number): string {
  if (!ts) return "Без даты";
  const now = new Date();
  const today = dayStart(now.getTime());
  const day = dayStart(ts);
  const diff = Math.round((today - day) / 86_400_000);
  if (diff <= 0) return "Сегодня";
  if (diff === 1) return "Вчера";
  const monday = new Date(today);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  if (day >= monday.getTime()) return "На этой неделе";
  const d = new Date(ts);
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) {
    return "В этом месяце";
  }
  return "Раньше";
}

/** Подпись группы по категории ИИ. */
function categoryGroupLabel(m: MessageHeader): string {
  const ai = analyses.get(m.uid);
  if (!ai) return "Без разбора";
  if (ai.importance === "высокая") return "Важное";
  const cat = (ai.category || "").trim();
  return cat || "Без разбора";
}

function groupTitles(keys: string[]): string[] {
  if (sortState.group === "date") {
    const order = sortState.order === "date_asc" ? [...DATE_GROUPS].reverse() : DATE_GROUPS;
    return order.filter((k) => keys.includes(k));
  }
  const rest = keys
    .filter((k) => k !== "Важное" && k !== "Без разбора")
    .sort((a, b) => a.localeCompare(b, "ru"));
  const out: string[] = [];
  if (keys.includes("Важное")) out.push("Важное");
  out.push(...rest);
  if (keys.includes("Без разбора")) out.push("Без разбора");
  return out;
}

function sortedMessages(): MessageHeader[] {
  const dir = sortState.order === "date_asc" ? 1 : -1;
  return visibleMessages()
    .slice()
    .sort((a, b) => {
      const ta = messageTime(a);
      const tb = messageTime(b);
      if (ta !== tb) return (ta - tb) * dir;
      return (a.seq - b.seq) * dir;
    });
}

/* ===== TASK-025: массовое выделение писем ===== */

let selectedUids = new Set<number>();
let lastAnchorUid: number | null = null;

function updateBulkBar(): void {
  const bar = document.getElementById("bulk-bar");
  if (!bar) return;
  const count = selectedUids.size;
  bar.classList.toggle("hidden", count === 0);
  const label = document.getElementById("bulk-count");
  if (label) label.textContent = `Выбрано: ${count}`;
  document.querySelectorAll<HTMLElement>("#messages li.m-row").forEach((li) => {
    li.classList.toggle("multi", selectedUids.has(Number(li.dataset.uid)));
  });
}

function clearMulti(): void {
  selectedUids = new Set<number>();
  lastAnchorUid = null;
  updateBulkBar();
}

function toggleMulti(m: MessageHeader): void {
  const next = new Set(selectedUids);
  if (next.has(m.uid)) next.delete(m.uid);
  else next.add(m.uid);
  selectedUids = next;
  lastAnchorUid = m.uid;
  updateBulkBar();
}

/** Shift+клик: выделяет диапазон по видимому порядку строк. */
function selectRange(m: MessageHeader): void {
  const rows = visibleRows();
  const ids = rows.map((r) => Number(r.dataset.uid));
  const anchor = lastAnchorUid ?? currentMessage?.uid ?? m.uid;
  const a = ids.indexOf(anchor);
  const b = ids.indexOf(m.uid);
  if (a < 0 || b < 0) {
    toggleMulti(m);
    return;
  }
  const [from, to] = a <= b ? [a, b] : [b, a];
  const next = new Set(selectedUids);
  for (let i = from; i <= to; i += 1) next.add(ids[i]);
  selectedUids = next;
  lastAnchorUid = m.uid;
  updateBulkBar();
}

async function bulkAction(kind: string): Promise<void> {
  if (kind === "clear") {
    clearMulti();
    return;
  }
  const uids = [...selectedUids];
  if (uids.length === 0) return;
  const folder = currentFolder;
  try {
    if (kind === "trash") {
      const n = await invoke<number>("delete_messages", { folder, uids });
      currentMessages = currentMessages.filter((m) => !selectedUids.has(m.uid));
      selectedUids = new Set<number>();
      lastAnchorUid = null;
      updateBulkBar();
      renderMessages();
      showToast(`В корзину: ${n}`);
    } else if (kind === "seen" || kind === "unseen") {
      const seen = kind === "seen";
      const n = await invoke<number>("mark_messages_seen", { folder, uids, seen });
      currentMessages = currentMessages.map((m) => (uids.includes(m.uid) ? { ...m, seen } : m));
      renderMessages();
      showToast(`${seen ? "Прочитано" : "Непрочитано"}: ${n}`);
    } else if (kind === "flag" || kind === "unflag") {
      const flagged = kind === "flag";
      const n = await invoke<number>("mark_messages_flagged", { folder, uids, flagged });
      currentMessages = currentMessages.map((m) => (uids.includes(m.uid) ? { ...m, flagged } : m));
      renderMessages();
      showToast(`${flagged ? "Важное" : "Снят флаг"}: ${n}`);
    }
  } catch (e) {
    showToast(`Не получилось: ${String(e)}`);
  }
}

/** Выделяет все видимые строки — кнопка «✓» и Ctrl+A. */
function selectAllVisible(): void {
  const rows = visibleRows();
  const next = new Set<number>();
  rows.forEach((r) => next.add(Number(r.dataset.uid)));
  selectedUids = next;
  lastAnchorUid = rows.length > 0 ? Number(rows[rows.length - 1].dataset.uid) : null;
  updateBulkBar();
}

function initBulkBar(): void {
  document.querySelectorAll<HTMLButtonElement>("#bulk-bar button[data-bulk]").forEach((b) => {
    b.addEventListener("click", () => void bulkAction(b.dataset.bulk ?? ""));
  });
  document.getElementById("select-all")?.addEventListener("click", selectAllVisible);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && selectedUids.size > 0 && !modalOpen()) {
      clearMulti();
      return;
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      e.key.toLowerCase() === "a" &&
      !isTypingTarget(e.target) &&
      !modalOpen()
    ) {
      e.preventDefault();
      selectAllVisible();
    }
  });
}

function messageRow(m: MessageHeader): HTMLLIElement {
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
    paintBadge(bs, badge);
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
  const flag = document.createElement("button");
  flag.type = "button";
  flag.className = m.flagged ? "flag-btn on" : "flag-btn";
  flag.textContent = "⚑";
  flag.title = m.flagged ? "Снять «важное»" : "Пометить важным";
  flag.addEventListener("click", (e) => {
    e.stopPropagation();
    void toggleFlag(m);
  });
  time.append(flag);
  if (m.has_attachments) {
    const clip = document.createElement("span");
    clip.className = "clip";
    clip.title = "Есть вложения";
    clip.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';
    time.append(clip);
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
  // Shift+клик не должен выделять текст в строке — только письмо.
  li.addEventListener("mousedown", (e) => {
    if (e.shiftKey) e.preventDefault();
  });
  if (selectedUids.has(m.uid)) li.classList.add("multi");
  li.addEventListener("click", (e) => {
    if (e.ctrlKey || e.metaKey) {
      toggleMulti(m);
      return;
    }
    if (e.shiftKey) {
      selectRange(m);
      return;
    }
    if (selectedUids.size > 0) clearMulti();
    selectMessage(m);
  });
  li.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openMsgMenu(e.clientX, e.clientY, m);
  });
  li.addEventListener("dblclick", () => void openDraftIfAny(m));
  return li;
}

const GROUPS_KEY = "soroka.groupsCollapsed";

/** Какие группы свёрнуты — ключ «режим|название». */
function collapsedGroups(): Set<string> {
  try {
    const raw = localStorage.getItem(GROUPS_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [],
    );
  } catch {
    return new Set();
  }
}

function saveCollapsedGroups(set: Set<string>): void {
  localStorage.setItem(GROUPS_KEY, JSON.stringify([...set]));
}

function toggleGroup(key: string): void {
  const set = collapsedGroups();
  if (set.has(key)) set.delete(key);
  else set.add(key);
  saveCollapsedGroups(set);
  renderMessages();
}

/** «Свернуть все» / «Развернуть все» — для всех групп текущего списка. */
function collapseAllGroups(collapsed: boolean): void {
  const set = collapsedGroups();
  document.querySelectorAll<HTMLElement>("#messages li.group-head").forEach((head) => {
    const key = head.dataset.groupKey;
    if (!key) return;
    if (collapsed) set.add(key);
    else set.delete(key);
  });
  saveCollapsedGroups(set);
  renderMessages();
}

function openGroupMenu(x: number, y: number): void {
  const menu = document.getElementById("group-menu");
  if (!menu) return;
  menu.classList.remove("hidden");
  menu.style.left = `${Math.min(x, window.innerWidth - 190)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 84)}px`;
}

function closeGroupMenu(): void {
  document.getElementById("group-menu")?.classList.add("hidden");
}

function initGroupMenu(): void {
  const menu = document.getElementById("group-menu");
  menu?.querySelectorAll<HTMLButtonElement>("button[data-group-act]").forEach((b) => {
    b.addEventListener("click", () => {
      collapseAllGroups(b.dataset.groupAct === "collapse");
      closeGroupMenu();
    });
  });
  document.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement | null)?.closest("#group-menu")) closeGroupMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeGroupMenu();
  });
}

/** Подсветить строку открытого письма после перерисовки списка. */
function markSelection(): void {
  if (!messagesList || !currentMessage) return;
  messagesList.querySelectorAll<HTMLElement>("li[data-uid]").forEach((el) => {
    el.classList.toggle("selected", el.dataset.uid === String(currentMessage!.uid));
  });
}

function renderMessages(): void {
  if (!messagesList || !messagesEmpty) return;
  const items = sortedMessages();
  messagesList.innerHTML = "";
  messagesEmpty.textContent = searchQuery
    ? "Сорока ничего не нашла"
    : "Сорока ещё в полёте — писем нет";
  messagesEmpty.classList.toggle("hidden", items.length > 0);

  if (sortState.group === "none") {
    items.forEach((m) => messagesList?.appendChild(messageRow(m)));
    markSelection();
    updateBulkBar();
    return;
  }

  const groups = new Map<string, MessageHeader[]>();
  for (const m of items) {
    const key =
      sortState.group === "date" ? dateGroupLabel(messageTime(m)) : categoryGroupLabel(m);
    const bucket = groups.get(key);
    if (bucket) bucket.push(m);
    else groups.set(key, [m]);
  }
  const collapsed = collapsedGroups();
  for (const title of groupTitles([...groups.keys()])) {
    const bucket = groups.get(title) ?? [];
    const key = `${sortState.group}|${title}`;
    const isCollapsed = collapsed.has(key);

    const head = document.createElement("li");
    head.className = isCollapsed ? "group-head collapsed" : "group-head";
    head.dataset.groupKey = key;
    head.title = "Клик — свернуть/развернуть, правый клик — все группы";

    const caret = document.createElement("span");
    caret.className = "gr-caret";
    caret.textContent = isCollapsed ? "▶" : "▼";
    const label = document.createElement("span");
    label.className = "gr-title";
    label.textContent = title;
    const cnt = document.createElement("span");
    cnt.className = "cnt";
    const unread = bucket.filter((m) => !m.seen).length;
    cnt.textContent = unread > 0 ? `${bucket.length} · ${unread} новых` : String(bucket.length);
    head.append(caret, label, cnt);

    head.addEventListener("click", () => toggleGroup(key));
    head.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openGroupMenu(e.clientX, e.clientY);
    });

    messagesList.appendChild(head);
    bucket.forEach((m) => {
      const row = messageRow(m);
      if (isCollapsed) row.hidden = true;
      messagesList.appendChild(row);
    });
  }
  markSelection();
  updateBulkBar();
}

function groupLabel(mode: GroupMode): string {
  if (mode === "category") return "по категориям";
  if (mode === "none") return "без группировки";
  return "по датам";
}

function initSortMenu(): void {
  const btn = document.getElementById("sort-btn");
  const menu = document.getElementById("sort-menu");
  if (!btn || !menu) return;
  const sync = (): void => {
    menu.querySelectorAll<HTMLButtonElement>("button[data-sort]").forEach((b) => {
      b.classList.toggle("sel", b.dataset.sort === sortState.order);
    });
    menu.querySelectorAll<HTMLButtonElement>("button[data-group]").forEach((b) => {
      b.classList.toggle("sel", b.dataset.group === sortState.group);
    });
    btn.classList.add("on");
    btn.title = `Сортировка: ${sortState.order === "date_desc" ? "сначала новые" : "сначала старые"}, группировка ${groupLabel(sortState.group)}`;
  };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("hidden");
    if (!menu.classList.contains("hidden")) sync();
  });
  menu.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b) return;
    if (b.dataset.sort) {
      sortState.order = b.dataset.sort === "date_asc" ? "date_asc" : "date_desc";
    }
    if (b.dataset.group) {
      sortState.group =
        b.dataset.group === "category" ? "category" : b.dataset.group === "none" ? "none" : "date";
    }
    saveSortState();
    sync();
    menu.classList.add("hidden");
    renderMessages();
  });
  document.addEventListener("click", (e) => {
    if (!menu.classList.contains("hidden") && !(e.target as HTMLElement).closest("#sort-wrap")) {
      menu.classList.add("hidden");
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") menu.classList.add("hidden");
  });
  sync();
}

function selectMessage(m: MessageHeader): void {
  currentMessage = m;
  hideTranslation();
  notspamBtn?.classList.toggle("hidden", !isSpamFolder(splitFolderKey(currentFolder).name));
  if (dFrom) {
    dFrom.textContent = m.from;
    dFrom.title = m.from;
  }
  if (dSubject) dSubject.textContent = m.subject;
  if (dDate) dDate.textContent = fullDate(m.date);
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
    const res = await invoke<SyncPayload>("sync_inbox", { accountId: activeAccountId || null });
    if (res.offline) {
      if (statusMail) statusMail.textContent = `почта: офлайн, писем ${res.total}`;
      showToast(`Сорока вернулась ни с чем (${res.error ?? "нет сети"}) — показываю кэш`);
    } else {
      if (statusMail) statusMail.textContent = `почта: писем ${res.total}`;
      showToast(`Сорока на хвосте принесла — ${res.fetched} писем`);
    }
    currentFolder = folderKeyOf(activeAccountId, "INBOX");
    await refreshMail();
    void refreshUnreadFromServer();
  } catch (err) {
    if (statusMail) statusMail.textContent = "почта: ошибка";
    showToast(`Сорока вернулась ни с чем: ${String(err)}`);
  } finally {
    if (mailBtn) mailBtn.disabled = false;
  }
}

async function initMail(): Promise<void> {
  // TASK-016: список ящиков; если ни одного — сразу мастер настройки.
  try {
    accounts = await invoke<AccountView[]>("get_accounts");
  } catch {
    accounts = [];
  }
  if (accounts.length === 0) {
    void openSettings(true, true);
    if (statusMail) statusMail.textContent = "почта: не настроена";
    return;
  }
  activeAccountId = accounts[0].id;
  currentFolder = folderKeyOf(activeAccountId, "INBOX");
  // мгновенный показ из кэша, затем синхронизация
  try {
    const info = await invoke<CacheInfo | null>("load_cache");
    if (info && (!info.account || info.account === activeAccountId)) {
      if (statusMail) statusMail.textContent = `почта: писем ${info.total} (кэш)`;
      await refreshMail();
    }
  } catch {
    /* кэша нет или ошибка — не мешаем основной синхронизации */
  }
  void refreshUnread();
  window.setTimeout(() => void checkMail(), 400);
}

/* ===== TASK-017: светлая и тёмная тема ===== */
type ThemeName = "light" | "dark";
const THEME_KEY = "soroka.theme";

function systemTheme(): ThemeName {
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function currentTheme(): ThemeName {
  const saved = localStorage.getItem(THEME_KEY);
  return saved === "light" || saved === "dark" ? saved : systemTheme();
}

function applyTheme(theme: ThemeName, persist = true): void {
  document.documentElement.dataset.theme = theme;
  if (persist) localStorage.setItem(THEME_KEY, theme);
  // Одна кнопка показывает тему, на которую переключит
  const btn = document.getElementById("theme-btn");
  if (btn) {
    const next = theme === "dark" ? "light" : "dark";
    btn.textContent = next === "light" ? "☀" : "🌙";
    btn.title = next === "light" ? "Светлая тема" : "Тёмная тема";
    btn.setAttribute("aria-label", btn.title);
  }
  // Mica/Acrylic и системный заголовок окна — в тон теме
  void invoke("set_window_theme", { dark: theme === "dark" }).catch(() => undefined);
}

/* ===== TASK-021: удаление писем и очистка корзины ===== */

function isTrashFolder(name: string): boolean {
  const l = name.toLowerCase();
  return l.includes("корзин") || l.includes("trash") || l.includes("удал");
}

function isSpamFolder(name: string): boolean {
  const l = name.toLowerCase();
  return l.includes("спам") || l.includes("spam") || l.includes("junk");
}

function clearReadingPane(): void {
  currentMessage = null;
  details?.classList.add("hidden");
  messageEmpty?.classList.remove("hidden");
}

async function deleteCurrent(): Promise<void> {
  if (!currentMessage) return;
  const m = currentMessage;
  try {
    await invoke("delete_message", { folder: currentFolder, uid: m.uid });
    currentMessages = currentMessages.filter((x) => x.uid !== m.uid);
    clearReadingPane();
    renderMessages();
    await refreshUnread();
    showToast("Сорока убрала письмо в корзину");
  } catch (err) {
    showToast(`Не удалось удалить: ${String(err)}`);
  }
}

async function notSpamCurrent(): Promise<void> {
  if (!currentMessage) return;
  const m = currentMessage;
  try {
    await invoke("restore_from_spam", { folder: currentFolder, uid: m.uid });
    currentMessages = currentMessages.filter((x) => x.uid !== m.uid);
    clearReadingPane();
    renderMessages();
    await refreshUnread();
    showToast("Письмо вернулось во «Входящие»");
  } catch (err) {
    showToast(`Не удалось вернуть письмо: ${String(err)}`);
  }
}

async function emptyTrashFolder(): Promise<void> {
  if (!currentFolder) return;
  if (!window.confirm("Удалить все письма из корзины безвозвратно?")) return;
  try {
    const removed = await invoke<number>("empty_trash", { folder: currentFolder });
    currentMessages = [];
    clearReadingPane();
    renderMessages();
    await refreshUnread();
    showToast(`Корзина очищена: ${removed} писем`);
  } catch (err) {
    showToast(`Не удалось очистить корзину: ${String(err)}`);
  }
}

function makeSettingsMovable(): void {
  const shell = document.querySelector<HTMLElement>(".settings-shell");
  const handle = shell?.querySelector<HTMLElement>(".sn-head");
  if (!shell || !handle) return;
  // Сдвигаем окно через transform: position: fixed внутри overlay с backdrop-filter
  // считается от overlay, из-за чего окно «возвращалось» на место (TASK-021).
  let shift = { x: 0, y: 0 };
  let start: { x: number; y: number; ox: number; oy: number } | null = null;
  const paint = (): void => {
    shell.style.transform = shift.x === 0 && shift.y === 0 ? "" : `translate(${shift.x}px, ${shift.y}px)`;
  };
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    start = { x: e.clientX, y: e.clientY, ox: shift.x, oy: shift.y };
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("grabbing");
    e.preventDefault();
  });
  handle.addEventListener("pointermove", (e) => {
    if (!start) return;
    shift = { x: start.ox + (e.clientX - start.x), y: start.oy + (e.clientY - start.y) };
    paint();
  });
  const stop = (e: PointerEvent): void => {
    if (!start) return;
    start = null;
    handle.classList.remove("grabbing");
    try {
      handle.releasePointerCapture(e.pointerId);
    } catch {
      /* указатель уже отпущен */
    }
  };
  handle.addEventListener("pointerup", stop);
  handle.addEventListener("pointercancel", stop);
}

/** Папка черновиков на сервере: по флагу \Drafts, иначе по имени (TASK-022). */
function isDraftsFolder(name: string): boolean {
  const acc = splitFolderKey(currentFolder).accountId;
  const f = lastFolders.find((x) => x.name === folderKeyOf(acc, name));
  if (f?.is_drafts) return true;
  const l = name.toLowerCase();
  return l === "drafts" || l === "черновики" || l.endsWith("/drafts") || l.endsWith(".drafts");
}

/** Двойной клик по письму в папке черновиков открывает его в окне письма. */
async function openDraftIfAny(m: MessageHeader): Promise<void> {
  const { accountId: acc, name: folderName } = splitFolderKey(currentFolder);
  if (!isDraftsFolder(folderName)) return;
  try {
    const drafts = await invoke<DraftData[]>("get_drafts", { accountId: acc || null });
    const d = drafts.find((x) => x.uid === m.uid);
    if (!d) return;
    openCompose({
      title: "Черновик",
      to: d.to_addr,
      subject: d.subject,
      body: d.body,
      draft: d,
    });
  } catch {
    /* обычное открытие письма */
  }
}

/** Меню письма по правому клику в списке (TASK-021). */
function openMsgMenu(x: number, y: number, m: MessageHeader): void {
  const menu = document.getElementById("acct-menu");
  if (!menu) return;
  menu.innerHTML = "";
  const add = (label: string, fn: () => void): void => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", () => {
      closeAcctMenu();
      fn();
    });
    menu.appendChild(b);
  };

  // Правый клик по выделенной строке — действия над всем выделением.
  if (selectedUids.size > 1 && selectedUids.has(m.uid)) {
    const n = selectedUids.size;
    add(`В корзину (${n})`, () => void bulkAction("trash"));
    add(`Прочитано (${n})`, () => void bulkAction("seen"));
    add(`Непрочитано (${n})`, () => void bulkAction("unseen"));
    add(`⚑ Важное (${n})`, () => void bulkAction("flag"));
    add(`Снять ⚑ (${n})`, () => void bulkAction("unflag"));
    add("Снять выделение", () => clearMulti());
    menu.classList.remove("hidden");
    menu.style.left = `${Math.min(x, window.innerWidth - 240)}px`;
    menu.style.top = `${Math.min(y + 8, window.innerHeight - 260)}px`;
    menu.querySelector<HTMLButtonElement>("button")?.focus();
    return;
  }

  add("Открыть", () => selectMessage(m));
  add("В корзину", () => {
    selectMessage(m);
    void deleteCurrent();
  });
  if (isSpamFolder(splitFolderKey(currentFolder).name)) {
    add("Не спам", () => {
      selectMessage(m);
      void notSpamCurrent();
    });
  } else {
    add("В спам", () => {
      selectMessage(m);
      void moveToSpam(m);
    });
  }
  add(m.seen ? "Непрочитано" : "Прочитано", () => void markSeen(m.uid, !m.seen));
  menu.classList.remove("hidden");
  menu.style.left = `${Math.min(x, window.innerWidth - 220)}px`;
  menu.style.top = `${Math.min(y + 8, window.innerHeight - 200)}px`;
  menu.querySelector<HTMLButtonElement>("button")?.focus();
}

/** Прозрачность окна: класс на body + эффект стекла в Rust (TASK-021). */
function renderAppearance(): void {
  const box = document.getElementById("opt-transparent") as HTMLInputElement | null;
  if (box) box.checked = settingsData?.appearance?.transparent ?? false;
}

function syncOpaqueClass(): void {
  const transparent = settingsData?.appearance?.transparent ?? false;
  document.body.classList.toggle("opaque", !transparent);
}

async function applyTransparent(value: boolean): Promise<void> {
  if (settingsData) {
    settingsData.appearance = { transparent: value };
    await persistSettings();
  }
  document.body.classList.toggle("opaque", !value);
  try {
    await invoke("apply_appearance", { transparent: value });
  } catch (err) {
    console.warn("эффект окна", err);
  }
  showToast(
    value
      ? "Прозрачность включена"
      : "Прозрачность выключена: полностью — после перезапуска «Сороки»",
  );
}

function initSettingsUi(): void {
  document.querySelectorAll<HTMLElement>(".sn-item[data-view]").forEach((el) => {
    el.addEventListener("click", () => {
      const view = el.dataset.view ?? "categories";
      if (view === "categories") renderCategories();
      if (view === "prompts") renderPrompts();
      if (view === "signatures") renderSignatures();
      if (view === "appearance") renderAppearance();
      switchSettingsView(view);
    });
  });
  document.getElementById("settings-close")?.addEventListener("click", () => closeSettings());
  document.getElementById("cat-add")?.addEventListener("click", () => openCategoryEditor(null));
  document.getElementById("cat-save")?.addEventListener("click", () => void saveCategory());
  document.getElementById("cat-cancel")?.addEventListener("click", () => closeCategoryEditor());
  document.getElementById("cat-delete")?.addEventListener("click", () => void deleteCategory());
  document.getElementById("prompts-save")?.addEventListener("click", () => void savePrompts());
  document.getElementById("prompts-reset")?.addEventListener("click", () => void resetAllSettings());
  document.getElementById("sig-add")?.addEventListener("click", () => void addSignature());
  document.getElementById("signatures-save")?.addEventListener("click", () => {
    void persistSettings().then(() => showToast("Подписи сохранены"));
  });
  document.getElementById("appearance-save")?.addEventListener("click", () => {
    const box = document.getElementById("opt-transparent") as HTMLInputElement | null;
    void applyTransparent(Boolean(box?.checked));
  });
  trashBtn?.addEventListener("click", () => void deleteCurrent());
  notspamBtn?.addEventListener("click", () => void notSpamCurrent());
  emptyTrashBtn?.addEventListener("click", () => void emptyTrashFolder());
  document.getElementById("titlebar")?.addEventListener("mousedown", () => {
    document.body.classList.add("win-drag");
    const up = (): void => {
      document.body.classList.remove("win-drag");
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mouseup", up);
  });
  makeSettingsMovable();
  const optTransparent = document.getElementById("opt-transparent") as HTMLInputElement | null;
  optTransparent?.addEventListener("change", () => void applyTransparent(optTransparent.checked));
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Delete") return;
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
    if (!currentMessage) return;
    e.preventDefault();
    void deleteCurrent();
  });
  composeDraftBtn?.addEventListener("click", () => void saveDraftNow(false));
  translateBtn?.addEventListener("click", () => void translateCurrent());
  trClose?.addEventListener("click", () => hideTranslation());
  trToggle?.addEventListener("click", () => hideTranslation());
  settingsOverlay?.addEventListener("click", (e) => {
    if (e.target === settingsOverlay) closeSettings();
  });
}

/* ===== TASK-023: навигация с клавиатуры ===== */

/** Панель, в которой работают стрелки: папки или список писем. */
let activePane: "folders" | "messages" = "messages";

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** Открыт ли модальный слой — тогда стрелки ему не мешаем. */
function modalOpen(): boolean {
  const shown = (el: HTMLElement | null): boolean =>
    Boolean(el && !el.classList.contains("hidden"));
  return (
    shown(settingsOverlay as HTMLElement | null) ||
    shown(composeOverlay as HTMLElement | null) ||
    shown(document.getElementById("event-overlay")) ||
    shown(document.getElementById("calendar-view")) ||
    shown(document.getElementById("contacts-overlay"))
  );
}

/** Видимые строки списка — в том порядке, в каком они на экране (свёрнутые скрыты). */
function visibleRows(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("#messages li.m-row[data-uid]"),
  ).filter((el) => !el.hidden && el.offsetParent !== null);
}

function moveMessageSelection(delta: number, extend = false): void {
  const rows = visibleRows();
  if (rows.length === 0) return;
  const idx = rows.findIndex((el) => el.classList.contains("selected"));
  let next: number;
  if (idx < 0) next = delta > 0 ? 0 : rows.length - 1;
  else next = idx + delta;
  next = Math.max(0, Math.min(rows.length - 1, next));
  const row = rows[next];
  if (!row) return;
  if (!extend) {
    row.click();
    row.scrollIntoView({ block: "nearest" });
    return;
  }
  // Shift+стрелка: тянем диапазон от опорной строки до новой (как в Проводнике).
  const ids = rows.map((r) => Number(r.dataset.uid));
  const uid = Number(row.dataset.uid);
  if (selectedUids.size === 0) {
    const anchorIdx = idx >= 0 ? idx : next;
    const anchorUid = ids[anchorIdx];
    selectedUids = new Set<number>([anchorUid]);
    lastAnchorUid = anchorUid;
  }
  const a = ids.indexOf(lastAnchorUid ?? uid);
  const b = ids.indexOf(uid);
  if (a >= 0 && b >= 0) {
    const [from, to] = a <= b ? [a, b] : [b, a];
    selectedUids = new Set<number>(ids.slice(from, to + 1));
  }
  updateBulkBar();
  rows.forEach((r) => r.classList.toggle("selected", r === row));
  const m = currentMessages.find((x) => x.uid === uid);
  if (m) void selectMessage(m);
  row.scrollIntoView({ block: "nearest" });
}

function moveFolderSelection(delta: number): void {
  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>("#folder-list li.folder[data-folder]"),
  );
  if (nodes.length === 0) return;
  const idx = nodes.findIndex((el) => el.dataset.folder === currentFolder);
  let next = idx < 0 ? 0 : idx + delta;
  next = Math.max(0, Math.min(nodes.length - 1, next));
  const node = nodes[next];
  if (!node || node.dataset.folder === currentFolder) return;
  node.click();
  node.scrollIntoView({ block: "nearest" });
}

function initKeyboardNav(): void {
  const PAGE = 10;
  // pointerdown в capture-фазе: заголовок панели гасит mousedown при перетаскивании.
  document.getElementById("folder-tree")?.addEventListener(
    "pointerdown",
    () => {
      activePane = "folders";
    },
    true,
  );
  document.getElementById("message-list")?.addEventListener(
    "pointerdown",
    () => {
      activePane = "messages";
    },
    true,
  );
  document.getElementById("message-view")?.addEventListener(
    "pointerdown",
    () => {
      activePane = "messages";
    },
    true,
  );
  document.addEventListener("keydown", (e) => {
    if (isTypingTarget(e.target) || modalOpen()) return;
    const key = e.key;
    if (
      key !== "ArrowDown" &&
      key !== "ArrowUp" &&
      key !== "Home" &&
      key !== "End" &&
      key !== "PageDown" &&
      key !== "PageUp"
    ) {
      return;
    }
    e.preventDefault();
    const step =
      key === "ArrowDown" ? 1
      : key === "ArrowUp" ? -1
      : key === "Home" ? -100000
      : key === "End" ? 100000
      : key === "PageDown" ? PAGE
      : -PAGE;
    if (activePane === "folders") moveFolderSelection(step);
    else moveMessageSelection(step, e.shiftKey);
  });
}

/* ===== TASK-028: адресная книга — палитра + карточка ===== */

interface Contact {
  id: number;
  name: string;
  email: string;
  organization: string;
  position: string;
  phone: string;
  notes: string;
  groups: string;
}

interface ContactDraft {
  name: string;
  email: string;
  organization: string;
  position: string;
  phone: string;
  notes: string;
}

interface AddressSuggestion {
  email: string;
  name: string;
  source: string;
  count: number;
}

let contacts: Contact[] = [];
let correspondence: AddressSuggestion[] = [];
let currentContactId = 0;
let contactsQuery = "";
/** "" — все контакты, "__mail" — люди из переписки, иначе имя группы. */
let contactsGroup = "";
let contactEditing = false;
let contactsIndex = -1;
let statsToken = 0;

function contactEl(id: string): HTMLInputElement | HTMLTextAreaElement | null {
  return document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
}

function contactText(id: string): string {
  return contactEl(id)?.value ?? "";
}

function setContactText(id: string, value: string): void {
  const el = contactEl(id);
  if (el) el.value = value;
}

function contactStatus(text: string): void {
  const el = document.getElementById("contact-status");
  if (el) el.textContent = text;
}

function contactsOverlay(): HTMLElement | null {
  return document.getElementById("contacts-overlay");
}

/** Инициалы для кружка: «Анна Смирнова» → «АС», иначе первые две буквы адреса. */
function initials(name: string, email: string): string {
  const src = (name || email || "").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  const base = src.includes("@") ? src.split("@")[0] : src;
  return base.slice(0, 2).toUpperCase() || "?";
}

/** Тон кружка по адресу — пастельные кружки, как в макете. */
function avatarTone(email: string): string {
  let sum = 0;
  for (let i = 0; i < email.length; i++) sum += email.charCodeAt(i);
  return ["", "b", "c", "d"][sum % 4];
}

function avatarClass(base: string, email: string): string {
  const tone = avatarTone(email);
  return tone ? `${base} ${tone}` : base;
}

function contactGroups(c: Contact): string[] {
  return c.groups
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function allGroups(): { name: string; count: number }[] {
  const map = new Map<string, number>();
  for (const c of contacts) {
    for (const g of contactGroups(c)) map.set(g, (map.get(g) ?? 0) + 1);
  }
  return Array.from(map, ([name, count]) => ({ name, count })).sort((a, b) =>
    a.name.localeCompare(b.name, "ru"),
  );
}

function renderContactGroups(): void {
  const box = document.getElementById("contacts-groups");
  if (!box) return;
  box.innerHTML = "";
  const row = (label: string, value: string, count?: number): void => {
    const d = document.createElement("div");
    d.className = "cg-row" + (contactsGroup === value ? " on" : "");
    const name = document.createElement("span");
    name.className = "cg-label";
    name.textContent = label;
    d.appendChild(name);
    if (count !== undefined) {
      const s = document.createElement("span");
      s.className = "cg-num";
      s.textContent = String(count);
      d.appendChild(s);
    }
    d.addEventListener("click", () => {
      contactsGroup = value;
      contactsIndex = -1;
      renderContactGroups();
      renderContacts();
      if (value === "__mail" && correspondence.length > 0) showSuggestion(correspondence[0], 0);
      document.getElementById("contacts-search")?.focus();
    });
    box.appendChild(d);
  };
  row("Все контакты", "", contacts.length);
  if (correspondence.length > 0) row("Из переписки", "__mail", correspondence.length);
  for (const g of allGroups()) row(g.name, g.name);
}

async function loadContacts(): Promise<void> {
  try {
    contacts = await invoke<Contact[]>("get_contacts");
  } catch (e) {
    contacts = [];
    showToast(`Адресная книга не открылась: ${String(e)}`);
  }
  renderContactGroups();
  renderContacts();
}

function filteredContacts(): Contact[] {
  const q = contactsQuery.trim().toLowerCase();
  return contacts
    .filter((c) => {
      if (contactsGroup && contactsGroup !== "__mail" && !contactGroups(c).includes(contactsGroup)) {
        return false;
      }
      if (!q) return true;
      return `${c.name} ${c.email} ${c.organization} ${c.position} ${c.groups}`
        .toLowerCase()
        .includes(q);
    })
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, "ru"));
}

function contactRow(c: Contact, index: number): HTMLLIElement {
  const li = document.createElement("li");
  if (index === contactsIndex) li.className = "selected";
  const av = document.createElement("div");
  av.className = avatarClass("c-av", c.email);
  av.textContent = initials(c.name, c.email);
  const body = document.createElement("div");
  body.className = "c-body";
  const nm = document.createElement("div");
  nm.className = "c-name";
  nm.textContent = c.name || c.email;
  const em = document.createElement("div");
  em.className = "c-mail";
  em.textContent = c.email;
  body.append(nm, em);
  li.append(av, body);
  li.addEventListener("click", () => openContactCard(c, index, false));
  li.addEventListener("dblclick", () => writeToEmail(c.email));
  return li;
}

function suggestionRow(s: AddressSuggestion, index: number): HTMLLIElement {
  const li = document.createElement("li");
  if (index === contactsIndex) li.className = "selected";
  const av = document.createElement("div");
  av.className = avatarClass("c-av", s.email);
  av.textContent = initials(s.name, s.email);
  const body = document.createElement("div");
  body.className = "c-body";
  const nm = document.createElement("div");
  nm.className = "c-name";
  nm.textContent = s.name || s.email;
  const em = document.createElement("div");
  em.className = "c-mail";
  em.textContent = s.name ? s.email : "";
  body.append(nm, em);
  const cnt = document.createElement("span");
  cnt.className = "c-count";
  cnt.textContent = String(s.count);
  const add = document.createElement("button");
  add.type = "button";
  add.className = "c-add";
  add.textContent = "Сохранить";
  add.addEventListener("click", (e) => {
    e.stopPropagation();
    void saveSuggestion(s);
  });
  li.append(av, body, cnt, add);
  li.addEventListener("click", () => showSuggestion(s, index));
  return li;
}

function renderContacts(): void {
  const list = document.getElementById("contacts-list");
  const empty = document.getElementById("contacts-empty");
  if (!list) return;
  list.innerHTML = "";
  const fromMail = contactsGroup === "__mail";
  if (empty) {
    empty.textContent = fromMail
      ? "Все, с кем была переписка, уже в книге."
      : contacts.length === 0
        ? "Пока пусто. Нажмите «+ Контакт» или «Импорт»."
        : "Ничего не нашлось.";
    empty.classList.toggle("hidden", (fromMail ? correspondence.length : filteredContacts().length) > 0);
  }
  if (fromMail) {
    correspondence.forEach((s, i) => list.appendChild(suggestionRow(s, i)));
  } else {
    filteredContacts().forEach((c, i) => list.appendChild(contactRow(c, i)));
  }
}

function fillContactFields(c: Contact | null): void {
  setContactText("contact-name", c?.name ?? "");
  setContactText("contact-email", c?.email ?? "");
  setContactText("contact-org", c?.organization ?? "");
  setContactText("contact-position", c?.position ?? "");
  setContactText("contact-phone", c?.phone ?? "");
  setContactText("contact-groups", c?.groups ?? "");
  setContactText("contact-notes", c?.notes ?? "");
}

function readContactForm(): Contact {
  return {
    id: currentContactId,
    name: contactText("contact-name").trim(),
    email: contactText("contact-email").trim(),
    organization: contactText("contact-org").trim(),
    position: contactText("contact-position").trim(),
    phone: contactText("contact-phone").trim(),
    notes: contactText("contact-notes").trim(),
    groups: contactText("contact-groups").trim(),
  };
}

function renderCardHeader(c: Contact | null): void {
  const av = document.getElementById("contact-avatar");
  const title = document.getElementById("contact-title");
  const sub = document.getElementById("contact-subtitle");
  if (av) {
    av.className = avatarClass("cc-avatar", c?.email ?? "");
    av.textContent = initials(c?.name ?? "", c?.email ?? "");
  }
  if (title) title.textContent = c ? c.name || c.email : "Новый контакт";
  if (sub) sub.textContent = c ? c.email : "Заполните поля и нажмите «Сохранить»";
}

function renderCardFields(c: Contact | null): void {
  const dl = document.getElementById("contact-fields");
  if (!dl) return;
  dl.innerHTML = "";
  if (!c) return;
  const add = (key: string, value: string): void => {
    if (!value.trim()) return;
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = value;
    dl.append(dt, dd);
  };
  add("E-mail", c.email);
  add("Организация", c.organization);
  add("Должность", c.position);
  add("Телефон", c.phone);
  add("Группы", c.groups);
  add("Заметки", c.notes);
  if (dl.children.length === 0) {
    const dt = document.createElement("dt");
    dt.textContent = "Данные";
    const dd = document.createElement("dd");
    dd.textContent = "Заполните карточку — кнопка «Изменить»";
    dl.append(dt, dd);
  }
}

function renderCardButtons(): void {
  const show = (id: string, visible: boolean): void => {
    document.getElementById(id)?.classList.toggle("hidden", !visible);
  };
  const has = currentContactId > 0;
  show("contact-save", contactEditing);
  show("contact-ai", contactEditing);
  show("contact-edit", !contactEditing && has);
  show("contact-write", !contactEditing && has);
  show("contact-to-compose", !contactEditing && has);
  show("contact-delete", !contactEditing && has);
}

function renderCard(): void {
  document.getElementById("contact-read")?.classList.toggle("hidden", contactEditing);
  document.getElementById("contact-form")?.classList.toggle("hidden", !contactEditing);
  renderCardButtons();
}

async function loadContactStats(email: string): Promise<void> {
  const box = document.getElementById("contact-stats");
  if (!box) return;
  const token = ++statsToken;
  box.textContent = "";
  if (!email.includes("@")) return;
  try {
    const res = await invoke<[number, string]>("contact_stats", { email });
    if (token !== statsToken) return;
    const n = Number(res[0] ?? 0);
    const last = String(res[1] ?? "");
    box.textContent =
      n > 0 ? `Писем: ${n} · последнее ${last ? shortTime(last) : "—"}` : "Писем в кэше нет";
  } catch {
    if (token === statsToken) box.textContent = "";
  }
}

function openContactCard(c: Contact | null, index = -1, edit = false): void {
  currentContactId = c?.id ?? 0;
  contactsIndex = index;
  contactEditing = edit || !c;
  fillContactFields(c);
  renderCardHeader(c);
  renderCardFields(c);
  renderCard();
  renderContacts();
  void loadContactStats(c?.email ?? "");
  contactStatus("");
  if (contactEditing) document.getElementById("contact-name")?.focus();
}

/** Карточка для человека из переписки: поля уже заполнены, осталось сохранить. */
function showSuggestion(s: AddressSuggestion, index: number): void {
  currentContactId = 0;
  contactsIndex = index;
  contactEditing = true;
  fillContactFields({
    id: 0,
    name: s.name,
    email: s.email,
    organization: "",
    position: "",
    phone: "",
    notes: "",
    groups: "",
  });
  renderCardHeader(null);
  const title = document.getElementById("contact-title");
  if (title) title.textContent = s.name || s.email;
  const sub = document.getElementById("contact-subtitle");
  if (sub) sub.textContent = `Из переписки · писем: ${s.count}`;
  const av = document.getElementById("contact-avatar");
  if (av) {
    av.className = avatarClass("cc-avatar", s.email);
    av.textContent = initials(s.name, s.email);
  }
  renderCardFields(null);
  renderCard();
  renderContacts();
  void loadContactStats(s.email);
  contactStatus("проверьте и нажмите «Сохранить»");
}

async function saveContact(): Promise<void> {
  const c = readContactForm();
  if (!c.email.includes("@")) {
    showToast("Укажите e-mail контакта");
    return;
  }
  try {
    const id = await invoke<number>("save_contact", { contact: c });
    currentContactId = id;
    await loadContacts();
    const saved = contacts.find((x) => x.id === id) ?? null;
    const index = saved ? filteredContacts().findIndex((x) => x.id === id) : -1;
    openContactCard(saved, index, false);
    contactStatus("сохранено");
  } catch (e) {
    showToast(`Не сохранилось: ${String(e)}`);
  }
}

async function saveSuggestion(s: AddressSuggestion): Promise<void> {
  try {
    const id = await invoke<number>("save_contact", {
      contact: {
        id: 0,
        name: s.name,
        email: s.email,
        organization: "",
        position: "",
        phone: "",
        notes: "",
        groups: "",
      },
    });
    correspondence = correspondence.filter((x) => x.email.toLowerCase() !== s.email.toLowerCase());
    await loadContacts();
    const saved = contacts.find((x) => x.id === id) ?? null;
    if (saved) {
      contactsGroup = "";
      renderContactGroups();
      openContactCard(saved, filteredContacts().findIndex((x) => x.id === id), false);
    } else {
      renderContactGroups();
    }
    showToast(`Контакт добавлен: ${s.email}`);
  } catch (e) {
    showToast(`Не сохранилось: ${String(e)}`);
  }
}

async function deleteContact(): Promise<void> {
  if (!currentContactId) return;
  if (!window.confirm("Удалить контакт из адресной книги?")) return;
  try {
    await invoke("delete_contact", { id: currentContactId });
    currentContactId = 0;
    await loadContacts();
    if (contacts.length > 0) openContactCard(contacts[0], 0, false);
    else openContactCard(null);
  } catch (e) {
    showToast(`Не удалилось: ${String(e)}`);
  }
}

async function aiFillContact(): Promise<void> {
  const email = contactText("contact-email").trim();
  if (!email.includes("@")) {
    showToast("Сначала укажите e-mail — по нему найдём письмо");
    return;
  }
  contactStatus("ИИ читает письмо…");
  try {
    const d = await invoke<ContactDraft>("contact_draft_by_email", { email });
    if (d.name) setContactText("contact-name", d.name);
    if (d.organization) setContactText("contact-org", d.organization);
    if (d.position) setContactText("contact-position", d.position);
    if (d.phone) setContactText("contact-phone", d.phone);
    if (d.notes) setContactText("contact-notes", d.notes);
    if (!contactText("contact-email") && d.email) setContactText("contact-email", d.email);
    contactStatus("проверьте и нажмите «Сохранить»");
  } catch (e) {
    contactStatus("");
    showToast(String(e));
  }
}

async function importContactsFile(file: File): Promise<void> {
  try {
    const text = await file.text();
    const format = /\.(vcf|vcard)$/i.test(file.name) ? "vcf" : "csv";
    const n = await invoke<number>("import_contacts_text", { text, format });
    await loadContacts();
    showToast(`Импортировано контактов: ${n}`);
  } catch (e) {
    showToast(`Импорт не удался: ${String(e)}`);
  }
}

async function exportContacts(format: string): Promise<void> {
  try {
    const path = await invoke<string>("export_contacts_file", { format });
    showToast(`Сохранено: ${path}`);
  } catch (e) {
    showToast(`Экспорт не удался: ${String(e)}`);
  }
}

function closeContacts(): void {
  contactsOverlay()?.classList.add("hidden");
  document.getElementById("contacts-export-menu")?.classList.add("hidden");
}

/** Написать письмо этому человеку: книга закрывается, открывается форма. */
function writeToEmail(email: string): void {
  if (!email.includes("@")) return;
  closeContacts();
  openCompose({ to: email });
}

/** Добавить адрес в уже открытое письмо или открыть новое. */
function addToCompose(email: string): void {
  if (!email.includes("@")) return;
  if (composeOverlay && !composeOverlay.classList.contains("hidden") && composeTo) {
    const cur = composeTo.value.trim();
    composeTo.value = cur ? `${normalizeRecipients(cur)}, ${email}` : email;
    composeTo.focus();
    showToast(`Добавлено в письмо: ${email}`);
    closeContacts();
    return;
  }
  writeToEmail(email);
}

async function openContacts(): Promise<void> {
  contactsOverlay()?.classList.remove("hidden");
  contactsQuery = "";
  contactsGroup = "";
  contactsIndex = -1;
  contactEditing = false;
  const search = document.getElementById("contacts-search") as HTMLInputElement | null;
  if (search) search.value = "";
  await loadContacts();
  try {
    correspondence = await invoke<AddressSuggestion[]>("suggest_contacts", { limit: 40 });
  } catch {
    correspondence = [];
  }
  renderContactGroups();
  const first = filteredContacts()[0] ?? contacts[0] ?? null;
  if (first) openContactCard(first, 0, false);
  else openContactCard(null);
  search?.focus();
}

/** Клавиши книги: ↑/↓ листают, Enter — написать, Ctrl+Enter — правка, Esc — закрыть. */
function contactsKeydown(e: KeyboardEvent): void {
  if (contactsOverlay()?.classList.contains("hidden")) return;
  if (e.key === "Escape") {
    e.preventDefault();
    closeContacts();
    return;
  }
  const inCardForm = Boolean((e.target as HTMLElement | null)?.closest("#contact-form"));
  if (contactEditing && inCardForm) return;
  const fromMail = contactsGroup === "__mail";
  const len = fromMail ? correspondence.length : filteredContacts().length;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (len === 0) return;
    e.preventDefault();
    const step = e.key === "ArrowDown" ? 1 : -1;
    contactsIndex =
      contactsIndex < 0
        ? step > 0
          ? 0
          : len - 1
        : Math.min(len - 1, Math.max(0, contactsIndex + step));
    if (fromMail) {
      const s = correspondence[contactsIndex];
      if (s) showSuggestion(s, contactsIndex);
    } else {
      const c = filteredContacts()[contactsIndex];
      if (c) openContactCard(c, contactsIndex, false);
    }
    document.querySelector("#contacts-list li.selected")?.scrollIntoView({ block: "nearest" });
    return;
  }
  if (e.key !== "Enter") return;
  if (contactEditing) return;
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    if (currentContactId > 0) {
      contactEditing = true;
      renderCard();
      document.getElementById("contact-name")?.focus();
    }
    return;
  }
  const email = fromMail
    ? correspondence[contactsIndex]?.email
    : (filteredContacts()[contactsIndex]?.email ??
      contacts.find((c) => c.id === currentContactId)?.email);
  if (email) writeToEmail(email);
}

/** «+ В книгу» в панели письма: сохранить отправителя. */
async function addCurrentSenderToBook(): Promise<void> {
  if (!currentMessage) return;
  const email = extractAddress(currentMessage.from);
  if (!email.includes("@")) {
    showToast("У отправителя нет адреса");
    return;
  }
  await loadContacts();
  if (contacts.some((c) => c.email.toLowerCase() === email.toLowerCase())) {
    showToast("Уже в книге");
    return;
  }
  const rawName = currentMessage.from.replace(/<[^>]*>/g, "").trim();
  const name = rawName === email ? "" : rawName;
  try {
    await invoke<number>("save_contact", {
      contact: {
        id: 0,
        name,
        email,
        organization: "",
        position: "",
        phone: "",
        notes: "",
        groups: "",
      },
    });
    await loadContacts();
    showToast("Контакт добавлен");
  } catch (e) {
    showToast(`Не сохранилось: ${String(e)}`);
  }
}

function initContacts(): void {
  document.getElementById("contacts-btn")?.addEventListener("click", () => void openContacts());
  document.getElementById("contacts-close")?.addEventListener("click", closeContacts);
  contactsOverlay()?.addEventListener("click", (e) => {
    if (e.target === contactsOverlay()) closeContacts();
  });
  document.getElementById("contact-new")?.addEventListener("click", () => openContactCard(null));
  document.getElementById("contact-save")?.addEventListener("click", () => void saveContact());
  document.getElementById("contact-delete")?.addEventListener("click", () => void deleteContact());
  document.getElementById("contact-ai")?.addEventListener("click", () => void aiFillContact());
  document.getElementById("contact-edit")?.addEventListener("click", () => {
    contactEditing = true;
    renderCard();
    document.getElementById("contact-name")?.focus();
  });
  document.getElementById("contact-write")?.addEventListener("click", () => {
    const c = contacts.find((x) => x.id === currentContactId);
    if (c) writeToEmail(c.email);
  });
  document.getElementById("contact-to-compose")?.addEventListener("click", () => {
    const c = contacts.find((x) => x.id === currentContactId);
    if (c) addToCompose(c.email);
  });
  document
    .getElementById("msg-add-contact")
    ?.addEventListener("click", () => void addCurrentSenderToBook());

  const search = document.getElementById("contacts-search") as HTMLInputElement | null;
  search?.addEventListener("input", () => {
    contactsQuery = search.value;
    contactsIndex = -1;
    renderContacts();
  });

  const fileInput = document.getElementById("contacts-file") as HTMLInputElement | null;
  document.getElementById("contacts-import")?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) void importContactsFile(file);
    fileInput.value = "";
  });

  const exportBtn = document.getElementById("contacts-export");
  exportBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    document.getElementById("contacts-export-menu")?.classList.toggle("hidden");
  });
  document
    .querySelectorAll<HTMLButtonElement>("#contacts-export-menu button[data-export]")
    .forEach((b) => {
      b.addEventListener("click", () => {
        void exportContacts(b.dataset.export ?? "csv");
        document.getElementById("contacts-export-menu")?.classList.add("hidden");
      });
    });
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target?.closest("#contacts-export-menu") && !target?.closest("#contacts-export")) {
      document.getElementById("contacts-export-menu")?.classList.add("hidden");
    }
  });
  document.addEventListener("keydown", contactsKeydown);
}

/* Подсказки адреса в поле «Кому» нового письма. */
function addressFragment(value: string): { prefix: string; frag: string } {
  const cut = Math.max(value.lastIndexOf(","), value.lastIndexOf(";"));
  return { prefix: value.slice(0, cut + 1), frag: value.slice(cut + 1).trim() };
}

function initAddressSuggest(): void {
  const input = document.getElementById("compose-to") as HTMLInputElement | null;
  const box = document.getElementById("compose-to-suggest");
  if (!input || !box) return;
  let items: AddressSuggestion[] = [];
  let active = -1;
  let timer = 0;

  const hide = (): void => {
    box.classList.add("hidden");
    box.innerHTML = "";
    items = [];
    active = -1;
  };

  const apply = (s: AddressSuggestion): void => {
    const cut = Math.max(input.value.lastIndexOf(","), input.value.lastIndexOf(";"));
    const head = cut >= 0 ? `${input.value.slice(0, cut + 1).trimEnd()} ` : "";
    input.value = `${head}${s.email}, `;
    hide();
    input.focus();
  };

  const paint = (): void => {
    box.innerHTML = "";
    items.forEach((s, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = i === active ? "ac-item active" : "ac-item";
      const name = document.createElement("span");
      name.className = "ac-name";
      name.textContent = s.name || s.email;
      const mail = document.createElement("span");
      mail.className = "ac-mail";
      mail.textContent = s.name
        ? s.email
        : s.source === "contact"
          ? "адресная книга"
          : `писем: ${s.count}`;
      b.append(name, mail);
      b.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        apply(s);
      });
      box.appendChild(b);
    });
    box.classList.toggle("hidden", items.length === 0);
  };

  input.addEventListener("input", () => {
    window.clearTimeout(timer);
    const { frag } = addressFragment(input.value);
    if (frag.length < 2) {
      hide();
      return;
    }
    timer = window.setTimeout(() => {
      void (async () => {
        try {
          items = await invoke<AddressSuggestion[]>("suggest_addresses", {
            query: frag,
            limit: 8,
          });
          active = items.length > 0 ? 0 : -1;
          paint();
        } catch {
          hide();
        }
      })();
    }, 150);
  });

  input.addEventListener("keydown", (e) => {
    if (box.classList.contains("hidden")) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      active = Math.min(items.length - 1, active + 1);
      paint();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = Math.max(0, active - 1);
      paint();
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      apply(items[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      hide();
    }
  });

  input.addEventListener("blur", () => {
    window.setTimeout(hide, 160);
  });
}

function initTheme(): void {
  applyTheme(currentTheme(), false);
  document.getElementById("theme-btn")?.addEventListener("click", () => {
    const now = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    applyTheme(now);
  });
  window.matchMedia?.("(prefers-color-scheme: light)").addEventListener?.("change", () => {
    if (!localStorage.getItem(THEME_KEY)) applyTheme(systemTheme(), false);
  });
}

window.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initSortMenu();
  initSettingsUi();
  void loadSettings().then(() => {
    syncOpaqueClass();
    renderSettingsAccounts();
    if (currentMessages.length > 0) renderMessages();
  });
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
  composeSignature?.addEventListener("change", () => {
    applySignature(composeSignature.value || null);
  });
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
  draftBtn?.addEventListener("click", () => void requestDraftReply());
  settingsBtn?.addEventListener("click", () => openSettingsShell("categories"));
  document
    .getElementById("add-account")
    ?.addEventListener("click", () => void openSettings(false, true));
  settingsProvider?.addEventListener("click", (e) => {
    e.stopPropagation();
    settingsProviderMenu?.classList.toggle("hidden");
  });
  settingsProvider?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      settingsProviderMenu?.classList.toggle("hidden");
    }
  });
  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (!t.closest("#settings-provider")) settingsProviderMenu?.classList.add("hidden");
    if (!t.closest("#acct-menu")) closeAcctMenu();
  });
  document.getElementById("settings-cancel")?.addEventListener("click", () => closeSettings());
  document.getElementById("settings-save")?.addEventListener("click", () => void saveMailSettings());
  composeCancel?.addEventListener("click", () => closeCompose(true));
  composeSend?.addEventListener("click", () => void sendCompose());
  document.getElementById("compose-improve")?.addEventListener("click", () => void improveComposeText());
  makeComposeMovable();
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
  const updateSearchClear = (): void => {
    searchClear?.classList.toggle("hidden", !(searchBox?.value ?? ""));
  };
  searchBox?.addEventListener("input", () => {
    updateSearchClear();
    if (searchTimer !== undefined) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      searchQuery = (searchBox?.value ?? "").trim().toLowerCase();
      renderMessages();
    }, 150);
  });
  searchClear?.addEventListener("click", () => {
    if (searchBox) {
      searchBox.value = "";
      searchBox.focus();
    }
    searchQuery = "";
    updateSearchClear();
    renderMessages();
  });
  updateSearchClear();
  imagesBtn?.addEventListener("click", () => {
    if (currentBody?.html && bodyFrame) {
      bodyFrame.srcdoc = wrapHtml(currentBody.html, true);
      imagesBtn.classList.add("hidden");
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (eventOverlay && !eventOverlay.classList.contains("hidden")) {
        closeEventForm();
        e.stopImmediatePropagation();
        return;
      }
      if (settingsOverlay && !settingsOverlay.classList.contains("hidden")) {
        closeSettings();
        e.stopImmediatePropagation();
        return;
      }
      closeCompose();
    }
    if (e.ctrlKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      openCompose();
    }
    if (e.ctrlKey && e.key === "Enter" && !composeOverlay?.classList.contains("hidden")) {
      e.preventDefault();
      void sendCompose();
    }
  });
  calendarBtn?.addEventListener("click", () => {
    if (calendarView?.classList.contains("hidden")) void openCalendar();
    else closeCalendar();
  });
  document.getElementById("cal-today")?.addEventListener("click", () => {
    const now = new Date();
    calCursor = new Date(now.getFullYear(), now.getMonth(), 1);
    calSelectedDay = dayKey(now.getFullYear(), now.getMonth(), now.getDate());
    renderCalendar();
  });
  document.getElementById("cal-prev")?.addEventListener("click", () => {
    calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1);
    renderCalendar();
  });
  document.getElementById("cal-next")?.addEventListener("click", () => {
    calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 1);
    renderCalendar();
  });
  document.getElementById("event-cancel")?.addEventListener("click", () => closeEventForm());
  document.getElementById("event-save")?.addEventListener("click", () => void saveEventForm());
  eventOverlay?.addEventListener("click", (e) => {
    if (e.target === eventOverlay) closeEventForm();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && calendarView && !calendarView.classList.contains("hidden")) {
      closeCalendar();
    }
  });
  initKeyboardNav();
  initGroupMenu();
  initContacts();
  initAddressSuggest();
  initBulkBar();
  initLayout();
  void loadAppInfo();
  void checkBackend();
  void initMail();
});