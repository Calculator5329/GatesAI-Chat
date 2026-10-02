//! HTTP pass-through for the local model runtimes (Ollama and ComfyUI).
//!
//! The webview's fetch is bound by CORS and the CSP. Making the request from
//! Rust instead means a running Ollama or ComfyUI works without OLLAMA_ORIGINS
//! or --enable-cors-header, and the Ollama host can be any http(s) server.
//! Only app code calls these commands (no model tool reaches them) and only
//! fixed Ollama and ComfyUI API paths are allowed. See
//! docs/adr/2026-10-01-local-http-passthrough.md.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use reqwest::{Method, Url};
use serde::{Deserialize, Serialize};
use tauri::async_runtime::JoinHandle;
use tauri::ipc::{Channel, InvokeResponseBody};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

/// Ollama and ComfyUI endpoints the app calls, matched exactly after URL
/// normalization (so `..` segments are already resolved).
const EXACT_PATHS: &[&str] = &[
  "/api/tags",
  "/api/version",
  "/api/chat",
  "/api/generate",
  "/api/pull",
  "/api/delete",
  "/api/embed",
  "/api/show",
  "/api/ps",
  "/system_stats",
  "/object_info",
  "/prompt",
  "/view",
  "/queue",
  "/interrupt",
];

/// ComfyUI endpoints that take exactly one trailing segment (a node class
/// name or a prompt id), checked by `is_plain_segment`.
const ONE_SEGMENT_PREFIXES: &[&str] = &["/object_info/", "/history/"];

const PASS_THROUGH_HEADERS: [HeaderName; 3] = [CONTENT_TYPE, ACCEPT, AUTHORIZATION];

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum LocalHttpMethod {
  Get,
  Post,
  Delete,
}

impl From<LocalHttpMethod> for Method {
  fn from(method: LocalHttpMethod) -> Self {
    match method {
      LocalHttpMethod::Get => Method::GET,
      LocalHttpMethod::Post => Method::POST,
      LocalHttpMethod::Delete => Method::DELETE,
    }
  }
}

/// One request from `localFetch` in `src/services/local/localHttp.ts`.
/// `id` is chosen by the caller and names the request for `local_http_cancel`.
#[derive(Deserialize)]
pub struct LocalHttpRequest {
  id: String,
  url: String,
  method: LocalHttpMethod,
  #[serde(default)]
  headers: HashMap<String, String>,
  body: Option<String>,
}

/// JSON events on the channel. Body bytes travel between `head` and the
/// terminal `end`/`error` as raw channel messages (an ArrayBuffer in JS).
#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "event", rename_all = "camelCase")]
enum LocalHttpEvent {
  #[serde(rename_all = "camelCase")]
  Head {
    status: u16,
    status_text: String,
    content_type: Option<String>,
  },
  End,
  Error { message: String },
}

/// In-flight requests by id, so `local_http_cancel` can abort the task even
/// while it is waiting on a slow server, plus the shared HTTP clients. The
/// clients are built once so connections are kept alive across the many
/// polls of one ComfyUI render; a build failure is reported per request.
pub struct LocalHttpState {
  tasks: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
  clients: Result<Clients, String>,
}

impl Default for LocalHttpState {
  fn default() -> Self {
    Self {
      tasks: Arc::default(),
      clients: Clients::build().map_err(|err| format!("Could not set up the local runtime HTTP client: {err}.")),
    }
  }
}

struct Clients {
  /// For localhost, 127.0.0.0/8 and ::1: ignores HTTP_PROXY and ALL_PROXY,
  /// which reqwest otherwise applies to loopback too unless NO_PROXY lists it.
  loopback: reqwest::Client,
  /// For every other host: honors the environment proxy.
  remote: reqwest::Client,
}

impl Clients {
  fn build() -> reqwest::Result<Self> {
    let builder = || {
      reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
    };
    Ok(Self {
      loopback: builder().no_proxy().build()?,
      remote: builder().build()?,
    })
  }

  fn for_url(&self, url: &Url) -> &reqwest::Client {
    if is_loopback(url) {
      &self.loopback
    } else {
      &self.remote
    }
  }
}

/// Validates the request, starts it on the async runtime and returns. The
/// response arrives on `on_event`: `head`, then body chunks, then `end` or
/// `error`. A connection failure is a single `error` with no `head`.
#[tauri::command]
pub async fn local_http_request(
  request: LocalHttpRequest,
  on_event: Channel<InvokeResponseBody>,
  state: tauri::State<'_, LocalHttpState>,
) -> Result<(), String> {
  let url = validate_url(&request.url)?;
  let headers = pass_through_headers(&request.headers)?;
  let clients = state.clients.as_ref().map_err(String::clone)?;
  let mut outgoing = clients
    .for_url(&url)
    .request(request.method.into(), url)
    .headers(headers);
  if let Some(body) = request.body {
    outgoing = outgoing.body(body);
  }

  let registry = Arc::clone(&state.tasks);
  let mut tasks = lock(&state.tasks);
  if tasks.contains_key(&request.id) {
    return Err(format!("Local request {} is already running.", request.id));
  }
  let id = request.id.clone();
  // The lock is held until the handle is inserted, so the task's own removal
  // always runs after the insert.
  let handle = tauri::async_runtime::spawn(async move {
    stream_response(outgoing, &on_event).await;
    lock(&registry).remove(&id);
  });
  tasks.insert(request.id, handle);
  Ok(())
}

/// Aborts an in-flight request. Unknown or finished ids are a no-op.
#[tauri::command]
pub fn local_http_cancel(id: String, state: tauri::State<'_, LocalHttpState>) {
  if let Some(handle) = lock(&state.tasks).remove(&id) {
    handle.abort();
  }
}

async fn stream_response(request: reqwest::RequestBuilder, channel: &Channel<InvokeResponseBody>) {
  let mut response = match request.send().await {
    Ok(response) => response,
    Err(err) => {
      let _ = send_event(channel, &LocalHttpEvent::Error { message: describe_error(&err) });
      return;
    }
  };
  let status = response.status();
  let head = LocalHttpEvent::Head {
    status: status.as_u16(),
    status_text: status.canonical_reason().unwrap_or("").to_string(),
    content_type: response
      .headers()
      .get(CONTENT_TYPE)
      .and_then(|value| value.to_str().ok())
      .map(str::to_string),
  };
  if send_event(channel, &head).is_err() {
    return;
  }
  loop {
    match response.chunk().await {
      Ok(Some(bytes)) if bytes.is_empty() => {}
      Ok(Some(bytes)) => {
        if channel.send(InvokeResponseBody::Raw(bytes.to_vec())).is_err() {
          return;
        }
      }
      Ok(None) => {
        let _ = send_event(channel, &LocalHttpEvent::End);
        return;
      }
      Err(err) => {
        let _ = send_event(channel, &LocalHttpEvent::Error { message: describe_error(&err) });
        return;
      }
    }
  }
}

fn send_event(channel: &Channel<InvokeResponseBody>, event: &LocalHttpEvent) -> Result<(), String> {
  let json = serde_json::to_string(event).map_err(|err| err.to_string())?;
  channel.send(InvokeResponseBody::Json(json)).map_err(|err| err.to_string())
}

/// Parses and checks a runtime URL: http or https, no credentials in the URL,
/// and a path on the Ollama/ComfyUI allowlist. Returns the normalized URL that
/// is actually requested, so the check and the request cannot disagree.
fn validate_url(raw: &str) -> Result<Url, String> {
  let url = Url::parse(raw.trim()).map_err(|err| format!("Invalid local runtime URL: {err}."))?;
  if !matches!(url.scheme(), "http" | "https") {
    return Err(format!("Local runtime URLs must use http or https, not {}.", url.scheme()));
  }
  if !url.username().is_empty() || url.password().is_some() {
    return Err("Local runtime URLs cannot contain a username or password. Use the API key field.".to_string());
  }
  if !path_allowed(url.path()) {
    return Err(format!("{} is not an Ollama or ComfyUI API path GatesAI can call.", url.path()));
  }
  Ok(url)
}

/// The path must be an exact allowlisted path or a one-segment prefix plus a
/// plain segment. Neither form can contain `%`, so an escaped separator or
/// dot (`%2F`, `%5C`, `%2e`) that a reverse proxy would decode never passes.
/// The query string is not checked; it does not choose the endpoint.
fn path_allowed(path: &str) -> bool {
  EXACT_PATHS.contains(&path)
    || ONE_SEGMENT_PREFIXES
      .iter()
      .any(|prefix| path.strip_prefix(prefix).is_some_and(is_plain_segment))
}

/// A ComfyUI node class name or prompt id: only ASCII letters, digits, `_`,
/// `.` and `-`, and never the dot segments `.` or `..`.
fn is_plain_segment(segment: &str) -> bool {
  !segment.is_empty()
    && !matches!(segment, "." | "..")
    && segment
      .bytes()
      .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
}

/// localhost, 127.0.0.0/8 or ::1. The parsed URL already holds IPv4 in dotted
/// form and IPv6 in brackets, so `127.1` and `0x7f.0.0.1` count too.
fn is_loopback(url: &Url) -> bool {
  let Some(host) = url.host_str() else {
    return false;
  };
  if host == "localhost" {
    return true;
  }
  let ip = host
    .strip_prefix('[')
    .and_then(|inner| inner.strip_suffix(']'))
    .unwrap_or(host);
  ip.parse::<IpAddr>().is_ok_and(|addr| addr.is_loopback())
}

/// Keeps only Content-Type, Accept and Authorization; other headers are dropped.
fn pass_through_headers(headers: &HashMap<String, String>) -> Result<HeaderMap, String> {
  let mut out = HeaderMap::new();
  for (name, value) in headers {
    let Some(allowed) = PASS_THROUGH_HEADERS
      .iter()
      .find(|candidate| candidate.as_str().eq_ignore_ascii_case(name))
    else {
      continue;
    };
    let mut value = HeaderValue::from_str(value).map_err(|_| format!("Header {name} has an invalid value."))?;
    if *allowed == AUTHORIZATION {
      value.set_sensitive(true);
    }
    out.insert(allowed.clone(), value);
  }
  Ok(out)
}

fn describe_error(err: &reqwest::Error) -> String {
  let mut message = err.to_string();
  let mut source = std::error::Error::source(err);
  while let Some(inner) = source {
    message.push_str(": ");
    message.push_str(&inner.to_string());
    source = inner.source();
  }
  message
}

fn lock(tasks: &Mutex<HashMap<String, JoinHandle<()>>>) -> MutexGuard<'_, HashMap<String, JoinHandle<()>>> {
  tasks.lock().unwrap_or_else(|poison| {
    log::warn!("[gatesai] local http task registry lock was poisoned; recovering");
    poison.into_inner()
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn allows_ollama_and_comfy_api_urls_on_any_http_host() {
    for url in [
      "http://127.0.0.1:11434/api/tags",
      "http://localhost:11434/api/version",
      "http://[::1]:11434/api/ps",
      "http://192.168.1.20:11434/api/chat",
      "https://ollama.example.com/api/pull",
      "http://gpu-box.tail1234.ts.net:11434/api/embed",
      "http://127.0.0.1:8188/system_stats",
      "http://127.0.0.1:8000/object_info/CheckpointLoaderSimple",
      "http://127.0.0.1:8188/history/6f1c2d3e-prompt-id",
      "http://127.0.0.1:8188/history/0f8e7a3c-1b2d-4e5f-9a6b-7c8d9e0f1a2b",
      "http://nas.lan/object_info/UNETLoader",
      "http://127.0.0.1:8188/view?filename=out_00001_.png&subfolder=&type=output",
      "http://127.0.0.1:8188/prompt",
    ] {
      assert!(validate_url(url).is_ok(), "{url} should be allowed");
    }
  }

  #[test]
  fn refuses_other_schemes_credentials_and_paths() {
    for url in [
      "file:///etc/passwd",
      "ftp://127.0.0.1:11434/api/tags",
      "ws://127.0.0.1:8188/prompt",
      "http://user:secret@127.0.0.1:11434/api/tags",
      "http://user@127.0.0.1:11434/api/tags",
      "http://127.0.0.1:11434/api/../etc",
      "http://127.0.0.1:11434/api/chat/../../etc/passwd",
      "http://127.0.0.1:8188/history/%2e%2e",
      "http://127.0.0.1:8188/object_info/..",
      "http://127.0.0.1:11434/api/create",
      "http://127.0.0.1:11434/api/tags/",
      "http://127.0.0.1:8188/history/",
      "http://127.0.0.1:8188/history/a/b",
      "http://192.168.1.1/admin",
      "not a url",
      // Escaped separators and dots stay encoded in the parsed URL, and a
      // reverse proxy in front of ComfyUI decodes them.
      "http://nas.lan/history/..%2Fadmin",
      "http://nas.lan/object_info/..%2F..%2Fanything",
      "http://nas.lan/object_info/%2e%2e%2Fanything",
      "http://nas.lan/history/..%5Cadmin",
      "http://nas.lan/history/abc%2Fdef",
      "http://nas.lan/history/%2e%2e",
      "http://nas.lan/history/..",
      "http://nas.lan/history/../admin",
      "http://nas.lan/object_info/.",
      "http://nas.lan/history/a;b",
      "http://127.0.0.1:11434/api/ch%61t",
    ] {
      assert!(validate_url(url).is_err(), "{url} should be refused");
    }
  }

  #[test]
  fn only_loopback_hosts_skip_the_environment_proxy() {
    for url in [
      "http://localhost:11434/api/tags",
      "http://127.0.0.1:11434/api/tags",
      "http://127.8.9.10:8188/prompt",
      "http://127.1:11434/api/tags",
      "http://[::1]:11434/api/tags",
    ] {
      assert!(is_loopback(&Url::parse(url).unwrap()), "{url} is loopback");
    }
    for url in [
      "http://192.168.1.20:11434/api/chat",
      "https://ollama.example.com/api/pull",
      "http://localhost.example.com/api/tags",
      "http://[::ffff:c0a8:114]:11434/api/tags",
    ] {
      assert!(!is_loopback(&Url::parse(url).unwrap()), "{url} is not loopback");
    }
  }

  #[test]
  fn state_builds_its_clients_outside_an_async_runtime() {
    // lib.rs constructs the state before Tauri starts its runtime.
    assert!(LocalHttpState::default().clients.is_ok());
  }

  #[test]
  fn validated_url_is_the_normalized_one() {
    let url = validate_url("  http://127.0.0.1:11434/api/x/../chat  ").expect("normalizes to /api/chat");
    assert_eq!(url.as_str(), "http://127.0.0.1:11434/api/chat");
  }

  #[test]
  fn credential_refusal_does_not_echo_the_url() {
    let err = validate_url("http://user:hunter2@127.0.0.1:11434/api/tags").unwrap_err();
    assert!(!err.contains("hunter2"));
  }

  #[test]
  fn passes_only_content_type_accept_and_authorization() {
    let headers = HashMap::from([
      ("content-type".to_string(), "application/json".to_string()),
      ("Accept".to_string(), "application/x-ndjson".to_string()),
      ("Authorization".to_string(), "Bearer test-key".to_string()),
      ("Origin".to_string(), "http://evil.example".to_string()),
      ("Cookie".to_string(), "a=b".to_string()),
    ]);
    let out = pass_through_headers(&headers).expect("valid headers");
    assert_eq!(out.len(), 3);
    assert_eq!(out.get(CONTENT_TYPE).unwrap(), "application/json");
    assert_eq!(out.get(ACCEPT).unwrap(), "application/x-ndjson");
    assert!(out.get(AUTHORIZATION).unwrap().is_sensitive());
    assert!(out.get("origin").is_none());
  }

  #[test]
  fn refuses_header_values_with_control_characters() {
    let headers = HashMap::from([("Authorization".to_string(), "Bearer a\r\nX-Injected: 1".to_string())]);
    assert!(pass_through_headers(&headers).is_err());
  }

  #[test]
  fn events_serialize_to_the_shape_local_http_ts_reads() {
    let head = LocalHttpEvent::Head {
      status: 404,
      status_text: "Not Found".to_string(),
      content_type: Some("application/json".to_string()),
    };
    assert_eq!(
      serde_json::to_string(&head).unwrap(),
      r#"{"event":"head","status":404,"statusText":"Not Found","contentType":"application/json"}"#
    );
    assert_eq!(serde_json::to_string(&LocalHttpEvent::End).unwrap(), r#"{"event":"end"}"#);
    assert_eq!(
      serde_json::to_string(&LocalHttpEvent::Error { message: "refused".to_string() }).unwrap(),
      r#"{"event":"error","message":"refused"}"#
    );
  }
}
