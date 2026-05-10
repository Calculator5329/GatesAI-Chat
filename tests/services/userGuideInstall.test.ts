import { describe, expect, it, beforeEach } from 'vitest';
import {
  USER_GUIDE_WORKSPACE_PATH,
  ensureUserGuide,
  openUserGuideOnFirstInstall,
  prepareWorkspaceGuideHtml,
} from '../../src/services/bridge/userGuideInstall';

describe('userGuideInstall', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('rewrites guide screenshot paths for the seeded workspace location', () => {
    expect(prepareWorkspaceGuideHtml('<img src="user-guide-assets/chat-home.png">'))
      .toBe('<img src="./user-guide-assets/chat-home.png">');
  });

  it('creates the user guide html and asset files in workspace reports', async () => {
    const calls: Array<{ op: string; data: unknown }> = [];
    const client = {
      async request<T = unknown>(op: string, data: unknown): Promise<T> {
        calls.push({ op, data });
        return {} as T;
      },
    };

    await ensureUserGuide(client, {
      html: '<img src="user-guide-assets/chat-home.png">',
      assets: [{ filename: 'chat-home.png', base64: 'abc123' }],
    });

    expect(calls).toEqual(expect.arrayContaining([
      { op: 'fs.mkdir', data: { path: '/workspace/artifacts/reports' } },
      { op: 'fs.mkdir', data: { path: '/workspace/artifacts/reports/user-guide-assets' } },
      {
        op: 'fs.write',
        data: {
          path: USER_GUIDE_WORKSPACE_PATH,
          content: '<img src="./user-guide-assets/chat-home.png">',
          encoding: 'utf8',
        },
      },
      {
        op: 'fs.write',
        data: {
          path: '/workspace/artifacts/reports/user-guide-assets/chat-home.png',
          content: 'abc123',
          encoding: 'base64',
        },
      },
    ]));
  });

  it('opens the guide only once after it is seeded', async () => {
    const client = {
      async request<T = unknown>(): Promise<T> {
        return {} as T;
      },
    };
    const opened: string[] = [];
    const openWorkspacePath = async (path: string): Promise<boolean> => {
      opened.push(path);
      return true;
    };
    const options = {
      html: 'hello',
      assets: [] as [],
    };

    await expect(openUserGuideOnFirstInstall(client, openWorkspacePath, options)).resolves.toBe(true);
    await expect(openUserGuideOnFirstInstall(client, openWorkspacePath, options)).resolves.toBe(false);

    expect(opened).toEqual([USER_GUIDE_WORKSPACE_PATH]);
  });
});
