use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

mod http_health;
mod brave_search;
mod desktop;
mod fetch_page;
mod local_runtime;
mod secrets;
mod webkit_dmabuf;

use http_health::probe_health;

const BRIDGE_LISTEN: &str = "127.0.0.1:7331";
const BRIDGE_HEALTH_URL: &str = "http://127.0.0.1:7331/health";

struct BridgeChild(Mutex<Option<CommandChild>>);

fn bridge_already_running() -> bool {
  probe_health(BRIDGE_HEALTH_URL)
}

fn cleanup_children(app: &tauri::AppHandle) {
  let state = app.state::<BridgeChild>();
  let mut guard = match state.0.lock() {
    Ok(g) => g,
    Err(poison) => poison.into_inner(),
  };
  if let Some(child) = guard.take() {
    let _ = child.kill();
    log::info!("[gatesai] bridge sidecar killed");
  }
  let runtime_state = app.state::<local_runtime::LocalRuntimeState>();
  local_runtime::kill_all(&runtime_state);
}

/// Open a filesystem path with the OS default handler (browser for .html,
/// editor for .md/.py/etc., file manager for directories). Used by the
/// markdown renderer when the user clicks a workspace path that the model
/// produced. We do a `canonicalize` + existence check up front so we can
/// surface a friendly error instead of silently failing or shelling out
/// to a path that contains shell metacharacters.
#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
  let pb = PathBuf::from(&path);
  let canonical = pb
    .canonicalize()
    .map_err(|err| format!("cannot resolve {path}: {err}"))?;
  open::that_detached(&canonical).map_err(|err| format!("cannot open {}: {err}", canonical.display()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  webkit_dmabuf::configure();

  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_global_shortcut::Builder::new()
      .with_handler(|app, shortcut, event| desktop::handle_global_shortcut(app, shortcut, event.state()))
      .build())
    .invoke_handler(tauri::generate_handler![
      desktop::set_global_shortcut,
      desktop::global_shortcut_state,
      desktop::set_close_to_tray,
      open_path,
      brave_search::brave_llm_context,
      fetch_page::fetch_page,
      secrets::secret_set,
      secrets::secret_get,
      secrets::secret_delete,
      local_runtime::spawn_runtime,
      local_runtime::stop_runtime,
      local_runtime::runtime_status,
      local_runtime::probe_http,
      local_runtime::ollama_tags,
      local_runtime::path_exists,
      local_runtime::pick_directory,
      local_runtime::pick_file,
      local_runtime::runtime_candidate_paths,
    ])
    .manage(desktop::DesktopState::default())
    .manage(BridgeChild(Mutex::new(None)))
    .manage(local_runtime::LocalRuntimeState::default())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      desktop::install(app, cleanup_children)?;
      if bridge_already_running() {
        eprintln!("[gatesai] bridge already running on 7331; reusing");
        return Ok(());
      }
      let sidecar_result = app
        .shell()
        .sidecar("gatesai-bridge")
        .and_then(|s| Ok(s.args(["--listen", BRIDGE_LISTEN])))
        .and_then(|s| s.spawn());
      let (mut rx, child) = match sidecar_result {
        Ok(pair) => pair,
        Err(err) => {
          eprintln!("[gatesai] bridge sidecar unavailable: {err}; workspace tools will be offline");
          return Ok(());
        }
      };
      tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
          match event {
            CommandEvent::Stdout(bytes) => {
              log::info!("[bridge stdout] {}", String::from_utf8_lossy(&bytes).trim_end());
            }
            CommandEvent::Stderr(bytes) => {
              log::warn!("[bridge stderr] {}", String::from_utf8_lossy(&bytes).trim_end());
            }
            CommandEvent::Terminated(payload) => {
              log::warn!("[bridge] sidecar terminated: {:?}", payload);
            }
            _ => {}
          }
        }
      });
      let state = app.state::<BridgeChild>();
      let mut guard = match state.0.lock() {
        Ok(g) => g,
        Err(poison) => poison.into_inner(),
      };
      guard.replace(child);
      eprintln!("[gatesai] spawned bridge sidecar");
      Ok(())
    })
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        if desktop::close_to_tray_enabled(window) {
          api.prevent_close();
          if let Err(err) = window.hide() {
            log::warn!("[gatesai] failed to hide window on close request: {err}");
          }
        }
      } else if let tauri::WindowEvent::Destroyed = event {
        let app = window.app_handle();
        cleanup_children(&app);
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
