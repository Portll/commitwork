**Title:** `joern-scan` exits 0 when the scan fails — the launcher returns the retry-`if`'s status

`joern-cli/src/universal/joern-scan` ends with

```sh
if [ $? -eq 2 ]; then
  $SCRIPT ... "$@" 2> /tmp/joern-scan-log.txt
fi
```

That `if` is the script's **last command**, so the script exits with the *if*'s status. The
retry-on-2 path is real (`runScanPlugin` calls `System.exit(2)` after downloading the query db),
but every other failure code becomes 0.

### Impact

Any tool consuming `joern-scan` cannot distinguish a failed scan from a clean repository. Both give
exit 0 and a 41-byte stdout (`Writing logs to: /tmp/joern-scan-log.txt`). We found this after
building a security-reporting lane on `joern-scan` — it had reported "clean" on every repository it
had ever run against, because the scan had never once succeeded.

### Reproduce

```sh
joern-scan /path/to/src --frontend-args --exclude-regex 'a\.b'   # any failing invocation
echo $?    # 0
```

`/tmp/joern-scan-log.txt` shows the real failure. Three separate defects reach a user this way
(see the linked issues); this one is why none of them is visible.

### Fix

```diff
-  $SCRIPT ... "$@" 2> /tmp/joern-scan-log.txt
-if [ $? -eq 2 ]; then
+  $SCRIPT ... "$@" 2> /tmp/joern-scan-log.txt
+status=$?
+if [ $status -eq 2 ]; then
   $SCRIPT ... "$@" 2> /tmp/joern-scan-log.txt
+  status=$?
 fi
+exit $status
```

Verified in place: a failing scan goes 0 → 1, a healthy scan stays 0 and still prints its findings.
Still present on master, byte-identical to the Homebrew bottle.
