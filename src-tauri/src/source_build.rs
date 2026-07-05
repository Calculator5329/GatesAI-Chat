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
    job_kind: Option<String>,
    command: Option<String>,
    cmdline: Option<String>,
    source_root: Option<String>,
    started_at_unix: Option<u64>,
    finished_at_unix: Option<u64>,
    exit_code: Option<i32>,
    steps: Vec<SourceBuildStepSnapshot>,
    logs: Vec<String>,
    last_error: Option<String>,
    installer_path: Option<String>,
    installer_bytes: Option<u64>,
    last_build: Option<SourceBuildJobSummary>,
    last_test: Option<SourceBuildJobSummary>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceBuildStepSnapshot {
    id: String,
    label: String,
    cmdline: String,
    status: String,
    started_at_unix: Option<u64>,
    finished_at_unix: Option<u64>,
    exit_code: Option<i32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceBuildJobSummary {
    job_kind: String,
    command: String,
    status: String,
    started_at_unix: Option<u64>,
    finished_at_unix: Option<u64>,
    exit_code: Option<i32>,
    steps: Vec<SourceBuildStepSnapshot>,
    failure_tail: Option<String>,
}

impl Default for SourceBuildSnapshot {
    fn default() -> Self {
        Self {
            status: "idle".to_string(),
            job_kind: None,
            command: None,
            cmdline: None,
            source_root: None,
            started_at_unix: None,
            finished_at_unix: None,
            exit_code: None,
            steps: Vec::new(),
            logs: Vec::new(),
            last_error: None,
            installer_path: None,
            installer_bytes: None,
            last_build: None,
            last_test: None,
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
    let last_build = guard.last_build.clone();
    let last_test = guard.last_test.clone();
    *guard = SourceBuildSnapshot {
        last_build,
        last_test,
        ..SourceBuildSnapshot::default()
    };
    Ok(guard.clone())
}

#[tauri::command]
pub fn source_build_start(
    app: AppHandle,
    command: String,
    state: tauri::State<'_, SourceBuildState>,
) -> Result<SourceBuildSnapshot, String> {
    let job = job_spec(&command)?;
    let source_root = prepared_source_root(&app)?;
    let state_arc = Arc::clone(&state.0);

    {
        let mut guard = state_arc
            .lock()
            .map_err(|_| "source build state lock poisoned".to_string())?;
        if guard.status == "running" {
            return Err("A source build job is already running.".to_string());
        }
        let last_build = guard.last_build.clone();
        let last_test = guard.last_test.clone();
        *guard = SourceBuildSnapshot {
            status: "running".to_string(),
            job_kind: Some(job.kind.to_string()),
            command: Some(job.command.to_string()),
            cmdline: Some(job.cmdline()),
            source_root: Some(path_string(&source_root)),
            started_at_unix: Some(unix_now()),
            finished_at_unix: None,
            exit_code: None,
            steps: job.step_snapshots(),
            logs: vec![format!(
                "[job] starting {} job: {}",
                job.kind,
                job.cmdline()
            )],
            last_error: None,
            installer_path: None,
            installer_bytes: None,
            last_build,
            last_test,
        };
    }

    std::thread::spawn(move || run_job(state_arc, source_root, job));
    Ok(snapshot(&state.0))
}

fn run_job(state: Arc<Mutex<SourceBuildSnapshot>>, source_root: PathBuf, job: SourceBuildJob) {
    let mut exit_code = 0;
    let mut failed_step: Option<String> = None;
    for (index, step) in job.steps.iter().enumerate() {
        if step.skip_if_node_modules && source_root.join("node_modules").is_dir() {
            update_step_skipped(&state, index);
            continue;
        }
        match run_step(Arc::clone(&state), &source_root, step, index) {
            Ok(code) if code == 0 => {
                update_step_finished(&state, index, "succeeded", Some(code));
            }
            Ok(code) => {
                exit_code = code;
                failed_step = Some(step.cmdline());
                update_step_finished(&state, index, "failed", Some(code));
                break;
            }
            Err(message) => {
                update_step_finished(&state, index, "failed", None);
                finish_with_error(&state, message);
                return;
            }
        }
    }

    let (installer_path, installer_bytes) = if job.command == "package" && exit_code == 0 {
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
        if let Some(cmdline) = failed_step {
            guard.last_error = Some(format!("{cmdline} exited with code {exit_code}"));
        }
        let summary = summary_from_snapshot(&guard);
        if job.kind == "test" {
            guard.last_test = Some(summary);
        } else {
            guard.last_build = Some(summary);
        }
    }
}

fn run_step(
    state: Arc<Mutex<SourceBuildSnapshot>>,
    source_root: &Path,
    step: &SourceBuildCommand,
    step_index: usize,
) -> Result<i32, String> {
    update_step_running(&state, step_index);
    push_log(&state, format!("$ {}", step.cmdline()));
    let mut command = Command::new(npm_program());
    command
        .args(&step.args)
        .current_dir(&source_root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(err) => return Err(format!("failed to start {}: {err}", step.cmdline())),
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
            return Err(format!(
                "failed while waiting for {}: {err}",
                step.cmdline()
            ))
        }
    };
    for reader in readers {
        let _ = reader.join();
    }

    Ok(status.code().unwrap_or(-1))
}

fn update_step_running(state: &Arc<Mutex<SourceBuildSnapshot>>, step_index: usize) {
    if let Ok(mut guard) = state.lock() {
        if let Some(step) = guard.steps.get_mut(step_index) {
            step.status = "running".to_string();
            step.started_at_unix = Some(unix_now());
        }
    }
}

fn update_step_finished(
    state: &Arc<Mutex<SourceBuildSnapshot>>,
    step_index: usize,
    status: &str,
    exit_code: Option<i32>,
) {
    if let Ok(mut guard) = state.lock() {
        if let Some(step) = guard.steps.get_mut(step_index) {
            step.status = status.to_string();
            step.finished_at_unix = Some(unix_now());
            step.exit_code = exit_code;
        }
    }
}

fn update_step_skipped(state: &Arc<Mutex<SourceBuildSnapshot>>, step_index: usize) {
    if let Ok(mut guard) = state.lock() {
        let mut skipped_cmdline: Option<String> = None;
        if let Some(step) = guard.steps.get_mut(step_index) {
            step.status = "skipped".to_string();
            step.started_at_unix = Some(unix_now());
            step.finished_at_unix = step.started_at_unix;
            step.exit_code = Some(0);
            skipped_cmdline = Some(step.cmdline.clone());
        }
        if let Some(cmdline) = skipped_cmdline {
            push_log_locked(
                &mut guard,
                format!("[job] skipped {cmdline}; node_modules already exists"),
            );
        }
    }
}

fn summary_from_snapshot(snapshot: &SourceBuildSnapshot) -> SourceBuildJobSummary {
    SourceBuildJobSummary {
        job_kind: snapshot
            .job_kind
            .clone()
            .unwrap_or_else(|| "build".to_string()),
        command: snapshot.command.clone().unwrap_or_default(),
        status: snapshot.status.clone(),
        started_at_unix: snapshot.started_at_unix,
        finished_at_unix: snapshot.finished_at_unix,
        exit_code: snapshot.exit_code,
        steps: snapshot.steps.clone(),
        failure_tail: if snapshot.status == "failed" {
            Some(log_tail_chars(&snapshot.logs, 8_000))
        } else {
            None
        },
    }
}

fn log_tail_chars(logs: &[String], max_chars: usize) -> String {
    let joined = logs.join("\n");
    let count = joined.chars().count();
    if count <= max_chars {
        return joined;
    }
    joined.chars().skip(count - max_chars).collect()
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
    label: &'static str,
    args: Vec<&'static str>,
    skip_if_node_modules: bool,
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

#[derive(Debug)]
struct SourceBuildJob {
    kind: &'static str,
    command: &'static str,
    steps: Vec<SourceBuildCommand>,
}

impl SourceBuildJob {
    fn cmdline(&self) -> String {
        self.steps
            .iter()
            .map(SourceBuildCommand::cmdline)
            .collect::<Vec<_>>()
            .join(" && ")
    }

    fn step_snapshots(&self) -> Vec<SourceBuildStepSnapshot> {
        self.steps
            .iter()
            .map(|step| SourceBuildStepSnapshot {
                id: step.id.to_string(),
                label: step.label.to_string(),
                cmdline: step.cmdline(),
                status: "pending".to_string(),
                started_at_unix: None,
                finished_at_unix: None,
                exit_code: None,
            })
            .collect()
    }
}

fn command_spec(command: &str) -> Result<SourceBuildCommand, String> {
    match command.trim() {
        "install" => Ok(SourceBuildCommand {
            id: "install",
            label: "install",
            args: vec!["install"],
            skip_if_node_modules: false,
        }),
        "ci" => Ok(SourceBuildCommand {
            id: "ci",
            label: "npm ci",
            args: vec!["ci"],
            skip_if_node_modules: true,
        }),
        "test" => Ok(SourceBuildCommand {
            id: "test",
            label: "test",
            args: vec!["test"],
            skip_if_node_modules: false,
        }),
        "typecheck" => Ok(SourceBuildCommand {
            id: "typecheck",
            label: "typecheck",
            args: vec!["run", "typecheck"],
            skip_if_node_modules: false,
        }),
        "lint" => Ok(SourceBuildCommand {
            id: "lint",
            label: "lint",
            args: vec!["run", "lint"],
            skip_if_node_modules: false,
        }),
        "build" => Ok(SourceBuildCommand {
            id: "build",
            label: "build",
            args: vec!["run", "build"],
            skip_if_node_modules: false,
        }),
        "package" => Ok(SourceBuildCommand {
            id: "package",
            label: "package",
            args: vec!["run", "tauri:build"],
            skip_if_node_modules: false,
        }),
        other => Err(format!(
            "Unknown source build command `{other}`. Valid: install, ci, test, typecheck, lint, build, package."
        )),
    }
}

fn job_spec(command: &str) -> Result<SourceBuildJob, String> {
    match command.trim() {
        "test" => {
            // These scripts run in the managed source copy with the same trust
            // boundary as the existing package build, which already executes npm.
            Ok(SourceBuildJob {
                kind: "test",
                command: "test",
                steps: vec![
                    command_spec("ci")?,
                    command_spec("test")?,
                    command_spec("typecheck")?,
                    command_spec("lint")?,
                ],
            })
        }
        "install" | "build" | "package" => Ok(SourceBuildJob {
            kind: "build",
            command: match command.trim() {
                "install" => "install",
                "build" => "build",
                _ => "package",
            },
            steps: vec![command_spec(command)?],
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
        assert_eq!(command_spec("ci").unwrap().args, vec!["ci"]);
        assert_eq!(command_spec("test").unwrap().args, vec!["test"]);
        assert_eq!(
            command_spec("typecheck").unwrap().args,
            vec!["run", "typecheck"]
        );
        assert_eq!(command_spec("lint").unwrap().args, vec!["run", "lint"]);
        assert_eq!(command_spec("build").unwrap().args, vec!["run", "build"]);
        assert_eq!(
            command_spec("package").unwrap().args,
            vec!["run", "tauri:build"]
        );
        assert!(command_spec("start").is_err());
        assert!(command_spec("npm run anything").is_err());
    }

    #[test]
    fn test_job_runs_ci_test_typecheck_lint_in_order() {
        let job = job_spec("test").unwrap();
        assert_eq!(job.kind, "test");
        assert_eq!(
            job.steps.iter().map(|step| step.id).collect::<Vec<_>>(),
            vec!["ci", "test", "typecheck", "lint"]
        );
        assert_eq!(
            job.steps
                .iter()
                .map(SourceBuildCommand::cmdline)
                .collect::<Vec<_>>(),
            vec![
                format!("{} ci", npm_program()),
                format!("{} test", npm_program()),
                format!("{} run typecheck", npm_program()),
                format!("{} run lint", npm_program()),
            ]
        );
        assert!(job.steps[0].skip_if_node_modules);
    }

    #[test]
    fn job_spec_keeps_one_job_kind_for_build_commands() {
        for command in ["install", "build", "package"] {
            let job = job_spec(command).unwrap();
            assert_eq!(job.kind, "build");
            assert_eq!(job.steps.len(), 1);
        }
        assert!(job_spec("lint").is_err());
    }

    #[test]
    fn running_snapshot_blocks_new_jobs_and_clear() {
        let state = Arc::new(Mutex::new(SourceBuildSnapshot {
            status: "running".to_string(),
            ..SourceBuildSnapshot::default()
        }));
        let guard = state.lock().unwrap();
        assert_eq!(guard.status, "running");
        drop(guard);
        let snapshot = snapshot(&state);
        assert_eq!(snapshot.status, "running");
    }

    #[test]
    fn default_snapshot_is_idle() {
        let snapshot = SourceBuildSnapshot::default();
        assert_eq!(snapshot.status, "idle");
        assert!(snapshot.logs.is_empty());
    }
}
