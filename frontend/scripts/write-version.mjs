import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function readCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'local';
  }
}

const commit = process.env.CF_PAGES_COMMIT_SHA?.slice(0, 7) || readCommit();
const version = `front-${commit}`;
const outputPath = join(process.cwd(), 'src', 'app', 'app-version.ts');

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `export const APP_VERSION = '${version}';\n`);

console.log(`Wrote ${version} to ${outputPath}`);
