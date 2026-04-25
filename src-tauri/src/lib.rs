use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const BRIDGE_LISTEN: &str = "127.0.0.1:7331";
const BRIDGE_HEALTH_URL: &str = "http://127.0.0.1:7331/health";

struct BridgeChild(Mutex<Option<CommandChild>>);

fn bridge_already_running() -> bool {
  let client = reqwest::blocking::Client::builder()
    .timeout(std::time::Duration::from_millis(500))
    .build();
  let Ok(client) = client else { return false };
  matches!(
    client.get(BRIDGE_HEALTH_URL).send(),
    Ok(r) if r.status().is_success()
  )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .manage(BridgeChild(Mutex::new(None)))
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      if bridge_already_running() {
        eprintln!("[gatesai] bridge already running on 7331; reusing");
        return Ok(());
      }
      let sidecar = app
        .shell()
        .sidecar("gatesai-bridge")?
        .args(["--listen", BRIDGE_LISTEN]);
      let (mut rx, child) = sidecar.spawn()?;
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
      app.state::<BridgeChild>().0.lock().unwrap().replace(child);
      eprintln!("[gatesai] spawned bridge sidecar");
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
