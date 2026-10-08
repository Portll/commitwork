// The entry condition for manifests/semgrep-taint/: every rule must find something the OSS engine
// CANNOT. A rule the OSS engine also finds belongs in a pattern pack — keeping it here would make
// the Semgrep account dependency look load-bearing when it is not, which is the same class of claim
// as a lane that reports coverage it does not have.
//
// This test SHELLS OUT to semgrep. It is skipped, loudly and by name, when semgrep is absent — a
// skip that says why is a state; a silent pass would assert the rules work on a machine that never
// ran them.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RULES = process.env.CW_SEMGREP_TAINT || resolve(HERE, '..', '..', 'manifests', 'semgrep-taint', 'taint.yaml');

const semgrepPresent = () => spawnSync('semgrep', ['--version'], { encoding: 'utf8' }).status === 0;

// One probe per rule, each crossing a function boundary so pattern matching cannot see it.
const PROBES = {
  'env-shell.js': 'const cp=require("child_process");\nfunction src(){ return process.env.EVIL; }\nfunction sink(x){ cp.execSync(x); }\nsink(src());\n',
  'req-shell.js': 'const cp=require("child_process");\nfunction get(req){ return req.body.cmd; }\nfunction run(c){ cp.exec(c); }\nmodule.exports=(req)=>run(get(req));\n',
  'env-shell.py': 'import os, subprocess\ndef src():\n    return os.environ.get("EVIL")\ndef sink(c):\n    subprocess.run(c, shell=True)\nsink(src())\n',
};

/** {results, engine, scanned, errors} from one semgrep run, or null when it produced nothing. */
function scan(dir, pro) {
  const out = join(dir, `res-${pro ? 'pro' : 'oss'}.json`);
  const args = ['scan', '--config', RULES, '--metrics=off', '--json', '--output', out, '.'];
  if (pro) args.splice(4, 0, '--pro-intrafile');
  spawnSync('semgrep', args, { cwd: dir, encoding: 'utf8', timeout: 300000 });
  if (!existsSync(out)) return null;
  let j; try { j = JSON.parse(readFileSync(out, 'utf8')); } catch { return null; }
  return {
    results: j.results || [],
    // semgrep states which engine it ACTUALLY used, which is not always the one asked for.
    engine: j.engine_requested || null,
    scanned: ((j.paths || {}).scanned || []).length,
    errors: (j.errors || []).map((e) => String((e && e.message) || '').split('\n')[0]).filter(Boolean),
  };
}

describe('semgrep taint rules — the engine dependency must be load-bearing', () => {
  test('the rule file exists and declares only taint-mode rules', () => {
    assert.ok(existsSync(RULES), `${RULES} is missing — the sast lane points at it`);
    const src = readFileSync(RULES, 'utf8');
    const ids = [...src.matchAll(/^\s*-\s*id:\s*(\S+)/gm)].map((m) => m[1]);
    const modes = [...src.matchAll(/^\s*mode:\s*(\S+)/gm)].map((m) => m[1]);
    assert.ok(ids.length > 0, 'no rules declared');
    assert.equal(modes.length, ids.length, `${ids.length} rules but ${modes.length} mode declarations — a rule with no mode is a pattern rule and does not belong here`);
    for (const m of modes) assert.equal(m, 'taint', `mode ${m} is not taint`);
  });

  test('every rule carries the marker naming its own dependency', () => {
    const src = readFileSync(RULES, 'utf8');
    const ids = [...src.matchAll(/^\s*-\s*id:\s*(\S+)/gm)].map((m) => m[1]);
    const marks = [...src.matchAll(/commitwork:\s*requires-pro-intrafile/g)];
    assert.equal(marks.length, ids.length, 'every rule must declare requires-pro-intrafile, so a reader can see why the lane needs an account');
  });

  test('EVERY rule fires under --pro-intrafile and NONE fires without it', (t) => {
    // t.skip(), not t.diagnostic(). A diagnostic leaves the test counted as a PASS — the run
    // summary said `pass 3 / skipped 0` while this assertion had never executed, which is an
    // unmeasured result published as a pass in the one place a reader looks. The reason still rides
    // out with it.
    if (!semgrepPresent()) {
      t.skip('SKIPPED (not a silent pass): semgrep is not installed on this machine, so the entry condition was NOT verified here');
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), 'cw-taint-'));
    for (const [name, body] of Object.entries(PROBES)) writeFileSync(join(dir, name), body);

    const pro = scan(dir, true);
    const oss = scan(dir, false);
    assert.ok(pro, 'the --pro-intrafile scan produced no parseable output');
    assert.ok(oss, 'the OSS scan produced no parseable output');

    // ── THE PRO ENGINE MUST ACTUALLY HAVE RUN ────────────────────────────────────────────────────
    // `semgrep --pro-intrafile` does not fail when the Pro engine is unavailable: it falls back,
    // reports `engine_requested: "OSS"`, scans nothing, and exits with the login error in
    // `errors[]`. Every declared rule then "found nothing under --pro-intrafile", and the loop below
    // published that as a finding about the RULES — a claim about rule quality manufactured out of a
    // missing login. Measured 2026-10-04 on a clean export of HEAD run with HOME pointed at an empty
    // directory (the Pro binary and credentials live under $HOME/.semgrep): engine_requested OSS,
    // paths.scanned 0, errors ["This is a proprietary extension of semgrep. You must log in …"],
    // and this test reported `cw-env-to-shell declared but found nothing under --pro-intrafile`.
    //
    // Unmeasured is its own state. It is not a pass — the entry condition stays unverified — and it
    // is emphatically not a finding.
    if (pro.engine !== 'PRO' || pro.scanned === 0) {
      t.skip('SKIPPED (not a silent pass): the --pro-intrafile scan did not engage the Pro engine '
        + `(engine_requested=${pro.engine}, paths.scanned=${pro.scanned})`
        + `${pro.errors.length ? ` — semgrep said: ${pro.errors[0]}` : ''}`
        + '. The entry condition was NOT verified here. Remedy: `semgrep login` as the user that runs this suite.');
      return;
    }

    const src = readFileSync(RULES, 'utf8');
    const declared = [...src.matchAll(/^\s*-\s*id:\s*(\S+)/gm)].map((m) => m[1]);
    const proIds = new Set(pro.results.map((r) => String(r.check_id).split('.').pop()));

    // `declared` is REGEX-DERIVED from the rules file. Change the rule format — or the indentation
    // the pattern anchors on — and it silently becomes empty, at which point "every declared rule
    // fires" passes having checked no rules at all. The failure is invisible precisely because the
    // subject vanished rather than the assertion breaking.
    assert.ok(declared.length > 0,
      `no rule ids parsed out of ${RULES} — the extractor is blind, and the loop below would pass over nothing`);

    for (const id of declared) {
      assert.ok(proIds.has(id), `${id} declared but found nothing under --pro-intrafile — a rule that never fires is indistinguishable from one that found nothing`);
    }
    assert.equal(oss.results.length, 0,
      `the OSS engine found ${oss.results.length} of these, so at least one rule does not need the Pro engine and is making an account dependency look load-bearing when it is not`);
  });
});
