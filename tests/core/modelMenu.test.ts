import { describe, expect, it } from 'vitest';
import type { Model } from '../../src/core/types';
import { MODELS } from '../../src/core/models';
import {
  FAVORITE_MODEL_IDS,
  buildModelMenuSections,
} from '../../src/core/modelMenu';

describe('model menu organization', () => {
  it('puts favorite models first in the requested order', () => {
    const sections = buildModelMenuSections(MODELS);
    const favorites = sections[0];

    expect(favorites?.title).toBe('Favorites');
    expect(favorites?.models.map(model => model.id)).toEqual(FAVORITE_MODEL_IDS);
    expect(favorites?.models.map(model => model.name)).toEqual([
      'Gemini 3 Flash',
      'DeepSeek V4 Flash',
      'GPT-5.5',
      'Claude Opus 4.7',
      'Gemini 3.1 Pro',
      'Normal image — Flux 2 Klein',
    ]);
  });

  it('keeps favorites when live OpenRouter entries replace curated ids', () => {
    const livePreferredCatalog: Model[] = [
      catalogModel('or-live-google_gemini-3-flash-preview', 'Google: Gemini 3 Flash Preview', 'Google', 'google/gemini-3-flash-preview'),
      catalogModel('or-live-deepseek_deepseek-v4-flash', 'DeepSeek: DeepSeek V4 Flash', 'DeepSeek', 'deepseek/deepseek-v4-flash'),
      catalogModel('or-live-openai_gpt-5.5', 'OpenAI: GPT-5.5', 'OpenAI', 'openai/gpt-5.5'),
      catalogModel('or-live-anthropic_claude-opus-4.7', 'Anthropic: Claude Opus 4.7', 'Anthropic', 'anthropic/claude-opus-4.7'),
      catalogModel('or-live-google_gemini-3.1-pro-preview', 'Google: Gemini 3.1 Pro Preview', 'Google', 'google/gemini-3.1-pro-preview'),
      favorite('image-direct-comfy', 'Normal image — Flux 2 Klein', 'Local image', 'comfy-direct', 'local-image'),
      catalogModel('or-live-google_gemma', 'Google: Gemma 4', 'Google', 'google/gemma-4'),
    ];

    const sections = buildModelMenuSections(livePreferredCatalog);
    const favorites = sections[0];

    expect(favorites?.title).toBe('Favorites');
    expect(favorites?.models.map(model => model.providerModelId)).toEqual([
      'google/gemini-3-flash-preview',
      'deepseek/deepseek-v4-flash',
      'openai/gpt-5.5',
      'anthropic/claude-opus-4.7',
      'google/gemini-3.1-pro-preview',
      'comfy-direct',
    ]);
    expect(sections.find(section => section.title === 'Google')?.models.map(model => model.providerModelId)).toEqual([
      'google/gemma-4',
    ]);
  });

  it('groups non-favorite OpenRouter catalog models by top provider before the rest', () => {
    const catalog: Model[] = [
      favorite('or-gemini-3-flash', 'Gemini 3 Flash', 'Google', 'google/gemini-3-flash-preview'),
      favorite('or-deepseek-v4-flash', 'DeepSeek V4 Flash', 'DeepSeek', 'deepseek/deepseek-v4-flash'),
      favorite('or-gpt-5.5', 'GPT-5.5', 'OpenAI', 'openai/gpt-5.5'),
      favorite('or-claude-opus-4.7', 'Claude Opus 4.7', 'Anthropic', 'anthropic/claude-opus-4.7'),
      favorite('or-gemini-3.1-pro', 'Gemini 3.1 Pro', 'Google', 'google/gemini-3.1-pro-preview'),
      favorite('image-direct-comfy', 'Normal image — Flux 2 Klein', 'Local image', 'comfy-direct', 'local-image'),
      catalogModel('or-live-google_extra', 'Google: extra', 'Google', 'google/extra'),
      catalogModel('or-live-anthropic_extra', 'Anthropic: extra', 'Anthropic', 'anthropic/extra'),
      catalogModel('or-live-openai_extra', 'OpenAI: extra', 'OpenAI', 'openai/extra'),
      catalogModel('or-live-deepseek_extra', 'DeepSeek: extra', 'DeepSeek', 'deepseek/extra'),
      catalogModel('or-live-x-ai_extra', 'xAI: extra', 'xAI', 'x-ai/extra'),
      catalogModel('or-live-mistral_extra', 'Mistral: extra', 'Mistral', 'mistralai/extra'),
    ];

    const sections = buildModelMenuSections(catalog);

    expect(sections.map(section => section.title)).toEqual([
      'Favorites',
      'Google',
      'Anthropic',
      'OpenAI',
      'DeepSeek',
      'xAI',
      'Mistral',
    ]);
    expect(sections.find(section => section.title === 'Google')?.models.map(model => model.id)).toEqual([
      'or-live-google_extra',
    ]);
  });
});

function favorite(
  id: string,
  name: string,
  vendor: string,
  providerModelId: string,
  providerId: Model['providerId'] = 'openrouter',
): Model {
  return {
    id,
    name,
    vendor,
    providerId,
    providerModelId,
  };
}

function catalogModel(id: string, name: string, vendor: string, providerModelId: string): Model {
  return {
    id,
    name,
    vendor,
    providerId: 'openrouter',
    providerModelId,
    dynamic: true,
  };
}
