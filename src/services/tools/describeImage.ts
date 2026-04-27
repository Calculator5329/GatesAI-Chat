import type { Tool } from './types';

export const describeImageTool: Tool = {
  def: {
    name: 'describe_image',
    description: 'Use a local Ollama vision model to describe or answer questions about an image file in the workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace path to the image, e.g. /workspace/artifacts/example.png.' },
        question: { type: 'string', description: 'Optional focused question about the image.' },
      },
      required: ['path'],
    },
  },
  meta: { category: 'vision' },
  async execute(args, ctx) {
    const path = typeof args.path === 'string' ? args.path.trim() : '';
    if (!path) return 'Error: `path` is required.';
    if (!ctx.bridge?.isOnline) return 'Error: bridge is offline, so GatesAI cannot read the image file.';
    if (!ctx.localRuntime?.visionModel) return 'Error: No local vision model selected in the Local menu.';

    const image = await ctx.bridge.readAttachmentBase64(path);
    if (!image) return `Error: could not read image at ${path}.`;

    const question = typeof args.question === 'string' && args.question.trim()
      ? args.question.trim()
      : 'Describe this image in detail.';

    const resp = await fetch(`${ctx.localRuntime.ollamaBaseUrl.replace(/\/+$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ctx.localRuntime.visionModel,
        stream: false,
        messages: [{
          role: 'user',
          content: question,
          images: [image.base64],
        }],
      }),
    });

    if (!resp.ok) return `Error: Ollama vision request failed with HTTP ${resp.status}.`;
    const json = await resp.json() as { message?: { content?: string }; response?: string };
    return json.message?.content?.trim() || json.response?.trim() || 'No description returned by the local vision model.';
  },
};
