import { describe, expect, it } from 'vitest';
import { deriveFollowUps } from '../../src/core/followUps';

describe('deriveFollowUps', () => {
  it('quotes the offer the reply actually ends with', () => {
    const suggestions = deriveFollowUps('I patched the parser and the tests pass.\n\nWant me to run the full suite too?');
    expect(suggestions).toEqual(['Want me to run the full suite too?']);
  });

  it('ranks a direct offer above an earlier open question', () => {
    const reply = [
      'Which database should this write to?',
      '',
      'Should I wire it to SQLite for now?',
    ].join('\n');
    expect(deriveFollowUps(reply)).toEqual([
      'Should I wire it to SQLite for now?',
      'Which database should this write to?',
    ]);
  });

  it('invents nothing when the reply asks nothing', () => {
    expect(deriveFollowUps('Done. The file is at /workspace/notes/plan.md.')).toEqual([]);
    expect(deriveFollowUps('   ')).toEqual([]);
  });

  it('drops noise, duplicates, and anything too long for a chip', () => {
    const reply = [
      'Ok?',
      'Want me to deploy it?',
      'Want me to deploy it?',
      `Would you like me to ${'expand '.repeat(30)}?`,
    ].join('\n');
    expect(deriveFollowUps(reply)).toEqual(['Want me to deploy it?']);
  });

  it('strips markdown so a chip never shows list bullets or backticks', () => {
    expect(deriveFollowUps('- Should I run `npm run ci` next?')).toEqual(['Should I run npm run ci next?']);
  });

  it('returns at most three suggestions', () => {
    const reply = [
      'Should I do the first thing?',
      'Should I do the second thing?',
      'Should I do the third thing?',
      'Should I do the fourth thing?',
    ].join('\n');
    expect(deriveFollowUps(reply)).toHaveLength(3);
  });
});
