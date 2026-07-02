use keyring::{Entry, Error as KeyringError};

const SERVICE_NAME: &str = "gatesai-chat";

#[tauri::command]
pub fn secret_set(name: String, value: String) -> Result<(), String> {
  entry_for(&name)?
    .set_password(&value)
    .map_err(|err| format!("credential write failed: {err}"))
}

#[tauri::command]
pub fn secret_get(name: String) -> Result<Option<String>, String> {
  match entry_for(&name)?.get_password() {
    Ok(value) => Ok(Some(value)),
    Err(KeyringError::NoEntry) => Ok(None),
    Err(err) => Err(format!("credential read failed: {err}")),
  }
}

#[tauri::command]
pub fn secret_delete(name: String) -> Result<(), String> {
  match entry_for(&name)?.delete_credential() {
    Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
    Err(err) => Err(format!("credential delete failed: {err}")),
  }
}

fn entry_for(name: &str) -> Result<Entry, String> {
  validate_name(name)?;
  Entry::new(SERVICE_NAME, name).map_err(|err| format!("credential entry setup failed: {err}"))
}

fn validate_name(name: &str) -> Result<(), String> {
  if is_valid_name(name) {
    Ok(())
  } else {
    Err("secret name must match ^[a-z0-9][a-z0-9._-]{0,63}$".to_string())
  }
}

fn is_valid_name(name: &str) -> bool {
  if name.is_empty() || name.len() > 64 {
    return false;
  }
  let mut bytes = name.bytes();
  let Some(first) = bytes.next() else {
    return false;
  };
  is_lower_alnum(first) && bytes.all(is_secret_name_tail)
}

fn is_lower_alnum(byte: u8) -> bool {
  byte.is_ascii_lowercase() || byte.is_ascii_digit()
}

fn is_secret_name_tail(byte: u8) -> bool {
  is_lower_alnum(byte) || matches!(byte, b'.' | b'_' | b'-')
}

#[cfg(test)]
mod tests {
  use super::is_valid_name;

  #[test]
  fn valid_secret_names_match_allowlist() {
    assert!(is_valid_name("openrouter.api-key"));
    assert!(is_valid_name("brave_api-key"));
    assert!(is_valid_name("o"));
    assert!(is_valid_name("a23456789012345678901234567890123456789012345678901234567890123"));
  }

  #[test]
  fn invalid_secret_names_are_rejected() {
    for name in [
      "",
      ".openrouter",
      "-openrouter",
      "_openrouter",
      "OpenRouter",
      "open router",
      "openrouter/api-key",
      "openrouter:api-key",
      "openrouter.api-key!",
      "a2345678901234567890123456789012345678901234567890123456789012345",
      "brave\u{00e9}",
    ] {
      assert!(!is_valid_name(name), "{name} should be rejected");
    }
  }
}
