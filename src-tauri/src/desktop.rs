use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, Runtime, Window};
use tauri_plugin_global_shortcut::{
  Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
};

pub const DEFAULT_GLOBAL_SUMMON_CHORD: &str = "Ctrl+Shift+Space";
const SUMMON_EVENT: &str = "gatesai://summon";
const NEW_CONVERSATION_EVENT: &str = "gatesai://new-conversation";
const SHORTCUT_STATE_EVENT: &str = "gatesai://global-shortcut-state";
const TRAY_OPEN_ID: &str = "open-gatesai";
const TRAY_NEW_CONVERSATION_ID: &str = "new-conversation";
const TRAY_QUIT_ID: &str = "quit-gatesai";

#[derive(Default)]
pub struct DesktopState {
  shortcut: Mutex<ShortcutRegistration>,
  close_to_tray: Mutex<bool>,
}

#[derive(Default)]
struct ShortcutRegistration {
  shortcut: Option<Shortcut>,
  chord: Option<String>,
  unavailable_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalShortcutStatus {
  pub enabled: bool,
  pub chord: Option<String>,
  pub available: bool,
  pub reason: Option<String>,
}

impl GlobalShortcutStatus {
  fn disabled() -> Self {
    Self { enabled: false, chord: None, available: true, reason: None }
  }

  fn unavailable(chord: Option<String>, reason: String) -> Self {
    Self { enabled: chord.is_some(), chord, available: false, reason: Some(reason) }
  }
}

#[tauri::command]
pub fn set_global_shortcut(app: AppHandle, chord: Option<String>) -> GlobalShortcutStatus {
  set_global_shortcut_inner(&app, chord)
}

#[tauri::command]
pub fn global_shortcut_state(app: AppHandle) -> GlobalShortcutStatus {
  let state = app.state::<DesktopState>();
  let guard = lock_or_recover(&state.shortcut);
  GlobalShortcutStatus {
    enabled: guard.chord.is_some(),
    chord: guard.chord.clone(),
    available: guard.unavailable_reason.is_none(),
    reason: guard.unavailable_reason.clone(),
  }
}

#[tauri::command]
pub fn set_close_to_tray(app: AppHandle, enabled: bool) {
  let state = app.state::<DesktopState>();
  *lock_or_recover(&state.close_to_tray) = enabled;
}

pub fn close_to_tray_enabled<R: Runtime>(window: &Window<R>) -> bool {
  let app = window.app_handle();
  let state = app.state::<DesktopState>();
  *lock_or_recover(&state.close_to_tray)
}

pub fn install<F>(app: &mut App, on_quit: F) -> tauri::Result<()>
where
  F: Fn(&AppHandle) + Send + Sync + 'static,
{
  install_tray(app, Arc::new(on_quit))?;
  let status = set_global_shortcut_inner(
    app.handle(),
    Some(DEFAULT_GLOBAL_SUMMON_CHORD.to_string()),
  );
  if !status.available {
    log::warn!("[gatesai] global shortcut unavailable at boot: {:?}", status.reason);
  }
  Ok(())
}

pub fn handle_global_shortcut(app: &AppHandle, event: ShortcutState) {
  if event == ShortcutState::Pressed {
    toggle_summon(app);
  }
}

pub fn toggle_summon(app: &AppHandle) {
  let Some(window) = app.get_webview_window("main") else { return; };
  let visible = window.is_visible().unwrap_or(false);
  let minimized = window.is_minimized().unwrap_or(false);
  let focused = window.is_focused().unwrap_or(false);

  if visible && !minimized && focused {
    if let Err(err) = window.hide() {
      log::warn!("[gatesai] failed to hide window: {err}");
    }
    return;
  }

  if let Err(err) = window.show() {
    log::warn!("[gatesai] failed to show window: {err}");
  }
  if minimized {
    if let Err(err) = window.unminimize() {
      log::warn!("[gatesai] failed to unminimize window: {err}");
    }
  }
  if let Err(err) = window.set_focus() {
    log::warn!("[gatesai] failed to focus window: {err}");
  }
  if let Err(err) = window.emit(SUMMON_EVENT, ()) {
    log::warn!("[gatesai] failed to emit summon event: {err}");
  }
}

pub fn parse_chord(chord: &str) -> Result<Shortcut, String> {
  let mut modifiers = Modifiers::empty();
  let mut key: Option<Code> = None;
  let mut saw_modifier = false;

  for raw_part in chord.split('+') {
    let part = raw_part.trim();
    if part.is_empty() {
      return Err("shortcut contains an empty key segment".to_string());
    }
    match part.to_ascii_lowercase().as_str() {
      "ctrl" | "control" => {
        modifiers.insert(Modifiers::CONTROL);
        saw_modifier = true;
      }
      "alt" | "option" => {
        modifiers.insert(Modifiers::ALT);
        saw_modifier = true;
      }
      "shift" => {
        modifiers.insert(Modifiers::SHIFT);
        saw_modifier = true;
      }
      "cmd" | "command" | "meta" | "super" => {
        modifiers.insert(Modifiers::META);
        saw_modifier = true;
      }
      _ => {
        if key.is_some() {
          return Err("shortcut must contain exactly one non-modifier key".to_string());
        }
        key = Some(parse_key(part)?);
      }
    }
  }

  if !saw_modifier {
    return Err("shortcut must include at least one modifier".to_string());
  }
  let key = key.ok_or_else(|| "shortcut must include a non-modifier key".to_string())?;
  Ok(Shortcut::new(Some(modifiers), key))
}

fn set_global_shortcut_inner(app: &AppHandle, chord: Option<String>) -> GlobalShortcutStatus {
  let state = app.state::<DesktopState>();
  let mut guard = lock_or_recover(&state.shortcut);
  if let Some(shortcut) = guard.shortcut.take() {
    if let Err(err) = app.global_shortcut().unregister(shortcut) {
      log::warn!("[gatesai] failed to unregister global shortcut: {err}");
    }
  }
  guard.chord = None;
  guard.unavailable_reason = None;

  let Some(chord) = chord.map(|value| value.trim().to_string()).filter(|value| !value.is_empty()) else {
    let status = GlobalShortcutStatus::disabled();
    emit_shortcut_status(app, &status);
    return status;
  };

  let shortcut = match parse_chord(&chord) {
    Ok(shortcut) => shortcut,
    Err(reason) => {
      let status = GlobalShortcutStatus::unavailable(Some(chord), reason);
      guard.unavailable_reason = status.reason.clone();
      emit_shortcut_status(app, &status);
      return status;
    }
  };

  match app.global_shortcut().register(shortcut) {
    Ok(()) => {
      guard.shortcut = Some(shortcut);
      guard.chord = Some(chord.clone());
      let status = GlobalShortcutStatus { enabled: true, chord: Some(chord), available: true, reason: None };
      emit_shortcut_status(app, &status);
      status
    }
    Err(err) => {
      let reason = format!("shortcut unavailable - in use by another app ({err})");
      log::warn!("[gatesai] global shortcut registration failed for {chord}: {err}");
      guard.chord = Some(chord.clone());
      guard.unavailable_reason = Some(reason.clone());
      let status = GlobalShortcutStatus::unavailable(Some(chord), reason);
      emit_shortcut_status(app, &status);
      status
    }
  }
}

fn install_tray(app: &mut App, on_quit: Arc<dyn Fn(&AppHandle) + Send + Sync>) -> tauri::Result<()> {
  let open = MenuItemBuilder::with_id(TRAY_OPEN_ID, "Open GatesAI").build(app)?;
  let new_conversation = MenuItemBuilder::with_id(TRAY_NEW_CONVERSATION_ID, "New conversation").build(app)?;
  let quit = MenuItemBuilder::with_id(TRAY_QUIT_ID, "Quit").build(app)?;
  let menu = MenuBuilder::new(app)
    .item(&open)
    .item(&new_conversation)
    .separator()
    .item(&quit)
    .build()?;

  let icon = app.default_window_icon().cloned();
  let mut builder = TrayIconBuilder::with_id("gatesai-tray")
    .menu(&menu)
    .tooltip("GatesAI Chat")
    .show_menu_on_left_click(false)
    .on_menu_event(|app, event| match event.id().as_ref() {
      TRAY_OPEN_ID => toggle_summon(app),
      TRAY_NEW_CONVERSATION_ID => {
        toggle_summon(app);
        if let Err(err) = app.emit(NEW_CONVERSATION_EVENT, ()) {
          log::warn!("[gatesai] failed to emit new conversation event: {err}");
        }
      }
      TRAY_QUIT_ID => {
        on_quit(app);
        app.exit(0);
      }
      _ => {}
    })
    .on_tray_icon_event(|tray, event| {
      if let TrayIconEvent::Click { button, button_state, .. } = event {
        if button == MouseButton::Left && button_state == MouseButtonState::Up {
          toggle_summon(tray.app_handle());
        }
      }
    });
  if let Some(icon) = icon {
    builder = builder.icon(icon);
  }
  builder.build(app)?;
  Ok(())
}

fn parse_key(key: &str) -> Result<Code, String> {
  let normalized = key.trim().to_ascii_lowercase();
  let code = match normalized.as_str() {
    "space" => Code::Space,
    "enter" | "return" => Code::Enter,
    "tab" => Code::Tab,
    "escape" | "esc" => Code::Escape,
    "backspace" => Code::Backspace,
    "delete" | "del" => Code::Delete,
    "arrowup" | "up" => Code::ArrowUp,
    "arrowdown" | "down" => Code::ArrowDown,
    "arrowleft" | "left" => Code::ArrowLeft,
    "arrowright" | "right" => Code::ArrowRight,
    "comma" | "," => Code::Comma,
    "period" | "." => Code::Period,
    "slash" | "/" => Code::Slash,
    "semicolon" | ";" => Code::Semicolon,
    "quote" | "'" => Code::Quote,
    "minus" | "-" => Code::Minus,
    "equal" | "=" => Code::Equal,
    "backquote" | "`" => Code::Backquote,
    value if value.len() == 1 && value.as_bytes()[0].is_ascii_alphabetic() => {
      match value.as_bytes()[0].to_ascii_uppercase() {
        b'A' => Code::KeyA,
        b'B' => Code::KeyB,
        b'C' => Code::KeyC,
        b'D' => Code::KeyD,
        b'E' => Code::KeyE,
        b'F' => Code::KeyF,
        b'G' => Code::KeyG,
        b'H' => Code::KeyH,
        b'I' => Code::KeyI,
        b'J' => Code::KeyJ,
        b'K' => Code::KeyK,
        b'L' => Code::KeyL,
        b'M' => Code::KeyM,
        b'N' => Code::KeyN,
        b'O' => Code::KeyO,
        b'P' => Code::KeyP,
        b'Q' => Code::KeyQ,
        b'R' => Code::KeyR,
        b'S' => Code::KeyS,
        b'T' => Code::KeyT,
        b'U' => Code::KeyU,
        b'V' => Code::KeyV,
        b'W' => Code::KeyW,
        b'X' => Code::KeyX,
        b'Y' => Code::KeyY,
        b'Z' => Code::KeyZ,
        _ => unreachable!(),
      }
    }
    value if value.len() == 1 && value.as_bytes()[0].is_ascii_digit() => {
      match value.as_bytes()[0] {
        b'0' => Code::Digit0,
        b'1' => Code::Digit1,
        b'2' => Code::Digit2,
        b'3' => Code::Digit3,
        b'4' => Code::Digit4,
        b'5' => Code::Digit5,
        b'6' => Code::Digit6,
        b'7' => Code::Digit7,
        b'8' => Code::Digit8,
        b'9' => Code::Digit9,
        _ => unreachable!(),
      }
    }
    value if value.starts_with('f') => parse_function_key(value)?,
    _ => return Err(format!("unsupported shortcut key: {key}")),
  };
  Ok(code)
}

fn parse_function_key(value: &str) -> Result<Code, String> {
  let number: u8 = value[1..]
    .parse()
    .map_err(|_| format!("unsupported shortcut key: {value}"))?;
  let code = match number {
    1 => Code::F1,
    2 => Code::F2,
    3 => Code::F3,
    4 => Code::F4,
    5 => Code::F5,
    6 => Code::F6,
    7 => Code::F7,
    8 => Code::F8,
    9 => Code::F9,
    10 => Code::F10,
    11 => Code::F11,
    12 => Code::F12,
    13 => Code::F13,
    14 => Code::F14,
    15 => Code::F15,
    16 => Code::F16,
    17 => Code::F17,
    18 => Code::F18,
    19 => Code::F19,
    20 => Code::F20,
    21 => Code::F21,
    22 => Code::F22,
    23 => Code::F23,
    24 => Code::F24,
    _ => return Err(format!("unsupported shortcut key: {value}")),
  };
  Ok(code)
}

fn emit_shortcut_status(app: &AppHandle, status: &GlobalShortcutStatus) {
  if let Err(err) = app.emit(SHORTCUT_STATE_EVENT, status) {
    log::warn!("[gatesai] failed to emit global shortcut state: {err}");
  }
}

fn lock_or_recover<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
  match mutex.lock() {
    Ok(guard) => guard,
    Err(poison) => poison.into_inner(),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn parses_default_chord() {
    assert!(parse_chord(DEFAULT_GLOBAL_SUMMON_CHORD).is_ok());
  }

  #[test]
  fn accepts_case_and_modifier_aliases() {
    assert!(parse_chord("control+alt+k").is_ok());
    assert!(parse_chord("Shift+F12").is_ok());
  }

  #[test]
  fn rejects_modifier_only_chords() {
    let err = parse_chord("Ctrl+Shift").unwrap_err();
    assert!(err.contains("non-modifier"));
  }

  #[test]
  fn rejects_chords_without_modifiers() {
    let err = parse_chord("Space").unwrap_err();
    assert!(err.contains("modifier"));
  }

  #[test]
  fn rejects_multiple_non_modifier_keys() {
    let err = parse_chord("Ctrl+K+Space").unwrap_err();
    assert!(err.contains("exactly one"));
  }
}
