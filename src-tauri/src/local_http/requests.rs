//! Tracks cancellation callbacks by webview and request id. Kept independent
//! of Tauri so ownership and lifecycle rules can be tested without a webview.
use std::collections::HashMap;
use std::sync::Arc;

pub(super) type RequestKey = (String, String);

type Abort = Box<dyn Fn() + Send>;

#[derive(Default)]
pub(super) struct RequestRegistry {
  requests: HashMap<RequestKey, Request>,
}

struct Request {
  token: Arc<()>,
  abort: Abort,
}

impl RequestRegistry {
  pub fn contains(&self, key: &RequestKey) -> bool {
    self.requests.contains_key(key)
  }

  // Caller holds the registry lock from the duplicate check until insertion.
  pub fn insert(&mut self, key: RequestKey, token: Arc<()>, abort: Abort) {
    self.requests.insert(key, Request { token, abort });
  }

  pub fn finish(&mut self, key: &RequestKey, token: &Arc<()>) {
    // A cancelled task can finish just as its id is reused. Its cleanup
    // must not remove the replacement request.
    if self.requests.get(key).is_some_and(|request| Arc::ptr_eq(&request.token, token)) {
      self.requests.remove(key);
    }
  }

  pub fn cancel(&mut self, key: &RequestKey) {
    if let Some(request) = self.requests.remove(key) {
      (request.abort)();
    }
  }

  pub fn cancel_webview(&mut self, owner: &str) {
    self.requests.retain(|(webview, _), request| {
      if webview != owner { return true; }
      (request.abort)();
      false
    });
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::atomic::{AtomicUsize, Ordering};

  fn track(registry: &mut RequestRegistry, owner: &str, id: &str) -> (RequestKey, Arc<()>, Arc<AtomicUsize>) {
    let key = (owner.into(), id.into());
    let token = Arc::new(());
    let cancelled = Arc::new(AtomicUsize::new(0));
    let count = Arc::clone(&cancelled);
    registry.insert(key.clone(), Arc::clone(&token), Box::new(move || { count.fetch_add(1, Ordering::SeqCst); }));
    (key, token, cancelled)
  }

  #[test]
  fn reload_cancels_every_request_owned_by_that_webview_only() {
    let mut registry = RequestRegistry::default();
    let (chat, _, chat_cancelled) = track(&mut registry, "main", "chat");
    let (pull, _, pull_cancelled) = track(&mut registry, "main", "pull");
    let (other, _, other_cancelled) = track(&mut registry, "other", "chat");
    registry.cancel_webview("main");
    assert!(!registry.contains(&chat));
    assert!(!registry.contains(&pull));
    assert!(registry.contains(&other));
    assert_eq!(chat_cancelled.load(Ordering::SeqCst), 1);
    assert_eq!(pull_cancelled.load(Ordering::SeqCst), 1);
    assert_eq!(other_cancelled.load(Ordering::SeqCst), 0);
    registry.cancel_webview("main");
    assert_eq!(chat_cancelled.load(Ordering::SeqCst), 1);
  }

  #[test]
  fn explicit_cancel_is_scoped_to_the_calling_webview_and_unknown_ids_are_safe() {
    let mut registry = RequestRegistry::default();
    let (main, _, main_cancelled) = track(&mut registry, "main", "same-id");
    let (other, _, other_cancelled) = track(&mut registry, "other", "same-id");
    registry.cancel(&("main".into(), "unknown".into()));
    registry.cancel_webview("unknown");
    assert!(registry.contains(&main));
    assert!(registry.contains(&other));
    registry.cancel(&main);
    assert_eq!(main_cancelled.load(Ordering::SeqCst), 1);
    assert_eq!(other_cancelled.load(Ordering::SeqCst), 0);
    assert!(registry.contains(&other));
    registry.cancel(&main);
    assert_eq!(main_cancelled.load(Ordering::SeqCst), 1);
  }

  #[test]
  fn completion_removes_tracking_without_cancelling() {
    let mut registry = RequestRegistry::default();
    let (key, token, cancelled) = track(&mut registry, "main", "chat");
    registry.finish(&key, &token);
    registry.finish(&key, &token);
    registry.cancel_webview("main");
    assert!(!registry.contains(&key));
    assert_eq!(cancelled.load(Ordering::SeqCst), 0);
  }

  #[test]
  fn finishing_a_cancelled_request_does_not_remove_a_reused_id() {
    let mut registry = RequestRegistry::default();
    let (key, old_token, old_cancelled) = track(&mut registry, "main", "chat");
    registry.cancel_webview("main");
    let (_, current_token, current_cancelled) = track(&mut registry, "main", "chat");
    registry.finish(&key, &old_token);
    assert!(registry.contains(&key));
    assert_eq!(old_cancelled.load(Ordering::SeqCst), 1);
    registry.cancel(&key);
    registry.finish(&key, &current_token);
    assert!(!registry.contains(&key));
    assert_eq!(current_cancelled.load(Ordering::SeqCst), 1);
  }
}
