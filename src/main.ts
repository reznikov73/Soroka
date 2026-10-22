import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { emitTo, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

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
const dFromName = document.querySelector<HTMLElement>("#d-from-name");
const dFromEmail = document.querySelector<HTMLElement>("#d-from-email");
const dSubject = document.querySelector<HTMLElement>("#d-subject");
const dDate = document.querySelector<HTMLElement>("#d-date");
const bodyStatus = document.querySelector<HTMLElement>("#body-status");
const bodyText = document.querySelector<HTMLElement>("#body-text");
const bodyFrame = document.querySelector<HTMLIFrameElement>("#body-frame");
const imagesBtn = document.querySelector<HTMLButtonElement>("#images-btn");
const attachList = document.querySelector<HTMLElement>("#body-attachments");
const replyBtn = document.querySelector<HTMLButtonElement>("#reply-btn");
const replyAllBtn = document.querySelector<HTMLButtonElement>("#reply-all-btn");
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
const toastText = document.querySelector<HTMLElement>("#toast-text");
const toastAction = document.querySelector<HTMLButtonElement>("#toast-action");
const composeBtn = document.querySelector<HTMLButtonElement>("#compose-btn");
const composeOverlay = document.querySelector<HTMLElement>("#compose-overlay");
const composeTo = document.querySelector<HTMLInputElement>("#compose-to");
const composeSubject = document.querySelector<HTMLInputElement>("#compose-subject");
const composeBody = document.querySelector<HTMLDivElement>("#compose-body");
const composeCc = document.querySelector<HTMLInputElement>("#compose-cc");
const composeBcc = document.querySelector<HTMLInputElement>("#compose-bcc");
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
let toastActionFn: (() => void) | null = null;
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

/** Сколько писем на сервере и сколько реально отдал сервер — TASK-034. */
let folderTotals: { total: number; fetched: number } = { total: 0, fetched: 0 };

interface SearchHitDto {
  folder: string;
  uid: number;
  subject: string;
  from: string;
  date: string;
  seen: boolean;
  flagged: boolean;
  has_attachments: boolean;
  in_body?: boolean;
}

type SearchScope = "folder" | "all" | "accounts";
let searchScope: SearchScope = "folder";
let globalHits: { folder: string; hit: SearchHitDto }[] = [];
/** Совпадения в тексте писем текущей папки (TASK-036). */
let bodyHits: SearchHitDto[] = [];
let bodySearchTimer: number | undefined;
/** Перетаскивание письма мышью (TASK-037): HTML5 DnD в WebView2 не срабатывал. */
let rowDrag: { startX: number; startY: number; uids: number[]; active: boolean; ghost: HTMLElement | null } | null =
  null;
let suppressClickUntil = 0;
/** Письмо, для которого открыт инлайн-ответ (TASK-036). */
let inlineReplyUid: number | null = null;
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
/** Подпись конкретного ящика — TASK-030. */
type AccountSignatureData = { account_id: string; text: string; enabled: boolean };
type SignatureVariant = { title: string; text: string };
type AppearanceData = { dense_list: boolean; transparent?: boolean };
type UiSettingsData = { minimize_to_tray: boolean; autostart: boolean };
type SettingsData = {
  categories: CategoryData[];
  prompts: PromptsData;
  signatures: SignatureData[];
  account_signatures: AccountSignatureData[];
  appearance: AppearanceData;
  ui: UiSettingsData;
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
  if (view === "ai") void renderAiSettings();
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

/** Подпись ящика, если её уже сохраняли — TASK-030. */
function storedSignature(accountId: string): AccountSignatureData | null {
  return (settingsData?.account_signatures ?? []).find((s) => s.account_id === accountId) ?? null;
}

/** Старая общая подпись: из неё подставляем текст, пока у ящика нет своей. */
function legacySignatureText(): string {
  const list = settingsData?.signatures ?? [];
  return (list.find((s) => s.is_default) ?? list[0])?.text ?? "";
}

/** Что реально подставляется в письма этого ящика. */
function effectiveSignature(accountId: string): { text: string; enabled: boolean } {
  const own = storedSignature(accountId);
  if (own) return { text: own.text, enabled: own.enabled };
  return { text: legacySignatureText(), enabled: true };
}

function saveAccountSignature(accountId: string, text: string, enabled: boolean): void {
  if (!settingsData) return;
  if (!settingsData.account_signatures) settingsData.account_signatures = [];
  const own = storedSignature(accountId);
  if (own) {
    own.text = text;
    own.enabled = enabled;
    return;
  }
  settingsData.account_signatures.push({ account_id: accountId, text, enabled });
}

function signaturePreview(text: string): string {
  const line = text.split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? "";
  return line || "подписи нет";
}

/** Раздел «Подписи»: список ящиков и то, что в них подставляется. */
function renderSignatures(): void {
  const box = document.getElementById("sig-accounts");
  if (!box) return;
  box.innerHTML = "";
  if (accounts.length === 0) {
    const p = document.createElement("p");
    p.className = "sv-hint";
    p.textContent = "Ящиков пока нет — подпись появится у каждого после настройки.";
    box.append(p);
    return;
  }
  for (const acc of accounts) {
    const sig = effectiveSignature(acc.id);
    const row = document.createElement("div");
    row.className = "sig-acc";
    const mail = document.createElement("span");
    mail.className = "sig-acc-mail";
    mail.textContent = acc.email;
    const preview = document.createElement("span");
    preview.className = "sig-acc-preview";
    preview.textContent = sig.enabled ? signaturePreview(sig.text) : "подпись выключена";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-plain";
    btn.textContent = "Изменить";
    btn.addEventListener("click", () => {
      void openSettings(false, false, acc.id).then(() => {
        document.getElementById("account-signature")?.scrollIntoView({ block: "center" });
        document.getElementById("sig-editor")?.focus();
      });
    });
    row.append(mail, preview, btn);
    box.append(row);
  }
}

function updateSigCount(): void {
  const area = document.getElementById("sig-editor") as HTMLTextAreaElement | null;
  const count = document.getElementById("sig-count");
  if (!area || !count) return;
  count.textContent = `${area.value.length} символов`;
}

/** Заполняет блок подписи в карточке ящика. */
function fillAccountSignature(accountId: string | null): void {
  const block = document.getElementById("account-signature");
  const area = document.getElementById("sig-editor") as HTMLTextAreaElement | null;
  const chk = document.getElementById("sig-enabled") as HTMLInputElement | null;
  document.getElementById("sig-suggest")?.classList.add("hidden");
  if (!block || !area || !chk) return;
  block.classList.toggle("hidden", !accountId);
  if (!accountId) {
    area.value = "";
    chk.checked = true;
    updateSigCount();
    return;
  }
  const sig = effectiveSignature(accountId);
  area.value = sig.text;
  chk.checked = sig.enabled;
  updateSigCount();
}

/** «Сохранить подпись» — только подпись, без перепроверки сервера. */
async function saveSignatureOnly(): Promise<void> {
  const area = document.getElementById("sig-editor") as HTMLTextAreaElement | null;
  const chk = document.getElementById("sig-enabled") as HTMLInputElement | null;
  if (!editingAccountId || !settingsData || !area || !chk) {
    showToast("Сначала сохраните ящик");
    return;
  }
  saveAccountSignature(editingAccountId, area.value.trim(), chk.checked);
  await persistSettings();
  renderSignatures();
  showToast("Подпись ящика сохранена");
}

/** «✨ Улучшить»: три варианта подписи, применяем только по кнопке. */
async function improveSignature(): Promise<void> {
  const area = document.getElementById("sig-editor") as HTMLTextAreaElement | null;
  const box = document.getElementById("sig-suggest");
  const btn = document.getElementById("sig-improve") as HTMLButtonElement | null;
  if (!area || !box) return;
  const text = area.value.trim();
  if (text.length < 3) {
    showToast("Сначала наберите подпись");
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Думаю…";
  }
  try {
    const list = await invoke<SignatureVariant[]>("improve_signature", { text });
    box.innerHTML = "";
    list.slice(0, 3).forEach((v) => {
      const card = document.createElement("div");
      card.className = "sig-card";
      const title = document.createElement("b");
      title.textContent = v.title;
      const body = document.createElement("p");
      body.textContent = v.text;
      const apply = document.createElement("button");
      apply.type = "button";
      apply.className = "btn-primary";
      apply.textContent = "Применить";
      apply.addEventListener("click", () => {
        area.value = v.text;
        updateSigCount();
        box.classList.add("hidden");
      });
      card.append(title, body, apply);
      box.append(card);
    });
    box.classList.toggle("hidden", list.length === 0);
    if (list.length === 0) showToast("ИИ не предложил вариантов");
  } catch (err) {
    showToast(`Не получилось улучшить: ${String(err)}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "✨ Улучшить";
    }
  }
}

function initSignatureEditor(): void {
  const area = document.getElementById("sig-editor") as HTMLTextAreaElement | null;
  area?.addEventListener("input", updateSigCount);
  document
    .querySelectorAll<HTMLButtonElement>("#account-signature button[data-macro]")
    .forEach((b) => {
      b.addEventListener("click", () => {
        if (!area) return;
        const macro = b.dataset.macro ?? "";
        const from = area.selectionStart ?? area.value.length;
        const to = area.selectionEnd ?? from;
        area.value = area.value.slice(0, from) + macro + area.value.slice(to);
        area.focus();
        area.setSelectionRange(from + macro.length, from + macro.length);
        updateSigCount();
      });
    });
  document.getElementById("sig-save")?.addEventListener("click", () => void saveSignatureOnly());
  document.getElementById("sig-improve")?.addEventListener("click", () => void improveSignature());
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


function showToast(
  text: string,
  actionLabel?: string,
  onAction?: () => void,
  ms = 5000,
): void {
  if (!toast) return;
  if (toastText) toastText.textContent = text;
  else toast.textContent = text;
  toastActionFn = null;
  if (toastAction) {
    if (actionLabel && onAction) {
      toastAction.textContent = actionLabel;
      toastAction.classList.remove("hidden");
      toastActionFn = onAction;
    } else {
      toastAction.textContent = "";
      toastAction.classList.add("hidden");
    }
  }
  toast.classList.toggle("actionable", toastActionFn !== null);
  toast.title = toastActionFn !== null ? "Нажмите, чтобы отменить действие" : "";
  toast.classList.remove("hidden");
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.classList.add("hidden");
    toast.classList.remove("actionable");
    toastActionFn = null;
  }, ms);
}

/** Кнопка «Отменить» в тосте. */
function initToastAction(): void {
  const run = (): void => {
    const fn = toastActionFn;
    if (!fn) return;
    toastActionFn = null;
    toast?.classList.add("hidden");
    toast?.classList.remove("actionable");
    if (toastTimer !== undefined) window.clearTimeout(toastTimer);
    fn();
  };
  toastAction?.addEventListener("click", (e) => {
    e.stopPropagation();
    run();
  });
  // Крупная цель: отменить можно кликом по всему тосту.
  toast?.addEventListener("click", run);
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
    document.getElementById("quote-wrap")?.classList.add("hidden");
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

/** Делит текст на «до цитаты» и цитату (TASK-042). */
function splitQuoted(text: string): { main: string; quote: string; lines: number } {
  const markerText = "--- Исходное письмо ---";
  const marker = text.indexOf(markerText);
  if (marker >= 0) {
    const quote = text.slice(marker);
    return {
      main: text.slice(0, marker).trimEnd(),
      quote,
      lines: quote.split(/\r?\n/).filter((l) => l.trim()).length,
    };
  }
  const lines = text.split("\n");
  const qi = lines.findIndex((l) => l.trimStart().startsWith(">"));
  if (qi > 2) {
    const quote = lines.slice(qi).join("\n");
    return { main: lines.slice(0, qi).join("\n"), quote, lines: quote.split("\n").length };
  }
  return { main: text, quote: "", lines: 0 };
}

function collapseQuotedHtml(html: string): { html: string; lines: number } | null {
  const marker = "--- Исходное письмо ---";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let node: Text | null = null;
  while (walker.nextNode()) {
    const t = walker.currentNode as Text;
    if (t.data.includes(marker)) {
      node = t;
      break;
    }
  }
  if (!node) return null;
  let block: HTMLElement | null = node.parentElement;
  while (block && block !== doc.body && !/^(DIV|P|BLOCKQUOTE|SECTION|TD)$/.test(block.tagName)) {
    block = block.parentElement;
  }
  if (!block || block === doc.body) return null;
  const details = doc.createElement("details");
  details.className = "quote";
  const summary = doc.createElement("summary");
  const frag = doc.createDocumentFragment();
  let el: Element | null = block;
  while (el) {
    const next: Element | null = el.nextElementSibling;
    frag.appendChild(el);
    el = next;
  }
  const text = frag.textContent ?? "";
  const blocks = frag.querySelectorAll("div,p,li,tr,br").length;
  const lines = Math.max(1, blocks || text.split(/\r?\n/).filter((l) => l.trim()).length);
  summary.textContent = `Показать цитату · ${pluralStrok(lines)}`;
  details.append(summary, frag);
  doc.body.appendChild(details);
  return { html: doc.body.innerHTML, lines };
}

function renderBody(res: BodyPayload): void {
  renderAttachments(res);
  if (res.html && bodyFrame) {
    if (bodyStatus) bodyStatus.textContent = res.from_cache ? "Из кэша." : "";
    const cq = collapseQuotedHtml(res.html);
    bodyFrame.srcdoc = wrapHtml(cq ? cq.html : res.html, false);
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
    const parts = splitQuoted(res.text);
    bodyText.textContent = parts.main;
    bodyText.classList.remove("hidden");
    if (bodyFrame) bodyFrame.classList.add("hidden");
    imagesBtn?.classList.add("hidden");
    const wrap = document.getElementById("quote-wrap");
    const toggle = document.getElementById("quote-toggle");
    const quote = document.getElementById("quote-text");
    if (wrap && toggle && quote) {
      wrap.classList.toggle("hidden", !parts.quote);
      if (parts.quote) {
        quote.textContent = parts.quote;
        quote.classList.add("hidden");
        toggle.dataset.lines = String(parts.lines);
        toggle.textContent = `Показать цитату · ${parts.lines} строк`;
      }
    }
    return;
  }
  imagesBtn?.classList.add("hidden");
  if (bodyStatus) bodyStatus.textContent = "В письме нет текста (возможно, только вложения).";
}

const savedAttachments = new Map<string, string>();

const PAPERCLIP_SVG =
  '<svg class="clip-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.8 5.2 6.2 9.8a1.6 1.6 0 0 0 2.3 2.3l5-5a3.2 3.2 0 0 0-4.6-4.6l-5.3 5.3a4.8 4.8 0 0 0 6.8 6.8l4.4-4.4"/></svg>';

function attachmentKey(uid: number, a: AttachmentInfo): string {
  return `${uid}:${a.index}`;
}

function attachNameEl(a: AttachmentInfo): HTMLElement {
  const el = document.createElement("span");
  el.className = "name";
  el.textContent = a.name;
  el.title = a.name;
  return el;
}

function attachSizeEl(a: AttachmentInfo): HTMLElement {
  const el = document.createElement("span");
  el.className = "size";
  el.textContent = formatSize(a.size);
  return el;
}

function attachActions(uid: number, a: AttachmentInfo): HTMLElement {
  const acts = document.createElement("span");
  acts.className = "acts";
  const dl = document.createElement("button");
  dl.type = "button";
  dl.title = "Сохранить в «Загрузки»";
  dl.textContent = "↓";
  dl.addEventListener("click", (e) => {
    e.stopPropagation();
    void saveAttachment(uid, a, dl.closest<HTMLElement>(".attach-chip, .attach-card"));
  });
  const more = document.createElement("button");
  more.type = "button";
  more.title = "Ещё";
  more.textContent = "⋯";
  more.addEventListener("click", (e) => {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openAttachMenu(r.left, r.bottom + 4, uid, a);
  });
  acts.append(dl, more);
  return acts;
}

function renderAttachments(res: BodyPayload | null): void {
  if (!attachList) return;
  attachList.innerHTML = "";
  const items = res?.attachments ?? [];
  attachList.classList.toggle("hidden", items.length === 0);
  if (!res || items.length === 0) return;

  const total = items.reduce((sum, a) => sum + a.size, 0);
  const head = document.createElement("div");
  head.className = "attach-head";
  const caption = document.createElement("span");
  caption.textContent = `Вложения · ${items.length} · ${formatSize(total)}`;
  head.append(caption);
  if (items.length > 1) {
    const spacer = document.createElement("span");
    spacer.className = "sp";
    const all = document.createElement("button");
    all.type = "button";
    all.className = "attach-all";
    all.textContent = "Сохранить все";
    all.title = "Сохранить все вложения в «Загрузки»";
    all.addEventListener("click", () => void saveAllAttachments(res.uid));
    head.append(spacer, all);
  }
  attachList.appendChild(head);

  const previewable = items.filter((a) => (a.mime || "").startsWith("image/")).slice(0, 3);
  for (const a of items) {
    attachList.appendChild(
      previewable.includes(a) ? attachmentCard(res.uid, a) : attachmentChip(res.uid, a),
    );
  }
}

function attachmentChip(uid: number, a: AttachmentInfo): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "attach-chip";
  chip.title = `${a.name} — ${formatSize(a.size)}`;
  chip.innerHTML = PAPERCLIP_SVG;
  chip.append(attachNameEl(a), attachSizeEl(a), attachActions(uid, a));
  chip.addEventListener("click", () => void openAttachment(uid, a, chip));
  chip.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openAttachMenu(e.clientX, e.clientY, uid, a);
  });
  return chip;
}

function attachmentCard(uid: number, a: AttachmentInfo): HTMLElement {
  const card = document.createElement("div");
  card.className = "attach-card";
  card.title = `${a.name} — ${formatSize(a.size)}`;
  const thumb = document.createElement("div");
  thumb.className = "thumb";
  const img = document.createElement("img");
  img.alt = a.name;
  thumb.appendChild(img);
  const body = document.createElement("div");
  body.className = "body";
  body.append(attachNameEl(a), attachSizeEl(a), attachActions(uid, a));
  card.append(thumb, body);
  card.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openAttachMenu(e.clientX, e.clientY, uid, a);
  });
  void loadAttachmentThumb(uid, a, img);
  return card;
}

async function loadAttachmentThumb(
  uid: number,
  a: AttachmentInfo,
  img: HTMLImageElement,
): Promise<void> {
  try {
    const url = await invoke<string>("attachment_preview", {
      folder: currentFolder,
      uid,
      index: a.index,
    });
    img.src = url;
  } catch {
    const fallback = document.createElement("span");
    fallback.className = "size";
    fallback.textContent = "картинка";
    img.replaceWith(fallback);
  }
}

/** Меню вложения: открыть, сохранить, скопировать имя, показать в папке. */
function openAttachMenu(x: number, y: number, uid: number, a: AttachmentInfo): void {
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
  const count = currentBody?.attachments?.length ?? 1;
  add("Открыть", () => void openAttachment(uid, a));
  add("Сохранить в «Загрузки»", () => void saveAttachment(uid, a));
  add("Копировать имя файла", () => void copyAttachmentName(a));
  add("Показать в папке", () => void revealAttachment(uid, a));
  if (count > 1) add(`Сохранить все (${count})`, () => void saveAllAttachments(uid));
  menu.classList.remove("hidden");
  menu.style.left = `${Math.min(x, window.innerWidth - 240)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 220)}px`;
  menu.querySelector<HTMLButtonElement>("button")?.focus();
}

async function copyAttachmentName(a: AttachmentInfo): Promise<void> {
  try {
    await navigator.clipboard.writeText(a.name);
    showToast("Имя файла скопировано");
  } catch {
    showToast(`Имя файла: ${a.name}`);
  }
}

/** Вставляет текст, подчёркивая совпадения с поисковым запросом. */
function fillHighlighted(el: HTMLElement, text: string, query: string): void {
  el.textContent = "";
  const q = query.trim().toLowerCase();
  if (!q) {
    el.textContent = text;
    return;
  }
  const low = text.toLowerCase();
  let done = 0;
  while (done < text.length) {
    const at = low.indexOf(q, done);
    if (at < 0) break;
    if (at > done) el.append(text.slice(done, at));
    const mark = document.createElement("mark");
    mark.className = "search-hit";
    mark.textContent = text.slice(at, at + q.length);
    el.append(mark);
    done = at + q.length;
  }
  if (done < text.length) el.append(text.slice(done));
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

async function saveAttachment(
  uid: number,
  a: AttachmentInfo,
  chip?: HTMLElement | null,
): Promise<string | null> {
  chip?.classList.add("saving");
  if (bodyStatus) bodyStatus.textContent = `Сохраняем «${a.name}»…`;
  try {
    const path = await invoke<string>("save_attachment", {
      folder: currentFolder,
      uid,
      index: a.index,
    });
    savedAttachments.set(attachmentKey(uid, a), path);
    chip?.classList.remove("saving");
    chip?.classList.add("saved");
    window.setTimeout(() => chip?.classList.remove("saved"), 2000);
    showToast(`Сохранено: ${a.name}`);
    if (bodyStatus) bodyStatus.textContent = "";
    return path;
  } catch (err) {
    chip?.classList.remove("saving");
    showToast(`Не удалось сохранить вложение: ${String(err)}`);
    if (bodyStatus) bodyStatus.textContent = "";
    return null;
  }
}

async function saveAllAttachments(uid: number): Promise<void> {
  if (bodyStatus) bodyStatus.textContent = "Сохраняем все вложения…";
  try {
    const paths = await invoke<string[]>("save_all_attachments", {
      folder: currentFolder,
      uid,
    });
    showToast(`Сохранено файлов: ${paths.length}`);
    if (bodyStatus) bodyStatus.textContent = "";
  } catch (err) {
    showToast(`Не удалось сохранить вложения: ${String(err)}`);
    if (bodyStatus) bodyStatus.textContent = "";
  }
}

/** Открывает вложение: при необходимости сначала сохраняет его. */
async function openAttachment(
  uid: number,
  a: AttachmentInfo,
  chip?: HTMLElement | null,
): Promise<void> {
  const key = attachmentKey(uid, a);
  let path = savedAttachments.get(key) ?? null;
  if (!path) path = await saveAttachment(uid, a, chip);
  if (!path) return;
  try {
    await invoke("open_path", { path });
  } catch (err) {
    showToast(`Не открыть файл: ${String(err)}`);
  }
}

/** Показывает файл в Проводнике (с предварительным сохранением). */
async function revealAttachment(uid: number, a: AttachmentInfo): Promise<void> {
  const key = attachmentKey(uid, a);
  let path = savedAttachments.get(key) ?? null;
  if (!path) path = await saveAttachment(uid, a);
  if (!path) return;
  try {
    await invoke("reveal_path", { path });
  } catch (err) {
    showToast(`Не показать файл: ${String(err)}`);
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
  el.style.background = `${badge.color}1f`;
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

/** Ответ всем: отправитель + все адреса из To и Cc, кроме собственного (TASK-036). */
async function replyAll(): Promise<void> {
  if (!currentMessage) return;
  const self = (accounts.find((a) => a.id === activeAccountId)?.email ?? "").toLowerCase();
  const to: string[] = [];
  const push = (addr: string): void => {
    const e = addr.trim().toLowerCase();
    if (!e.includes("@") || e === self || to.includes(e)) return;
    to.push(e);
  };
  push(extractAddress(currentMessage.from));
  try {
    const [origTo, origCc] = await invoke<[string, string]>("message_recipients", {
      folder: currentFolder,
      uid: currentMessage.uid,
    });
    for (const addr of `${origTo}, ${origCc}`.split(",")) push(addr);
  } catch (err) {
    console.warn("recipients", err);
  }
  openCompose({
    title: "Ответ всем",
    to: to.join(", "),
    subject: prefixedSubject(currentMessage.subject, "Re"),
    body: quotedOriginal(),
  });
}

/** Отложенный перенос в спам: 7 секунд на «Отменить» (TASK-036). */
let pendingSpam: { folder: string; uid: number; timer: number } | null = null;

function requestSpam(m: MessageHeader): void {
  if (pendingSpam) {
    const prev = pendingSpam;
    window.clearTimeout(prev.timer);
    pendingSpam = null;
    void commitSpam(prev.folder, prev.uid, false);
  }
  const folder = currentFolder;
  document
    .querySelector<HTMLElement>(`#messages li.m-row[data-uid="${m.uid}"]`)
    ?.classList.add("pending-spam");
  if (currentMessage?.uid === m.uid) clearReadingPane();
  const timer = window.setTimeout(() => void commitSpam(folder, m.uid, true), 7000);
  pendingSpam = { folder, uid: m.uid, timer };
  showToast("Письмо уйдёт в «Спам»", "Отменить", () => undoSpam(), 7000);
}

function undoSpam(): void {
  if (!pendingSpam) return;
  window.clearTimeout(pendingSpam.timer);
  pendingSpam = null;
  document
    .querySelectorAll<HTMLElement>("#messages li.m-row.pending-spam")
    .forEach((li) => li.classList.remove("pending-spam"));
  renderMessages();
  showToast("Оставлено на месте");
}

async function commitSpam(folder: string, uid: number, notify: boolean): Promise<void> {
  pendingSpam = null;
  const m = currentMessages.find((x) => x.uid === uid);
  if (!m) return;
  try {
    const spamFolder = await invoke<string>("move_to_spam", {
      folder,
      uid,
      domain: extractDomain(m.from),
    });
    if (folder === currentFolder) {
      currentMessages = currentMessages.filter((x) => x.uid !== uid);
      if (currentMessage?.uid === uid) clearReadingPane();
      renderMessages();
    }
    await refreshUnread();
    if (notify) showToast(`Письмо перенесено в «${spamFolder || "Спам"}»`);
  } catch (err) {
    showToast(`Не удалось перенести: ${String(err)}`);
    renderMessages();
  }
}

/** Папка под курсором — цель перетаскивания (TASK-037). */
function folderElementAt(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  return el?.closest<HTMLElement>("#folder-list li.folder[data-folder]") ?? null;
}

function highlightDropFolder(x: number, y: number): void {
  const target = folderElementAt(x, y);
  document.querySelectorAll<HTMLElement>("#folder-list li.folder.drop-target").forEach((el) => {
    if (el !== target) el.classList.remove("drop-target");
  });
  if (target) target.classList.add("drop-target");
}

/** Начало перетаскивания строки письма (TASK-037). */
function initRowDrag(li: HTMLLIElement, m: MessageHeader): void {
  li.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (
      (e.target as HTMLElement).closest("button, input, textarea, select, .inline-reply, .m-actions")
    ) {
      return;
    }
    const uids = selectedUids.size > 0 && selectedUids.has(m.uid) ? [...selectedUids] : [m.uid];
    rowDrag = { startX: e.clientX, startY: e.clientY, uids, active: false, ghost: null };
  });
}

function initRowDragHandlers(): void {
  document.addEventListener("mousemove", (e) => {
    if (!rowDrag) return;
    if (!rowDrag.active) {
      const dx = e.clientX - rowDrag.startX;
      const dy = e.clientY - rowDrag.startY;
      if (Math.hypot(dx, dy) < 7) return;
      rowDrag.active = true;
      const ghost = document.createElement("div");
      ghost.className = "drag-ghost";
      ghost.textContent =
        rowDrag.uids.length > 1 ? `Писем: ${rowDrag.uids.length}` : "Перенести в папку";
      document.body.appendChild(ghost);
      rowDrag.ghost = ghost;
      document.body.classList.add("dragging-mail");
    }
    if (rowDrag.ghost) {
      rowDrag.ghost.style.left = `${e.clientX + 12}px`;
      rowDrag.ghost.style.top = `${e.clientY + 10}px`;
    }
    highlightDropFolder(e.clientX, e.clientY);
  });
  document.addEventListener("mouseup", (e) => {
    const drag = rowDrag;
    rowDrag = null;
    if (!drag?.active) return;
    drag.ghost?.remove();
    document.body.classList.remove("dragging-mail");
    document
      .querySelectorAll<HTMLElement>("#folder-list li.folder.drop-target")
      .forEach((el) => el.classList.remove("drop-target"));
    suppressClickUntil = Date.now() + 400;
    const folder = folderElementAt(e.clientX, e.clientY);
    if (folder?.dataset.folder) void moveToFolder(folder.dataset.folder, drag.uids);
  });
}

/** Перенос писем в папку (перетаскивание) — TASK-036. */
async function moveToFolder(target: string, uids: number[]): Promise<void> {
  if (!target || target === currentFolder || uids.length === 0) return;
  try {
    const n = await invoke<number>("move_messages", {
      folder: currentFolder,
      uids,
      target,
    });
    currentMessages = currentMessages.filter((m) => !uids.includes(m.uid));
    if (currentMessage && uids.includes(currentMessage.uid)) clearReadingPane();
    clearMulti();
    renderMessages();
    await refreshUnread();
    showToast(`Перенесено в «${folderDisplay(splitFolderKey(target).name)}»: ${n}`);
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
    "details.quote { margin-top: 14px; }",
    "details.quote > summary { cursor: pointer; color: #2f6fd8; font-size: 13px; padding: 6px 0; }",
    "details.quote[open] > summary { margin-bottom: 6px; }",
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

/**
 * Псевдонимы папок (TASK-035).
 * Mail.ru, Яндекс, Gmail и Outlook отдают по IMAP английские имена системных
 * и «умных» папок, а в веб-интерфейсе показывают русские. Повторяем это.
 */
const FOLDER_ALIASES: Record<string, string> = {
  inbox: "Входящие",
  sent: "Отправленные",
  "sent items": "Отправленные",
  "sent mail": "Отправленные",
  "sent messages": "Отправленные",
  drafts: "Черновики",
  draft: "Черновики",
  trash: "Удалённые",
  "deleted items": "Удалённые",
  "deleted messages": "Удалённые",
  spam: "Спам",
  junk: "Спам",
  "junk email": "Спам",
  "junk e-mail": "Спам",
  outbox: "Исходящие",
  archive: "Архив",
  archives: "Архив",
  template: "Шаблоны",
  templates: "Шаблоны",
  newsletters: "Рассылки",
  "public services": "Публичные сервисы",
  receipts: "Чеки",
  social: "Социальные сети",
  tomyself: "Письма себе",
  important: "Важное",
  starred: "Помеченные",
  "all mail": "Вся почта",
  notes: "Заметки",
};

/** Значок папки по её имени. */
const FOLDER_SVG: Record<string, string> = {
  inbox: '<rect x="1.8" y="3" width="12.4" height="10" rx="1.6"/><path d="M2.2 4.2 8 8.5l5.8-4.3"/>',
  sent: '<path d="M14 2 2 7l4.2 1.9L8 14l6-12Z"/><path d="M6.2 8.9 14 2"/>',
  trash: '<path d="M2.6 4.2h10.8M6 4.2V2.7h4v1.5M4.2 4.2l.7 9.1h6.2l.7-9.1"/>',
  spam: '<circle cx="8" cy="8" r="5.6"/><path d="M4.2 4.2l7.6 7.6"/>',
  drafts: '<path d="M4 1.9h5.4L12.8 5v9.1H4z"/><path d="M9.2 2v3.2h3.4M6 8.4h4.6M6 10.8h4.6"/>',
  archive: '<rect x="2.2" y="3" width="11.6" height="3" rx="1"/><path d="M3.2 6v7.1h9.6V6M6.4 8.6h3.2"/>',
  news: '<rect x="2" y="3.2" width="12" height="9.6" rx="1"/><path d="M4.4 6h3.2M4.4 8.2h3.2M4.4 10.4h3.2M9.6 6h2M9.6 8.2h2"/>',
  folder: '<path d="M1.9 4.4h4l1.3 1.6h6.9v6.6H1.9z"/>',
};

function folderIcon(name: string): string {
  const l = folderDisplay(name).toLowerCase();
  let key = "folder";
  if (l.startsWith("входящ")) key = "inbox";
  else if (l.startsWith("отправл") || l.startsWith("исходящ")) key = "sent";
  else if (l.startsWith("удал") || l.startsWith("корзин")) key = "trash";
  else if (l.startsWith("спам")) key = "spam";
  else if (l.startsWith("черновик")) key = "drafts";
  else if (l.startsWith("архив")) key = "archive";
  else if (l.startsWith("рассылк")) key = "news";
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${FOLDER_SVG[key]}</svg>`;
}

/** Подпись папки для человека: INBOX -> «Входящие», Drafts -> «Черновики». */
function folderDisplay(name: string): string {
  const alias = FOLDER_ALIASES[name.trim().toLowerCase()];
  return alias ?? name;
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
/** Раскрытые ящики в панели папок (TASK-046). */
const EXPANDED_KEY = "soroka.expandedAccounts.v2";
let expansionsSaved = localStorage.getItem(EXPANDED_KEY) !== null;
const expandedAccounts = new Set<string>(
  (() => {
    try {
      return JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "[]") as string[];
    } catch {
      return [];
    }
  })(),
);

function saveExpandedAccounts(): void {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expandedAccounts]));
    expansionsSaved = true;
  } catch {
    /* приватный режим */
  }
}

/** Сумма непрочитанных по папкам ящика. */
function sumUnread(accountId: string): number {
  let sum = 0;
  for (const f of lastFolders) {
    if (f.name.startsWith(`${accountId}::`)) sum += unreadByFolder.get(f.name) ?? 0;
  }
  return sum;
}

/** Сумма всех писем по папкам ящика (TASK-035). */
function sumTotal(accountId: string): number {
  let sum = 0;
  for (const f of lastFolders) {
    if (f.name.startsWith(`${accountId}::`)) sum += totalsByFolder.get(f.name) ?? 0;
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

/** Автопроверка ящиков по их интервалу (TASK-037). */
const accountTimers = new Map<string, number>();

function stopAccountTimers(): void {
  for (const timer of accountTimers.values()) window.clearInterval(timer);
  accountTimers.clear();
}

function restartAccountTimers(): void {
  stopAccountTimers();
  for (const a of accounts) {
    const sec = Math.max(0, a.check_interval_sec ?? 0);
    if (sec < 15) continue;
    accountTimers.set(
      a.id,
      window.setInterval(() => void autoCheckAccount(a.id), sec * 1000),
    );
    // Разносим первый запуск по времени, чтобы не бить по всем серверам сразу.
    window.setTimeout(() => {
      if (accountTimers.has(a.id)) void autoCheckAccount(a.id);
    }, 3_000 + Math.random() * 7_000);
  }
}

async function autoCheckAccount(id: string): Promise<void> {
  try {
    const res = await invoke<SyncPayload>("sync_inbox", { accountId: id });
    if (id === activeAccountId) {
      await refreshMail();
      if (statusMail) statusMail.textContent = `почта: писем ${res.total}`;
    }
    await refreshUnread();
  } catch (err) {
    console.warn("автопроверка", id, err);
  }
}

/** Чистит корзины ящиков, где включена опция (TASK-037). */
async function emptyTrashOnExit(): Promise<void> {
  for (const a of accounts) {
    if (!a.empty_trash_on_exit) continue;
    try {
      await invoke<number>("empty_trash_account", { accountId: a.id });
    } catch (err) {
      console.warn("очистка корзины при выходе", a.id, err);
    }
  }
}

/** Перечитывает список папок с сервера и убирает удалённые (TASK-035). */
async function refreshFolders(accountId: string): Promise<void> {
  if (!accountId) return;
  try {
    const folders = await invoke<FolderInfo[]>("refresh_folders", { accountId });
    renderFolders(folders);
  } catch (err) {
    console.warn("refresh_folders", err);
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

/** Заголовок окна: «(3) Сорока» — видно новые письма, не разворачивая окно (TASK-035). */
let lastWindowTitle = "";
function updateWindowTitle(): void {
  let unread = 0;
  for (const a of accounts) unread += sumUnread(a.id);
  const title = unread > 0 ? `(${unread}) POS Mail` : "POS Mail";
  const badge = document.getElementById("tb-unread");
  if (badge) {
    badge.textContent = unread > 0 ? String(unread) : "";
    badge.classList.toggle("hidden", unread === 0);
    badge.title = `Непрочитанных писем: ${unread}`;
  }
  document.body.classList.toggle("has-unread", unread > 0);
  if (title === lastWindowTitle) return;
  lastWindowTitle = title;
  void getCurrentWindow()
    .setTitle(title)
    .catch(() => {
      /* окно ещё не готово */
    });
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
  expandedAccounts.add(id);
  saveExpandedAccounts();
  currentFolder = folderKeyOf(id, "INBOX");
  currentMessages = [];
  currentBody = null;
  currentMessage = null;
  renderMessages();
  // TASK-031: дерево переключаем сразу по кэшу — иначе кажется, что клик не сработал,
  // пока идёт синхронизация ящика.
  renderFolders(lastFolders);
  try {
    renderFolders(await invoke<FolderInfo[]>("get_folders"));
  } catch {
    /* папки придут после синхронизации */
  }
  void refreshFolders(id);
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
  const { accountId } = splitFolderKey(name);
  if (accountId && accountId !== activeAccountId) {
    activeAccountId = accountId;
    expandedAccounts.add(accountId);
    saveExpandedAccounts();
    renderFolders(lastFolders);
  }
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
    folderTotals = { total: cached.total, fetched: cached.messages.length };
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
    folderTotals = { total: res.total, fetched: res.fetched };
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

/** Добавляет файлы к письму: кнопка «Прикрепить», drag&drop, вставка из буфера. */
async function addComposeFiles(files: File[]): Promise<void> {
  if (files.length === 0) return;
  const maxFile = 15 * 1024 * 1024;
  const maxTotal = 20 * 1024 * 1024;
  for (const file of files) {
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
        name: file.name || `вставка-${composeAttachments.length + 1}.png`,
        mime: file.type || "application/octet-stream",
        dataB64: b64,
        size: file.size,
      });
    } catch (err) {
      showToast(`Не прочитать «${file.name}»: ${String(err)}`);
    }
  }
  renderComposeAttachments();
}

async function onFilesPicked(): Promise<void> {
  if (!composeFiles?.files) return;
  await addComposeFiles(Array.from(composeFiles.files));
  composeFiles.value = "";
}

/** Перетаскивание файлов в окно письма и Ctrl+V с картинкой из буфера — TASK-033. */
function initComposeDrop(): void {
  const overlay = document.getElementById("compose-overlay");
  const dropHint = document.getElementById("compose-drop");
  if (!overlay) return;
  const hasFiles = (e: DragEvent): boolean =>
    Array.from(e.dataTransfer?.types ?? []).includes("Files");
  let depth = 0;

  overlay.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth += 1;
    dropHint?.classList.remove("hidden");
  });
  overlay.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });
  overlay.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) dropHint?.classList.add("hidden");
  });
  overlay.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    dropHint?.classList.add("hidden");
    void addComposeFiles(Array.from(e.dataTransfer?.files ?? []));
  });
  composeBody?.addEventListener("paste", (e) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length === 0) return;
    e.preventDefault();
    void addComposeFiles(files);
  });
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
/** Подпись текущего ящика: своя, иначе — старая общая (TASK-030). */
function defaultSignature(): SignatureData | null {
  const id = activeAccountId ?? accounts[0]?.id ?? "";
  const sig = id ? effectiveSignature(id) : { text: legacySignatureText(), enabled: true };
  if (!sig.enabled || !sig.text.trim()) return null;
  return { name: "account", text: sig.text, is_default: true };
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

function fillSignatureSelect(selected: string | null): void {
  if (!composeSignature) return;
  composeSignature.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "Без подписи";
  composeSignature.appendChild(none);
  const sig = defaultSignature();
  if (sig) {
    const o = document.createElement("option");
    o.value = "account";
    o.textContent = "Подпись ящика";
    composeSignature.appendChild(o);
  }
  composeSignature.value = sig && selected ? "account" : "";
}

/** Экранирование текста в HTML (TASK-042). */
function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Текст письма из редактора. */
function composeText(): string {
  return (composeBody?.innerText ?? "").replace(/\u00a0/g, " ");
}

/** HTML письма из редактора. */
function composeHtml(): string {
  return composeBody?.innerHTML ?? "";
}

/** Ставит простой текст, сохраняя переводы строк. */
function setComposeText(text: string): void {
  if (!composeBody) return;
  composeBody.innerHTML = text
    .split("\n")
    .map((line) => (line ? `<div>${escapeHtmlText(line)}</div>` : "<div><br></div>"))
    .join("");
}

function setComposeHtml(html: string): void {
  if (composeBody) composeBody.innerHTML = html;
}

/** Вставляет выбранную подпись в конец письма (с учётом %Cursor). */
function applySignature(name: string | null): void {
  if (!composeBody) return;
  const norm = (value: string): string =>
    value.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\s+$/, "");
  let base = composeText();
  if (activeSignatureBlock) {
    const nb = norm(base);
    const bb = norm(activeSignatureBlock);
    if (nb.endsWith(bb)) {
      base = nb.slice(0, nb.length - bb.length).replace(/\s+$/, "");
    }
  }
  activeSignatureBlock = "";
  if (!name) {
    setComposeText(base);
    return;
  }
  let signatureText = "";
  if (name === "account") {
    const id = activeAccountId ?? accounts[0]?.id ?? "";
    signatureText = id ? effectiveSignature(id).text : legacySignatureText();
  } else if (name) {
    signatureText = (settingsData?.signatures ?? []).find((s) => s.name === name)?.text ?? "";
  }
  if (!signatureText.trim()) {
    setComposeText(base);
    return;
  }
  const macros = composeMacros(composeTo?.value ?? "", composeSubject?.value ?? "");
  const block = expandMacros(signatureText, macros).replace("%Cursor", "");
  activeSignatureBlock = block;
  const sep = base.trim().length > 0 ? "\n\n" : "";
  setComposeText(`${base.replace(/\s+$/, "")}${sep}${block}`);
  if (composeBody) {
    const range = document.createRange();
    range.selectNodeContents(composeBody);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
}

function openCompose(prefill?: {
  title?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  body?: string;
  bodyHtml?: string;
  draft?: DraftData;
}): void {
  resetComposeFrame();
  editingDraft = prefill?.draft ?? null;
  currentDraftId = editingDraft?.id ?? newDraftId();
  lastDraftPayload = "";
  if (composeSaved) composeSaved.textContent = "";
  if (composeTitle) composeTitle.textContent = prefill?.title ?? "Новое письмо";
  if (composeTo) composeTo.value = prefill?.to ?? "";
  if (composeCc) composeCc.value = prefill?.cc ?? "";
  if (composeBcc) composeBcc.value = prefill?.bcc ?? "";
  if (composeSubject) composeSubject.value = prefill?.subject ?? "";
  if (prefill?.bodyHtml) setComposeHtml(prefill.bodyHtml);
  else if ((prefill?.body ?? "").includes("<")) setComposeHtml(prefill?.body ?? "");
  else setComposeText(prefill?.body ?? "");
  activeSignatureBlock = "";
  const sig = prefill?.draft ? null : defaultSignature();
  fillSignatureSelect(sig ? "account" : null);
  if (!prefill?.draft && !prefill?.bodyHtml) applySignature(sig ? "account" : null);
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
  const body = composeHtml();
  if (!to && !subject && !composeText().trim()) return;
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
        files: composeAttachments.map((a) => ({ name: a.name, mime: a.mime, dataB64: a.dataB64, size: a.size })),
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

type PendingPayload = {
  accountId: string | null;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  text: string;
  html: string;
  files: { name: string; mime: string; dataB64: string; size: number }[];
  draftId: string | null;
};

let pendingSend: { payload: PendingPayload; timer: number } | null = null;

/** Очередь отправки: 7 секунд на отмену (TASK-042). */
function queueSend(payload: PendingPayload): void {
  if (pendingSend) void flushSend();
  const timer = window.setTimeout(() => void flushSend(), 7000);
  pendingSend = { payload, timer };
  showToast("Письмо отправлено", "Отменить", () => cancelSend(), 7000);
}

async function flushSend(): Promise<void> {
  const pending = pendingSend;
  if (!pending) return;
  pendingSend = null;
  window.clearTimeout(pending.timer);
  const p = pending.payload;
  try {
    await invoke("send_mail", {
      accountId: p.accountId,
      to: p.to,
      cc: p.cc || null,
      bcc: p.bcc || null,
      subject: p.subject,
      body: p.text,
      html: p.html || null,
      files: p.files,
    });
    if (p.draftId) {
      try {
        await invoke("delete_draft", { accountId: p.accountId, id: p.draftId });
      } catch (err) {
        console.warn("черновик не удалился", err);
      }
    }
    showToast(`Письмо улетело: ${p.to}`);
  } catch (err) {
    showToast(`Не удалось отправить: ${String(err)}`);
    openCompose({
      title: "Письмо",
      to: p.to,
      cc: p.cc,
      bcc: p.bcc,
      subject: p.subject,
      bodyHtml: p.html,
    });
    composeAttachments = p.files;
    renderComposeAttachments();
  }
}

function cancelSend(): void {
  const pending = pendingSend;
  if (!pending) return;
  pendingSend = null;
  window.clearTimeout(pending.timer);
  const p = pending.payload;
  openCompose({
    title: "Письмо",
    to: p.to,
    cc: p.cc,
    bcc: p.bcc,
    subject: p.subject,
    bodyHtml: p.html,
  });
  composeAttachments = p.files;
  renderComposeAttachments();
  showToast("Отправка отменена — письмо вернулось в редактор");
}

async function sendCompose(): Promise<void> {
  const to = normalizeRecipients(composeTo?.value ?? "");
  if (composeTo && composeTo.value !== to) composeTo.value = to;
  const cc = normalizeRecipients(composeCc?.value ?? "");
  const bcc = normalizeRecipients(composeBcc?.value ?? "");
  const subject = composeSubject?.value.trim() ?? "";
  const text = composeText();
  const html = composeHtml();
  if (!to || !to.includes("@")) {
    showToast("Укажите адрес получателя — например: friend@mail.ru");
    composeTo?.focus();
    return;
  }
  const payload: PendingPayload = {
    accountId: activeAccountId || null,
    to,
    cc,
    bcc,
    subject,
    text,
    html,
    files: composeAttachments.map((a) => ({ name: a.name, mime: a.mime, dataB64: a.dataB64, size: a.size })),
    draftId: editingDraft?.id ?? null,
  };
  editingDraft = null;
  lastDraftPayload = "";
  if (composeTo) composeTo.value = "";
  if (composeCc) composeCc.value = "";
  if (composeBcc) composeBcc.value = "";
  if (composeSubject) composeSubject.value = "";
  setComposeText("");
  composeAttachments = [];
  renderComposeAttachments();
  closeCompose(false);
  queueSend(payload);
}

/** Кнопки форматирования письма (TASK-042). */
function initComposeFormatting(): void {
  document.querySelectorAll<HTMLButtonElement>(".cf-toolbar button[data-cmd]").forEach((btn) => {
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => {
      const cmd = btn.dataset.cmd ?? "";
      if (!cmd) return;
      composeBody?.focus();
      document.execCommand(cmd, false);
    });
  });
  document.getElementById("compose-link")?.addEventListener("mousedown", (e) => e.preventDefault());
  document.getElementById("compose-link")?.addEventListener("click", () => {
    const url = window.prompt("Адрес ссылки", "https://");
    if (!url) return;
    composeBody?.focus();
    document.execCommand("createLink", false, url);
  });
  composeBody?.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") ?? "";
    document.execCommand("insertText", false, text);
  });
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
  check_interval_sec: number;
  empty_trash_on_exit: boolean;
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
  // TASK-031: ящик запоминаем до переключения вида, иначе строка подсвечивается
  // только со второго клика — switchSettingsView читает editingAccountId.
  editingAccountId = forNew ? null : accountId || activeAccountId || null;
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
  // TASK-016: правим активный ящик или добавляем новый (id выставлен выше).
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
    setAccountIntervalFields(details.check_interval_sec ?? 0);
    const trashBox = document.getElementById("settings-empty-trash") as HTMLInputElement | null;
    if (trashBox) trashBox.checked = Boolean(details.empty_trash_on_exit);
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
    setAccountIntervalFields(0);
    const trashBox = document.getElementById("settings-empty-trash") as HTMLInputElement | null;
    if (trashBox) trashBox.checked = false;
  }
  renderProviderMenu();
  fillAccountSignature(editingAccountId);
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

/** Интервал автопроверки ящика из формы — в секундах (TASK-037). */
function accountIntervalValue(): number {
  const num = document.getElementById("settings-interval") as HTMLInputElement | null;
  const unit = document.getElementById("settings-interval-unit") as HTMLSelectElement | null;
  const value = Math.max(0, Number(num?.value ?? 0) || 0);
  const seconds = unit?.value === "sec" ? value : value * 60;
  return Math.min(86_400, Math.round(seconds));
}

function setAccountIntervalFields(sec: number): void {
  const num = document.getElementById("settings-interval") as HTMLInputElement | null;
  const unit = document.getElementById("settings-interval-unit") as HTMLSelectElement | null;
  if (!num || !unit) return;
  const value = Math.max(0, sec || 0);
  if (value > 0 && value < 60) {
    unit.value = "sec";
    num.value = String(value);
  } else {
    unit.value = "min";
    num.value = value > 0 ? String(Math.round(value / 60)) : "";
  }
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
      checkIntervalSec: accountIntervalValue(),
      emptyTrashOnExit:
        (document.getElementById("settings-empty-trash") as HTMLInputElement | null)?.checked ??
        false,
    });
    setStatus(`✓ ${saved.message}`, "ok");
    try {
      accounts = await invoke<AccountView[]>("get_accounts");
    } catch {
      /* список обновится при следующем открытии */
    }
    if (saved.id) {
      restartAccountTimers();
      activeAccountId = saved.id;
      currentFolder = folderKeyOf(saved.id, "INBOX");
      const area = document.getElementById("sig-editor") as HTMLTextAreaElement | null;
      const chk = document.getElementById("sig-enabled") as HTMLInputElement | null;
      if (area && chk) {
        saveAccountSignature(saved.id, area.value.trim(), chk.checked);
        await persistSettings();
        renderSignatures();
      }
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
  const text = composeText().trim();
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
    const better = await invoke<string>("improve_text", { text: composeText() });
    setComposeText(better);
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
    statusVersion.textContent = `POS Mail v${info.version}+g${info.git_hash.slice(0, 7)}`;
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
  if (!expansionsSaved && activeAccountId) {
    expandedAccounts.add(activeAccountId);
    saveExpandedAccounts();
  }
  for (const a of accounts) {
    const isActive = a.id === activeAccountId;
    const expanded = expandedAccounts.has(a.id);
    const li = document.createElement("li");
    li.className = isActive ? "acct active" : "acct";

    const head = document.createElement("div");
    head.className = isActive ? "acct-head active" : "acct-head";
    head.title = isActive ? "" : `Открыть ящик ${a.email}`;
    const caret = document.createElement("span");
    caret.className = "caret";
    caret.textContent = expanded ? "▼" : "▶";
    caret.title = expanded ? "Свернуть ящик" : "Раскрыть ящик";
    caret.addEventListener("click", (e) => {
      e.stopPropagation();
      if (expandedAccounts.has(a.id)) expandedAccounts.delete(a.id);
      else expandedAccounts.add(a.id);
      saveExpandedAccounts();
      renderFolders(lastFolders);
    });
    const dot = document.createElement("span");
    dot.className = "stripe";
    const palette = ["#2f6fd8", "#c26a2e", "#2e7d54", "#7b52b8"];
    const idx = accounts.findIndex((x) => x.id === a.id);
    dot.style.background = palette[(idx >= 0 ? idx : 0) % palette.length];
    const mail = document.createElement("span");
    mail.className = "mail";
    mail.textContent = a.email;
    head.append(caret, dot, mail);
    const badgeCount = sumUnread(a.id);
    const totalCount = sumTotal(a.id);
    const badge = document.createElement("span");
    badge.className = badgeCount > 0 ? "badge" : "badge zero";
    badge.textContent = String(badgeCount);
    badge.title = `Непрочитанных: ${badgeCount}`;
    const tot = document.createElement("span");
    tot.className = "acct-total";
    tot.textContent = `/ ${totalCount}`;
    tot.title = `Всего писем: ${totalCount}`;
    head.append(badge, tot);
    head.addEventListener("click", () => void activateAccount(a.id));
    head.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openAcctMenu(e.clientX, e.clientY, a);
    });
    li.appendChild(head);

    if (expanded) {
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
        ic.innerHTML = folderIcon(item.rel);
        const nm = document.createElement("span");
        nm.className = "name";
        nm.textContent = folderDisplay(item.rel.split(item.delim).pop() ?? item.rel);
        fli.append(ic, nm);
        const cnt = document.createElement("span");
        cnt.className = "cnt";
        cnt.textContent = String(unreadIn);
        const tot = document.createElement("span");
        tot.className = "tot";
        tot.textContent = `/ ${totalIn}`;
        fli.append(cnt, tot);
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
  updateWindowTitle();
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
  if (sameDay(d, y)) return "Вчера";
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
      requestDelete(uids);
      return;
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

/** Перечитывает текущую папку с сервера — кнопка «⟳» и Ctrl+R (TASK-034). */
async function reloadCurrentFolder(): Promise<void> {
  if (!currentFolder) return;
  const btn = document.getElementById("refresh-btn");
  btn?.classList.add("spinning");
  void refreshFolders(activeAccountId);
  try {
    await selectFolder(currentFolder);
  } finally {
    btn?.classList.remove("spinning");
  }
}

/** Переключатель «в папке / во всех папках» — TASK-033. */
function initSearchScope(): void {
  const btn = document.getElementById("scope-btn");
  const menu = document.getElementById("scope-menu");
  if (!btn || !menu) return;
  const sync = (): void => {
    btn.textContent =
      searchScope === "accounts" ? "в ящиках" : searchScope === "all" ? "везде" : "в папке";
    btn.classList.toggle("all", searchScope !== "folder");
    menu.querySelectorAll<HTMLButtonElement>("button[data-scope]").forEach((b) => {
      b.classList.toggle("sel", b.dataset.scope === searchScope);
    });
  };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const rect = btn.getBoundingClientRect();
    menu.style.left = `${Math.min(rect.left, window.innerWidth - 190)}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    menu.classList.toggle("hidden");
    sync();
  });
  menu.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-scope]");
    if (!b) return;
    searchScope =
      b.dataset.scope === "accounts" ? "accounts" : b.dataset.scope === "all" ? "all" : "folder";
    menu.classList.add("hidden");
    sync();
    if (!searchQuery) {
      renderMessages();
      return;
    }
    if (searchScope !== "folder") void runGlobalSearch();
    else renderMessages();
  });
  document.addEventListener("click", (e) => {
    if (!menu.classList.contains("hidden") && !(e.target as HTMLElement).closest("#scope-wrap")) {
      menu.classList.add("hidden");
    }
  });
  sync();
}

/** J/K — следующее/предыдущее письмо, R — ответ, E — в корзину (TASK-036). */
function initMailHotkeys(): void {
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target) || modalOpen()) return;
    const key = e.key.toLowerCase();
    if (key === "j" || key === "k") {
      if (visibleRows().length === 0) return;
      e.preventDefault();
      moveMessageSelection(key === "j" ? 1 : -1);
      return;
    }
    if (!currentMessage) return;
    if (key === "r") {
      e.preventDefault();
      replyBtn?.click();
    } else if (key === "e") {
      e.preventDefault();
      requestDelete([currentMessage.uid]);
    }
  });
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

const ICON_EYE =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.8"/></svg>';
const ICON_FLAG =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14V2m0 0h7l-1.6 2.6L11 7H4"/></svg>';
const ICON_REPLY =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5 2.5 7 6 10.5M3 7h6.5a3.5 3.5 0 0 1 0 7H8"/></svg>';
const ICON_TRASH =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.6 8.2a1 1 0 0 0 1 .8h4.8a1 1 0 0 0 1-.8l.6-8.2"/></svg>';

/** Маленькая кнопка в строке письма (видна при наведении). */
function hoverAction(title: string, icon: string, fn: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.title = title;
  b.innerHTML = icon;
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    fn();
  });
  return b;
}

let lastRowClickUid = 0;
let lastRowClickAt = 0;

function messageRow(
  m: MessageHeader,
  opts?: { open?: () => void; plain?: boolean },
): HTMLLIElement {
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
  fillHighlighted(subj, m.subject, searchQuery);
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
  fillHighlighted(fromText, m.from, searchQuery);
  fromEl.append(fromText);

  li.append(l1, fromEl);
  if (ai && ai.summary) {
    const aiLine = document.createElement("div");
    aiLine.className = "m-ai";
    aiLine.textContent = `✦ ${ai.summary}`;
    li.append(aiLine);
  }
  if (!opts?.plain) {
  const acts = document.createElement("div");
  acts.className = "m-actions";
  acts.append(
    hoverAction("Ответить", ICON_REPLY, () => {
      inlineReplyUid = inlineReplyUid === m.uid ? null : m.uid;
      renderMessages();
    }),
    hoverAction(m.seen ? "Пометить непрочитанным" : "Пометить прочитанным", ICON_EYE, () =>
      void markSeen(m.uid, !m.seen),
    ),
    hoverAction(m.flagged ? "Снять «важное»" : "Пометить важным", ICON_FLAG, () =>
      void toggleFlag(m),
    ),
    hoverAction("В корзину", ICON_TRASH, () => requestDelete([m.uid])),
  );
  li.append(acts);
  }
  // Shift+клик не должен выделять текст в строке — только письмо.
  li.addEventListener("mousedown", (e) => {
    if (e.shiftKey) e.preventDefault();
  });
  if (selectedUids.has(m.uid)) li.classList.add("multi");
  if (inlineReplyUid === m.uid) li.appendChild(inlineReplyBox(m));
  if (!opts?.plain) initRowDrag(li, m);
  li.addEventListener("click", (e) => {
    if (Date.now() < suppressClickUntil) return;
    if (e.ctrlKey || e.metaKey) {
      toggleMulti(m);
      return;
    }
    if (e.shiftKey) {
      selectRange(m);
      return;
    }
    if (selectedUids.size > 0) clearMulti();
    if (opts?.open) {
      opts.open();
      return;
    }
    const now = Date.now();
    const doubleClick = lastRowClickUid === m.uid && now - lastRowClickAt < 420;
    lastRowClickUid = m.uid;
    lastRowClickAt = now;
    selectMessage(m);
    if (doubleClick) {
      lastRowClickUid = 0;
      if (isDraftsFolder(splitFolderKey(currentFolder).name)) {
        void openDraftIfAny(m);
      } else {
        openMessageWindow(m);
      }
    }
  });
  li.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openMsgMenu(e.clientX, e.clientY, m);
  });
  return li;
}

const GROUPS_KEY = "soroka.groupsCollapsed";

/** «1 строка», «2 строки», «5 строк». */
function pluralStrok(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  const w = d === 1 && dd !== 11 ? "строка" : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? "строки" : "строк";
  return `${n} ${w}`;
}

/** «1 письмо», «2 письма», «5 писем» (TASK-042). */
function pluralPisma(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  const word =
    d === 1 && dd !== 11 ? "письмо" : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? "письма" : "писем";
  return `${n} ${word}`;
}

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

/** Поиск по кэшу всех папок ящика — TASK-033. */
async function runGlobalSearch(): Promise<void> {
  if (!searchQuery) {
    globalHits = [];
    renderMessages();
    return;
  }
  try {
    const hits = await invoke<SearchHitDto[]>("search_messages", {
      prefix: searchScope === "accounts" ? "" : `${activeAccountId}::`,
      folder: null,
      query: searchQuery,
    });
    globalHits = hits.map((h) => ({ folder: h.folder, hit: h }));
  } catch (err) {
    globalHits = [];
    showToast(`Поиск не получился: ${String(err)}`);
  }
  renderMessages();
}

/** Поиск по тексту писем в текущей папке — TASK-036. */
function scheduleBodySearch(): void {
  if (bodySearchTimer !== undefined) window.clearTimeout(bodySearchTimer);
  if (!searchQuery || searchScope !== "folder" || !currentFolder) {
    bodyHits = [];
    return;
  }
  bodySearchTimer = window.setTimeout(() => void runBodySearch(), 250);
}

async function runBodySearch(): Promise<void> {
  const q = searchQuery;
  const folder = currentFolder;
  if (!q) {
    bodyHits = [];
    renderMessages();
    return;
  }
  try {
    const hits = await invoke<SearchHitDto[]>("search_messages", {
      prefix: `${activeAccountId}::`,
      folder,
      query: q,
    });
    if (q !== searchQuery || folder !== currentFolder) return;
    bodyHits = hits.filter((h) => h.in_body);
  } catch {
    bodyHits = [];
  }
  renderMessages();
}

/** Дописывает в список найденное в тексте писем. */
function appendBodyHits(): void {
  if (!messagesList) return;
  if (searchScope !== "folder" || !searchQuery || bodyHits.length === 0) return;
  const head = document.createElement("li");
  head.className = "group-head body-head";
  head.textContent = `В тексте письма · ${bodyHits.length}`;
  messagesList.appendChild(head);
  for (const h of bodyHits) {
    const m: MessageHeader = {
      uid: h.uid,
      seq: 0,
      from: h.from,
      subject: h.subject,
      date: h.date,
      seen: h.seen,
      flagged: h.flagged,
      has_attachments: h.has_attachments,
    };
    const li = messageRow(m, { plain: true });
    li.classList.add("body-hit");
    messagesList.appendChild(li);
  }
}

/** Открывает письмо из результатов «во всех папках». */
async function openSearchHit(item: { folder: string; hit: SearchHitDto }): Promise<void> {
  if (item.folder !== currentFolder) await selectFolder(item.folder);
  const m = currentMessages.find((x) => x.uid === item.hit.uid);
  if (m) selectMessage(m);
  else showToast("Письмо не в кэше этой папки — обновите её");
}

function renderGlobalHits(): void {
  if (!messagesList || !messagesEmpty) return;
  messagesList.innerHTML = "";
  messagesEmpty.textContent =
    searchScope === "accounts"
      ? "Сорока ничего не нашла во всех ящиках"
      : "Сорока ничего не нашла во всех папках";
  messagesEmpty.classList.toggle("hidden", globalHits.length > 0);
  for (const item of globalHits) {
    const m: MessageHeader = {
      uid: item.hit.uid,
      seq: 0,
      from: item.hit.from,
      subject: item.hit.subject,
      date: item.hit.date,
      seen: item.hit.seen,
      flagged: item.hit.flagged,
      has_attachments: item.hit.has_attachments,
    };
    const li = messageRow(m, { plain: true, open: () => void openSearchHit(item) });
    const tag = document.createElement("span");
    tag.className = "hit-folder";
    const { accountId: hitAcc, name: hitName } = splitFolderKey(item.folder);
    const hitAccount = accounts.find((a) => a.id === hitAcc);
    tag.textContent =
      searchScope === "accounts" && hitAccount
        ? `${hitAccount.email} · ${folderDisplay(hitName)}`
        : folderDisplay(hitName);
    li.querySelector(".meta")?.append(tag);
    messagesList.appendChild(li);
  }
  markSelection();
  updateBulkBar();
}

/** Текст пустого списка: distinguishes «пусто» и «сервер не отдал письма» — TASK-034. */
function emptyListText(): string {
  if (searchQuery) return "Сорока ничего не нашла";
  if (folderTotals.total > 0 && folderTotals.fetched === 0) {
    return `На сервере ${folderTotals.total} писем, но сервер не отдал их содержимое — нажмите «Обновить» позже`;
  }
  return "Сорока ещё в полёте — писем нет";
}

function renderMessages(): void {
  if (!messagesList || !messagesEmpty) return;
  const items = sortedMessages();
  messagesList.innerHTML = "";
  messagesEmpty.textContent = emptyListText();
  const hasBodyHits = searchScope === "folder" && Boolean(searchQuery) && bodyHits.length > 0;
  messagesEmpty.classList.toggle("hidden", items.length > 0 || hasBodyHits);

  if (searchScope !== "folder" && searchQuery) {
    renderGlobalHits();
    return;
  }

  if (sortState.group === "none") {
    items.forEach((m) => messagesList?.appendChild(messageRow(m)));
    appendBodyHits();
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
    cnt.textContent = pluralPisma(bucket.length);
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
  appendBodyHits();
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

function renderSender(from: string): void {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const name = (m?.[1] ?? "").trim();
  const email = (m?.[2] ?? from).trim();
  if (dFromName) dFromName.textContent = name || email;
  if (dFromEmail) {
    dFromEmail.textContent = name ? email : "";
    dFromEmail.classList.toggle("hidden", !name);
  }
  if (dFrom) dFrom.title = from;
}

function selectMessage(m: MessageHeader): void {
  currentMessage = m;
  hideTranslation();
  notspamBtn?.classList.toggle("hidden", !isSpamFolder(splitFolderKey(currentFolder).name));
  renderSender(m.from);
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

function openMessageWindow(m: MessageHeader): void {
  const payload = {
    account: activeAccountId,
    folder: currentFolder,
    uid: m.uid,
    subject: m.subject,
    from: m.from,
    date: m.date,
  };
  const label = `msg-${m.uid}-${Date.now()}`;
  const url = `index.html?reader=1&d=${encodeURIComponent(JSON.stringify(payload))}`;
  try {
    const w = new WebviewWindow(label, {
      url,
      title: `POS Mail — ${m.subject || "письмо"}`.slice(0, 90),
      width: 980,
      height: 760,
      minWidth: 620,
      minHeight: 460,
      decorations: false,
      shadow: true,
    });
    w.once("tauri://error", (e) => {
      showToast(`Не удалось открыть окно: ${String(e.payload)}`);
      openReadingFocus();
    });
  } catch (err) {
    showToast(`Не удалось открыть окно: ${String(err)}`);
    openReadingFocus();
  }
}

interface ReaderPayload {
  account: string;
  folder: string;
  uid: number;
  subject: string;
  from: string;
  date: string;
}

interface ReaderActionPayload {
  kind: "reply" | "forward";
  account: string;
  to: string;
  subject: string;
  body: string;
}

function initReaderWindowChrome(): void {
  const win = getCurrentWindow();
  initWindowDrag(win);
  document.getElementById("win-min")?.addEventListener("click", () => void win.minimize());
  document.getElementById("win-max")?.addEventListener("click", () => void win.toggleMaximize());
  document.getElementById("win-close")?.addEventListener("click", () => void win.close());
}

async function initReaderWindow(): Promise<void> {
  document.body.classList.add("reader-window", "reading-focus");
  initReaderWindowChrome();
  document.getElementById("reply-btn")?.addEventListener("click", () => readerCompose("reply"));
  document.getElementById("forward-btn")?.addEventListener("click", () => readerCompose("forward"));
  imagesBtn?.addEventListener("click", () => {
    if (currentBody?.html && bodyFrame) {
      bodyFrame.srcdoc = wrapHtml(currentBody.html, true);
      imagesBtn.classList.add("hidden");
    }
  });
  const raw = new URLSearchParams(location.search).get("d");
  if (!raw) return;
  let p: ReaderPayload;
  try {
    p = JSON.parse(raw) as ReaderPayload;
  } catch {
    return;
  }
  currentFolder = p.folder;
  activeAccountId = p.account;
  currentMessage = {
    uid: p.uid,
    seq: 0,
    from: p.from,
    subject: p.subject,
    date: p.date,
    seen: true,
    flagged: false,
  };
  renderSender(p.from);
  if (dSubject) dSubject.textContent = p.subject;
  if (dDate) dDate.textContent = fullDate(p.date);
  document.title = `POS Mail — ${p.subject}`;
  details?.classList.remove("hidden");
  messageEmpty?.classList.add("hidden");
  await loadBody(p.uid);
}

function readerCompose(kind: "reply" | "forward"): void {
  if (!currentMessage) return;
  const payload: ReaderActionPayload = {
    kind,
    account: activeAccountId,
    to: kind === "reply" ? extractAddress(currentMessage.from) : "",
    subject: prefixedSubject(currentMessage.subject, kind === "reply" ? "Re" : "Fwd"),
    body: quotedOriginal(),
  };
  void emitTo("main", "reader-action", payload).finally(() => {
    void getCurrentWindow().close();
  });
}

const readingBackBtn = document.getElementById("reading-back");

function openReadingFocus(): void {
  if (!currentMessage) return;
  document.body.classList.add("reading-focus");
  readingBackBtn?.classList.remove("hidden");
}

function closeReadingFocus(): void {
  document.body.classList.remove("reading-focus");
  readingBackBtn?.classList.add("hidden");
}

readingBackBtn?.addEventListener("click", closeReadingFocus);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.body.classList.contains("reading-focus")) closeReadingFocus();
});

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
  expandedAccounts.add(activeAccountId);
  saveExpandedAccounts();
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
  requestDelete([currentMessage.uid]);
}

/** Отложенное удаление: 7 секунд на «Отменить», потом перенос в корзину. */
let pendingDelete: { folder: string; uids: number[]; timer: number } | null = null;

function requestDelete(uids: number[]): void {
  if (uids.length === 0) return;
  if (pendingDelete) {
    const prev = pendingDelete;
    window.clearTimeout(prev.timer);
    void commitDelete(prev.folder, prev.uids);
  }
  const folder = currentFolder;
  const ids = new Set(uids);
  document.querySelectorAll<HTMLElement>("#messages li.m-row").forEach((li) => {
    if (ids.has(Number(li.dataset.uid))) li.classList.add("pending-del");
  });
  if (currentMessage && ids.has(currentMessage.uid)) clearReadingPane();
  selectedUids = new Set<number>();
  lastAnchorUid = null;
  updateBulkBar();
  const label =
    uids.length === 1 ? "Письмо убрано в корзину" : `Убрано в корзину: ${uids.length}`;
  const timer = window.setTimeout(() => void commitDelete(folder, uids), 7000);
  pendingDelete = { folder, uids, timer };
  showToast(label, "Отменить", () => undoDelete(), 7000);
}

function undoDelete(): void {
  if (!pendingDelete) return;
  window.clearTimeout(pendingDelete.timer);
  pendingDelete = null;
  document
    .querySelectorAll<HTMLElement>("#messages li.m-row.pending-del")
    .forEach((li) => li.classList.remove("pending-del"));
  showToast("Удаление отменено");
}

async function commitDelete(folder: string, uids: number[]): Promise<void> {
  pendingDelete = null;
  try {
    const n = await invoke<number>("delete_messages", { folder, uids });
    if (folder === currentFolder) {
      currentMessages = currentMessages.filter((m) => !uids.includes(m.uid));
      renderMessages();
    }
    await refreshUnread();
    if (n > 1) showToast(`В корзину: ${n}`);
  } catch (err) {
    showToast(`Не удалось удалить: ${String(err)}`);
    document
      .querySelectorAll<HTMLElement>("#messages li.m-row.pending-del")
      .forEach((li) => li.classList.remove("pending-del"));
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
    const d =
      drafts.find((x) => x.uid === m.uid) ??
      drafts.find((x) => x.subject.trim().toLowerCase() === m.subject.trim().toLowerCase());
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

  add("Открыть", () => {
    selectMessage(m);
    openMessageWindow(m);
  });
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
      requestSpam(m);
    });
  }
  add(m.seen ? "Непрочитано" : "Прочитано", () => void markSeen(m.uid, !m.seen));
  menu.classList.remove("hidden");
  menu.style.left = `${Math.min(x, window.innerWidth - 220)}px`;
  menu.style.top = `${Math.min(y + 8, window.innerHeight - 200)}px`;
  menu.querySelector<HTMLButtonElement>("button")?.focus();
}

/**
 * Перетаскивание окна без нативного модального цикла (TASK-039).
 * data-tauri-drag-region в WebView2 даёт рывки: окно перерисовывается только
 * после отпускания мыши. Двигаем окно сами через setPosition по pointermove.
 */
function initWindowDrag(win: ReturnType<typeof getCurrentWindow>): void {
  const bar = document.getElementById("titlebar");
  if (!bar) return;
  let drag: {
    pointerId: number;
    startX: number;
    startY: number;
    winX: number;
    winY: number;
    scale: number;
  } | null = null;
  let pending: { x: number; y: number } | null = null;
  let raf = 0;
  const flush = (): void => {
    raf = 0;
    if (!pending) return;
    const { x, y } = pending;
    pending = null;
    void win.setPosition(new PhysicalPosition(Math.round(x), Math.round(y)));
  };
  bar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, input, select, textarea, .dd-menu")) return;
    void (async () => {
      const pos = await win.outerPosition();
      const scale = await win.scaleFactor();
      drag = {
        pointerId: e.pointerId,
        startX: e.screenX,
        startY: e.screenY,
        winX: pos.x,
        winY: pos.y,
        scale,
      };
      bar.setPointerCapture(e.pointerId);
      document.body.classList.add("win-drag");
    })();
  });
  bar.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    pending = {
      x: drag.winX + (e.screenX - drag.startX) * drag.scale,
      y: drag.winY + (e.screenY - drag.startY) * drag.scale,
    };
    if (!raf) raf = window.requestAnimationFrame(flush);
  });
  const end = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag = null;
    document.body.classList.remove("win-drag");
    try {
      bar.releasePointerCapture(e.pointerId);
    } catch {
      /* уже отпущен */
    }
  };
  bar.addEventListener("pointerup", end);
  bar.addEventListener("pointercancel", end);
}

/** Прозрачность окна: класс на body + эффект стекла в Rust (TASK-021). */
function renderAppearance(): void {
  const dense = document.getElementById("opt-dense") as HTMLInputElement | null;
  if (dense) dense.checked = settingsData?.appearance?.dense_list ?? false;
  const minTray = document.getElementById("opt-min-tray") as HTMLInputElement | null;
  if (minTray) minTray.checked = settingsData?.ui?.minimize_to_tray ?? true;
  const auto = document.getElementById("opt-autostart") as HTMLInputElement | null;
  if (auto) auto.checked = settingsData?.ui?.autostart ?? false;
}

/** Автозапуск при входе в Windows (TASK-040). */
type GigachatStatus = { source: string; has_file: boolean; env_set: boolean };

/** Экран ключа GigaChat (TASK-041). */
async function renderAiSettings(): Promise<void> {
  const status = document.getElementById("gc-status");
  const input = document.getElementById("gc-key") as HTMLInputElement | null;
  if (input) {
    input.value = "";
    input.placeholder = "вставьте ключ авторизации";
  }
  if (!status) return;
  try {
    const st = await invoke<GigachatStatus>("gigachat_status");
    if (st.source === "env") {
      status.textContent =
        "Ключ задан переменной окружения SOROKA_GIGACHAT_KEY — она важнее файла. Здесь можно сохранить резервный ключ.";
    } else if (st.source === "file") {
      status.textContent = "Ключ сохранён в файле. Можно заменить или проверить подключение.";
    } else {
      status.textContent = "Ключ не задан: ИИ-функции не работают, пока его не добавить.";
    }
  } catch (err) {
    status.textContent = `Не удалось прочитать состояние ключа: ${String(err)}`;
  }
}

async function saveGigachatKey(): Promise<void> {
  const input = document.getElementById("gc-key") as HTMLInputElement | null;
  const status = document.getElementById("gc-status");
  const key = input?.value.trim() ?? "";
  if (!key) {
    if (status) status.textContent = "Вставьте ключ авторизации.";
    return;
  }
  try {
    await invoke("save_gigachat_key", { key });
    if (input) input.value = "";
    if (status) status.textContent = "Ключ сохранён. Нажмите «Проверить подключение».";
    showToast("Ключ GigaChat сохранён");
  } catch (err) {
    if (status) status.textContent = `Не удалось сохранить: ${String(err)}`;
  }
}

async function checkGigachatKey(): Promise<void> {
  const input = document.getElementById("gc-key") as HTMLInputElement | null;
  const status = document.getElementById("gc-status");
  const btn = document.getElementById("gc-check") as HTMLButtonElement | null;
  const key = input?.value.trim() ?? "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Проверяю…";
  }
  try {
    const msg = await invoke<string>("check_gigachat_key", { key: key || null });
    if (status) status.textContent = msg;
  } catch (err) {
    if (status) status.textContent = `Проверка не прошла: ${String(err)}`;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Проверить подключение";
    }
  }
}

async function clearGigachatKey(): Promise<void> {
  const status = document.getElementById("gc-status");
  try {
    await invoke("clear_gigachat_key");
    if (status) status.textContent = "Сохранённый ключ удалён.";
    showToast("Ключ GigaChat удалён");
  } catch (err) {
    if (status) status.textContent = `Не удалось удалить: ${String(err)}`;
  }
}

async function setAutostart(enabled: boolean): Promise<void> {
  try {
    await invoke("set_autostart", { enabled });
    if (settingsData) {
      settingsData.ui = { ...settingsData.ui, autostart: enabled };
      await persistSettings();
    }
    showToast(
      enabled
        ? "POS Mail будет запускаться при входе в Windows"
        : "Автозапуск при входе в Windows выключен",
    );
  } catch (err) {
    showToast(`Не удалось изменить автозапуск: ${String(err)}`);
  }
}

function syncOpaqueClass(): void {
  // TASK-037: прозрачное окно убрано — оно заметно тормозило; окно всегда непрозрачное.
  document.body.classList.add("opaque");
}

/** Плотный список: одна строка на письмо (TASK-036). */
function syncDenseClass(): void {
  const dense = settingsData?.appearance?.dense_list ?? false;
  document.body.classList.toggle("dense-list", dense);
}

async function applyDensity(value: boolean): Promise<void> {
  if (settingsData) {
    settingsData.appearance = { ...settingsData.appearance, dense_list: value };
    await persistSettings();
  }
  document.body.classList.toggle("dense-list", value);
  renderMessages();
}

function initSettingsUi(): void {
  document.querySelectorAll<HTMLElement>(".sn-item[data-view]").forEach((el) => {
    el.addEventListener("click", () => {
      const view = el.dataset.view ?? "categories";
      if (view === "categories") renderCategories();
      if (view === "prompts") renderPrompts();
      if (view === "signatures") renderSignatures();
      if (view === "appearance") renderAppearance();
      if (view === "ai") void renderAiSettings();
      switchSettingsView(view);
    });
  });
  document.getElementById("settings-close")?.addEventListener("click", () => closeSettings());
  document.getElementById("quote-toggle")?.addEventListener("click", () => {
    const quote = document.getElementById("quote-text");
    const toggle = document.getElementById("quote-toggle");
    if (!quote || !toggle) return;
    const hidden = quote.classList.toggle("hidden");
    const lines = toggle.dataset.lines ?? "0";
    toggle.textContent = hidden ? `Показать цитату · ${lines} строк` : "Скрыть цитату";
  });
  document.getElementById("gc-save")?.addEventListener("click", () => void saveGigachatKey());
  document.getElementById("gc-check")?.addEventListener("click", () => void checkGigachatKey());
  document.getElementById("gc-clear")?.addEventListener("click", () => void clearGigachatKey());
  const gcShow = document.getElementById("gc-show") as HTMLInputElement | null;
  gcShow?.addEventListener("change", () => {
    const input = document.getElementById("gc-key") as HTMLInputElement | null;
    if (input) input.type = gcShow.checked ? "text" : "password";
  });
  document.getElementById("cat-add")?.addEventListener("click", () => openCategoryEditor(null));
  document.getElementById("cat-save")?.addEventListener("click", () => void saveCategory());
  document.getElementById("cat-cancel")?.addEventListener("click", () => closeCategoryEditor());
  document.getElementById("cat-delete")?.addEventListener("click", () => void deleteCategory());
  document.getElementById("prompts-save")?.addEventListener("click", () => void savePrompts());
  document.getElementById("prompts-reset")?.addEventListener("click", () => void resetAllSettings());
  initSignatureEditor();
  trashBtn?.addEventListener("click", () => void deleteCurrent());
  notspamBtn?.addEventListener("click", () => void notSpamCurrent());
  emptyTrashBtn?.addEventListener("click", () => void emptyTrashFolder());
  makeSettingsMovable();
  const optDense = document.getElementById("opt-dense") as HTMLInputElement | null;
  optDense?.addEventListener("change", () => void applyDensity(optDense.checked));
  const optMinTray = document.getElementById("opt-min-tray") as HTMLInputElement | null;
  optMinTray?.addEventListener("change", () => {
    if (!settingsData) return;
    settingsData.ui = { ...settingsData.ui, minimize_to_tray: optMinTray.checked };
    void persistSettings();
  });
  const optAutostart = document.getElementById("opt-autostart") as HTMLInputElement | null;
  optAutostart?.addEventListener("change", () => void setAutostart(optAutostart.checked));
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Delete") return;
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
    if (selectedUids.size > 0) {
      e.preventDefault();
      requestDelete([...selectedUids]);
      return;
    }
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

/** Мини-форма ответа прямо в списке (TASK-036). */
function inlineReplyBox(m: MessageHeader): HTMLElement {
  const box = document.createElement("div");
  box.className = "inline-reply";
  box.addEventListener("click", (e) => e.stopPropagation());
  box.addEventListener("mousedown", (e) => e.stopPropagation());
  const ta = document.createElement("textarea");
  ta.rows = 3;
  ta.placeholder = `Ответ ${m.from}…`;
  const row = document.createElement("div");
  row.className = "inline-reply-row";
  const send = document.createElement("button");
  send.type = "button";
  send.className = "btn-primary";
  send.textContent = "Отправить";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Отмена";
  cancel.addEventListener("click", () => {
    inlineReplyUid = null;
    renderMessages();
  });
  const status = document.createElement("span");
  status.className = "inline-reply-status";
  send.addEventListener("click", () => {
    const text = ta.value.trim();
    if (!text) {
      ta.focus();
      return;
    }
    send.disabled = true;
    status.textContent = "Отправляю…";
    void (async () => {
      try {
        await invoke("send_mail", {
          accountId: activeAccountId || null,
          to: extractAddress(m.from),
          cc: null,
          bcc: null,
          subject: prefixedSubject(m.subject, "Re"),
          body: text,
          html: null,
          files: [],
        });
        inlineReplyUid = null;
        renderMessages();
        showToast(`Ответ улетел: ${extractAddress(m.from)}`);
      } catch (err) {
        status.textContent = `Не ушло: ${String(err)}`;
        send.disabled = false;
      }
    })();
  });
  row.append(send, cancel, status);
  box.append(ta, row);
  window.setTimeout(() => ta.focus(), 0);
  return box;
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
/** Карточка нового контакта с уже заполненными полями — TASK-034. */
function beginNewContact(name: string, email: string, note: string): void {
  currentContactId = 0;
  contactsIndex = -1;
  contactEditing = true;
  fillContactFields({
    id: 0,
    name,
    email,
    organization: "",
    position: "",
    phone: "",
    notes: "",
    groups: "",
  });
  renderCardHeader(null);
  const title = document.getElementById("contact-title");
  if (title) title.textContent = name || email;
  const sub = document.getElementById("contact-subtitle");
  if (sub) sub.textContent = note;
  const av = document.getElementById("contact-avatar");
  if (av) {
    av.className = avatarClass("cc-avatar", email);
    av.textContent = initials(name, email);
  }
  renderCardFields(null);
  renderCard();
  renderContacts();
  void loadContactStats(email);
  contactStatus("проверьте и нажмите «Сохранить»");
  document.getElementById("contact-name")?.focus();
}

async function addCurrentSenderToBook(): Promise<void> {
  if (!currentMessage) return;
  const email = extractAddress(currentMessage.from);
  if (!email.includes("@")) {
    showToast("У отправителя нет адреса");
    return;
  }
  const rawName = currentMessage.from.replace(/<[^>]*>/g, "").trim();
  const name = rawName === email ? "" : rawName;
  await loadContacts();
  await openContacts();
  const existing = contacts.find((c) => c.email.toLowerCase() === email.toLowerCase());
  if (existing) {
    openContactCard(
      existing,
      filteredContacts().findIndex((x) => x.id === existing.id),
      true,
    );
    showToast("Контакт уже в книге — можно поправить и сохранить");
    return;
  }
  beginNewContact(name, email, "Из письма · проверьте и нажмите «Сохранить»");
}

/** Подвижные разделители в адресной книге с запоминанием (TASK-038). */
function initContactsSplits(): void {
  const shell = document.querySelector<HTMLElement>(".contacts-shell");
  if (!shell) return;
  try {
    const saved = JSON.parse(localStorage.getItem("soroka.contactsCols") ?? "null") as
      | { left: number; right: number }
      | null;
    if (saved) {
      shell.style.setProperty("--c-left", `${saved.left}px`);
      shell.style.setProperty("--c-right", `${saved.right}px`);
    }
  } catch {
    /* приватный режим */
  }
  const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
  shell.querySelectorAll<HTMLElement>(".c-split").forEach((handle) => {
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const side = handle.dataset.side === "right" ? "right" : "left";
      const startX = e.clientX;
      const computed = getComputedStyle(shell);
      const left = parseFloat(computed.getPropertyValue("--c-left")) || 150;
      const right = parseFloat(computed.getPropertyValue("--c-right")) || 232;
      const shellW = shell.getBoundingClientRect().width;
      handle.classList.add("dragging");
      const move = (ev: MouseEvent): void => {
        const dx = ev.clientX - startX;
        if (side === "left") {
          shell.style.setProperty(
            "--c-left",
            `${clamp(left + dx, 110, Math.min(360, shellW * 0.4))}px`,
          );
        } else {
          shell.style.setProperty(
            "--c-right",
            `${clamp(right - dx, 200, Math.min(460, shellW * 0.5))}px`,
          );
        }
      };
      const up = (): void => {
        handle.classList.remove("dragging");
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        const now = getComputedStyle(shell);
        const l = parseFloat(now.getPropertyValue("--c-left")) || 150;
        const r = parseFloat(now.getPropertyValue("--c-right")) || 232;
        try {
          localStorage.setItem("soroka.contactsCols", JSON.stringify({ left: l, right: r }));
        } catch {
          /* приватный режим */
        }
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
  });
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
  if (new URLSearchParams(location.search).get("reader") === "1") {
    void initReaderWindow();
    return;
  }
  initSortMenu();
  initSettingsUi();
  void loadSettings().then(() => {
    syncOpaqueClass();
    syncDenseClass();
    void invoke<boolean>("get_autostart")
      .then((real) => {
        if (settingsData) settingsData.ui = { ...settingsData.ui, autostart: real };
        renderAppearance();
      })
      .catch(() => {
        /* автозапуск недоступен */
      });
    restartAccountTimers();
    renderSettingsAccounts();
    if (currentMessages.length > 0) renderMessages();
  });
  const appWindow = getCurrentWindow();
  document
    .querySelector<HTMLButtonElement>("#win-min")
    ?.addEventListener("click", () => {
      // TASK-040: поведение «свернуть» задаётся в настройках.
      if (settingsData?.ui?.minimize_to_tray ?? true) {
        void appWindow.hide();
      } else {
        void appWindow.minimize();
      }
    });
  document
    .querySelector<HTMLButtonElement>("#win-max")
    ?.addEventListener("click", () => void appWindow.toggleMaximize());
  document
    .querySelector<HTMLButtonElement>("#win-close")
    ?.addEventListener("click", () => void appWindow.close());
  document.getElementById("compose-x")?.addEventListener("click", () => closeCompose(true));
  document.getElementById("event-x")?.addEventListener("click", () => closeEventForm());
  document.getElementById("settings-x")?.addEventListener("click", () => closeSettings());
  document.getElementById("cal-close")?.addEventListener("click", () => void closeCalendar());
  let windowClosing = false;
  initWindowDrag(appWindow);
  void appWindow.onCloseRequested(async (event) => {
    // Второй вызов (после close()) пропускаем — иначе окно не закроется никогда.
    if (windowClosing) return;
    event.preventDefault();
    windowClosing = true;
    try {
      // Не держим окно дольше 8 секунд: сервер может не ответить.
      await Promise.race([
        emptyTrashOnExit(),
        new Promise((resolve) => window.setTimeout(resolve, 8_000)),
      ]);
    } catch (err) {
      console.warn("очистка корзин", err);
    }
    // destroy() закрывает окно и процесс гарантированно; close() — запасной путь.
    try {
      await appWindow.destroy();
    } catch (err) {
      console.warn("destroy", err);
      await appWindow.close();
    }
  });
  document.querySelector<HTMLElement>("#titlebar")?.addEventListener("dblclick", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest(".tb-btns")) return;
    void appWindow.toggleMaximize();
  });
  pingBtn?.addEventListener("click", () => void checkBackend());
  mailBtn?.addEventListener("click", () => void checkMail());
  const checkMailBtn = document.getElementById("check-mail-btn") as HTMLButtonElement | null;
  checkMailBtn?.addEventListener("click", () => {
    checkMailBtn.disabled = true;
    checkMailBtn.classList.add("spinning");
    void checkMail().finally(() => {
      checkMailBtn.disabled = false;
      checkMailBtn.classList.remove("spinning");
    });
  });
  composeBtn?.addEventListener("click", () => openCompose());
  composeSignature?.addEventListener("change", () => {
    applySignature(composeSignature.value || null);
  });
  const msgMoreBtn = document.querySelector<HTMLButtonElement>("#msg-more-btn");
  const msgMore = document.querySelector<HTMLElement>("#msg-more");
  msgMoreBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    msgMore?.classList.toggle("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest("#msg-more, #msg-more-btn")) {
      msgMore?.classList.add("hidden");
    }
  });
  void listen<ReaderActionPayload>("reader-action", (e) => {
    const p = e.payload;
    if (p.account) activeAccountId = p.account;
    if (p.kind === "reply") {
      openCompose({ title: "Ответ", to: p.to, subject: p.subject, body: p.body });
    } else {
      openCompose({ title: "Пересылка", to: "", subject: p.subject, body: p.body });
    }
    void getCurrentWindow().setFocus();
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
  replyAllBtn?.addEventListener("click", () => void replyAll());
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
    if (currentMessage) requestSpam(currentMessage);
  });
  void listen("tray-check-mail", () => void checkMail());
  void listen("tray-quit", () => void appWindow.close());
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
      if (searchScope !== "folder" && searchQuery) void runGlobalSearch();
      else {
        bodyHits = [];
        renderMessages();
        scheduleBodySearch();
      }
    }, 150);
  });
  searchClear?.addEventListener("click", () => {
    if (searchBox) {
      searchBox.value = "";
      searchBox.focus();
    }
    searchQuery = "";
    globalHits = [];
    bodyHits = [];
    updateSearchClear();
    renderMessages();
  });
  initSearchScope();
  document.getElementById("refresh-btn")?.addEventListener("click", () => void reloadCurrentFolder());
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
    if (
      (e.ctrlKey || e.metaKey) &&
      e.key.toLowerCase() === "r" &&
      !isTypingTarget(e.target) &&
      !modalOpen()
    ) {
      e.preventDefault();
      void reloadCurrentFolder();
    }
    if (e.key === "/" && !isTypingTarget(e.target) && !modalOpen()) {
      e.preventDefault();
      searchBox?.focus();
      searchBox?.select();
    }
    if (e.key === "Escape" && document.activeElement === searchBox) {
      e.preventDefault();
      if (searchBox) searchBox.value = "";
      searchQuery = "";
      globalHits = [];
      updateSearchClear();
      renderMessages();
    }
    if (e.ctrlKey && e.key === "Enter" && !composeOverlay?.classList.contains("hidden")) {
      e.preventDefault();
      void sendCompose();
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      e.key.toLowerCase() === "s" &&
      !composeOverlay?.classList.contains("hidden")
    ) {
      e.preventDefault();
      void saveDraftNow(false);
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
  initContactsSplits();
  initAddressSuggest();
  initBulkBar();
  initMailHotkeys();
  initRowDragHandlers();
  initComposeFormatting();
  initToastAction();
  initComposeDrop();
  initLayout();
  void loadAppInfo();
  void checkBackend();
  void initMail();
});