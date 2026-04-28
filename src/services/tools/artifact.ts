import type { Tool } from './types';

/**
 * artifact — emit a self-contained interactive HTML page that renders inline
 * in the chat. Returns an artifact reference the UI uses to mount a sandboxed
 * iframe; the model never re-pastes the html into the visible reply.
 */
export const artifactTool: Tool = {
  def: {
    name: 'artifact',
    description: [
      'artifact — emit a self-contained interactive HTML page that renders inline in the chat.',
      '',
      'Use this when the user asks for a page, widget, calculator, mini-tool, visualization, demo, dashboard, or anything they can click on. Single-file HTML only: inline <style> and <script>, optional CDN imports. The page renders inside a sandboxed iframe; you have NO access to host cookies or storage, but `window.gates` is available for workspace I/O:',
      '',
      '  await window.gates.readFile(path)            // any /workspace path',
      '  await window.gates.listDir(path)             // any /workspace path',
      '  await window.gates.writeFile(path, content)  // only inside this artifact\'s data folder',
      '',
      'Actions:',
      '• `create` — { title, html, summary? }. Returns artifact_id + v1.',
      '• `update` — { artifact_id, html, change_note? }. Bumps to v(n+1). Always pass the FULL replacement html.',
      '',
      'Constraints: html ≤ 1,000,000 chars. After calling, do NOT paste the html back into chat — the user already sees the rendered card.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'update'], description: 'create a new artifact, or update an existing one' },
        title: { type: 'string', description: 'Short human-readable title (create only).' },
        html: { type: 'string', description: 'Full HTML document. Required for create and update.' },
        summary: { type: 'string', description: 'One-sentence note shown alongside the success line (create only).' },
        artifact_id: { type: 'string', description: 'Existing artifact id (update only).' },
        change_note: { type: 'string', description: 'Optional note about what changed (update only).' },
      },
      required: ['action'],
    },
  },
  meta: { category: 'workspace', resultPolicy: { maxChars: 500 }, hasSideEffects: () => true },
  async execute(args, ctx) {
    if (!ctx.artifacts) return 'Error: artifacts unavailable in this context.';
    const action = String(args.action ?? '');
    const html = typeof args.html === 'string' ? args.html : '';
    if (html.length > 1_000_000) return `Error: html too large (${html.length} chars; max 1,000,000).`;
    if (!html) return 'Error: `html` is required.';
    if (action === 'create') {
      const title = typeof args.title === 'string' ? args.title.trim() : '';
      if (!title) return 'Error: `title` is required for create.';
      const ref = await ctx.artifacts.create({ title, html, threadId: ctx.threadId, originMessageId: undefined });
      const summary = typeof args.summary === 'string' && args.summary.trim() ? ` ${args.summary.trim()}` : '';
      return {
        content: `Created artifact ${ref.id} v${ref.version}: ${title}.${summary}`,
        artifacts: [{ kind: 'artifact', id: ref.id, version: ref.version }],
      };
    }
    if (action === 'update') {
      const id = typeof args.artifact_id === 'string' ? args.artifact_id : '';
      if (!id) return 'Error: `artifact_id` is required for update.';
      const changeNote = typeof args.change_note === 'string' ? args.change_note : undefined;
      const ref = await ctx.artifacts.update({ id, html, changeNote });
      if (!ref) return `Error: artifact ${id} not found.`;
      return {
        content: `Updated artifact ${ref.id} to v${ref.version}.${changeNote ? ' ' + changeNote : ''}`,
        artifacts: [{ kind: 'artifact', id: ref.id, version: ref.version }],
      };
    }
    return `Error: unknown action "${action}". Valid: create, update.`;
  },
};
