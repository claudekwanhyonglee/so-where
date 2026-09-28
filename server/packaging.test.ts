import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const CI = '.github/workflows/ci.yml';
const RELEASE = '.github/workflows/release.yml';

describe('#11 AC1: CI runs both test suites on every push and pull request', () => {
  it('triggers on pushes and pull requests', () => {
    const ci = read(CI);
    expect(ci).toMatch(/^on:\s*\n(\s+.*\n)*?\s+push:/m);
    expect(ci).toMatch(/^\s+pull_request:/m);
  });

  it('runs the unit/API tests and the browser tests', () => {
    const ci = read(CI);
    expect(ci).toMatch(/run: npm test\b/);
    expect(ci).toMatch(/run: npm run test:e2e\b/);
    expect(ci).toMatch(/playwright install --with-deps chromium/);
  });
});

describe('#11 AC2: a version tag publishes the image to ghcr.io', () => {
  it('triggers on v* tags, tests first, then builds and pushes to ghcr.io', () => {
    const release = read(RELEASE);
    expect(release).toMatch(/tags:\s*\[?\s*['"]v\*['"]/);
    expect(release).toMatch(/uses: \.\/\.github\/workflows\/ci\.yml/);
    expect(release).toMatch(/needs: test/);
    expect(release).toMatch(/registry: ghcr\.io/);
    expect(release).toMatch(/images: ghcr\.io\/\$\{\{ github\.repository \}\}/);
    expect(release).toMatch(/push: true/);
    expect(release).toMatch(/packages: write/);
  });
});

describe('#11 AC3: the README uses the published image with a .env alongside', () => {
  it('has a copy-paste docker-compose.yml using ghcr.io and env_file: .env', () => {
    const readme = read('README.md');
    const compose = readme.match(/```ya?ml\n([\s\S]*?)```/)?.[1] ?? '';
    expect(compose).toMatch(/image: ghcr\.io\/claudekwanhyonglee\/so-where:latest/);
    expect(compose).toMatch(/env_file: \.env/);
    expect(compose).toMatch(/:\/data/);
    expect(readme).toMatch(/INVITE_CODE=/);
    expect(readme).toMatch(/PIN_PEPPER=/);
  });
});

describe('#11 AC4: no secrets beyond GitHub\'s built-in token', () => {
  it.each([CI, RELEASE])('%s only uses secrets.GITHUB_TOKEN', (path) => {
    expect(existsSync(new URL(`../${path}`, import.meta.url))).toBe(true);
    const secrets = read(path).match(/secrets\.\w+/g) ?? [];
    expect(secrets.every((s) => s === 'secrets.GITHUB_TOKEN')).toBe(true);
  });
});
