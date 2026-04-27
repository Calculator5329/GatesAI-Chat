use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::str::FromStr;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Instant;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::http_health::probe_health;

const MAX_LOG_LINES: usize = 2000;
const OLLAMA_HEALTH_URL: &str = "http://127.0.0.1:11434/api/version";
const COMFY_HEALTH_URL: &str = "http://127.0.0.1:8188/system_stats";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeKind {
  Ollama,
  ComfyUI,
}

impl RuntimeKind {
  pub fn health_url(self) -> &'static str {
    match self {
      RuntimeKind::Ollama => OLLAMA_HEALTH_URL,
      RuntimeKind::ComfyUI => COMFY_HEALTH_URL,
    }
  }

  fn spec(self, install_path: &str) -> Result<RuntimeSpec, String> {
    match self {
      RuntimeKind::Ollama => ollama_spec(install_path),
      RuntimeKind::ComfyUI => comfy_spec(install_path),
    }
  }
}

impl FromStr for RuntimeKind {
  type Err = String;
  fn from_str(s: &str) -> Result<Self, Self::Err> {
    match s {
      "ollama" => Ok(RuntimeKind::Ollama),
      "comfyui" => Ok(RuntimeKind::ComfyUI),
      _ => Err(format!("unknown local runtime {s}")),
    }
  }
}
#[cfg(windows)]
const COMFY_WINDOWS_PLATFORM_BOOTSTRAP: &str = r#"import collections, platform, runpy, sys
U = collections.namedtuple('uname_result', 'system node release version machine processor')
platform.win32_ver = lambda *a, **k: ('10', '10.0.26200', '', 'Multiprocessor Free')
platform.system = lambda: 'Windows'
platform.machine = lambda: 'AMD64'
platform.processor = lambda: 'AMD64'
platform.uname = lambda: U('Windows', 'localhost', '10', '10.0.26200', 'AMD64', 'AMD64')
main = sys.argv[1]
sys.argv = sys.argv[1:]
runpy.run_path(main, run_name='__main__')"#;

#[derive(Default)]
pub struct LocalRuntimeState(pub Mutex<HashMap<String, RuntimeProcess>>);

pub struct RuntimeProcess {
  child: Child,
  started_at: Instant,
  health_url: String,
  logs: Arc<Mutex<VecDeque<String>>>,
  last_error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
  running: bool,
  pid: Option<u32>,
  uptime_ms: Option<u128>,
  status: String,
  logs: Vec<String>,
  last_error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCandidatePaths {
  platform: String,
  home_dir: String,
  local_app_data: String,
  comfy_candidates: Vec<String>,
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
  PathBuf::from(path).exists()
}

#[tauri::command]
pub fn pick_directory(app: AppHandle) -> Result<Option<String>, String> {
  Ok(app
    .dialog()
    .file()
    .blocking_pick_folder()
    .map(|path| path.to_string()))
}

#[tauri::command]
pub fn pick_file(app: AppHandle) -> Result<Option<String>, String> {
  Ok(app
    .dialog()
    .file()
    .blocking_pick_file()
    .map(|path| path.to_string()))
}

#[tauri::command]
pub fn runtime_candidate_paths() -> RuntimeCandidatePaths {
  let home = std::env::var("USERPROFILE")
    .or_else(|_| std::env::var("HOME"))
    .unwrap_or_default();
  let local_app_data = std::env::var("LOCALAPPDATA")
    .unwrap_or_else(|_| if home.is_empty() { String::new() } else { PathBuf::from(&home).join("AppData").join("Local").to_string_lossy().to_string() });
  let comfy_candidates = if home.is_empty() {
    Vec::new()
  } else {
    vec![
      PathBuf::from(&home).join("ComfyUI_windows_portable"),
      PathBuf::from(&home).join("ComfyUI").join("ComfyUI_windows_portable"),
      PathBuf::from(&home).join("Downloads").join("ComfyUI_windows_portable"),
      PathBuf::from(&home).join("Downloads").join("ComfyUI_fresh").join("ComfyUI_windows_portable"),
      PathBuf::from(&home).join("Desktop").join("ComfyUI_windows_portable"),
      PathBuf::from(&home).join("Desktop").join("ComfyUI_fresh").join("ComfyUI_windows_portable"),
    ].into_iter().map(|p| p.to_string_lossy().to_string()).collect()
  };
  RuntimeCandidatePaths {
    platform: std::env::consts::OS.to_string(),
    home_dir: home,
    local_app_data,
    comfy_candidates,
  }
}

#[tauri::command]
pub fn spawn_runtime(
  id: String,
  install_path: String,
  state: tauri::State<'_, LocalRuntimeState>,
) -> Result<(), String> {
  let kind = RuntimeKind::from_str(&id)?;

  {
    let mut guard = lock_state(&state);
    if let Some(existing) = guard.get_mut(&id) {
      if existing.child.try_wait().map_err(|err| err.to_string())?.is_none() {
        return Ok(());
      }
    }
  }

  let spec = kind.spec(&install_path)?;
  let logs = Arc::new(Mutex::new(VecDeque::with_capacity(MAX_LOG_LINES)));
  let mut command = Command::new(&spec.program);
  command
    .args(&spec.args)
    .current_dir(&spec.cwd)
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .stdin(Stdio::null());

  let mut child = command
    .spawn()
    .map_err(|err| format!("failed to start {id}: {err}"))?;

  if let Some(stdout) = child.stdout.take() {
    pipe_logs(format!("{id} stdout"), stdout, Arc::clone(&logs));
  }
  if let Some(stderr) = child.stderr.take() {
    pipe_logs(format!("{id} stderr"), stderr, Arc::clone(&logs));
  }

  let process = RuntimeProcess {
    child,
    started_at: Instant::now(),
    health_url: kind.health_url().to_string(),
    logs,
    last_error: None,
  };

  let mut guard = lock_state(&state);
  guard.insert(id, process);
  Ok(())
}

#[tauri::command]
pub fn stop_runtime(id: String, state: tauri::State<'_, LocalRuntimeState>) -> Result<(), String> {
  RuntimeKind::from_str(&id)?;
  let mut guard = lock_state(&state);
  if let Some(mut process) = guard.remove(&id) {
    let _ = process.child.kill();
    let _ = process.child.wait();
  }
  Ok(())
}

#[tauri::command]
pub fn runtime_status(id: String, state: tauri::State<'_, LocalRuntimeState>) -> Result<RuntimeStatus, String> {
  RuntimeKind::from_str(&id)?;
  let mut guard = lock_state(&state);
  let Some(process) = guard.get_mut(&id) else {
    return Ok(RuntimeStatus {
      running: false,
      pid: None,
      uptime_ms: None,
      status: "stopped".to_string(),
      logs: Vec::new(),
      last_error: None,
    });
  };

  if let Some(exit) = process.child.try_wait().map_err(|err| err.to_string())? {
    process.last_error = Some(format!("process exited with {exit}"));
    return Ok(RuntimeStatus {
      running: false,
      pid: None,
      uptime_ms: Some(process.started_at.elapsed().as_millis()),
      status: "crashed".to_string(),
      logs: snapshot_logs(&process.logs),
      last_error: process.last_error.clone(),
    });
  }

  let online = probe_health(&process.health_url);
  Ok(RuntimeStatus {
    running: true,
    pid: Some(process.child.id()),
    uptime_ms: Some(process.started_at.elapsed().as_millis()),
    status: if online { "online" } else { "offline" }.to_string(),
    logs: snapshot_logs(&process.logs),
    last_error: process.last_error.clone(),
  })
}

pub fn kill_all(state: &LocalRuntimeState) {
  let mut guard = state.0.lock().unwrap_or_else(|poison| {
    log::warn!("[gatesai] local runtime state lock was poisoned during shutdown; recovering");
    poison.into_inner()
  });
  for (_, mut process) in guard.drain() {
    let _ = process.child.kill();
    let _ = process.child.wait();
  }
}

fn lock_state<'a>(
  state: &'a tauri::State<'_, LocalRuntimeState>,
) -> MutexGuard<'a, HashMap<String, RuntimeProcess>> {
  state.0.lock().unwrap_or_else(|poison| {
    log::warn!("[gatesai] local runtime state lock was poisoned; recovering");
    poison.into_inner()
  })
}

struct RuntimeSpec {
  program: PathBuf,
  args: Vec<String>,
  cwd: PathBuf,
}

fn ollama_spec(install_path: &str) -> Result<RuntimeSpec, String> {
  let exe = PathBuf::from(install_path);
  if exe.file_name().and_then(|n| n.to_str()).map(|n| n.eq_ignore_ascii_case("ollama.exe") || n == "ollama") != Some(true) {
    return Err("Ollama path must point to ollama.exe (or ollama on Unix).".to_string());
  }
  if !exe.exists() {
    return Err(format!("Ollama executable does not exist: {}", exe.display()));
  }
  let cwd = exe.parent().unwrap_or_else(|| Path::new(".")).to_path_buf();
  Ok(RuntimeSpec { program: exe, args: vec!["serve".to_string()], cwd })
}

fn comfy_spec(install_path: &str) -> Result<RuntimeSpec, String> {
  let python_leaf = if cfg!(windows) { "python.exe" } else { "python" };
  let raw = PathBuf::from(install_path);
  let candidates: Vec<PathBuf> = {
    let mut v = vec![raw.clone()];
    if let Some(parent) = raw.parent() { v.push(parent.to_path_buf()); }
    v
  };
  let root = candidates.into_iter().find(|p| {
    p.join("python_embeded").join(python_leaf).exists() && p.join("ComfyUI").join("main.py").exists()
  }).ok_or_else(|| format!(
    "ComfyUI portable root not found at {}. Point this at the folder that contains both python_embeded\\ and ComfyUI\\.",
    raw.display()
  ))?;
  let python = root.join("python_embeded").join(python_leaf);
  let main = root.join("ComfyUI").join("main.py");
  let args = if cfg!(windows) {
    vec![
      "-s".to_string(),
      "-u".to_string(),
      "-c".to_string(),
      COMFY_WINDOWS_PLATFORM_BOOTSTRAP.to_string(),
      main.to_string_lossy().to_string(),
      "--windows-standalone-build".to_string(),
      "--enable-cors-header".to_string(),
      "*".to_string(),
    ]
  } else {
    vec![
      "-s".to_string(),
      main.to_string_lossy().to_string(),
      "--enable-cors-header".to_string(),
      "*".to_string(),
    ]
  };
  Ok(RuntimeSpec {
    program: python,
    cwd: root,
    args,
  })
}

fn pipe_logs<R: std::io::Read + Send + 'static>(label: String, reader: R, logs: Arc<Mutex<VecDeque<String>>>) {
  std::thread::spawn(move || {
    let reader = BufReader::new(reader);
    for line in reader.lines().map_while(Result::ok) {
      push_log(&logs, format!("[{label}] {line}"));
    }
  });
}

fn push_log(logs: &Arc<Mutex<VecDeque<String>>>, line: String) {
  if let Ok(mut guard) = logs.lock() {
    if guard.len() >= MAX_LOG_LINES {
      guard.pop_front();
    }
    guard.push_back(line);
  }
}

fn snapshot_logs(logs: &Arc<Mutex<VecDeque<String>>>) -> Vec<String> {
  logs.lock().map(|guard| guard.iter().cloned().collect()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;

  #[test]
  #[cfg(windows)]
  fn comfy_spec_accepts_inner_folder_and_uses_windows_bootstrap() {
    let root = std::env::temp_dir().join(format!(
      "gatesai-comfy-spec-{}",
      std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock before epoch")
        .as_nanos()
    ));
    let inner = root.join("ComfyUI");
    fs::create_dir_all(root.join("python_embeded")).expect("create python dir");
    fs::create_dir_all(&inner).expect("create comfy dir");
    fs::write(root.join("python_embeded").join("python.exe"), "").expect("write python exe");
    fs::write(inner.join("main.py"), "").expect("write main");

    let spec = comfy_spec(&inner.to_string_lossy()).expect("build comfy spec");

    assert_eq!(spec.cwd, root);
    assert!(spec.program.ends_with(PathBuf::from("python_embeded").join("python.exe")));
    assert_eq!(spec.args[0], "-s");
    assert_eq!(spec.args[1], "-u");
    assert_eq!(spec.args[2], "-c");
    assert!(spec.args[3].contains("platform.win32_ver"));
    assert!(spec.args[3].contains("platform.uname"));
    assert_eq!(spec.args[4], inner.join("main.py").to_string_lossy());
    assert!(spec.args.windows(2).any(|pair| pair == ["--enable-cors-header", "*"]));

    fs::remove_dir_all(spec.cwd).expect("remove temp comfy root");
  }
}
