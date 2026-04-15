mod cmd;
mod db;
mod fingerprint;
mod models;
mod state;

use state::AppState;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::RwLock;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let app_dir = app_handle
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_dir).expect("failed to create app data dir");

            let profiles_dir = app_dir.join("profiles");
            std::fs::create_dir_all(&profiles_dir).expect("failed to create profiles dir");

            let rt = tokio::runtime::Runtime::new().expect("failed to create tokio runtime");
            let db = rt.block_on(db::init(&app_dir)).expect("failed to init database");

            app.manage(AppState {
                db,
                sessions: Arc::new(RwLock::new(HashMap::new())),
                profiles_dir,
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cmd::profile::list_profiles,
            cmd::profile::get_profile,
            cmd::profile::create_profile,
            cmd::profile::update_profile,
            cmd::profile::delete_profile,
            cmd::profile::duplicate_profile,
            cmd::profile::update_fingerprint,
            cmd::browser::launch_browser,
            cmd::browser::stop_browser,
            cmd::browser::get_running_sessions,
            cmd::browser::detect_browsers,
            cmd::proxy::list_proxies,
            cmd::proxy::create_proxy,
            cmd::proxy::update_proxy,
            cmd::proxy::delete_proxy,
            cmd::proxy::test_proxy,
            cmd::fingerprint::generate_fingerprint,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub use fingerprint::build_injection_script;
