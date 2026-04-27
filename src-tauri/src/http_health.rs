use std::time::Duration;

pub const HEALTH_PROBE_TIMEOUT: Duration = Duration::from_millis(500);

pub fn probe_health(url: &str) -> bool {
  let Ok(client) = reqwest::blocking::Client::builder()
    .timeout(HEALTH_PROBE_TIMEOUT)
    .build()
  else {
    return false;
  };
  matches!(client.get(url).send(), Ok(resp) if resp.status().is_success())
}
