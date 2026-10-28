mod activity;
mod engine;
mod host;
mod installer;
mod relocation;
mod terminal;
mod worker;
use engine::{Config, Request};
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::Manager;
use worker::EngineState;

#[tauri::command]
fn get_config(state: tauri::State<'_, Arc<EngineState>>) -> Result<Value, String> {
    state.call("get_config", Value::Null)
}
#[tauri::command]
fn save_config(state: tauri::State<'_, Arc<EngineState>>, config: Config) -> Result<(), String> {
    state
        .call("save_config", json!({"config": config}))
        .map(|_| ())
}
#[tauri::command]
fn unlock(
    state: tauri::State<'_, Arc<EngineState>>,
    id: String,
    passphrase: String,
) -> Result<(), String> {
    state
        .call("unlock", json!({"id":id, "passphrase":passphrase}))
        .map(|_| ())
}
#[tauri::command]
fn lock_repository(state: tauri::State<'_, Arc<EngineState>>, id: String) -> Result<(), String> {
    state.call("lock_repository", json!({"id": id})).map(|_| ())
}
#[tauri::command]
fn get_status(state: tauri::State<'_, Arc<EngineState>>) -> Result<Value, String> {
    state.call("get_status", Value::Null)
}
#[tauri::command]
async fn get_history_details(
    state: tauri::State<'_, Arc<EngineState>>,
    id: String,
) -> Result<Value, String> {
    let backend = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        backend.call("get_history_details", json!({"id": id}))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn probe() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(engine::probe)
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn run_operation(
    state: tauri::State<'_, Arc<EngineState>>,
    request: Request,
) -> Result<Value, String> {
    let backend = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        backend.call("run_operation", json!({"request": request}))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn confirm_relocation(
    state: tauri::State<'_, Arc<EngineState>>,
    token: String,
) -> Result<Value, String> {
    let backend = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        backend.call("confirm_relocation", json!({"token": token}))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn dismiss_relocation(
    state: tauri::State<'_, Arc<EngineState>>,
    token: String,
) -> Result<(), String> {
    state
        .call("dismiss_relocation", json!({"token": token}))
        .map(|_| ())
}

#[tauri::command]
async fn get_install_plan(
    state: tauri::State<'_, Arc<installer::Installer>>,
) -> Result<installer::Plan, String> {
    let installer = state.inner().clone();
    // Plan detection is fast on native Unix; WSL detection runs off the UI thread below.
    tauri::async_runtime::spawn_blocking(move || installer.plan())
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
fn dismiss_install_plan(state: tauri::State<'_, Arc<installer::Installer>>, plan_id: String) {
    state.dismiss(&plan_id);
}
#[tauri::command]
async fn install_borg(
    state: tauri::State<'_, Arc<installer::Installer>>,
    plan_id: String,
) -> Result<String, String> {
    let installer = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || installer.install(&plan_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn terminal_create(
    state: tauri::State<'_, Arc<terminal::Terminals>>,
    cols: u16,
    rows: u16,
) -> Result<terminal::Started, String> {
    let terminals = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || terminals.create(cols, rows))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn terminal_write(
    state: tauri::State<'_, Arc<terminal::Terminals>>,
    id: u32,
    data: String,
) -> Result<(), String> {
    let terminals = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || terminals.write(id, data))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
fn terminal_read(
    state: tauri::State<'_, Arc<terminal::Terminals>>,
    id: u32,
) -> Result<terminal::Output, String> {
    state.read(id)
}
#[tauri::command]
fn terminal_resize(
    state: tauri::State<'_, Arc<terminal::Terminals>>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.resize(id, cols, rows)
}
#[tauri::command]
async fn terminal_close(
    state: tauri::State<'_, Arc<terminal::Terminals>>,
    id: u32,
) -> Result<(), String> {
    let terminals = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || terminals.close(id))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Some(result) = worker::run_if_requested() {
        if let Err(error) = result {
            eprintln!("borgd worker: {error}");
            std::process::exit(1);
        }
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            app.manage(Arc::new(
                EngineState::new(app.path().app_config_dir()?).map_err(std::io::Error::other)?,
            ));
            app.manage(Arc::new(installer::Installer::default()));
            app.manage(Arc::new(terminal::Terminals::default()));
            // Closing a running backup would orphan the process and lose its result.
            let handle = app.handle().clone();
            app.get_webview_window("main")
                .unwrap()
                .on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        if handle.state::<Arc<EngineState>>().local_busy()
                            || handle
                                .state::<Arc<installer::Installer>>()
                                .busy
                                .load(std::sync::atomic::Ordering::SeqCst)
                        {
                            api.prevent_close();
                        }
                    }
                });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            unlock,
            lock_repository,
            get_status,
            get_history_details,
            probe,
            run_operation,
            get_install_plan,
            install_borg,
            dismiss_install_plan,
            confirm_relocation,
            dismiss_relocation,
            terminal_create,
            terminal_write,
            terminal_read,
            terminal_resize,
            terminal_close
        ])
        .build(tauri::generate_context!())
        .expect("error running borgd")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if app.state::<Arc<EngineState>>().local_busy() {
                    api.prevent_exit();
                } else {
                    app.state::<Arc<terminal::Terminals>>().close_all();
                }
            }
        });
}
