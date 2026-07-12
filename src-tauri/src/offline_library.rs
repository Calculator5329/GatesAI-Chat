use reqwest::header::{CONTENT_LENGTH, CONTENT_TYPE};
use reqwest::{redirect, Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

const BASE_URL: &str = "http://127.0.0.1:8892/api/v1";
const MAX_RESPONSE_BYTES: usize = 1_000_000;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfflineLibraryResource {
    Plugin,
    Status,
    Sources,
    Evaluations,
    Profiles,
    KnowledgeArena,
    Databases,
    PublicSchema,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OfflineLibrarySearchMode {
    Fulltext,
    Semantic,
    Hybrid,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineLibrarySearchRequest {
    query: String,
    limit: u8,
    mode: OfflineLibrarySearchMode,
    #[serde(rename = "include_kiwix", alias = "includeKiwix")]
    include_kiwix: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct OfflineLibraryError {
    kind: &'static str,
    status: Option<u16>,
    message: String,
}

impl OfflineLibraryError {
    fn new(kind: &'static str, message: impl Into<String>) -> Self {
        Self {
            kind,
            status: None,
            message: message.into(),
        }
    }

    fn http(status: StatusCode) -> Self {
        Self {
            kind: "http",
            status: Some(status.as_u16()),
            message: format!("Offline Library returned HTTP {}", status.as_u16()),
        }
    }
}

#[tauri::command]
pub async fn offline_library_read(
    resource: OfflineLibraryResource,
    alias: Option<String>,
) -> Result<Value, OfflineLibraryError> {
    let path = resource_path(&resource, alias.as_deref())?;
    request_json(Method::GET, &path, None).await
}

#[tauri::command]
pub async fn offline_library_search(
    request: OfflineLibrarySearchRequest,
) -> Result<Value, OfflineLibraryError> {
    validate_search(&request)?;
    let body = serde_json::to_value(request)
        .map_err(|err| OfflineLibraryError::new("invalid_request", err.to_string()))?;
    request_json(Method::POST, "/search", Some(body)).await
}

fn resource_path(
    resource: &OfflineLibraryResource,
    alias: Option<&str>,
) -> Result<String, OfflineLibraryError> {
    let path = match resource {
        OfflineLibraryResource::Plugin => "/plugin",
        OfflineLibraryResource::Status => "/status",
        OfflineLibraryResource::Sources => "/sources",
        OfflineLibraryResource::Evaluations => "/evaluations",
        OfflineLibraryResource::Profiles => "/profiles",
        OfflineLibraryResource::KnowledgeArena => "/benchmarks/knowledge-arena",
        OfflineLibraryResource::Databases => "/databases",
        OfflineLibraryResource::PublicSchema => {
            let alias = alias.ok_or_else(|| {
                OfflineLibraryError::new("invalid_request", "public schema alias is required")
            })?;
            validate_alias(alias)?;
            return Ok(format!("/databases/{alias}/schema"));
        }
    };
    if alias.is_some() {
        return Err(OfflineLibraryError::new(
            "invalid_request",
            "alias is only accepted for public_schema",
        ));
    }
    Ok(path.to_string())
}

fn validate_alias(alias: &str) -> Result<(), OfflineLibraryError> {
    let bytes = alias.as_bytes();
    let first_ok = bytes
        .first()
        .is_some_and(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit());
    let rest_ok = bytes.iter().all(|byte| {
        byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'-')
    });
    if bytes.is_empty() || bytes.len() > 64 || !first_ok || !rest_ok {
        return Err(OfflineLibraryError::new(
            "invalid_request",
            "public schema alias must match [a-z0-9][a-z0-9_-]{0,63}",
        ));
    }
    Ok(())
}

fn validate_search(request: &OfflineLibrarySearchRequest) -> Result<(), OfflineLibraryError> {
    let query_len = request.query.chars().count();
    if request.query.trim().is_empty() || query_len > 2_000 {
        return Err(OfflineLibraryError::new(
            "invalid_request",
            "query must contain 1 to 2000 characters",
        ));
    }
    if !(1..=20).contains(&request.limit) {
        return Err(OfflineLibraryError::new(
            "invalid_request",
            "limit must be from 1 to 20",
        ));
    }
    Ok(())
}

async fn request_json(
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, OfflineLibraryError> {
    let client = reqwest::Client::builder()
        .redirect(redirect::Policy::none())
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(TOTAL_TIMEOUT)
        .build()
        .map_err(|err| OfflineLibraryError::new("client", err.to_string()))?;
    let mut builder = client.request(method, format!("{BASE_URL}{path}"));
    if let Some(body) = body {
        let encoded = serde_json::to_vec(&body)
            .map_err(|err| OfflineLibraryError::new("invalid_request", err.to_string()))?;
        builder = builder
            .header(CONTENT_TYPE, "application/json")
            .body(encoded);
    }
    let mut response = builder.send().await.map_err(map_request_error)?;
    validate_response_metadata(response.status(), response.headers())?;

    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(map_request_error)? {
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err(OfflineLibraryError::new(
                "too_large",
                "Offline Library response exceeded 1000000 bytes",
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    parse_json_bytes(&bytes)
}

fn validate_response_metadata(
    status: StatusCode,
    headers: &reqwest::header::HeaderMap,
) -> Result<(), OfflineLibraryError> {
    if status.is_redirection() {
        return Err(OfflineLibraryError::new(
            "redirect",
            "Offline Library redirects are not allowed",
        ));
    }
    if !status.is_success() {
        return Err(OfflineLibraryError::http(status));
    }
    if headers
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<usize>().ok())
        .is_some_and(|length| length > MAX_RESPONSE_BYTES)
    {
        return Err(OfflineLibraryError::new(
            "too_large",
            "Offline Library response exceeded 1000000 bytes",
        ));
    }
    let content_type = headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !content_type
        .split(';')
        .next()
        .is_some_and(|mime| mime.trim().eq_ignore_ascii_case("application/json"))
    {
        return Err(OfflineLibraryError::new(
            "invalid_content_type",
            "Offline Library response must be application/json",
        ));
    }
    Ok(())
}

fn parse_json_bytes(bytes: &[u8]) -> Result<Value, OfflineLibraryError> {
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err(OfflineLibraryError::new(
            "too_large",
            "Offline Library response exceeded 1000000 bytes",
        ));
    }
    serde_json::from_slice(bytes).map_err(|err| {
        OfflineLibraryError::new(
            "invalid_json",
            format!("invalid Offline Library JSON: {err}"),
        )
    })
}

fn map_request_error(error: reqwest::Error) -> OfflineLibraryError {
    if error.is_timeout() {
        OfflineLibraryError::new("timeout", "Offline Library request timed out")
    } else if error.is_connect() {
        OfflineLibraryError::new("unavailable", "Offline Library is unavailable")
    } else {
        OfflineLibraryError::new(
            "transport",
            format!("Offline Library request failed: {error}"),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::{HeaderMap, HeaderValue};

    #[test]
    fn resource_paths_are_fixed_and_aliases_are_bounded() {
        assert_eq!(
            resource_path(&OfflineLibraryResource::Status, None).unwrap(),
            "/status"
        );
        assert_eq!(
            resource_path(&OfflineLibraryResource::PublicSchema, Some("arch_docs-1")).unwrap(),
            "/databases/arch_docs-1/schema"
        );
        for alias in ["../private", "UPPER", "two/slashes", "", "a.b"] {
            assert_eq!(
                resource_path(&OfflineLibraryResource::PublicSchema, Some(alias))
                    .unwrap_err()
                    .kind,
                "invalid_request"
            );
        }
        assert!(resource_path(&OfflineLibraryResource::Sources, Some("ignored")).is_err());
    }

    #[test]
    fn search_bounds_are_enforced_before_transport() {
        let valid = OfflineLibrarySearchRequest {
            query: "pacman hooks".into(),
            limit: 5,
            mode: OfflineLibrarySearchMode::Hybrid,
            include_kiwix: true,
        };
        assert!(validate_search(&valid).is_ok());
        assert_eq!(
            validate_search(&OfflineLibrarySearchRequest {
                query: " ".into(),
                ..valid.clone()
            })
            .unwrap_err()
            .kind,
            "invalid_request"
        );
        assert_eq!(
            validate_search(&OfflineLibrarySearchRequest { limit: 21, ..valid })
                .unwrap_err()
                .kind,
            "invalid_request"
        );

        let from_webview: OfflineLibrarySearchRequest = serde_json::from_value(serde_json::json!({
            "query": "hooks", "limit": 5, "mode": "hybrid", "includeKiwix": true
        }))
        .unwrap();
        let host_payload = serde_json::to_value(from_webview).unwrap();
        assert_eq!(host_payload["include_kiwix"], true);
        assert!(host_payload.get("includeKiwix").is_none());
    }

    #[test]
    fn redirects_non_json_and_declared_oversize_are_rejected() {
        let json_headers = || {
            let mut headers = HeaderMap::new();
            headers.insert(
                CONTENT_TYPE,
                HeaderValue::from_static("application/json; charset=utf-8"),
            );
            headers
        };
        assert_eq!(
            validate_response_metadata(StatusCode::FOUND, &json_headers())
                .unwrap_err()
                .kind,
            "redirect"
        );
        assert_eq!(
            validate_response_metadata(StatusCode::NOT_FOUND, &json_headers())
                .unwrap_err()
                .status,
            Some(404)
        );

        let mut html = HeaderMap::new();
        html.insert(CONTENT_TYPE, HeaderValue::from_static("text/html"));
        assert_eq!(
            validate_response_metadata(StatusCode::OK, &html)
                .unwrap_err()
                .kind,
            "invalid_content_type"
        );

        let mut large = json_headers();
        large.insert(CONTENT_LENGTH, HeaderValue::from_static("1000001"));
        assert_eq!(
            validate_response_metadata(StatusCode::OK, &large)
                .unwrap_err()
                .kind,
            "too_large"
        );
        assert_eq!(
            parse_json_bytes(&vec![b' '; MAX_RESPONSE_BYTES + 1])
                .unwrap_err()
                .kind,
            "too_large"
        );
    }

    #[test]
    fn valid_json_is_returned_without_rewriting_citation_uris() {
        let value = parse_json_bytes(
            br#"{"citation":"kiwix://archlinux/title","database":"db://public/schema"}"#,
        )
        .unwrap();
        assert_eq!(value["citation"], "kiwix://archlinux/title");
        assert_eq!(value["database"], "db://public/schema");
    }
}
