import { OpenAiCompatProvider } from './openaiCompat';

export class GroqProvider extends OpenAiCompatProvider {
  constructor(apiKey?: string) {
    super({
      id: 'groq',
      name: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey,
    });
  }
}
