// Brave Search mock: the LLM-context grounding response braveClient parses.
import type { BravePlan, MockRoute } from '../types';
import { jsonResponse, networkFailure } from './http';

export const BRAVE_HOST_SUFFIX = 'brave.com';

export function braveRoutes(plan: BravePlan | undefined): MockRoute[] {
  const matches = (host: string) => host === BRAVE_HOST_SUFFIX || host.endsWith(`.${BRAVE_HOST_SUFFIX}`);
  if (!plan) {
    return [{ name: 'brave.offline', matches: req => matches(req.url.host), respond: req => networkFailure(req.url) }];
  }
  return [{
    name: 'brave.search',
    matches: req => matches(req.url.host),
    respond: req => {
      const query = req.url.searchParams.get('q') ?? '';
      return jsonResponse({
        query,
        grounding: {
          generic: plan.results.map(result => ({ title: result.title, url: result.url, content: result.text })),
        },
      });
    },
  }];
}
