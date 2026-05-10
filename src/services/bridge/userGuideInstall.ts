import userGuideHtml from '../../../docs/user-guide.html?raw';
import agentMemoryUrl from '../../../docs/user-guide-assets/agent-memory.png?url';
import chatHomeUrl from '../../../docs/user-guide-assets/chat-home.png?url';
import galleryUrl from '../../../docs/user-guide-assets/gallery.png?url';
import modelPickerUrl from '../../../docs/user-guide-assets/model-picker.png?url';
import modelsOpenrouterUrl from '../../../docs/user-guide-assets/models-openrouter.png?url';
import workspaceUrl from '../../../docs/user-guide-assets/workspace.png?url';

interface BridgeRequestFacade {
  request<T = unknown>(op: string, data: unknown): Promise<T>;
}

type UserGuideAsset =
  | { filename: string; url: string; base64?: never }
  | { filename: string; base64: string; url?: never };

interface EnsureUserGuideOptions {
  html?: string;
  assets?: UserGuideAsset[];
}

const USER_GUIDE_OPENED_KEY = 'gatesai.userGuide.opened.v1';
const USER_GUIDE_DIR = '/workspace/artifacts/reports';
const USER_GUIDE_ASSET_DIR = `${USER_GUIDE_DIR}/user-guide-assets`;

export const USER_GUIDE_WORKSPACE_PATH = `${USER_GUIDE_DIR}/GatesAI-User-Guide.html`;

const USER_GUIDE_ASSETS: UserGuideAsset[] = [
  { filename: 'agent-memory.png', url: agentMemoryUrl },
  { filename: 'chat-home.png', url: chatHomeUrl },
  { filename: 'gallery.png', url: galleryUrl },
  { filename: 'model-picker.png', url: modelPickerUrl },
  { filename: 'models-openrouter.png', url: modelsOpenrouterUrl },
  { filename: 'workspace.png', url: workspaceUrl },
];

export async function ensureUserGuide(
  client: BridgeRequestFacade,
  options: EnsureUserGuideOptions = {},
): Promise<void> {
  const html = prepareWorkspaceGuideHtml(options.html ?? userGuideHtml);
  const assets = options.assets ?? USER_GUIDE_ASSETS;

  await safeRequest(client, 'fs.mkdir', { path: USER_GUIDE_DIR });
  await safeRequest(client, 'fs.mkdir', { path: USER_GUIDE_ASSET_DIR });
  await safeRequest(client, 'fs.write', {
    path: USER_GUIDE_WORKSPACE_PATH,
    content: html,
    encoding: 'utf8',
  });

  for (const asset of assets) {
    const content = asset.base64 ?? await fetchAssetBase64(asset.url);
    await safeRequest(client, 'fs.write', {
      path: `${USER_GUIDE_ASSET_DIR}/${asset.filename}`,
      content,
      encoding: 'base64',
    });
  }
}

export async function openUserGuideOnFirstInstall(
  client: BridgeRequestFacade,
  openWorkspacePath: (path: string) => Promise<boolean>,
  options: EnsureUserGuideOptions = {},
): Promise<boolean> {
  try {
    await ensureUserGuide(client, options);
  } catch (err) {
    console.warn('[userGuideInstall] failed to seed user guide', err);
    return false;
  }
  if (hasOpenedUserGuide()) return false;
  const opened = await openWorkspacePath(USER_GUIDE_WORKSPACE_PATH).catch(() => false);
  if (opened) markUserGuideOpened();
  return opened;
}

export function prepareWorkspaceGuideHtml(html: string): string {
  return html.replaceAll('src="user-guide-assets/', 'src="./user-guide-assets/');
}

export function hasOpenedUserGuide(): boolean {
  try {
    return localStorage.getItem(USER_GUIDE_OPENED_KEY) === '1';
  } catch {
    return true;
  }
}

export function markUserGuideOpened(): void {
  try {
    localStorage.setItem(USER_GUIDE_OPENED_KEY, '1');
  } catch {
    // Ignore storage failures; the guide has already been opened.
  }
}

async function fetchAssetBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load user guide asset ${url}: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return bytesToBase64(bytes);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function safeRequest(client: BridgeRequestFacade, op: string, data: unknown): Promise<void> {
  try {
    await client.request(op, data);
  } catch {
    // User-guide seeding should not block app startup.
  }
}
