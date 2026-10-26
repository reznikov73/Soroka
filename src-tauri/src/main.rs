// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(windows)]
mod single_instance {
    use std::sync::atomic::{AtomicIsize, Ordering};

    type Handle = isize;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateMutexW(attrs: *const u8, initial: i32, name: *const u16) -> Handle;
        fn GetLastError() -> u32;
    }

    #[link(name = "user32")]
    unsafe extern "system" {
        fn EnumWindows(cb: extern "system" fn(Handle, Handle) -> i32, param: Handle) -> i32;
        fn GetWindowTextW(h: Handle, buf: *mut u16, len: i32) -> i32;
        fn ShowWindow(h: Handle, cmd: i32) -> i32;
        fn SetForegroundWindow(h: Handle) -> i32;
    }

    static FOUND: AtomicIsize = AtomicIsize::new(0);

    extern "system" fn enum_cb(h: Handle, _: Handle) -> i32 {
        let mut buf = [0u16; 256];
        let n = unsafe { GetWindowTextW(h, buf.as_mut_ptr(), buf.len() as i32) };
        if n > 0 {
            let title = String::from_utf16_lossy(&buf[..n as usize]);
            if title.ends_with("POS Mail") {
                FOUND.store(h, Ordering::SeqCst);
                return 0;
            }
        }
        1
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// true — можно запускаться; false — уже есть окно, его подняли.
    pub fn acquire() -> bool {
        let name = wide("POSMail_SingleInstance_v1");
        let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
        if handle == 0 {
            return true;
        }
        if unsafe { GetLastError() } != 183 {
            return true;
        }
        unsafe {
            EnumWindows(enum_cb, 0);
        }
        let h = FOUND.load(Ordering::SeqCst);
        if h != 0 {
            unsafe {
                ShowWindow(h, 9);
                SetForegroundWindow(h);
            }
        }
        false
    }
}

fn main() {
    #[cfg(windows)]
    if !single_instance::acquire() {
        return;
    }
    soroka_lib::run()
}
