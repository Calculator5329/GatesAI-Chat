import { describe, expect, it } from 'vitest';
import { artifactDir, artifactVersionPath, artifactDataDir, artifactMetaPath, makeArtifactId, isArtifactDataPath } from '../../src/core/artifacts';

describe('artifact path helpers', () => {
  it('builds canonical /workspace paths from id', () => {
    expect(artifactDir('pomodoro-a1b2c3')).toBe('/workspace/artifacts/pomodoro-a1b2c3');
    expect(artifactMetaPath('pomodoro-a1b2c3')).toBe('/workspace/artifacts/pomodoro-a1b2c3/meta.json');
    expect(artifactVersionPath('pomodoro-a1b2c3', 2)).toBe('/workspace/artifacts/pomodoro-a1b2c3/v2.html');
    expect(artifactDataDir('pomodoro-a1b2c3')).toBe('/workspace/artifacts/pomodoro-a1b2c3/data');
  });

  it('makes ids that combine title slug and 6-char nanoid', () => {
    const id = makeArtifactId('My Cool Demo!');
    expect(id).toMatch(/^my-cool-demo-[a-z0-9]{6}$/);
  });

  it('falls back to "artifact" when title slug is empty', () => {
    expect(makeArtifactId('!!!')).toMatch(/^artifact-[a-z0-9]{6}$/);
  });

  it('isArtifactDataPath only accepts paths inside the artifact data dir', () => {
    expect(isArtifactDataPath('foo', '/workspace/artifacts/foo/data/x.json')).toBe(true);
    expect(isArtifactDataPath('foo', '/workspace/artifacts/foo/data/sub/x.json')).toBe(true);
    expect(isArtifactDataPath('foo', '/workspace/artifacts/foo/v1.html')).toBe(false);
    expect(isArtifactDataPath('foo', '/workspace/artifacts/bar/data/x.json')).toBe(false);
    expect(isArtifactDataPath('foo', '/workspace/artifacts/foo/data/../../escape')).toBe(false);
  });
});
