import { describe, expect, it } from 'vitest';
import { extractFirstDataUrlImage, OpenRouterImageClient } from '../../../src/services/image/openrouterImageClient';

describe('extractFirstDataUrlImage', () => {
  it('finds base64 image data URLs anywhere in a provider payload', () => {
    const image = extractFirstDataUrlImage({
      choices: [{ message: { content: [{ image_url: { url: 'data:image/webp;base64,abc123==' } }] } }],
    });

    expect(image).toEqual({ mime: 'image/webp', base64: 'abc123==' });
  });
});

describe('OpenRouterImageClient', () => {
  it('fails clearly when the response has no image', async () => {
    const fetch = (async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'I could not create that image.' } }],
    }), { status: 200 })) as typeof fetch;
    const client = new OpenRouterImageClient({ apiKey: 'sk-or-test', fetch });

    await expect(client.generate({ prompt: 'x' })).rejects.toThrow(/no generated image: I could not create that image/i);
  });

  it('surfaces HTTP failures', async () => {
    const fetch = (async () => new Response('bad request', { status: 400, statusText: 'Bad Request' })) as typeof fetch;
    const client = new OpenRouterImageClient({ apiKey: 'sk-or-test', fetch });

    await expect(client.generate({ prompt: 'x' })).rejects.toThrow(/400 Bad Request: bad request/i);
  });
});
