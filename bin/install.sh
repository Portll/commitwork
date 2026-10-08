#!/bin/sh
# commitwork installer: copies one commitwork tree into a prefix, refuses a Node.js below the floor
# that tree's package.json declares, writes a `commitwork` launcher, then runs `commitwork setup`
# for the scanners asked for. POSIX sh. It downloads nothing itself: a release tarball is read from
# disk and must match the SHA-256 passed with it, and scanner downloads are setup's, pinned where
# manifests/install-catalog.json pins them.
#
# usage: sh bin/install.sh [--from <checkout|dir|commitwork-X.Y.Z.tgz>] [--sha256 <hex>]
#                          [--prefix <dir>] [--dest <dir>] [--scanners <a,b,...>|all|none] [--release-only]
#                          [--no-link] [--keep-previous-only]
#   --from      a git checkout installs its HEAD, never uncommitted edits; a directory without .git
#               is copied as it stands; a .tgz is the npm-pack release tarball. Default: the checkout
#               holding this script
#   --sha256    required with a tarball; a mismatch is refused before anything is extracted
#   --prefix    default $HOME/.local; the launcher is <prefix>/bin/commitwork
#   --dest      where the tree goes, default <prefix>/lib/commitwork. An existing dest is replaced
#               only if it is empty or carries .commitwork-install, the marker this script writes
#               beside .commitwork-files, the list of every path it wrote. On a replace, each path
#               in the old tree that list does not name is the operator's (monitor/private, reports,
#               .claude, anything written there since) and is copied into the new tree first, modes
#               and symlinks kept; one the new tree also ships is refused, by name. The old tree is
#               then kept whole at <dest>.previous, one generation: the next upgrade replaces it.
#               An install made before the list existed carries monitor/private, reports, .claude
#               and evaluations, and refuses if the old tree holds anything else the new one lacks
#   --keep-previous-only  carry nothing: install the new tree and leave the old one untouched at
#               <dest>.previous to copy from by hand. The next upgrade refuses to replace it until
#               it is moved or deleted
#   --scanners  tools from manifests/install-catalog.json for `setup --yes --only`; `all` is the
#               whole catalogue (a tool with no installer on this platform is listed, not failed);
#               default none
#   --release-only  refuse, before installing anything, a named scanner that setup would not take
#               from a release asset pinned by SHA-256 in the catalogue (exit 2); refuses all
#   --no-link   write no launcher
# exit: 0 installed · 2 usage · 20 node absent, below the floor, or unable to run the check ·
#       21 source unreadable or not commitwork, checksum mismatch, dest, launcher or
#       <dest>.previous refused, operator data the new tree would collide with, or a step that
#       failed and was undone (<dest> is then the tree it was before the run) ·
#       22 a named scanner failed to install or is still missing afterwards
# Re-running with the same source leaves the same tree, marker and launcher.

set -eu
umask 022

die() { code=$1; shift; printf 'install.sh: %s\n' "$*" >&2; exit "$code"; }
note() { printf 'install.sh: %s\n' "$*" >&2; }

abs() { case $1 in /*) printf '%s' "$1" ;; *) printf '%s/%s' "$(pwd -P)" "$1" ;; esac; }

here=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)
from=$here sha='' prefix='' dest='' scanners=none link=1 release_only=0 keep_only=0

need() { [ "$2" -ge 2 ] || die 2 "$1 needs a value"; }
while [ $# -gt 0 ]; do
  case $1 in
    --from) need "$1" $#; from=$2; shift 2 ;;
    --from=*) from=${1#*=}; shift ;;
    --sha256) need "$1" $#; sha=$2; shift 2 ;;
    --sha256=*) sha=${1#*=}; shift ;;
    --prefix) need "$1" $#; prefix=$2; shift 2 ;;
    --prefix=*) prefix=${1#*=}; shift ;;
    --dest) need "$1" $#; dest=$2; shift 2 ;;
    --dest=*) dest=${1#*=}; shift ;;
    --scanners) need "$1" $#; scanners=$2; shift 2 ;;
    --scanners=*) scanners=${1#*=}; shift ;;
    --release-only) release_only=1; shift ;;
    --no-link) link=0; shift ;;
    --keep-previous-only) keep_only=1; shift ;;
    -h|--help) sed -n '2,/^# Re-running/s/^# \{0,1\}//p' "$0"; exit 0 ;;
    *) die 2 "unknown argument: $1 (see --help)" ;;
  esac
done

if [ -z "$prefix" ]; then
  [ -n "${HOME:-}" ] || die 2 'HOME is unset; pass --prefix'
  prefix=$HOME/.local
fi
prefix=$(abs "$prefix")
[ -n "$dest" ] || dest=$prefix/lib/commitwork
dest=$(abs "$dest")
case $scanners in ''|*[!A-Za-z0-9._,-]*) die 2 "--scanners takes tool names separated by commas, all or none" ;; esac
case $sha in ''|*[!0-9a-f]*) [ -z "$sha" ] || die 2 '--sha256 takes 64 lowercase hex digits' ;; esac
[ -z "$sha" ] || [ ${#sha} -eq 64 ] || die 2 '--sha256 takes 64 lowercase hex digits'
nl='
'
case $dest$prefix in *"$nl"*) die 2 'a path containing a newline cannot be written into the launcher' ;; esac

command -v node >/dev/null 2>&1 || die 20 'node is not on PATH; install the Node.js release package.json engines.node names, then re-run'

[ -e "$from" ] || die 21 "source $from does not exist"
from=$(abs "$from")
if [ -d "$from" ]; then from=$(CDPATH='' cd -- "$from" && pwd -P); fi

name=$(basename -- "$dest")
case $name in /|.|..) die 21 "refusing $dest as the install directory" ;; esac
parent=$(dirname -- "$dest")
mkdir -p -- "$parent" || die 21 "cannot create $parent"
parent=$(CDPATH='' cd -- "$parent" && pwd -P)
dest=${parent%/}/$name
prev=$dest.previous
if [ -n "${HOME:-}" ] && [ -d "$HOME" ]; then
  [ "$dest" != "$(CDPATH='' cd -- "$HOME" && pwd -P)" ] || die 21 'refusing the home directory as the install directory'
fi
if [ -d "$from" ]; then
  case $dest/ in "$from"/*) die 21 "$dest is inside the source $from" ;; esac
  case $from/ in "$dest"/*) die 21 "the source $from is inside $dest" ;; esac
  case $prev/ in "$from"/*) die 21 "$prev is inside the source $from" ;; esac
fi
# An upgrade replaces <dest>.previous, so a source in it would be deleted under the install.
case $from/ in "$prev"/*) die 21 "the source $from is inside $prev, which an upgrade replaces; move it elsewhere first" ;; esac

launcher=$prefix/bin/commitwork
launcher_mark='# commitwork launcher written by bin/install.sh'
if [ "$link" = 1 ] && { [ -e "$launcher" ] || [ -L "$launcher" ]; }; then
  grep -qxF "$launcher_mark" "$launcher" 2>/dev/null \
    || die 21 "$launcher exists and is not this installer's launcher; remove it or pass --no-link"
fi
if { [ -e "$dest" ] || [ -L "$dest" ]; } && [ ! -f "$dest/.commitwork-install" ]; then
  # An empty directory is the only unmarked dest taken; anything else may be somebody's data.
  rmdir -- "$dest" 2>/dev/null || die 21 "$dest exists and was not written by this installer; refusing to replace it"
fi

# A replace keeps the old tree at <dest>.previous, so the one there now is deleted only if it is
# this installer's and an earlier --keep-previous-only did not leave operator data in it.
held_line='previous tree kept uncarried (--keep-previous-only)'
upgrade=0
if [ -e "$dest" ] || [ -L "$dest" ]; then upgrade=1; fi
if [ "$upgrade" = 1 ] && { [ -e "$prev" ] || [ -L "$prev" ]; }; then
  [ -f "$prev/.commitwork-install" ] \
    || die 21 "$prev exists and was not written by this installer; move it aside, then re-run"
  rc=0
  grep -qxF "$held_line" "$dest/.commitwork-install" || rc=$?
  case $rc in
    0) die 21 "$prev is the tree an install with --keep-previous-only replaced, and nothing was carried out of it; copy what you need from it, move or delete it, then re-run" ;;
    1) ;;
    *) die 21 "cannot read $dest/.commitwork-install" ;;
  esac
fi

stage=$(mktemp -d "$parent/.commitwork-install.XXXXXX") || die 21 "cannot create a staging directory in $parent"
tree=$stage/tree
launcher_tmp=''
# phase names the last move begun: stage (none) · discarded ($prev into the stage) · parked ($dest
# to $prev) · placed (the new tree to $dest) · complete. Each undo step runs only if its move happened,
# so an interrupt between a move and the next line is undone as well.
phase=stage

undo() {
  if [ "$phase" = placed ]; then
    if [ ! -e "$tree" ] && [ -e "$dest" ]; then mv -- "$dest" "$tree" || return 1; fi
    phase=parked
  fi
  if [ "$phase" = parked ]; then
    if [ "$upgrade" = 1 ] && [ ! -e "$dest" ] && [ ! -L "$dest" ] && [ -e "$prev" ]; then mv -- "$prev" "$dest" || return 1; fi
    phase=discarded
  fi
  if [ "$phase" = discarded ]; then
    if [ ! -e "$prev" ] && [ ! -L "$prev" ] && { [ -e "$stage/discard" ] || [ -L "$stage/discard" ]; }; then
      mv -- "$stage/discard" "$prev" || return 1
    fi
    phase=stage
  fi
  return 0
}

finish() {
  status=$?
  [ -z "$launcher_tmp" ] || rm -f -- "$launcher_tmp"
  if [ "$phase" != complete ] && [ "$phase" != stage ]; then
    if undo; then
      note "undone: $dest is the tree it was before this run"
    else
      # Nothing is deleted when an undo step fails: the staging directory stays, and says where.
      note "the undo did not finish; nothing was deleted. Put back by hand: the new tree at $dest or $tree, the tree from before this run at $prev or $dest, the generation before it at $stage/discard"
      [ "$status" != 0 ] || status=21
      exit "$status"
    fi
  fi
  # A carried directory keeps its mode, so one without write permission needs it back to be emptied.
  rm -rf -- "$stage" 2>/dev/null || { chmod -R u+w -- "$stage" && rm -rf -- "$stage"; } || note "could not remove $stage"
  exit "$status"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ -f "$from" ]; then
  [ -n "$sha" ] || die 2 'a tarball needs --sha256 (the release lists it, and gh attestation verify checks the file)'
  got=$(node -e 'const h = require("crypto").createHash("sha256"); h.update(require("fs").readFileSync(process.argv[1])); console.log(h.digest("hex"))' "$from") \
    || die 21 "cannot read $from"
  [ "$got" = "$sha" ] || die 21 "$from has sha256 $got, not the $sha given; refusing it"
  mkdir "$stage/x"
  tar -xzf "$from" -C "$stage/x" || die 21 "$from is not a gzip tar"
  [ -d "$stage/x/package" ] || die 21 "$from has no package/ directory; it is not an npm-pack tarball"
  mv "$stage/x/package" "$tree"
  origin="tarball sha256:$sha"
elif [ -d "$from/.git" ] || [ -f "$from/.git" ]; then
  # safe.directory names only the source the operator gave; a build mounts it owned by another uid.
  g() { GIT_OPTIONAL_LOCKS=0 git -c safe.directory="$from" -c core.fsmonitor=false -C "$from" "$@"; }
  commit=$(g rev-parse --verify 'HEAD^{commit}') || die 21 "$from has no readable HEAD"
  g archive --format=tar -o "$stage/src.tar" "$commit" || die 21 "git archive of $from failed"
  mkdir "$tree"
  tar -xf "$stage/src.tar" -C "$tree" || die 21 "cannot unpack the archive of $from"
  if [ -n "$(g status --porcelain --untracked-files=no 2>/dev/null)" ]; then
    note "$from has uncommitted changes; they are not installed, HEAD $commit is"
  fi
  origin="git $commit"
elif [ -d "$from" ]; then
  mkdir "$tree"
  cp -RP "$from/." "$tree/" || die 21 "cannot copy $from"
  origin=directory
else
  die 21 "$from is neither a directory nor a file"
fi
# A source that is itself an install brings its marker and list; this run writes its own.
rm -f -- "$tree/.commitwork-install" "$tree/.commitwork-files" || die 21 "cannot clear the source's own install marker"

for f in package.json lib/node-floor.mjs bin/commitwork.mjs bin/setup.mjs manifests/install-catalog.json; do
  [ -f "$tree/$f" ] || die 21 "$from has no $f; it is not a commitwork tree"
done

# exits: 20 below the floor, 22 a scanner name the catalogue lacks, 23 not commitwork,
# 24 --release-only and a scanner setup would not take from a pinned release
# shellcheck disable=SC2016 # single quotes on purpose: this is JavaScript, not shell
preflight='
const { pathToFileURL } = await import("node:url");
const { readFileSync } = await import("node:fs");
const [tree, list, releaseOnly] = process.argv.slice(1);
const pkg = JSON.parse(readFileSync(`${tree}/package.json`, "utf8"));
if (pkg.name !== "commitwork") { console.error(`package.json names ${JSON.stringify(pkg.name)}, not commitwork`); process.exit(23); }
const { nodeFloorCheck } = await import(pathToFileURL(`${tree}/lib/node-floor.mjs`).href);
const floor = nodeFloorCheck(process.versions.node, `${tree}/package.json`);
if (!floor.ok) { console.error(floor.message); process.exit(20); }
if (list !== "none" && list !== "all") {
  const known = Object.keys(JSON.parse(readFileSync(`${tree}/manifests/install-catalog.json`, "utf8")).tools || {});
  const unknown = list.split(",").filter((n) => n && !known.includes(n));
  if (unknown.length) { console.error(`not in manifests/install-catalog.json: ${unknown.join(", ")}`); process.exit(22); }
}
if (releaseOnly === "1" && list !== "none") {
  if (list === "all") { console.error("--release-only installs named scanners, not all"); process.exit(24); }
  // The plan setup itself makes, so the check is the manager it will use here, not the catalogue alone.
  const setup = await import(pathToFileURL(`${tree}/bin/setup.mjs`).href);
  const off = setup.toolPlan(list.split(",").filter(Boolean)).filter((t) => !t.present && t.via !== "release");
  if (off.length) { console.error(`not from a pinned release here: ${off.map((t) => `${t.name} (${t.via ? `setup would use ${t.via}` : "no installer"})`).join(", ")}`); process.exit(24); }
}
console.log(pkg.version);
'
rc=0
version=$(node --input-type=module -e "$preflight" "$tree" "$scanners" "$release_only") || rc=$?
case $rc in
  0) ;;
  20) die 20 'refusing to install: node is below the floor above' ;;
  22) die 2 '--scanners names a tool the catalogue does not have' ;;
  23) die 21 "$from is not commitwork" ;;
  24) die 2 'refusing --release-only: a scanner above would not come from a release pinned by SHA-256' ;;
  *) die 20 "node $(node --version 2>/dev/null) could not run the floor check (exit $rc)" ;;
esac

{
  printf 'commitwork %s\nsource %s\n' "$version" "$origin"
  if [ "$upgrade" = 1 ] && [ "$keep_only" = 1 ]; then printf '%s\n' "$held_line"; fi
} > "$tree/.commitwork-install" || die 21 "cannot write the install marker"

# `list <tree>` writes <tree>/.commitwork-files: every path in the staged tree, so what an upgrade
# finds in an installed tree and not in its list is what somebody else wrote there.
# `carry <old> <new>` copies those paths from the installed tree into the staged one and reads every
# copy back. exits: 20 a path the new tree also ships (or a type it cannot copy), 21 an install
# without a list holding paths it cannot place, 22 a list or a copy that could not be read or made.
# No pipe character anywhere in this program: bin/test/lexical-ratchets.test.mjs (C28) reads it.
# shellcheck disable=SC2016 # single quotes on purpose: this is JavaScript, not shell
carry='
const fs = await import("node:fs");
const { createHash } = await import("node:crypto");
const { join } = await import("node:path");
const [mode, a, b] = process.argv.slice(1);
const say = (m) => console.error(`install.sh: ${m}`);
const LIST = ".commitwork-files";
const HEADER = "# commitwork-files v1: every path bin/install.sh wrote into this tree, one JSON string per line; an upgrade carries across whatever is not listed";
const KNOWN = ["monitor/private", "reports", ".claude", "evaluations"];
const kind = (st) => st.isSymbolicLink() ? "symlink" : st.isDirectory() ? "directory" : st.isFile() ? "file" : "special file";
const lst = (p) => { try { return fs.lstatSync(p); } catch (e) { if (e.code === "ENOENT") return null; throw e; } };
const names = (d) => fs.readdirSync(d).sort();
const sub = (r, n) => (r ? `${r}/${n}` : n);
const perm = (st) => st.mode & 0o7777;
const oct = (st) => perm(st).toString(8).padStart(4, "0");
const show = (xs) => xs.slice(0, 20).concat(xs.length > 20 ? [`and ${xs.length - 20} more`] : []);
const ancestors = (r) => { const out = []; for (let i = r.indexOf("/"); i > 0; i = r.indexOf("/", i + 1)) out.push(r.slice(0, i)); return out; };

if (mode === "list") {
  try {
    const out = [LIST];
    const walk = (r) => { for (const n of names(join(a, r))) { const p = sub(r, n); out.push(p); if (kind(fs.lstatSync(join(a, p))) === "directory") walk(p); } };
    walk("");
    out.sort();
    fs.writeFileSync(join(a, LIST), [HEADER, ...out.map((p) => JSON.stringify(p))].join("\n") + "\n", { flag: "wx", mode: 0o644 });
  } catch (e) { say(`cannot list the staged tree (${e.code ?? e.message})`); process.exit(22); }
  process.exit(0);
}

let listed = null;
try {
  const lines = fs.readFileSync(join(a, LIST), "utf8").split("\n");
  if (!lines[0].startsWith("# commitwork-files v1")) throw new Error("its first line is not a v1 header");
  listed = new Set(lines.slice(1).filter((l) => l !== "").map((l) => { const v = JSON.parse(l); if (typeof v !== "string") throw new Error("a line is not a path"); return v; }));
} catch (e) {
  if (e.code !== "ENOENT") { say(`cannot read ${join(a, LIST)} (${e.code ?? e.message}); refusing to guess which files in it are the operator data`); process.exit(22); }
}

const roots = [], clashes = [], unknown = [];
try {
  const offer = (r) => {
    const o = fs.lstatSync(join(a, r));
    if (kind(o) === "special file") { clashes.push(`${r}: a special file, which the installer cannot copy`); return; }
    for (const up of ancestors(r)) {
      const u = lst(join(b, up));
      if (u && kind(u) !== "directory") { clashes.push(`${r}: the new tree ships a ${kind(u)} at ${up}`); return; }
    }
    const n = lst(join(b, r));
    if (!n) { roots.push(r); return; }
    if (kind(o) === "directory" && kind(n) === "directory") {
      if (perm(o) !== perm(n)) { clashes.push(`${r}: a directory in both trees, mode ${oct(o)} in the old and ${oct(n)} in the new`); return; }
      for (const c of names(join(a, r))) offer(sub(r, c));
      return;
    }
    clashes.push(`${r}: the new tree ships a ${kind(n)} there`);
  };
  if (listed) {
    const walk = (r) => {
      for (const c of names(join(a, r))) {
        const p = sub(r, c);
        if (!listed.has(p)) offer(p);
        else if (kind(fs.lstatSync(join(a, p))) === "directory") walk(p);
      }
    };
    walk("");
  } else {
    for (const k of KNOWN) if (lst(join(a, k))) offer(k);
    // A path the new tree also has is taken to be the old installer files; a directory is read
    // into when the new tree has one there too, or when it holds a known path.
    const walk = (r) => {
      for (const c of names(join(a, r))) {
        const p = sub(r, c);
        if (p === ".commitwork-install" || KNOWN.includes(p)) continue;
        const o = fs.lstatSync(join(a, p)), n = lst(join(b, p));
        if (kind(o) === "directory") {
          if ((n && kind(n) === "directory") || KNOWN.some((k) => k.startsWith(`${p}/`))) walk(p);
          else unknown.push(p);
        } else if (!n) unknown.push(p);
      }
    };
    walk("");
  }
} catch (e) { say(`cannot read ${a} (${e.code ?? e.message}); refusing to replace what could not be read`); process.exit(22); }

if (clashes.length) {
  say(`these paths in ${a} are not the installer files, and the new tree has its own at each:`);
  for (const x of show(clashes)) say(`  ${x}`);
  process.exit(20);
}
if (unknown.length) {
  say(`${a} was installed before ${LIST} existed. Beside monitor/private, reports, .claude and evaluations, which are carried, it holds these, which the new tree does not ship, so they may be the operator data:`);
  for (const x of show(unknown)) say(`  ${x}`);
  process.exit(21);
}

const copy = (from, to) => {
  const st = fs.lstatSync(from);
  if (st.isSymbolicLink()) { fs.symlinkSync(fs.readlinkSync(from), to); return; }
  if (st.isFile()) {
    fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL + fs.constants.COPYFILE_FICLONE);
    fs.chmodSync(to, perm(st));
    fs.utimesSync(to, st.atime, st.mtime);
    return;
  }
  if (!st.isDirectory()) throw Object.assign(new Error(`${from} is a special file`), { code: "ESPECIAL" });
  fs.mkdirSync(to, { mode: 0o700 });
  for (const c of names(from)) copy(join(from, c), join(to, c));
  fs.chmodSync(to, perm(st));
  fs.utimesSync(to, st.atime, st.mtime);
};
const digest = (p) => {
  const h = createHash("sha256"), buf = Buffer.alloc(1 << 20), fd = fs.openSync(p, "r");
  try { for (let n = fs.readSync(fd, buf); n > 0; n = fs.readSync(fd, buf)) h.update(buf.subarray(0, n)); } finally { fs.closeSync(fd); }
  return h.digest("hex");
};
const check = (r) => {
  const o = fs.lstatSync(join(a, r)), n = fs.lstatSync(join(b, r));
  const bad = (why) => { throw Object.assign(new Error(`${r}: ${why}`), { code: "EVERIFY" }); };
  if (kind(o) !== kind(n)) bad(`copied as a ${kind(n)}, was a ${kind(o)}`);
  if (kind(o) === "symlink") { if (fs.readlinkSync(join(a, r)) !== fs.readlinkSync(join(b, r))) bad("the symlink target differs"); return; }
  if (perm(o) !== perm(n)) bad(`mode ${oct(n)}, was ${oct(o)}`);
  if (kind(o) === "file") { if (digest(join(a, r)) !== digest(join(b, r))) bad("the content differs"); return; }
  const x = names(join(a, r)), y = names(join(b, r));
  if (x.join("\0") !== y.join("\0")) bad("the directory listing differs");
  for (const c of x) check(sub(r, c));
};
try {
  const made = [];
  for (const r of roots) {
    for (const up of ancestors(r)) if (!lst(join(b, up))) { fs.mkdirSync(join(b, up), { mode: 0o700 }); made.push(up); }
    copy(join(a, r), join(b, r));
  }
  for (const up of made.reverse()) fs.chmodSync(join(b, up), perm(fs.statSync(join(a, up))));
  for (const r of roots) check(r);
} catch (e) { say(`copying the operator data into the new tree failed (${e.code ?? "error"}: ${e.message})`); process.exit(22); }
say(roots.length ? `carried ${roots.length} operator path(s) from ${a}: ${show(roots).join(", ")}` : `nothing to carry from ${a}: it holds only what the installer wrote`);
'
node --input-type=module -e "$carry" list "$tree" || die 21 "cannot write the file list into the staged tree"

if [ "$upgrade" = 1 ] && [ "$keep_only" = 0 ]; then
  rc=0
  node --input-type=module -e "$carry" carry "$dest" "$tree" || rc=$?
  case $rc in
    0) ;;
    20) die 21 "refusing to replace $dest: carrying the paths above would overwrite what the new tree ships, or be overwritten by it. Nothing was changed. Move them out of $dest, or pass --keep-previous-only" ;;
    21) die 21 "refusing to replace $dest: nothing was changed. Move those paths out of it, or pass --keep-previous-only to install beside it and copy by hand" ;;
    *) die 21 "the operator data in $dest could not be carried across (exit $rc); nothing was changed" ;;
  esac
fi

if [ "$link" = 1 ]; then
  mkdir -p -- "$prefix/bin" || die 21 "cannot create $prefix/bin"
  # Escaped by parameter expansion rather than `printf | sed`: a pipeline here would carry sed's
  # status and not printf's, and neither remedy for that (`set -o pipefail`, `PIPESTATUS`) exists
  # in the POSIX shell this script declares — dash answers `set: Illegal option -o pipefail`.
  quoted= ; rest=$dest/bin/commitwork.mjs
  while case $rest in *\'*) : ;; *) false ;; esac; do
    quoted=$quoted${rest%%\'*}"'\\''"
    rest=${rest#*\'}
  done
  quoted=$quoted$rest
  # Written before the tree moves, so the one step left after it is a rename.
  launcher_tmp=$prefix/bin/.commitwork.$$
  printf '#!/bin/sh\n%s\nexec node '\''%s'\'' "$@"\n' "$launcher_mark" "$quoted" > "$launcher_tmp" \
    || die 21 "cannot write $launcher_tmp"
  chmod 755 "$launcher_tmp" || die 21 "cannot make $launcher_tmp executable"
fi

if [ "$upgrade" = 1 ]; then
  if [ -e "$prev" ] || [ -L "$prev" ]; then
    phase=discarded
    mv -- "$prev" "$stage/discard" || die 21 "cannot move $prev aside"
  fi
  phase=parked
  mv -- "$dest" "$prev" || die 21 "cannot move $dest to $prev"
fi
phase=placed
mv -- "$tree" "$dest" || die 21 "cannot move the new tree into $dest"
if [ "$link" = 1 ]; then
  mv -f -- "$launcher_tmp" "$launcher" || die 21 "cannot write the launcher $launcher"
  launcher_tmp=''
fi
phase=complete

note "installed commitwork $version ($origin) in $dest"
[ "$link" = 0 ] || note "launcher: $launcher"
if [ "$upgrade" = 1 ]; then
  if [ "$keep_only" = 1 ]; then
    note "the tree it replaced is at $prev, and nothing was carried from it: copy what you need, then move or delete it before the next upgrade"
  else
    note "the tree it replaced is kept at $prev until the next upgrade"
  fi
fi

[ "$scanners" != none ] || exit 0
# shellcheck disable=SC2016 # JavaScript
setup='
const { pathToFileURL } = await import("node:url");
const [list, mod] = process.argv.slice(1);
const setup = await import(pathToFileURL(mod).href);
const only = list === "all" ? [] : list.split(",").filter(Boolean);
const r = await setup.runSetup({ yes: true, only });
const missing = setup.toolPlan(only).filter((t) => !t.present).map((t) => t.name);
if (r.failed.length) console.error(`install.sh: failed to install: ${r.failed.join(", ")}`);
if (only.length && missing.length) console.error(`install.sh: still missing: ${missing.join(", ")}`);
else if (missing.length) console.error(`install.sh: ${missing.length} catalogue tool(s) are not installed here; commitwork doctor says why: ${missing.join(", ")}`);
if (r.failed.length || (only.length && missing.length)) process.exitCode = 22;
'
rc=0
# The module path is not argv[1]: setup.mjs runs itself when argv[1] names it.
node --input-type=module -e "$setup" "$scanners" "$dest/bin/setup.mjs" || rc=$?
[ "$rc" = 0 ] || die 22 "setup did not install every scanner asked for (exit $rc); the tree and launcher are installed"
