// A small scanned repository, built in a temp dir per call: git-initialised and committed, with a
// TypeScript module that fetches and writes a DatabaseSync, a CommonJS file that only parses as a
// script, a setInterval, a scheduled workflow, and files the pass cannot read (an enum, JSX,
// Python). `plantGenerator` adds a monitor/install-agents.mjs whose import would write `marker`:
// the file proves the launchd generator of a non-commitwork target is never imported.

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const FIXTURE_FILES = {
  'src/api.ts': [
    "import { DatabaseSync } from 'node:sqlite';",
    "import { save } from './store.js';",
    'interface Row { id: number }',
    'export async function pull(): Promise<Row[]> {',
    "  const res = await fetch('https://api.example.com/v1/items');",
    "  const db = new DatabaseSync('data/app.db');",
    "  db.prepare('INSERT INTO items (id) VALUES (?)').run(1);",
    '  return save((await res.json()) as Row[]);',
    '}',
    'setInterval(pull, 60_000);',
    '',
  ].join('\n'),
  'src/store.ts': "import { writeFileSync } from 'node:fs';\nexport function save<T>(rows: T): T { writeFileSync('out/rows.json', JSON.stringify(rows)); return rows; }\n",
  'lib/old.cjs': "#!/usr/bin/env node\nconst fs = require('fs');\nconst helper = require('./helper');\nfs.readFileSync('config/settings.json', 'utf8');\nreturn;\n",
  'lib/helper.js': 'module.exports = 1;\n',
  'lib/job.js': "const name = process.argv[2];\nrequire('fs').readFileSync(name);\n",
  'src/enum.ts': 'enum E { A }\n',
  'src/view.tsx': 'export const C = () => <div/>;\n',
  'src/broken.js': 'const = ;\n',
  'tool.py': "print('hi')\n",
  'README.md': '# fixture\n',
  '.github/workflows/nightly.yml': [
    'on:',
    '  schedule:',
    "    - cron: '0 3 * * *'",
    'jobs:',
    '  run:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: node lib/job.js',
    '',
  ].join('\n'),
};

export function fixtureRepo({ plantGenerator = false, extra = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cw-dfd-scanned-'));
  const marker = join(root, '..', `${root.split('/').pop()}-generator-ran`);
  const files = { ...FIXTURE_FILES, ...extra };
  if (plantGenerator) {
    files['monitor/install-agents.mjs'] = `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'imported');\nexport const AGENTS = [];\n`;
  }
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  const git = (...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  const c = git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  if (c.status !== 0) throw new Error(`fixture commit failed: ${c.stderr}`);
  return { root, marker };
}
