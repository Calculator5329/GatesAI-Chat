use reqwest::header::{CONTENT_TYPE, LOCATION};
use reqwest::{redirect, Url};
use serde::Serialize;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs};
use std::time::{Duration, Instant};

const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;
const TOTAL_TIMEOUT: Duration = Duration::from_secs(20);
const USER_AGENT_VALUE: &str = concat!(
    "GatesAI-Chat/",
    env!("CARGO_PKG_VERSION"),
    " (+local research tool)"
);

#[derive(Clone, Debug, Serialize)]
pub struct FetchPageResult {
    final_url: String,
    status: u16,
    title: Option<String>,
    content: String,
    truncated: bool,
    content_type: String,
}

#[derive(Clone, Debug)]
struct ResolvedTarget {
    host: String,
    addrs: Vec<SocketAddr>,
    override_dns: bool,
}

#[tauri::command]
pub async fn fetch_page(url: String) -> Result<FetchPageResult, String> {
    fetch_page_inner(&url).await
}

async fn fetch_page_inner(input: &str) -> Result<FetchPageResult, String> {
    let mut current = Url::parse(input.trim()).map_err(|err| format!("invalid URL: {err}"))?;
    let started = Instant::now();

    for redirect_count in 0..=MAX_REDIRECTS {
        let target = validate_url_for_fetch(&current, &system_resolver)?;
        let remaining = TOTAL_TIMEOUT
            .checked_sub(started.elapsed())
            .ok_or_else(|| "request timed out after 20s".to_string())?;

        let client = client_for_target(&target)?;
        let mut response = client
            .get(current.clone())
            .timeout(remaining)
            .send()
            .await
            .map_err(|err| format!("request failed: {err}"))?;

        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| {
                    format!(
                        "redirect response missing Location header: HTTP {}",
                        response.status().as_u16()
                    )
                })?;
            if redirect_count >= MAX_REDIRECTS {
                return Err(format!(
                    "too many redirects; stopped after {MAX_REDIRECTS} redirects"
                ));
            }
            current = current
                .join(location)
                .map_err(|err| format!("invalid redirect URL: {err}"))?;
            continue;
        }

        let status = response.status();
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_string();
        let (body, body_truncated) = read_capped_body(&mut response).await?;
        let extracted = extract_response_content(&body, &content_type)?;
        return Ok(FetchPageResult {
            final_url: current.to_string(),
            status: status.as_u16(),
            title: extracted.title,
            content: extracted.content,
            truncated: body_truncated || extracted.truncated,
            content_type,
        });
    }

    Err(format!(
        "too many redirects; stopped after {MAX_REDIRECTS} redirects"
    ))
}

fn client_for_target(target: &ResolvedTarget) -> Result<reqwest::Client, String> {
    let builder = reqwest::Client::builder()
        .redirect(redirect::Policy::none())
        .user_agent(USER_AGENT_VALUE);
    let builder = if target.override_dns {
        builder.resolve_to_addrs(&target.host, &target.addrs)
    } else {
        builder
    };
    builder
        .build()
        .map_err(|err| format!("request client setup failed: {err}"))
}

async fn read_capped_body(response: &mut reqwest::Response) -> Result<(Vec<u8>, bool), String> {
    let mut body = Vec::new();
    let mut truncated = false;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|err| format!("response body could not be read: {err}"))?
    {
        let remaining = MAX_BODY_BYTES.saturating_sub(body.len());
        if chunk.len() > remaining {
            body.extend_from_slice(&chunk[..remaining]);
            truncated = true;
            break;
        }
        body.extend_from_slice(&chunk);
        if body.len() >= MAX_BODY_BYTES {
            truncated = true;
            break;
        }
    }
    Ok((body, truncated))
}

fn validate_url_for_fetch(
    url: &Url,
    resolver: &dyn Fn(&str, u16) -> Result<Vec<IpAddr>, String>,
) -> Result<ResolvedTarget, String> {
    if !url.username().is_empty() || url.password().is_some() {
        return Err("blocked URL: userinfo credentials are not allowed".to_string());
    }

    let scheme = url.scheme();
    let host = url
        .host_str()
        .ok_or_else(|| "blocked URL: host is required".to_string())?
        .to_string();
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "blocked URL: unsupported URL scheme".to_string())?;
    let explicit_localhost = is_explicit_localhost(&host);

    match scheme {
        "https" => {}
        "http" if explicit_localhost => {}
        "http" => {
            return Err(
                "blocked URL: http is only allowed for localhost, 127.0.0.1, or [::1]".to_string(),
            );
        }
        _ => {
            return Err("blocked URL: only http and https URLs are supported".to_string());
        }
    }

    let raw_ip = parse_ip_host(&host);
    let ips = match raw_ip {
        Some(ip) => vec![ip],
        None => resolver(&host, port)?,
    };
    if ips.is_empty() {
        return Err(format!("blocked URL: host {host} did not resolve"));
    }

    for ip in &ips {
        validate_resolved_ip(*ip, explicit_localhost)?;
    }

    Ok(ResolvedTarget {
        host,
        addrs: ips
            .into_iter()
            .map(|ip| SocketAddr::new(ip, port))
            .collect(),
        override_dns: raw_ip.is_none(),
    })
}

fn system_resolver(host: &str, port: u16) -> Result<Vec<IpAddr>, String> {
    (host, port)
        .to_socket_addrs()
        .map_err(|err| format!("DNS resolution failed for {host}: {err}"))
        .map(|iter| iter.map(|addr| addr.ip()).collect())
}

fn parse_ip_host(host: &str) -> Option<IpAddr> {
    host.trim_matches(|ch| ch == '[' || ch == ']')
        .parse::<IpAddr>()
        .ok()
}

fn is_explicit_localhost(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || matches!(parse_ip_host(host), Some(IpAddr::V4(ip)) if ip == Ipv4Addr::LOCALHOST)
        || matches!(parse_ip_host(host), Some(IpAddr::V6(ip)) if ip == Ipv6Addr::LOCALHOST)
}

fn validate_resolved_ip(ip: IpAddr, explicit_localhost: bool) -> Result<(), String> {
    match ip {
        IpAddr::V4(addr) => {
            if explicit_localhost && addr.is_loopback() {
                return Ok(());
            }
            if is_blocked_ipv4(addr) {
                return Err(format!(
                    "blocked URL: resolved address {addr} is not public"
                ));
            }
        }
        IpAddr::V6(addr) => {
            if explicit_localhost && addr.is_loopback() {
                return Ok(());
            }
            if let Some(mapped) = addr.to_ipv4_mapped() {
                if explicit_localhost && mapped.is_loopback() {
                    return Ok(());
                }
                if is_blocked_ipv4(mapped) {
                    return Err(format!(
                        "blocked URL: resolved address {addr} is not public"
                    ));
                }
            }
            if is_blocked_ipv6(addr) {
                return Err(format!(
                    "blocked URL: resolved address {addr} is not public"
                ));
            }
        }
    }
    Ok(())
}

fn is_blocked_ipv4(addr: Ipv4Addr) -> bool {
    let octets = addr.octets();
    addr.is_private()
        || addr.is_loopback()
        || addr.is_link_local()
        || addr.is_unspecified()
        || addr.is_multicast()
        || addr.is_broadcast()
        || octets[0] == 0
        || (octets[0] == 100 && (64..=127).contains(&octets[1]))
        || octets[0] >= 240
        || (octets[0] == 198 && (18..=19).contains(&octets[1]))
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 2)
        || (octets[0] == 198 && octets[1] == 51 && octets[2] == 100)
        || (octets[0] == 203 && octets[1] == 0 && octets[2] == 113)
}

fn is_blocked_ipv6(addr: Ipv6Addr) -> bool {
    let segments = addr.segments();
    addr.is_loopback()
        || addr.is_unspecified()
        || (segments[0] & 0xfe00) == 0xfc00
        || (segments[0] & 0xffc0) == 0xfe80
        || (segments[0] & 0xff00) == 0xff00
        || (segments[0] == 0x2001 && segments[1] == 0x0db8)
}

#[derive(Debug, PartialEq, Eq)]
struct ExtractedContent {
    title: Option<String>,
    content: String,
    truncated: bool,
}

fn extract_response_content(bytes: &[u8], content_type: &str) -> Result<ExtractedContent, String> {
    let media_type = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let text = String::from_utf8_lossy(bytes).to_string();

    if media_type == "text/html"
        || media_type == "application/xhtml+xml"
        || media_type.ends_with("+html")
    {
        let (title, content) = extract_html_text(&text);
        return Ok(ExtractedContent {
            title,
            content,
            truncated: false,
        });
    }

    if media_type.starts_with("text/") {
        return Ok(ExtractedContent {
            title: None,
            content: text,
            truncated: false,
        });
    }

    if media_type == "application/json" || media_type.ends_with("+json") {
        let content = match serde_json::from_slice::<serde_json::Value>(bytes) {
            Ok(value) => serde_json::to_string_pretty(&value).unwrap_or_else(|_| text.clone()),
            Err(_) => text,
        };
        let (content, truncated) = truncate_chars(content, MAX_BODY_BYTES);
        return Ok(ExtractedContent {
            title: None,
            content,
            truncated,
        });
    }

    Err(format!(
        "unsupported content type: {}",
        if content_type.trim().is_empty() {
            "(missing)"
        } else {
            content_type.trim()
        }
    ))
}

fn extract_html_text(html: &str) -> (Option<String>, String) {
    let title = find_element_inner(html, "title").map(|value| html_text_to_plain(&value));
    let without_ignored = strip_elements(
        html,
        &["script", "style", "nav", "header", "footer", "aside"],
    );
    let body = find_element_inner(&without_ignored, "article")
        .or_else(|| find_element_inner(&without_ignored, "main"))
        .unwrap_or(without_ignored);
    (
        title.filter(|value| !value.trim().is_empty()),
        html_text_to_plain(&body),
    )
}

fn strip_elements(input: &str, names: &[&str]) -> String {
    let mut out = input.to_string();
    for name in names {
        loop {
            let Some(start) = find_open_tag(&out, name, 0) else {
                break;
            };
            let Some(open_end) = out[start..].find('>').map(|offset| start + offset + 1) else {
                break;
            };
            let Some(close_start) = find_close_tag(&out, name, open_end) else {
                out.replace_range(start..open_end, "");
                continue;
            };
            let close_end = out[close_start..]
                .find('>')
                .map(|offset| close_start + offset + 1)
                .unwrap_or(close_start);
            out.replace_range(start..close_end, "");
        }
    }
    out
}

fn find_element_inner(input: &str, name: &str) -> Option<String> {
    let start = find_open_tag(input, name, 0)?;
    let open_end = input[start..].find('>').map(|offset| start + offset + 1)?;
    let close_start = find_close_tag(input, name, open_end)?;
    Some(input[open_end..close_start].to_string())
}

fn find_open_tag(input: &str, name: &str, from: usize) -> Option<usize> {
    let lower = input.to_ascii_lowercase();
    let needle = format!("<{}", name.to_ascii_lowercase());
    let mut index = from;
    while let Some(offset) = lower[index..].find(&needle) {
        let start = index + offset;
        let after = start + needle.len();
        let valid_boundary = lower.as_bytes().get(after).map_or(false, |byte| {
            byte.is_ascii_whitespace() || matches!(*byte, b'>' | b'/')
        });
        if valid_boundary {
            return Some(start);
        }
        index = after;
    }
    None
}

fn find_close_tag(input: &str, name: &str, from: usize) -> Option<usize> {
    input[from..]
        .to_ascii_lowercase()
        .find(&format!("</{}>", name.to_ascii_lowercase()))
        .map(|offset| from + offset)
}

fn html_text_to_plain(input: &str) -> String {
    let mut out = String::new();
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '<' {
            let mut tag = String::new();
            for next in chars.by_ref() {
                if next == '>' {
                    break;
                }
                tag.push(next);
            }
            append_break_for_tag(&mut out, &tag);
            continue;
        }
        if ch == '&' {
            let mut entity = String::new();
            while let Some(next) = chars.peek().copied() {
                if next == ';' {
                    chars.next();
                    break;
                }
                if entity.len() > 12 || next.is_whitespace() || next == '&' || next == '<' {
                    break;
                }
                entity.push(next);
                chars.next();
            }
            out.push_str(&decode_entity(&entity));
            continue;
        }
        out.push(ch);
    }
    normalize_text(&out)
}

fn append_break_for_tag(out: &mut String, raw_tag: &str) {
    let tag = raw_tag
        .trim_start_matches('/')
        .split_whitespace()
        .next()
        .unwrap_or("")
        .trim_end_matches('/')
        .to_ascii_lowercase();
    match tag.as_str() {
        "br" => out.push('\n'),
        "p" | "div" | "section" | "article" | "main" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
        | "li" | "ul" | "ol" | "blockquote" | "pre" | "table" | "tr" => {
            out.push_str("\n\n");
        }
        _ => out.push(' '),
    }
}

fn decode_entity(entity: &str) -> String {
    match entity {
        "amp" => "&".to_string(),
        "lt" => "<".to_string(),
        "gt" => ">".to_string(),
        "quot" => "\"".to_string(),
        "apos" | "#39" => "'".to_string(),
        "nbsp" => " ".to_string(),
        value if value.starts_with("#x") || value.starts_with("#X") => {
            u32::from_str_radix(&value[2..], 16)
                .ok()
                .and_then(char::from_u32)
                .map(|ch| ch.to_string())
                .unwrap_or_else(|| format!("&{entity};"))
        }
        value if value.starts_with('#') => value[1..]
            .parse::<u32>()
            .ok()
            .and_then(char::from_u32)
            .map(|ch| ch.to_string())
            .unwrap_or_else(|| format!("&{entity};")),
        "" => "&".to_string(),
        _ => format!("&{entity};"),
    }
}

fn normalize_text(input: &str) -> String {
    let mut paragraphs = Vec::new();
    for raw in input.split('\n') {
        let line = raw.split_whitespace().collect::<Vec<_>>().join(" ");
        if !line.is_empty() {
            paragraphs.push(line);
        }
    }
    paragraphs.join("\n\n")
}

fn truncate_chars(value: String, max_chars: usize) -> (String, bool) {
    if value.chars().count() <= max_chars {
        return (value, false);
    }
    (value.chars().take(max_chars).collect(), true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resolver(addrs: Vec<IpAddr>) -> impl Fn(&str, u16) -> Result<Vec<IpAddr>, String> {
        move |_host, _port| Ok(addrs.clone())
    }

    fn ok(url: &str, addrs: Vec<IpAddr>) -> ResolvedTarget {
        validate_url_for_fetch(&Url::parse(url).unwrap(), &resolver(addrs)).unwrap()
    }

    fn err(url: &str, addrs: Vec<IpAddr>) -> String {
        validate_url_for_fetch(&Url::parse(url).unwrap(), &resolver(addrs)).unwrap_err()
    }

    #[test]
    fn url_policy_allows_https_public_hosts() {
        let target = ok(
            "https://example.com/path",
            vec![IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34))],
        );
        assert_eq!(target.host, "example.com");
        assert_eq!(target.addrs[0].port(), 443);
    }

    #[test]
    fn url_policy_rejects_userinfo_and_non_http_schemes() {
        assert!(err(
            "https://user@example.com",
            vec![IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34))]
        )
        .contains("userinfo"));
        assert!(err(
            "ftp://example.com",
            vec![IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34))]
        )
        .contains("only http and https"));
    }

    #[test]
    fn url_policy_allows_localhost_over_http_or_https() {
        ok(
            "http://localhost:5173",
            vec![IpAddr::V4(Ipv4Addr::LOCALHOST)],
        );
        ok("http://127.0.0.1:5173", vec![]);
        ok("https://[::1]:5173", vec![]);
    }

    #[test]
    fn url_policy_rejects_public_http() {
        assert!(err(
            "http://example.com",
            vec![IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34))]
        )
        .contains("http is only allowed"));
    }

    #[test]
    fn url_policy_rejects_blocked_ipv4_ranges() {
        let blocked = [
            Ipv4Addr::new(10, 1, 2, 3),
            Ipv4Addr::new(172, 16, 0, 1),
            Ipv4Addr::new(192, 168, 0, 1),
            Ipv4Addr::new(169, 254, 169, 254),
            Ipv4Addr::new(100, 64, 0, 1),
            Ipv4Addr::new(127, 0, 0, 1),
        ];
        for ip in blocked {
            assert!(
                err("https://example.com", vec![IpAddr::V4(ip)]).contains("not public"),
                "{ip} should be blocked"
            );
        }
    }

    #[test]
    fn url_policy_rejects_raw_blocked_ipv4_urls() {
        assert!(err("https://10.0.0.1", vec![]).contains("not public"));
        assert!(err("https://169.254.169.254", vec![]).contains("not public"));
        assert!(err("https://100.64.1.1", vec![]).contains("not public"));
    }

    #[test]
    fn url_policy_rejects_blocked_ipv6_ranges() {
        let blocked = [
            Ipv6Addr::LOCALHOST,
            "fc00::1".parse::<Ipv6Addr>().unwrap(),
            "fd12:3456::1".parse::<Ipv6Addr>().unwrap(),
            "fe80::1".parse::<Ipv6Addr>().unwrap(),
        ];
        for ip in blocked {
            assert!(
                err("https://example.com", vec![IpAddr::V6(ip)]).contains("not public"),
                "{ip} should be blocked"
            );
        }
    }

    #[test]
    fn html_extraction_prefers_article_and_strips_chrome() {
        let html = r#"
      <!doctype html>
      <html>
        <head><title>Test &amp; Page</title><style>.x{}</style><script>bad()</script></head>
        <body>
          <header>Site header</header>
          <nav>Navigation</nav>
          <main>Main fallback</main>
          <article>
            <h1>Readable headline</h1>
            <p>First <a href="https://example.com">linked text</a>.</p>
            <aside>Related links</aside>
            <p>Second&nbsp;paragraph.</p>
          </article>
          <footer>Site footer</footer>
        </body>
      </html>
    "#;

        let extracted =
            extract_response_content(html.as_bytes(), "text/html; charset=utf-8").unwrap();

        assert_eq!(extracted.title, Some("Test & Page".to_string()));
        assert!(extracted.content.contains("Readable headline"));
        assert!(extracted.content.contains("First linked text ."));
        assert!(extracted.content.contains("Second paragraph."));
        assert!(!extracted.content.contains("Navigation"));
        assert!(!extracted.content.contains("Main fallback"));
        assert!(!extracted.content.contains("Site footer"));
    }

    #[test]
    fn text_and_json_content_types_are_returned_readably() {
        let text = extract_response_content(b"hello\nworld", "text/plain").unwrap();
        assert_eq!(text.content, "hello\nworld");

        let json = extract_response_content(br#"{"b":2,"a":1}"#, "application/json").unwrap();
        assert!(json.content.contains("\"b\": 2"));
        assert!(json.content.contains("\"a\": 1"));
    }

    #[test]
    fn unsupported_content_type_errors() {
        let err = extract_response_content(b"abc", "image/png").unwrap_err();
        assert!(err.contains("unsupported content type"));
    }

    #[test]
    fn json_pretty_output_reports_truncation() {
        let source = format!(r#"{{"value":"{}"}}"#, "a".repeat(MAX_BODY_BYTES + 10));
        let extracted = extract_response_content(source.as_bytes(), "application/json").unwrap();
        assert!(extracted.truncated);
        assert_eq!(extracted.content.chars().count(), MAX_BODY_BYTES);
    }

    #[test]
    fn readable_html_falls_back_to_main() {
        let html = r#"<html><title>T</title><body><main><p>Main text<br>Next line</p></main></body></html>"#;
        let extracted = extract_response_content(html.as_bytes(), "text/html").unwrap();
        assert_eq!(extracted.content, "Main text\n\nNext line");
    }
}
