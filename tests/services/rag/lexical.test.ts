import { describe, expect, it } from 'vitest';
import { lexicalSearch, tokenizeForRecall } from '../../../src/services/rag/lexical';
import type { RagChunk } from '../../../src/services/rag/vectorStore';
import { vectorForText } from './helpers';

describe('lexical recall', () => {
  it('preserves identifiers, model names, filenames, and hyphenated terms', () => {
    expect(tokenizeForRecall('ORB-731 qwen3:0.6b config.toml /v2/harbor')).toEqual([
      'orb-731', 'qwen3', '0.6b', 'config.toml', 'v2/harbor',
    ]);
    const chunks = [chunk('exact', 'Ticket ORB-731 tracks upload resume.'), chunk('noise', 'Orbital upload overview.')];
    expect(lexicalSearch('ORB-731', chunks, 2)[0]?.chunk.sourceId).toBe('exact');
  });

  it('uses document frequency so a rare term outranks common vocabulary', () => {
    const chunks = [
      chunk('rare', 'project project zephyr'),
      chunk('common-a', 'project status'),
      chunk('common-b', 'project notes'),
    ];
    expect(lexicalSearch('project zephyr', chunks, 3)[0]?.chunk.sourceId).toBe('rare');
  });
});

function chunk(sourceId: string, text: string): RagChunk {
  return { id: sourceId, sourceType: 'note', sourceId, text, vector: vectorForText(text), updatedAt: 1, model: 'model-a' };
}
