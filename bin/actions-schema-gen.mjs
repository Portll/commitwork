// Regenerates lib/actions-schema.mjs from the workflow schema shipped in @actions/workflow-parser,
// read from the oracle install (CW_ACTIONS_ORACLE_DIR, default ~/.commitwork/oracles/actions).
//   node bin/actions-schema-gen.mjs [--check]     exit 0 written or unchanged · 1 differs (--check) · 2 no oracle
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, '..', 'lib', 'actions-schema.mjs');

export function renderSchemaModule(schemaJson, packageVersion) {
  const stripProperties = (properties) => Object.fromEntries(Object.entries(properties).map(([name, spec]) => [name, typeof spec === 'string' ? spec : Object.fromEntries(Object.entries(spec).filter(([k]) => k !== 'description'))]));
  const stripDefinition = (def) => Object.fromEntries(Object.entries(def).filter(([k]) => k !== 'description').map(([k, v]) => [k, k === 'mapping' && v.properties ? { ...v, properties: stripProperties(v.properties) } : v]));
  const defs = Object.fromEntries(Object.entries(schemaJson.definitions).map(([name, def]) => [name, stripDefinition(def)]));
  const lines = [
    '// The workflow schema GitHub Actions reads workflow files against: definition names, mapping',
    '// properties, scalar forms, one-of choices and the contexts expressions may use at each site.',
    `// Derived from workflow-v1.0 in @actions/workflow-parser ${packageVersion} (MIT, GitHub), descriptions`,
    '// removed; see docs/THIRD-PARTY-NOTICES.md. Regenerate with bin/actions-schema-gen.mjs rather than edit.',
    '',
    `export const schemaVersion = ${JSON.stringify(schemaJson.version)};`,
    `export const schemaSource = ${JSON.stringify(`@actions/workflow-parser ${packageVersion}`)};`,
    '',
    'export const definitions = Object.freeze({',
    ...Object.entries(defs).map(([name, def]) => `  ${JSON.stringify(name)}: ${JSON.stringify(def)},`),
    '});',
    '',
  ];
  return lines.join('\n');
}

function main(argv, env) {
  const check = argv.includes('--check');
  const dir = env.CW_ACTIONS_ORACLE_DIR || path.join(homedir(), '.commitwork', 'oracles', 'actions');
  const pkgDir = path.join(dir, 'node_modules', '@actions', 'workflow-parser');
  const schemaPath = path.join(pkgDir, 'dist', 'workflow-v1.0.min.json');
  if (!existsSync(schemaPath)) { console.error(`no oracle schema at ${schemaPath}`); return 2; }
  const version = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version;
  const rendered = renderSchemaModule(JSON.parse(readFileSync(schemaPath, 'utf8')), version);
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (rendered === current) { console.log(`unchanged ${target}`); return 0; }
  if (check) { console.log(`differs ${target}`); return 1; }
  writeAtomic(target, rendered);
  console.log(`wrote ${target}`);
  return 0;
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2), process.env));
