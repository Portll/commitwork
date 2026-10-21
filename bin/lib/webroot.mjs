// A deployed web root (or a backup of one) scanned in place, git or not.
//
// A repository scan answers "is this code safe"; a web root answers "is this still the code that was
// deployed", and the two have different blind spots. A backup carries no history, keeps file
// permissions and timestamps only in the original tree (git stores neither), and is usually a
// slice: an UpdraftPlus backup holds wp-content and nothing above it, so WordPress core, wp-config.php
// and any file dropped beside them were never in the scan. describeWebroot names those gaps so the
// brief can list them under "Not measured" instead of letting an absent tree read as a clean one.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

export function wordpressCoreVersion(root) {
  const p = join(root, 'wp-includes', 'version.php');
  let src;
  try { src = readFileSync(p, 'utf8'); } catch (e) { return e.code === 'ENOENT' ? null : { unreadable: e.code || e.message }; }
  const m = /\$wp_version\s*=\s*['"]([^'"]+)['"]/.exec(src);
  return m ? { version: m[1] } : { unreadable: 'no $wp_version assignment in wp-includes/version.php' };
}

export function wordpressLayout(root) {
  const siteRoot = isDir(join(root, 'wp-includes')) || isFile(join(root, 'wp-config.php')) || isFile(join(root, 'wp-load.php'));
  if (siteRoot) return 'site-root';
  const contentOnly = basename(root) === 'wp-content'
    || (isDir(join(root, 'plugins')) && isDir(join(root, 'themes')) && (isFile(join(root, 'index.php')) || isDir(join(root, 'uploads'))));
  if (contentOnly) return 'wp-content';
  if (isDir(join(root, 'wp-content'))) return 'site-root';
  return null;
}

export function describeWebroot(root) {
  const git = existsSync(join(root, '.git'));
  const notMeasured = [];
  const out = { git, platform: null };
  if (!git) {
    notMeasured.push({ check: 'target', kind: 'scope', reason: 'not a git repository: the history lanes (secrets in history, commit provenance, commit velocity) do not apply, and there is no deployed commit to compare the tree against' });
  }
  const layout = wordpressLayout(root);
  if (layout) {
    out.platform = 'wordpress';
    const wp = { layout, core: 'absent', version: null };
    if (layout === 'site-root') {
      const v = wordpressCoreVersion(root);
      if (v && v.version) { wp.core = 'present'; wp.version = v.version; }
      else if (v && v.unreadable) { wp.core = 'unreadable'; notMeasured.push({ check: 'target', kind: 'void', reason: `WordPress core version could not be read: ${v.unreadable}` }); }
      else notMeasured.push({ check: 'target', kind: 'scope', reason: 'WordPress site root without wp-includes/version.php: the core version and core file integrity are not measured' });
    } else {
      notMeasured.push({ check: 'target', kind: 'scope', reason: 'WordPress wp-content only: core is not in the scanned tree, so the core version and core file integrity are not measured, and nothing beside wp-content in the web root (wp-config.php, the root .htaccess, a file dropped there) was examined' });
    }
    out.wordpress = wp;
  }
  out.notMeasured = notMeasured;
  return out;
}
