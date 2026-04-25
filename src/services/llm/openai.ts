import { OpenAiCompatProvider } from './openaiCompat';

export class OpenAiProvider extends OpenAiCompatProvider {
  constructor(apiKey?: string) {
    super({
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKey,
    });
  }
}
