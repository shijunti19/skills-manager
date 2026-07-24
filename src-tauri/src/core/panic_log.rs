use std::backtrace::Backtrace;
use std::fs;
use std::io::Write;
use std::panic;
use std::path::PathBuf;
use std::sync::OnceLock;

use tauri::{AppHandle, Manager};

static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

/// The Tauri bundle identifier (must match `tauri.conf.json` → `identifier`).
/// Tauri's `app_log_dir()` resolves to `<data_local_dir>/<identifier>/logs` on
/// Windows; we replicate that path with the `dirs` crate so the panic hook can
/// be installed before `tauri::Builder` exists (before any `AppHandle`).
const APP_IDENTIFIER: &str = "com.agentskills.desktop";

pub fn last_panic_path(app: &AppHandle) -> Option<PathBuf> {
    LOG_DIR
        .get()
        .cloned()
        .or_else(|| app.path().app_log_dir().ok())
        .map(|dir| dir.join("last_panic.log"))
}

/// Install the panic hook without needing an `AppHandle`. Call this as the
/// very first statement of `run()` — before `initialize_store()` (which can
/// take tens of seconds) and before `tauri::Builder`/`tauri_plugin_log` exist.
/// Without this, a panic during the pre-Builder startup window left zero
/// evidence (no `last_panic.log`, no log line) — which is why startup failures
/// were un-diagnosable.
pub fn install_panic_hook_early() {
    if let Some(dir) = dirs::data_local_dir().map(|d| d.join(APP_IDENTIFIER).join("logs")) {
        let _ = fs::create_dir_all(&dir);
        let _ = LOG_DIR.set(dir);
    }
    install_hook_body();
}

/// Legacy entry: kept for callers that already have an `AppHandle`. Prefers
/// the Tauri-resolved log dir, falling back to the static `LOG_DIR` set by
/// [`install_panic_hook_early`] if it ran first.
pub fn install_panic_hook(app: AppHandle) {
    if let Ok(dir) = app.path().app_log_dir() {
        let _ = fs::create_dir_all(&dir);
        let _ = LOG_DIR.set(dir);
    }
    install_hook_body();
}

fn install_hook_body() {
    // Guard: `set_hook` replaces any existing hook. If `_early` already ran,
    // calling the legacy entry from `setup` would re-wrap and drop the early
    // hook's file-write logic. Install the body at most once per process.
    static INSTALLED: std::sync::Once = std::sync::Once::new();
    INSTALLED.call_once(|| {
        let prev = panic::take_hook();
        panic::set_hook(Box::new(move |info| {
            let backtrace = Backtrace::capture();
            let timestamp = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%.3f%:z");
            let location = info
                .location()
                .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
                .unwrap_or_else(|| "<unknown>".into());
            let payload = if let Some(s) = info.payload().downcast_ref::<&str>() {
                (*s).to_string()
            } else if let Some(s) = info.payload().downcast_ref::<String>() {
                s.clone()
            } else {
                "<non-string panic payload>".to_string()
            };

            let body = format!(
                "[{timestamp}] PANIC at {location}\n{payload}\n\nBacktrace:\n{backtrace}\n"
            );

            // Best-effort: if the logger isn't installed yet (likely, since
            // this hook can fire pre-Builder) the default no-op logger swallows
            // it. The file write below is the real record.
            log::error!("panic: {payload} at {location}");

            if let Some(dir) = LOG_DIR.get() {
                let path = dir.join("last_panic.log");
                if let Ok(mut f) = fs::OpenOptions::new()
                    .create(true)
                    .write(true)
                    .truncate(true)
                    .open(&path)
                {
                    let _ = f.write_all(body.as_bytes());
                }
            }

            prev(info);
        }));
    });
}
