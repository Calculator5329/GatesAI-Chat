import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMFY_BASE_URL,
  DEFAULT_OLLAMA_BASE_URL,
  isLoopbackBaseUrl,
  normalizeComfyBaseUrl,
  normalizeOllamaBaseUrl,
  suggestOllamaPortUrl,
} from '../../src/core/localUrls';

describe('normalizeOllamaBaseUrl', () => {
  it.each([
    ['192.168.1.20', 'http://192.168.1.20:11434'],
    ['gpu-box:11434/', 'http://gpu-box:11434'],
    ['https://ollama.example.com/api', 'https://ollama.example.com'],
    ['https://ollama.example.com/api/tags?x=1#top', 'https://ollama.example.com'],
    ['http://gpu-box', 'http://gpu-box'],
    ['gpu-box:80', 'http://gpu-box'],
    ['[::1]', 'http://[::1]:11434'],
    ['  http://127.0.0.1:11434///  ', 'http://127.0.0.1:11434'],
    ['https://example.com/ollama/', 'https://example.com/ollama'],
    ['https://user:pass@example.com', 'https://example.com'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeOllamaBaseUrl(input)).toBe(expected);
  });

  it('falls back to the loopback default for empty input', () => {
    expect(normalizeOllamaBaseUrl('')).toBe(DEFAULT_OLLAMA_BASE_URL);
    expect(normalizeOllamaBaseUrl('   ')).toBe(DEFAULT_OLLAMA_BASE_URL);
  });

  it('leaves non-http input trimmed so the probe can report it', () => {
    expect(normalizeOllamaBaseUrl(' ftp://box/ ')).toBe('ftp://box');
  });
});

describe('normalizeComfyBaseUrl', () => {
  it('uses ComfyUI port 8188 for a bare host', () => {
    expect(normalizeComfyBaseUrl('192.168.1.20')).toBe('http://192.168.1.20:8188');
    expect(normalizeComfyBaseUrl('127.0.0.1:8000/')).toBe('http://127.0.0.1:8000');
    expect(normalizeComfyBaseUrl('')).toBe(DEFAULT_COMFY_BASE_URL);
  });
});

describe('isLoopbackBaseUrl', () => {
  it.each([
    ['http://127.0.0.1:11434', true],
    ['http://localhost:11434', true],
    ['http://[::1]:11434', true],
    ['http://127.1.2.3:8188', true],
    ['http://192.168.1.20:11434', false],
    ['https://ollama.example.com', false],
    ['http://127.0.0.1.example.com', false],
    ['not a url', false],
  ])('%s -> %s', (input, expected) => {
    expect(isLoopbackBaseUrl(input)).toBe(expected);
  });
});

describe('suggestOllamaPortUrl', () => {
  it.each([
    ['http://gpu-box', 'http://gpu-box:11434'],
    ['https://ollama.example.com/proxy', 'http://ollama.example.com:11434'],
    ['http://[::1]', 'http://[::1]:11434'],
    ['http://gpu-box:11434', undefined],
    ['http://gpu-box:8080', undefined],
    ['ftp://box', undefined],
    ['not a url', undefined],
  ])('%s -> %s', (input, expected) => {
    expect(suggestOllamaPortUrl(input)).toBe(expected);
  });
});
