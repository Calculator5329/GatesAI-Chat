import { OpenAiCompatProvider } from './openaiCompat';

const DEFAULT_LOCAL_BASE = 'http://localhost:11434/v1';

export class LocalProvider extends OpenAiCompatProvider {
  constructor(baseUrl?: string, apiKey?: string) {
    super({
      id: 'local',
      name: 'Local',
      baseUrl: baseUrl?.trim() || DEFAULT_LOCAL_BASE,
      apiKey,
    });
  }
}
