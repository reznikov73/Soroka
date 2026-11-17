//! Заморозка WebView2 на время системного жеста ресайза (TASK-108).
//!
//! Итог TASK-105/106/107: даже когда окно — обычное системное и в цикле
//! ресайза нет ни одной нашей строки, рамка идёт за курсором, а содержимое
//! отстаёт. Значит, стоимость — в перестройке и отрисовке DOM внутри
//! WebView2, и ниже она не станет, пока вебвью виден во время жеста.
//!
//! Приём — «ghost resize», как у Windows при выключенной опции «Отображать
//! содержимое окна при перетаскивании»: на первый `WM_SIZE` модального цикла
//! дочернее окно WebView2 прячется (`SW_HIDE`), родитель закрашивается цветом
//! темы, и до конца жеста окно тянет чистый Win32 — мгновенно. На выходе из
//! цикла вебвью возвращается (`SW_SHOW`) и делает одну раскладку уже
//! финального размера. Фокус возвращается туда, где был до жеста.
//!
//! Перетаскивание без изменения размера контент не прячет: там раскладки нет.
//! Дросселя, IPC и `eval()` из оконной процедуры здесь нет — то, что
//! замедлило 0.46.54, отсутствует по построению.

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

use tauri::WebviewWindow;

type Hwnd = isize;

const WM_DESTROY: u32 = 0x0002;
const WM_SIZE: u32 = 0x0005;
const WM_ERASEBKGND: u32 = 0x0014;
const WM_ENTERSIZEMOVE: u32 = 0x0231;
const WM_EXITSIZEMOVE: u32 = 0x0232;

/// Свой идентификатор сабкласса, чтобы не задеть сабкласс wry/tao.
const SUBCLASS_ID: usize = 0x108;

const SW_HIDE: i32 = 0;
const SW_SHOW: i32 = 5;

/// Класс дочернего HWND, который создаёт WebView2.
const WEBVIEW_CLASS: &str = "Chrome_WidgetWin_1";

#[allow(dead_code)]
#[repr(C)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
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
    fn ShowWindow(hwnd: Hwnd, cmd: i32) -> i32;
    fn EnumChildWindows(
        parent: Hwnd,
        cb: Option<unsafe extern "system" fn(Hwnd, isize) -> i32>,
        lparam: isize,
    ) -> i32;
    fn GetClassNameW(hwnd: Hwnd, name: *mut u16, max: i32) -> i32;
    fn GetClientRect(hwnd: Hwnd, rect: *mut Rect) -> i32;
    fn FillRect(hdc: isize, rect: *const Rect, brush: isize) -> i32;
    fn GetFocus() -> Hwnd;
    fn SetFocus(hwnd: Hwnd) -> Hwnd;
}

#[link(name = "gdi32")]
unsafe extern "system" {
    fn CreateSolidBrush(color: u32) -> isize;
    fn DeleteObject(obj: isize) -> i32;
}

/// Состояние на окно: живёт, пока живёт окно (освобождается в WM_DESTROY).
struct State {
    /// Дочерний HWND WebView2; 0 — ещё не искали.
    webview: Hwnd,
    /// Кисть цвета темы: закрашивает родителя, пока вебвью спрятан.
    brush: isize,
    /// Идёт системный модальный цикл (между ENTER/EXITSIZEMOVE).
    in_loop: bool,
    /// Вебвью сейчас спрятан.
    frozen: bool,
    /// Куда вернуть фокус после жеста.
    saved_focus: Hwnd,
}

/// Ищем дочернее окно WebView2 по классу. 0 — нашли, перебор останавливаем.
unsafe extern "system" fn find_webview_cb(hwnd: Hwnd, lparam: isize) -> i32 {
    let mut name = [0u16; 64];
    let n = unsafe { GetClassNameW(hwnd, name.as_mut_ptr(), name.len() as i32) }.max(0) as usize;
    let class = String::from_utf16_lossy(&name[..n.min(name.len())]);
    if class == WEBVIEW_CLASS {
        unsafe { *(lparam as *mut Hwnd) = hwnd };
        0
    } else {
        1
    }
}

/// Сабкласс стоит в цепочке первым (установлен позже wry/tao) и решает, что
/// делать с каждым сообщением. Никаких вызовов в webview отсюда нет.
unsafe extern "system" fn subclass_proc(
    hwnd: Hwnd,
    msg: u32,
    wparam: usize,
    lparam: isize,
    _id: usize,
    ref_data: usize,
) -> isize {
    let st = unsafe { &mut *(ref_data as *mut State) };
    match msg {
        WM_ENTERSIZEMOVE => {
            st.in_loop = true;
            unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
        }

        WM_EXITSIZEMOVE => {
            st.in_loop = false;
            if st.frozen {
                st.frozen = false;
                if st.webview != 0 {
                    unsafe { ShowWindow(st.webview, SW_SHOW) };
                }
                if st.saved_focus != 0 {
                    unsafe { SetFocus(st.saved_focus) };
                }
                st.saved_focus = 0;
            }
            unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
        }

        // Первый WM_SIZE внутри цикла — это ресайз: прячем вебвью до конца
        // жеста. Дальше wry обновляет bounds уже скрытого окна — это дёшево.
        WM_SIZE if st.in_loop && !st.frozen => {
            st.frozen = true;
            if st.webview == 0 {
                let mut wv: Hwnd = 0;
                unsafe {
                    EnumChildWindows(hwnd, Some(find_webview_cb), &mut wv as *mut Hwnd as isize);
                }
                st.webview = wv;
            }
            if st.webview != 0 {
                st.saved_focus = unsafe { GetFocus() };
                unsafe { ShowWindow(st.webview, SW_HIDE) };
            }
            unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
        }

        // Фон под спрятанным вебвью: без этого родитель мигает системным
        // цветом. Кисть — цвета темы, её передают при apply().
        WM_ERASEBKGND => {
            let mut rc = Rect { left: 0, top: 0, right: 0, bottom: 0 };
            if unsafe { GetClientRect(hwnd, &mut rc) } != 0 {
                unsafe { FillRect(wparam as isize, &rc, st.brush) };
            }
            1
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

/// Уже обработанные HWND — защита от повторного сабкласса (второй вызов
/// SetWindowSubclass с тем же id утёк бы предыдущее состояние).
fn applied() -> &'static Mutex<HashSet<isize>> {
    static APPLIED: OnceLock<Mutex<HashSet<isize>>> = OnceLock::new();
    APPLIED.get_or_init(|| Mutex::new(HashSet::new()))
}

/// «#RRGGBB» → COLORREF (0x00BBGGRR). None — если формат не тот.
pub(crate) fn parse_hex_color(s: &str) -> Option<u32> {
    let s = s.strip_prefix('#')?;
    if s.len() != 6 {
        return None;
    }
    let v = u32::from_str_radix(s, 16).ok()?;
    let r = (v >> 16) & 0xFF;
    let g = (v >> 8) & 0xFF;
    let b = v & 0xFF;
    Some((b << 16) | (g << 8) | r)
}

/// Прячет WebView2 на время системного жеста ресайза.
///
/// `bg` — цвет фона (COLORREF), которым закрашивается окно, пока вебвью
/// спрятан. Вызывается один раз на живое окно; повторные вызовы для того же
/// окна игнорируются. При неудаче окно остаётся просто системным.
pub fn apply(window: &WebviewWindow, bg: u32) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as Hwnd;
    {
        let mut set = applied().lock().map_err(|_| "мьютекс отравлен".to_string())?;
        if !set.insert(hwnd) {
            return Ok(()); // уже применено к этому окну
        }
    }
    let brush = unsafe { CreateSolidBrush(bg) };
    let state = Box::into_raw(Box::new(State {
        webview: 0,
        brush,
        in_loop: false,
        frozen: false,
        saved_focus: 0,
    }));
    let ok = unsafe { SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, state as usize) };
    if ok == 0 {
        if let Ok(mut set) = applied().lock() {
            set.remove(&hwnd);
        }
        unsafe {
            drop(Box::from_raw(state));
            DeleteObject(brush);
        }
        return Err("SetWindowSubclass не удался".into());
    }
    Ok(())
}
