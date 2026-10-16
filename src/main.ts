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
      b.title = "Сохранить в календарь (.ics)";
      b.addEventListener("click", () => void exportIcs(ev, item));
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
      b.title = "В календарь (.ics)";
      const ev = finalizeEvent(one, "", t);
      b.addEventListener("click", () => void exportIcs(ev, t));
      row.append(b);
    }
    aiTasks.append(row);
  });
}

/** ---- TASK-013: календарь планов (агрегация дат из разборов) ---- */

interface CalendarEntry {
  folder: string;
  uid: number;
  subject: string;
  from: string;
  analysis: AiAnalysisData;
}

interface CalEvent {
  y: number;
  m: number;
  d: number;
  time: string;
  title: string;
  source: string;
  folder: string;
  uid: number;
}

const CAL_MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

let calEntries: CalendarEntry[] = [];
let calEvents: CalEvent[] = [];
let calCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let calSelectedDay = "";

function dayKey(y: number, m: number, d: number): string {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

/** Все события из разборов: даты + задачи с датами (диапазоны раскладываются по дням). */
function buildCalEvents(entries: CalendarEntry[]): CalEvent[] {
  const out: CalEvent[] = [];
  const addEvent = (ev: ParsedEvent, fallbackTitle: string, folder: string, uid: number, source: string): void => {
    const sy = Number(ev.start.slice(0, 4));
    const sm = Number(ev.start.slice(5, 7)) - 1;
    const sd = Number(ev.start.slice(8, 10));
    const time = ev.allDay ? "" : ev.start.slice(11, 16);
    const first = new Date(sy, sm, sd);
    const last = new Date(Number(ev.end.slice(0, 4)), Number(ev.end.slice(5, 7)) - 1, Number(ev.end.slice(8, 10)));
    last.setDate(last.getDate() - 1); // конец в ICS — исключающий
    const spanDays = Math.round((last.getTime() - first.getTime()) / 86_400_000) + 1;
    // Длинные диапазоны (> 3 дней) показываем только в первый день — иначе хлам в каждом дне.
    const lastEff = spanDays > 3 ? first : last;
    const cur = new Date(first);
    let guard = 0;
    while (cur.getTime() <= lastEff.getTime() && guard < 60) {
      out.push({
        y: cur.getFullYear(),
        m: cur.getMonth(),
        d: cur.getDate(),
        time,
        title: ev.title || fallbackTitle,
        source,
        folder,
        uid,
      });
      cur.setDate(cur.getDate() + 1);
      guard += 1;
    }
  };
  entries.forEach((e) => {
    const subject = e.subject || `письмо из «${e.folder}»`;
    (e.analysis.dates ?? []).forEach((item) => {
      parseDateItems(item).forEach((ev) => addEvent(ev, subject, e.folder, e.uid, subject));
    });
    (e.analysis.tasks ?? []).forEach((t) => {
      const one = parseOneDate(t);
      if (!one) return;
      addEvent(finalizeEvent(one, "", t), subject, e.folder, e.uid, subject);
    });
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
      chip.title = `${e.title} — письмо: ${e.source}`;
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
    p.textContent = "На этот день событий нет. Даты и задачи «Сорока» берёт из разборов писем — они появятся здесь после «✦ Разбор».";
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
    const src = document.createElement("div");
    src.className = "cal-ev-src";
    src.textContent = `письмо: ${e.source}`;
    src.title = e.source;
    const actions = document.createElement("div");
    actions.className = "cal-ev-actions";
    const bOpen = document.createElement("button");
    bOpen.type = "button";
    bOpen.textContent = "Открыть письмо";
    bOpen.addEventListener("click", () => void openLetterFromCalendar(e));
    const bIcs = document.createElement("button");
    bIcs.type = "button";
    bIcs.textContent = "Сохранить .ics";
    bIcs.title = "Файл-приглашение для календаря Windows";
    bIcs.addEventListener("click", () => void saveCalEventIcs(e));
    actions.append(bOpen, bIcs);
    card.append(top, src, actions);
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
    e.title,
    { subject: e.source, from: "" },
  );
}

async function openLetterFromCalendar(e: CalEvent): Promise<void> {
  closeCalendar();
  if (currentFolder !== e.folder) {
    await selectFolder(e.folder);
  }
  const mm = currentMessages.find((x) => x.uid === e.uid);
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

async function openCalendar(): Promise<void> {
  document.getElementById("app")?.classList.add("hidden");
  calendarView?.classList.remove("hidden");
  if (calendarBtn) calendarBtn.textContent = "Почта";
  calSelectedDay = "";
  try {
    calEntries = await invoke<CalendarEntry[]>("get_calendar_entries");
  } catch (err) {
    calEntries = [];
    showToast(`Календарь: не загрузить разборы (${String(err)})`);
  }
  calEvents = buildCalEvents(calEntries);
  renderCalendar();
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
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && calendarView && !calendarView.classList.contains("hidden")) {
      closeCalendar();
    }
  });
  initLayout();
  void loadAppInfo();
  void checkBackend();
  void initMail();
});