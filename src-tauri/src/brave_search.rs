use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

const ENDPOINT: &str = "https://api.search.brave.com/res/v1/llm/context";
const STANDARD_TIMEOUT: Duration = Duration::from_secs(15);
const DEEP_TIMEOUT: Duration = Duration::from_secs(30);

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
  depth: Option<String>,
) -> Result<Value, BraveCommandError> {
  let profile = search_profile(depth.as_deref());
  let client = reqwest::blocking::Client::builder()
    .timeout(profile.timeout)
    .build()
    .map_err(|err| network_error(format!("Brave Search client setup failed: {err}")))?;

  let mut request = client
    .get(ENDPOINT)
    .query(&[
      ("q", query.trim()),
      ("count", profile.count),
      ("maximum_number_of_urls", profile.max_urls),
      ("maximum_number_of_tokens", profile.max_tokens),
      ("maximum_number_of_tokens_per_url", profile.max_tokens_per_url),
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

struct SearchProfile {
  count: &'static str,
  max_urls: &'static str,
  max_tokens: &'static str,
  max_tokens_per_url: &'static str,
  timeout: Duration,
}

fn search_profile(depth: Option<&str>) -> SearchProfile {
  if depth == Some("deep") {
    return SearchProfile {
      count: "50",
      max_urls: "30",
      max_tokens: "16384",
      max_tokens_per_url: "4096",
      timeout: DEEP_TIMEOUT,
    };
  }
  SearchProfile {
    count: "10",
    max_urls: "10",
    max_tokens: "4096",
    max_tokens_per_url: "2048",
    timeout: STANDARD_TIMEOUT,
  }
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

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn standard_profile_stays_compact() {
    let profile = search_profile(None);
    assert_eq!(profile.count, "10");
    assert_eq!(profile.max_urls, "10");
    assert_eq!(profile.max_tokens, "4096");
    assert_eq!(profile.timeout, STANDARD_TIMEOUT);
  }

  #[test]
  fn deep_profile_expands_research_coverage() {
    let profile = search_profile(Some("deep"));
    assert_eq!(profile.count, "50");
    assert_eq!(profile.max_urls, "30");
    assert_eq!(profile.max_tokens, "16384");
    assert_eq!(profile.max_tokens_per_url, "4096");
    assert_eq!(profile.timeout, DEEP_TIMEOUT);
  }
}
