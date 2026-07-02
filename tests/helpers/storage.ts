/** Wipes all keys we care about from localStorage between tests. */
export function clearAppStorage(): void {
  try {
    localStorage.removeItem('gatesai.state.v1');
    localStorage.removeItem('gatesai.providers.v1');
    localStorage.removeItem('gatesai.openrouter.catalog.v1');
    localStorage.removeItem('gatesai.profile.v1');
    localStorage.removeItem('gatesai.notes.v1');
    localStorage.removeItem('gatesai.uiprefs.v1');
    localStorage.removeItem('gatesai.ollama.v1');
    localStorage.removeItem('gatesai.imagegen.v1');
    localStorage.removeItem('gatesai.imagejobs.v1');
    localStorage.removeItem('gatesai.local.v1');
    localStorage.removeItem('gatesai.search.v1');
    localStorage.removeItem('gatesai.secrets.migrated.v1');
  } catch {
    // ignore
  }
}
