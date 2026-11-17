//! Нативный ресайз с кастомной шапкой (TASK-105).
//!
//! Окно создаётся обычным окном Windows (`decorations: true`, `resizable: true`):
//! модальный цикл ресайза, тень DWM, Aero Snap и клавиатурный ресайз ведёт
//! система. Этот модуль добавляет два механизма:
//!
//! 1. **Скрытая рамка.** `WM_NCCALCSIZE` возвращает 0 — клиентская область
//!    занимает всё окно, системного заголовка и рамки не видно, а наша
//!    HTML-шапка остаётся единственной. Тот же приём, что у Windows Terminal
//!    и Chromium. Развёрнутое окно ограничиваем рабочей областью монитора,
//!    иначе контент уходит под панель задач.
//! 2. **Дроссель внутри модального цикла.** Системный цикл присылает
//!    `WM_SIZE`/`WM_MOVE` с частотой мыши (до 1000 Гц), а не кадров. На каждое
//!    такое событие wry вызывает `ICoreWebView2Controller::SetBounds` и
//!    `SetWindowPos` дочернего HWND (`WM_SIZE`), а также
//!    `NotifyParentWindowPositionChanged` (`WM_MOVE`/`WM_MOVING`); сверху
//!    tauri-runtime-wry вызывает `set_bounds` ещё раз. WebView2 не успевает
//!    перестраиваться — окно «думает» и отстаёт от курсора. Это и есть
//!    медленность системного цикла из TASK-081/099. Здесь события
//!    пропускаются дальше по цепочке не чаще ~120 Гц; финальные размер и
//!    позиция доносятся при выходе из цикла и по таймеру-подстраховке.
//!
//! Ресайз и перетаскивание запускаются из JS: `startResizeDragging` /
//! `startDragging` — это одна команда на жест, дальше всю геометрию
//! (минимальный размер через `WM_GETMINMAXINFO`, примагничивание, DPI)
//! считает Windows без нашего участия.

use std::time::{Duration, Instant};
use tauri::WebviewWindow;

type Hwnd = isize;

const WM_DESTROY: u32 = 0x0002;
const WM_MOVE: u32 = 0x0003;
const WM_SIZE: u32 = 0x0005;
const WM_TIMER: u32 = 0x0113;
const WM_NCCALCSIZE: u32 = 0x0083;
const WM_MOVING: u32 = 0x0216;
const WM_ENTERSIZEMOVE: u32 = 0x0231;
const WM_EXITSIZEMOVE: u32 = 0x0232;

const MONITOR_DEFAULTTONEAREST: u32 = 2;
const ABM_GETAUTOHIDEBAR: u32 = 0x000B;
const ABE_LEFT: u32 = 0;
const ABE_TOP: u32 = 1;
const ABE_RIGHT: u32 = 2;
const ABE_BOTTOM: u32 = 3;

/// DWMWA_BORDER_COLOR (Windows 11): управление обводкой окна.
const DWMWA_BORDER_COLOR: u32 = 34;
/// DWMWA_COLOR_NONE: убрать обводку совсем.
const DWMWA_COLOR_NONE: u32 = 0xFFFF_FFFE;

/// Идентификатор сабкласса: свой, чтобы не задеть сабкласс wry.
const SUBCLASS_ID: usize = 0x105;
/// Идентификатор таймера-подстраховки для финального WM_SIZE.
const TIMER_ID: usize = 0x1051;
/// Пропускать события не чаще, чем раз в 8 мс (~120 Гц): тот же бэкспрешер,
/// что в TASK-102, только нативно — без IPC и без растущей очереди.
const THROTTLE: Duration = Duration::from_millis(8);

#[repr(C)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

// Поля этих структур читает Win32 через указатель, а не наш код —
// глушим dead_code, иначе `cargo clippy -- -D warnings` не пройдёт.
#[allow(dead_code)]
#[repr(C)]
struct MonitorInfoW {
    cb_size: u32,
    rc_monitor: Rect,
    rc_work: Rect,
    dw_flags: u32,
}

#[allow(dead_code)]
#[repr(C)]
struct AppBarData {
    cb_size: u32,
    hwnd: Hwnd,
    callback_message: u32,
    edge: u32,
    rc: Rect,
    l_param: isize,
}

#[allow(dead_code)]
#[repr(C)]
struct NcCalcSizeParams {
    rg_rc: [Rect; 3],
    lp_pos: *mut u8,
}

/// Состояние дросселя на окно. Живёт, пока живёт окно (освобождается в WM_DESTROY).
struct State {
    /// Окно — чтобы сообщать фронтенду о входе/выходе из модального цикла.
    window: WebviewWindow,
    /// Идёт ли сейчас системный модальный цикл (между WM_ENTERSIZEMOVE
    /// и WM_EXITSIZEMOVE).
    in_size_move: bool,
    /// Момент последнего пропущенного вниз события — точка отсчёта дросселя.
    last_pass: Instant,
    /// Последний проглоченный WM_SIZE (wparam, lparam) — финальный размер.
    pending_size: Option<(usize, isize)>,
    /// Последний проглоченный WM_MOVE (lparam) — финальная позиция.
    pending_move: Option<isize>,
}

#[link(name = "comctl32")]
unsafe extern "system" {
    fn SetWindowSubclass(
        hwnd: Hwnd,
        proc: Option<unsafe extern "system" fn(Hwnd, u32, usize, isize, usize, usize) -> isize>,
        id: usize,
        ref_data: usize,
    ) -> i32;
    fn DefSubclassProc(hwnd: Hwnd, msg: u32, wparam: usize, lparam: isize) -> isize;
    fn RemoveWindowSubclass(
        hwnd: Hwnd,
        proc: Option<unsafe extern "system" fn(Hwnd, u32, usize, isize, usize, usize) -> isize>,
        id: usize,
    ) -> i32;
}

#[link(name = "user32")]
unsafe extern "system" {
    fn IsZoomed(hwnd: Hwnd) -> i32;
    fn MonitorFromWindow(hwnd: Hwnd, flags: u32) -> Hwnd;
    fn GetMonitorInfoW(monitor: Hwnd, info: *mut MonitorInfoW) -> i32;
    fn SetTimer(
        hwnd: Hwnd,
        id: usize,
        ms: u32,
        cb: Option<unsafe extern "system" fn(Hwnd, u32, usize, u32)>,
    ) -> usize;
    fn KillTimer(hwnd: Hwnd, id: usize) -> i32;
}

#[link(name = "shell32")]
unsafe extern "system" {
    fn SHAppBarMessage(msg: u32, data: *mut AppBarData) -> u32;
}

#[link(name = "dwmapi")]
unsafe extern "system" {
    fn DwmSetWindowAttribute(hwnd: Hwnd, attr: u32, value: *const u32, size: u32) -> i32;
}

/// Есть ли у края экрана панель задач с автоскрытием (как делает tao).
fn has_autohide_bar(hwnd: Hwnd, edge: u32) -> bool {
    let mut data = AppBarData {
        cb_size: std::mem::size_of::<AppBarData>() as u32,
        hwnd,
        callback_message: 0,
        edge,
        rc: Rect { left: 0, top: 0, right: 0, bottom: 0 },
        l_param: 0,
    };
    unsafe { SHAppBarMessage(ABM_GETAUTOHIDEBAR, &mut data) != 0 }
}

/// Сабкласс стоит в цепочке ПОСЛЕ wry и tao (установлен позже — вызывается
/// первым), поэтому мы первыми видим каждое сообщение и решаем, пускать ли
/// его дальше (DefSubclassProc) или проглотить.
unsafe extern "system" fn subclass_proc(
    hwnd: Hwnd,
    msg: u32,
    wparam: usize,
    lparam: isize,
    _id: usize,
    ref_data: usize,
) -> isize {
    // Окно одного потока, перекрёстных вызовов нет.
    let st = unsafe { &mut *(ref_data as *mut State) };
    let in_loop = st.in_size_move;
    match msg {
        // Спрятать рамку: клиентская область = всё окно.
        WM_NCCALCSIZE if wparam != 0 => {
            let params = lparam as *mut NcCalcSizeParams;
            unsafe {
                if IsZoomed(hwnd) != 0 {
                    let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
                    let mut info = MonitorInfoW {
                        cb_size: std::mem::size_of::<MonitorInfoW>() as u32,
                        rc_monitor: Rect { left: 0, top: 0, right: 0, bottom: 0 },
                        rc_work: Rect { left: 0, top: 0, right: 0, bottom: 0 },
                        dw_flags: 0,
                    };
                    if GetMonitorInfoW(monitor, &mut info) != 0 {
                        let mut rc = info.rc_work;
                        // Панель задач с автоскрытием: оставить ей 1 px.
                        if has_autohide_bar(hwnd, ABE_BOTTOM) {
                            rc.bottom -= 1;
                        }
                        if has_autohide_bar(hwnd, ABE_LEFT) {
                            rc.left += 1;
                        }
                        if has_autohide_bar(hwnd, ABE_TOP) {
                            rc.top += 1;
                        }
                        if has_autohide_bar(hwnd, ABE_RIGHT) {
                            rc.right -= 1;
                        }
                        (*params).rg_rc[0] = rc;
                    }
                }
            }
            0
        }

        WM_ENTERSIZEMOVE => {
            if !st.in_size_move {
                st.in_size_move = true;
                st.last_pass = Instant::now();
                // Тот же класс, что раньше ставили JS-ручки: CSS гасит
                // переходы на время ресайза (styles.css, body.resizing).
                let _ = st.window.eval("document.body.classList.add(\"resizing\")");
            }
            unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
        }

        WM_EXITSIZEMOVE => {
            st.in_size_move = false;
            unsafe {
                KillTimer(hwnd, TIMER_ID);
                // Финальные размер и позицию WebView2 обязан узнать обязательно.
                if let Some((wp, lp)) = st.pending_size.take() {
                    st.last_pass = Instant::now();
                    DefSubclassProc(hwnd, WM_SIZE, wp, lp);
                }
                if let Some(lp) = st.pending_move.take() {
                    DefSubclassProc(hwnd, WM_MOVE, 0, lp);
                }
            }
            let _ = st.window.eval("document.body.classList.remove(\"resizing\")");
            unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
        }

        // Внутри модального цикла — дроссель: пропускать не чаще THROTTLE,
        // промежуточные события глотать, финальные не терять.
        WM_SIZE | WM_MOVE | WM_MOVING if in_loop => {
            let now = Instant::now();
            if now.duration_since(st.last_pass) >= THROTTLE {
                st.last_pass = now;
                match msg {
                    WM_SIZE => st.pending_size = None,
                    _ => st.pending_move = None,
                }
                unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
            } else {
                match msg {
                    WM_SIZE => {
                        st.pending_size = Some((wparam, lparam));
                        // Подстраховка: если жест закончится раньше THROTTLE,
                        // таймер всё равно донесёт финальный размер.
                        unsafe {
                            SetTimer(hwnd, TIMER_ID, THROTTLE.as_millis() as u32, None);
                        }
                    }
                    _ => st.pending_move = Some(lparam),
                }
                0
            }
        }

        WM_TIMER if wparam == TIMER_ID => {
            unsafe {
                KillTimer(hwnd, TIMER_ID);
                if let Some((wp, lp)) = st.pending_size.take() {
                    st.last_pass = Instant::now();
                    DefSubclassProc(hwnd, WM_SIZE, wp, lp);
                }
            }
            0
        }

        WM_DESTROY => {
            unsafe {
                let _ = RemoveWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID);
                drop(Box::from_raw(ref_data as *mut State));
                DefSubclassProc(hwnd, msg, wparam, lparam)
            }
        }

        _ => unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) },
    }
}

/// Прячет системную рамку окна и включает дроссель WebView2 в модальном цикле.
///
/// Окно должно быть создано с `decorations(true)` и `resizable(true)`.
/// Вызывается один раз на живое окно: для главного — из setup, для окон
/// чтения и настроек — командой `apply_borderless` до первого показа.
/// При неудаче окно остаётся обычным системным — это безопасный запасной вид.
pub fn apply(window: &WebviewWindow) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as Hwnd;
    let state = Box::into_raw(Box::new(State {
        window: window.clone(),
        in_size_move: false,
        last_pass: Instant::now(),
        pending_size: None,
        pending_move: None,
    }));
    let ok = unsafe { SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, state as usize) };
    if ok == 0 {
        unsafe { drop(Box::from_raw(state)) };
        return Err("SetWindowSubclass не удался".into());
    }
    // Windows 11: убрать системную обводку — рамки больше нет, а полупрозрачный
    // кант по краю был бы лишним. На Windows 10 вызов вернёт ошибку — не страшно.
    let none = DWMWA_COLOR_NONE;
    unsafe {
        let _ = DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, &none, 4);
    }
    Ok(())
}
