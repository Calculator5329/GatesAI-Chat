use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

const ENDPOINT: &str = "https://api.search.brave.com/res/v1/llm/context";
const DEFAULT_COUNT: &str = "10";
const DEFAULT_MAX_TOKENS: &str = "4096";
const DEFAULT_TIMEOUT: Duration = Duration::from_millis(8000);

#[derive(Debug, Serialize)]
pub struct BraveCommandError {
  code: &'static str,
  message: String,
}

#[tauri::command]
pub fn brave_llm_context(
  api_key: String,
  query: String,
  freshness: Option<String>,
  country: Option<String>,
  search_lang: Option<String>,
) -> Result<Value, BraveCommandError> {
  let client = reqwest::blocking::Client::builder()
    .timeout(DEFAULT_TIMEOUT)
    .build()
    .map_err(|err| network_error(format!("Brave Search client setup failed: {err}")))?;

  let mut request = client
    .get(ENDPOINT)
    .query(&[
      ("q", query.trim()),
      ("count", DEFAULT_COUNT),
      ("maximum_number_of_tokens", DEFAULT_MAX_TOKENS),
      ("context_threshold_mode", "balanced"),
      ("country", normalize_country(country.as_deref()).as_str()),
      ("search_lang", normalize_search_lang(search_lang.as_deref()).as_str()),
    ])
    .header(reqwest::header::ACCEPT, "application/json")
    .header("X-Subscription-Token", api_key.trim());

  if let Some(freshness) = normalize_freshness(freshness.as_deref()) {
    request = request.query(&[("freshness", freshness.as_str())]);
  }

  let response = request
    .send()
    .map_err(|err| network_error(format!("Brave Search request failed: {err}")))?;
  let status = response.status();
  if !status.is_success() {
    return Err(BraveCommandError {
      code: error_code_for_status(status.as_u16()),
      message: format!("Brave Search returned HTTP {}.", status.as_u16()),
    });
  }
  let body = response
    .text()
    .map_err(|err| network_error(format!("Brave Search response could not be read: {err}")))?;
  serde_json::from_str::<Value>(&body)
    .map_err(|err| network_error(format!("Brave Search returned invalid JSON: {err}")))
}

fn network_error(message: String) -> BraveCommandError {
  BraveCommandError {
    code: "network_error",
    message,
  }
}

fn normalize_country(value: Option<&str>) -> String {
  let trimmed = value.unwrap_or("US").trim().to_uppercase();
  if trimmed.len() == 2 && trimmed.chars().all(|c| c.is_ascii_alphabetic()) {
    trimmed
  } else {
    "US".to_string()
  }
}

fn normalize_search_lang(value: Option<&str>) -> String {
  let trimmed = value.unwrap_or("en").trim().to_lowercase();
  if trimmed.len() == 2 && trimmed.chars().all(|c| c.is_ascii_alphabetic()) {
    trimmed
  } else {
    "en".to_string()
  }
}

fn normalize_freshness(value: Option<&str>) -> Option<String> {
  let trimmed = value?.trim();
  match trimmed {
    "pd" | "pw" | "pm" | "py" => Some(trimmed.to_string()),
    _ => None,
  }
}

fn error_code_for_status(status: u16) -> &'static str {
  match status {
    401 | 403 => "auth_error",
    429 => "rate_limited",
    500..=599 => "brave_unavailable",
    _ => "brave_http_error",
  }
}
