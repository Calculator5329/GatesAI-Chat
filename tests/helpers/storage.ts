/** Wipes all keys we care about from localStorage between tests. */
export function clearAppStorage(): void {
  try {
    localStorage.removeItem('gatesai.state.v1');
    localStorage.removeItem('gatesai.providers.v1');
    localStorage.removeItem('gatesai.openrouter.catalog.v1');
    localStorage.removeItem('gatesai.profile.v1');
    localStorage.removeItem('gatesai.notes.v1');
    localStorage.removeItem('gatesai.schedules.v1');
    localStorage.removeItem('gatesai.uiprefs.v1');
    localStorage.removeItem('gatesai.dock.v1');
    localStorage.removeItem('gatesai.ollama.v1');
    localStorage.removeItem('gatesai.imagegen.v1');
    localStorage.removeItem('gatesai.imagejobs.v1');
    localStorage.removeItem('gatesai.local.v1');
    localStorage.removeItem('gatesai.search.v1');
    localStorage.removeItem('gatesai.mcp.v1');
    localStorage.removeItem('gatesai.whatsNew.v1');
    localStorage.removeItem('gatesai.secrets.migrated.v1');
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('gatesai.state.backup.')) localStorage.removeItem(key);
      if (key.startsWith('gatesai.secret.')) localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}
