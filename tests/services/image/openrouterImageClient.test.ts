import { describe, expect, it } from 'vitest';
import { extractFirstDataUrlImage, OpenRouterImageClient } from '../../../src/services/image/openrouterImageClient';

describe('extractFirstDataUrlImage', () => {
  it('reads OpenRouter assistant message images', () => {
    const image = extractFirstDataUrlImage({
      choices: [{ message: { images: [{ image_url: { url: 'data:image/png;base64,aGVsbG8=' } }] } }],
    });

    expect(image).toEqual({ mime: 'image/png', base64: 'aGVsbG8=' });
  });

  it('finds base64 image data URLs anywhere in a provider payload', () => {
    const image = extractFirstDataUrlImage({
      choices: [{ message: { content: [{ image_url: { url: 'data:image/webp;base64,abc123==' } }] } }],
    });

    expect(image).toEqual({ mime: 'image/webp', base64: 'abc123==' });
  });
});

describe('OpenRouterImageClient', () => {
  it('fails clearly when the response has no image', async () => {
    const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'I could not create that image.' } }],
    }), { status: 200 });
    const client = new OpenRouterImageClient({ apiKey: 'sk-or-test', fetch: fakeFetch });

    await expect(client.generate({ prompt: 'x' })).rejects.toThrow(/no generated image: I could not create that image/i);
  });

  it('returns OpenRouter usage cost when present', async () => {
    const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
      usage: { cost: 0.045 },
      choices: [{ message: { images: [{ image_url: { url: 'data:image/png;base64,aGVsbG8=' } }] } }],
    }), { status: 200 });
    const client = new OpenRouterImageClient({ apiKey: 'sk-or-test', fetch: fakeFetch });

    await expect(client.generate({ prompt: 'x' })).resolves.toMatchObject({
      base64: 'aGVsbG8=',
      costUsd: 0.045,
    });
  });

  it('surfaces HTTP failures', async () => {
    const fakeFetch: typeof fetch = async () => new Response('bad request', { status: 400, statusText: 'Bad Request' });
    const client = new OpenRouterImageClient({ apiKey: 'sk-or-test', fetch: fakeFetch });

    await expect(client.generate({ prompt: 'x' })).rejects.toThrow(/400 Bad Request: bad request/i);
  });
});
