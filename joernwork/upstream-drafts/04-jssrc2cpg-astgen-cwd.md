**Title:** `jssrc2cpg` resolves `astgen` against the process CWD, silently producing an empty CPG

`jssrc2cpg` hands `ProcessBuilder` a bare relative `astgen`. Java resolves a relative command
against the process working directory, not `PATH`, so unless the caller happens to be sitting in a
directory containing `./astgen` the frontend fails:

```
ERROR AstGenRunner - running astgen failed!
java.lang.RuntimeException: Cannot run program "/some/cwd/astgen"
  (in directory "/path/to/src"): Exec failed, error: 2 (No such file or directory)
```

The exception is caught and an **empty CPG is written anyway**, so the failure is invisible to
anything downstream.

### Reproduce

Same source tree, same `astgen`, only the working directory differs:

```sh
cd /tmp/empty && jssrc2cpg /path/to/js -o a.bin     # 4,607 bytes, 0 methods
mkdir /tmp/withlink && ln -s "$(command -v astgen)" /tmp/withlink/astgen
cd /tmp/withlink && jssrc2cpg /path/to/js -o b.bin  # 55,398 bytes, 27 methods
```

`astgen` was on `PATH` in **both** runs. Only the CWD-relative lookup decides whether it is found.

### Why it matters more than it looks

An empty CPG is not an error to a consumer — it is a repository with no methods, which a scanner
reports as clean. Combined with the launcher exit-code issue, a JavaScript scan returns exit 0, no
findings, and no diagnostic.

### Fix

`x2cpg`'s `AstGenRunner.resolveAstGenPath` returns `metaData.name` — **a bare name, no separator** —
for the "binary on the system `PATH`" branch, after `hasCompatibleAstGenVersion` has confirmed it is
there. `astGenCommand` then absolutises it, and a relative name absolutises against the process
working directory. "On PATH" silently becomes "in the current directory":

```diff
     logger.info(s"Using ${metaData.name} from '$resolvedPath'")
-    Paths.get(resolvedPath).toAbsolutePath.toString
+    if (Paths.get(resolvedPath).getNameCount == 1 && !Paths.get(resolvedPath).isAbsolute) resolvedPath
+    else Paths.get(resolvedPath).toAbsolutePath.toString
```

The bare name is a deliberate signal from the resolver that PATH lookup should happen; the fix is to
stop destroying it one line later.

**A second issue, left as a separate decision.** The exception is caught and an empty CPG is written
anyway. A frontend that could not run its AST generator arguably should not emit a graph at all —
an empty CPG is not an error to a consumer, it is a repository with no methods, which any scanner
reports as clean. That is a behaviour change with a wider blast radius than the resolution fix, so
it is named rather than bundled.
