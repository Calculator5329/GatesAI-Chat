import type { LlmMessage } from '../../core/llm';
import type { PromptStylePreset } from './types';

export type LlmComplete = (
  messages: Pick<LlmMessage, 'role' | 'content'>[],
  systemPrompt?: string,
) => Promise<string>;

export interface EnhancePromptInput {
  prompt: string;
  stylePreset: PromptStylePreset;
  llmComplete: LlmComplete;
}

const SYSTEM_PROMPT = [
  'You are an expert SDXL prompt engineer for local image generation.',
  'Rewrite the user prompt into one concise positive prompt only.',
  'Do not include explanations, markdown, numbered lists, or negative prompts.',
  'Prioritize: subject, environment, composition, lighting, color palette, rendering style, camera/lens cues, and quality descriptors.',
  'Avoid text/logos/letters unless the user explicitly asks for typography.',
  'Keep the result under 75 words.',
].join(' ');

const STYLE_HINTS: Record<PromptStylePreset, string> = {
  auto: 'Infer the best visual style from the user prompt.',
  photorealistic: 'Photorealistic, cinematic, natural materials, realistic lighting, detailed environment.',
  'concept-art': 'High-end concept art, strong silhouette, cinematic mood, detailed design language.',
  abstract: 'Abstract visual design, clean composition, rich texture, intentional color relationships.',
  illustration: 'Polished illustration, cohesive shapes, expressive lighting, crisp readable composition.',
};

export async function enhancePrompt(input: EnhancePromptInput): Promise<string> {
  const original = input.prompt.trim();
  if (!original) return original;

  try {
    const enhanced = await input.llmComplete(
      [{
        role: 'user',
        content: [
          `Style preset: ${input.stylePreset}`,
          `Style guidance: ${STYLE_HINTS[input.stylePreset]}`,
          `User prompt: ${original}`,
        ].join('\n'),
      }],
      SYSTEM_PROMPT,
    );
    const cleaned = enhanced
      .trim()
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned || original;
  } catch {
    return original;
  }
}
