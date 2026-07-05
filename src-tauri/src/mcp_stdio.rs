use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const STDERR_LINE_CAP: usize = 200;

#[derive(Default)]
pub struct McpStdioState(pub Mutex<HashMap<String, McpStdioProcess>>);

pub struct McpStdioProcess {
  child: Arc<Mutex<Child>>,
  stdin: Arc<Mutex<ChildStdin>>,
  exit_code: Arc<Mutex<Option<i32>>>,
}

#[derive(Clone, Serialize)]
struct McpStdioLineEvent {
  id: String,
  line: String,
}

#[derive(Clone, Serialize)]
struct McpStdioExitEvent {
  id: String,
  code: Option<i32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStdioStatus {
  running: bool,
  pid: Option<u32>,
  exit_code: Option<i32>,
}

#[tauri::command]
pub fn mcp_stdio_start(
  app: AppHandle,
  id: String,
  command: String,
  args: Vec<String>,
  env: HashMap<String, String>,
  state: tauri::State<'_, McpStdioState>,
) -> Result<(), String> {
  validate_id(&id)?;
  validate_command(&command, &args)?;
  validate_env(&env)?;

  {
    let mut guard = lock_state(&state);
    if let Some(existing) = guard.get_mut(&id) {
      if existing.exit_code.lock().unwrap_or_else(|poison| poison.into_inner()).is_none() {
        return Ok(());
      }
      guard.remove(&id);
    }
  }

  let mut child = Command::new(command.trim())
    .args(&args)
    .envs(&env)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|err| format!("failed to start MCP stdio server {id}: {err}"))?;

  let stdin = child.stdin.take().ok_or_else(|| "failed to open MCP stdio stdin".to_string())?;
  if let Some(stdout) = child.stdout.take() {
    pipe_stdout(app.clone(), id.clone(), stdout);
  }
  if let Some(stderr) = child.stderr.take() {
    pipe_stderr(app.clone(), id.clone(), stderr);
  }

  let child = Arc::new(Mutex::new(child));
  let exit_code = Arc::new(Mutex::new(None));
  watch_exit(app, id.clone(), Arc::clone(&child), Arc::clone(&exit_code));

  let process = McpStdioProcess {
    child,
    stdin: Arc::new(Mutex::new(stdin)),
    exit_code,
  };
  lock_state(&state).insert(id, process);
  Ok(())
}

#[tauri::command]
pub fn mcp_stdio_send(
  id: String,
  payload: String,
  state: tauri::State<'_, McpStdioState>,
) -> Result<(), String> {
  validate_id(&id)?;
  let stdin = {
    let guard = lock_state(&state);
    let process = guard.get(&id).ok_or_else(|| format!("MCP stdio server {id} is not running."))?;
    if process.exit_code.lock().unwrap_or_else(|poison| poison.into_inner()).is_some() {
      return Err(format!("MCP stdio server {id} has exited."));
    }
    Arc::clone(&process.stdin)
  };
  let mut guard = stdin.lock().unwrap_or_else(|poison| {
    log::warn!("[gatesai] MCP stdio stdin lock was poisoned; recovering");
    poison.into_inner()
  });
  let framed = frame_jsonrpc_line(&payload);
  guard.write_all(framed.as_bytes()).map_err(|err| err.to_string())?;
  guard.flush().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn mcp_stdio_stop(id: String, state: tauri::State<'_, McpStdioState>) -> Result<(), String> {
  validate_id(&id)?;
  let mut guard = lock_state(&state);
  if let Some(process) = guard.remove(&id) {
    let mut child = lock_child(&process.child);
    let _ = child.kill();
    let _ = child.wait();
  }
  Ok(())
}

#[tauri::command]
pub fn mcp_stdio_status(id: String, state: tauri::State<'_, McpStdioState>) -> Result<McpStdioStatus, String> {
  validate_id(&id)?;
  let mut guard = lock_state(&state);
  let Some(process) = guard.get_mut(&id) else {
    return Ok(McpStdioStatus { running: false, pid: None, exit_code: None });
  };
  let code = *process.exit_code.lock().unwrap_or_else(|poison| poison.into_inner());
  Ok(McpStdioStatus {
    running: code.is_none(),
    pid: if code.is_none() { Some(lock_child(&process.child).id()) } else { None },
    exit_code: code,
  })
}

pub fn kill_all(state: &McpStdioState) {
  let mut guard = state.0.lock().unwrap_or_else(|poison| {
    log::warn!("[gatesai] MCP stdio state lock was poisoned during shutdown; recovering");
    poison.into_inner()
  });
  for (_, process) in guard.drain() {
    let mut child = lock_child(&process.child);
    let _ = child.kill();
    let _ = child.wait();
  }
}

fn pipe_stdout<R: std::io::Read + Send + 'static>(app: AppHandle, id: String, reader: R) {
  thread::spawn(move || {
    let reader = BufReader::new(reader);
    for line in reader.lines().map_while(Result::ok) {
      emit_line(&app, "mcp-stdio-message", &id, line);
    }
  });
}

fn pipe_stderr<R: std::io::Read + Send + 'static>(app: AppHandle, id: String, reader: R) {
  thread::spawn(move || {
    let reader = BufReader::new(reader);
    let mut lines = 0usize;
    let mut marker_sent = false;
    for line in reader.lines().map_while(Result::ok) {
      if lines < STDERR_LINE_CAP {
        emit_line(&app, "mcp-stdio-stderr", &id, line);
        lines += 1;
      } else if !marker_sent {
        emit_line(&app, "mcp-stdio-stderr", &id, "[stderr line cap reached; further stderr output dropped]".to_string());
        marker_sent = true;
      }
    }
  });
}

fn watch_exit(app: AppHandle, id: String, child: Arc<Mutex<Child>>, exit_code: Arc<Mutex<Option<i32>>>) {
  thread::spawn(move || loop {
    let code = {
      let mut guard = lock_child(&child);
      match guard.try_wait() {
        Ok(Some(status)) => Some(status.code()),
        Ok(None) => None,
        Err(err) => {
          log::warn!("[gatesai] MCP stdio status failed for {id}: {err}");
          Some(None)
        }
      }
    };
    if let Some(code) = code {
      *exit_code.lock().unwrap_or_else(|poison| poison.into_inner()) = code;
      let _ = app.emit("mcp-stdio-exit", McpStdioExitEvent { id, code });
      break;
    }
    thread::sleep(Duration::from_millis(100));
  });
}

fn emit_line(app: &AppHandle, event: &str, id: &str, line: String) {
  let _ = app.emit(event, McpStdioLineEvent { id: id.to_string(), line });
}

fn lock_state<'a>(
  state: &'a tauri::State<'_, McpStdioState>,
) -> MutexGuard<'a, HashMap<String, McpStdioProcess>> {
  state.0.lock().unwrap_or_else(|poison| {
    log::warn!("[gatesai] MCP stdio state lock was poisoned; recovering");
    poison.into_inner()
  })
}

fn lock_child(child: &Arc<Mutex<Child>>) -> MutexGuard<'_, Child> {
  child.lock().unwrap_or_else(|poison| {
    log::warn!("[gatesai] MCP stdio child lock was poisoned; recovering");
    poison.into_inner()
  })
}

pub fn frame_jsonrpc_line(payload: &str) -> String {
  format!("{}\n", payload.trim_end_matches(['\r', '\n']))
}

fn validate_id(id: &str) -> Result<(), String> {
  if id.trim().is_empty() || has_nul(id) {
    return Err("MCP stdio id is required.".to_string());
  }
  Ok(())
}

pub fn validate_command(command: &str, args: &[String]) -> Result<(), String> {
  let command = command.trim();
  if command.is_empty() {
    return Err("MCP stdio command is required.".to_string());
  }
  if has_nul(command) || args.iter().any(|arg| has_nul(arg)) {
    return Err("MCP stdio command and arguments cannot contain NUL bytes.".to_string());
  }
  let leaf = command
    .replace('\\', "/")
    .rsplit('/')
    .next()
    .unwrap_or(command)
    .to_ascii_lowercase();
  let first_arg = args
    .iter()
    .find(|arg| !arg.trim().is_empty())
    .map(|arg| arg.trim().to_ascii_lowercase());
  if (leaf == "cmd" || leaf == "cmd.exe") && matches!(first_arg.as_deref(), Some("/c") | Some("/k")) {
    return Err("cmd /c and cmd /k are not allowed for MCP stdio servers.".to_string());
  }
  Ok(())
}

pub fn validate_env(env: &HashMap<String, String>) -> Result<(), String> {
  for (name, value) in env {
    if name.trim().is_empty() || name.contains('=') || has_nul(name) {
      return Err(format!("Invalid MCP stdio environment variable name: {name}"));
    }
    if has_nul(value) {
      return Err("MCP stdio environment variable values cannot contain NUL bytes.".to_string());
    }
  }
  Ok(())
}

fn has_nul(value: &str) -> bool {
  value.as_bytes().contains(&0)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn frames_payload_as_one_jsonrpc_line() {
    assert_eq!(frame_jsonrpc_line(r#"{"jsonrpc":"2.0"}"#), "{\"jsonrpc\":\"2.0\"}\n");
    assert_eq!(frame_jsonrpc_line("payload\r\n"), "payload\n");
  }

  #[test]
  fn validates_stdio_command_without_shelling_out() {
    assert!(validate_command("npx", &["@modelcontextprotocol/server-filesystem".to_string()]).is_ok());
    assert!(validate_command("", &[]).is_err());
    assert!(validate_command("cmd.exe", &["/c".to_string(), "echo hi".to_string()]).is_err());
    assert!(validate_command("cmd", &["/k".to_string(), "echo hi".to_string()]).is_err());
    assert!(validate_command("node", &["bad\0arg".to_string()]).is_err());
  }

  #[test]
  fn validates_env_names_and_values() {
    let mut env = HashMap::new();
    env.insert("API_KEY".to_string(), "secret".to_string());
    assert!(validate_env(&env).is_ok());
    env.insert("BAD=NAME".to_string(), "x".to_string());
    assert!(validate_env(&env).is_err());
  }
}
