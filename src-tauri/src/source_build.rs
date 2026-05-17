use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use crate::source_workspace::prepared_source_root;

const MAX_LOG_LINES: usize = 2000;

#[derive(Default)]
pub struct SourceBuildState(pub Arc<Mutex<SourceBuildSnapshot>>);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceBuildSnapshot {
    status: String,
    command: Option<String>,
    cmdline: Option<String>,
    source_root: Option<String>,
    started_at_unix: Option<u64>,
    finished_at_unix: Option<u64>,
    exit_code: Option<i32>,
    logs: Vec<String>,
    last_error: Option<String>,
    installer_path: Option<String>,
    installer_bytes: Option<u64>,
}

impl Default for SourceBuildSnapshot {
    fn default() -> Self {
        Self {
            status: "idle".to_string(),
            command: None,
            cmdline: None,
            source_root: None,
            started_at_unix: None,
            finished_at_unix: None,
            exit_code: None,
            logs: Vec::new(),
            last_error: None,
            installer_path: None,
            installer_bytes: None,
        }
    }
}

#[tauri::command]
pub fn source_build_status(state: tauri::State<'_, SourceBuildState>) -> SourceBuildSnapshot {
    snapshot(&state.0)
}

#[tauri::command]
pub fn source_build_clear(
    state: tauri::State<'_, SourceBuildState>,
) -> Result<SourceBuildSnapshot, String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "source build state lock poisoned".to_string())?;
    if guard.status == "running" {
        return Err("Cannot clear a running source build job.".to_string());
    }
    *guard = SourceBuildSnapshot::default();
    Ok(guard.clone())
}

#[tauri::command]
pub fn source_build_start(
    app: AppHandle,
    command: String,
    state: tauri::State<'_, SourceBuildState>,
) -> Result<SourceBuildSnapshot, String> {
    let spec = command_spec(&command)?;
    let source_root = prepared_source_root(&app)?;
    let state_arc = Arc::clone(&state.0);

    {
        let mut guard = state_arc
            .lock()
            .map_err(|_| "source build state lock poisoned".to_string())?;
        if guard.status == "running" {
            return Err("A source build job is already running.".to_string());
        }
        *guard = SourceBuildSnapshot {
            status: "running".to_string(),
            command: Some(spec.id.to_string()),
            cmdline: Some(spec.cmdline()),
            source_root: Some(path_string(&source_root)),
            started_at_unix: Some(unix_now()),
            finished_at_unix: None,
            exit_code: None,
            logs: vec![format!("$ {}", spec.cmdline())],
            last_error: None,
            installer_path: None,
            installer_bytes: None,
        };
    }

    std::thread::spawn(move || run_command(state_arc, source_root, spec));
    Ok(snapshot(&state.0))
}

fn run_command(
    state: Arc<Mutex<SourceBuildSnapshot>>,
    source_root: PathBuf,
    spec: SourceBuildCommand,
) {
    let mut command = Command::new(npm_program());
    command
        .args(&spec.args)
        .current_dir(&source_root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(err) => {
            finish_with_error(&state, format!("failed to start {}: {err}", spec.cmdline()));
            return;
        }
    };

    let mut readers = Vec::new();
    if let Some(stdout) = child.stdout.take() {
        readers.push(pipe_lines(Arc::clone(&state), "stdout", stdout));
    }
    if let Some(stderr) = child.stderr.take() {
        readers.push(pipe_lines(Arc::clone(&state), "stderr", stderr));
    }

    let status = match child.wait() {
        Ok(status) => status,
        Err(err) => {
            finish_with_error(
                &state,
                format!("failed while waiting for {}: {err}", spec.cmdline()),
            );
            return;
        }
    };
    for reader in readers {
        let _ = reader.join();
    }

    let exit_code = status.code().unwrap_or(-1);
    let (installer_path, installer_bytes) = if spec.id == "package" && exit_code == 0 {
        latest_installer(&source_root)
            .map(|(path, bytes)| (Some(path_string(&path)), Some(bytes)))
            .unwrap_or((None, None))
    } else {
        (None, None)
    };

    if let Ok(mut guard) = state.lock() {
        guard.status = if exit_code == 0 {
            "succeeded"
        } else {
            "failed"
        }
        .to_string();
        guard.finished_at_unix = Some(unix_now());
        guard.exit_code = Some(exit_code);
        guard.installer_path = installer_path;
        guard.installer_bytes = installer_bytes;
        if exit_code != 0 {
            guard.last_error = Some(format!("{} exited with code {exit_code}", spec.cmdline()));
        }
    }
}

fn pipe_lines<R: std::io::Read + Send + 'static>(
    state: Arc<Mutex<SourceBuildSnapshot>>,
    stream: &'static str,
    reader: R,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let reader = BufReader::new(reader);
        for line in reader.lines().map_while(Result::ok) {
            push_log(&state, format!("[{stream}] {line}"));
        }
    })
}

fn finish_with_error(state: &Arc<Mutex<SourceBuildSnapshot>>, message: String) {
    if let Ok(mut guard) = state.lock() {
        guard.status = "failed".to_string();
        guard.finished_at_unix = Some(unix_now());
        guard.exit_code = None;
        guard.last_error = Some(message.clone());
        push_log_locked(&mut guard, format!("[error] {message}"));
    }
}

fn push_log(state: &Arc<Mutex<SourceBuildSnapshot>>, line: String) {
    if let Ok(mut guard) = state.lock() {
        push_log_locked(&mut guard, line);
    }
}

fn push_log_locked(snapshot: &mut SourceBuildSnapshot, line: String) {
    if snapshot.logs.len() >= MAX_LOG_LINES {
        snapshot.logs.remove(0);
    }
    snapshot.logs.push(line);
}

fn snapshot(state: &Arc<Mutex<SourceBuildSnapshot>>) -> SourceBuildSnapshot {
    state
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_else(|_| SourceBuildSnapshot {
            status: "failed".to_string(),
            last_error: Some("source build state lock poisoned".to_string()),
            ..SourceBuildSnapshot::default()
        })
}

#[derive(Debug)]
struct SourceBuildCommand {
    id: &'static str,
    args: Vec<&'static str>,
}

impl SourceBuildCommand {
    fn cmdline(&self) -> String {
        [npm_program(), self.args.join(" ").as_str()]
            .into_iter()
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join(" ")
    }
}

fn command_spec(command: &str) -> Result<SourceBuildCommand, String> {
    match command.trim() {
        "install" => Ok(SourceBuildCommand {
            id: "install",
            args: vec!["install"],
        }),
        "test" => Ok(SourceBuildCommand {
            id: "test",
            args: vec!["test"],
        }),
        "build" => Ok(SourceBuildCommand {
            id: "build",
            args: vec!["run", "build"],
        }),
        "package" => Ok(SourceBuildCommand {
            id: "package",
            args: vec!["run", "tauri:build"],
        }),
        other => Err(format!(
            "Unknown source build command `{other}`. Valid: install, test, build, package."
        )),
    }
}

fn latest_installer(source_root: &Path) -> Option<(PathBuf, u64)> {
    let nsis_dir = source_root
        .join("src-tauri")
        .join("target")
        .join("release")
        .join("bundle")
        .join("nsis");
    let mut installers = read_installers(&nsis_dir)?;
    installers.sort_by_key(|(path, _)| modified_ms(path));
    installers.pop()
}

fn read_installers(path: &Path) -> Option<Vec<(PathBuf, u64)>> {
    let entries = std::fs::read_dir(path).ok()?;
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("exe"))
            != Some(true)
        {
            continue;
        }
        let metadata = entry.metadata().ok()?;
        out.push((path, metadata.len()));
    }
    Some(out)
}

fn modified_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn npm_program() -> &'static str {
    if cfg!(windows) {
        "npm.cmd"
    } else {
        "npm"
    }
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_spec_allows_only_known_commands() {
        assert_eq!(command_spec("install").unwrap().args, vec!["install"]);
        assert_eq!(command_spec("test").unwrap().args, vec!["test"]);
        assert_eq!(command_spec("build").unwrap().args, vec!["run", "build"]);
        assert_eq!(
            command_spec("package").unwrap().args,
            vec!["run", "tauri:build"]
        );
        assert!(command_spec("start").is_err());
        assert!(command_spec("npm run anything").is_err());
    }

    #[test]
    fn default_snapshot_is_idle() {
        let snapshot = SourceBuildSnapshot::default();
        assert_eq!(snapshot.status, "idle");
        assert!(snapshot.logs.is_empty());
    }
}
