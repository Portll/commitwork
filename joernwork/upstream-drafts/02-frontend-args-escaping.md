**Title:** `--frontend-args` values are interpolated into generated Scala without escaping

`BridgeBase.argsStringFromConfig` builds the generated script with bare quotes:

```scala
val quotedArgs = args.map { arg => "\"" ++ arg ++ "\"" }
```

`loadOrCreateCpg`, twenty lines above, already escapes `src` with
`StringEscapeUtils.escapeJava`. Frontend args go through the same generated-source path and do not.

Any arg containing a backslash produces an invalid Scala string literal, so the generated script
fails to **compile** and the scan never runs. A regex is the common case — `--exclude-regex
'.*/\.git/.*'` contains `\.`, which is not a legal Scala escape.

### Reproduce

```sh
joern-scan ./src --frontend-args --exclude-regex '.*/(node_modules|\.git)/.*'
# Error during compilation, in /tmp/joern-scan-log.txt; stdout is a 41-byte husk
joern-scan ./src --frontend-args --exclude-regex '.*/(node_modules|[.]git)/.*'
# works — the only difference is the backslash
```

**Control:** passed straight to `c2cpg`, the same `--exclude-regex` value works and excludes
correctly. So this is a `joern-scan` interpolation bug, not a `c2cpg` limitation.

Note this reports as **exit 0** unless the launcher is also fixed — see the exit-code issue.

### Fix

```diff
         val quotedArgs = args.map { arg =>
-          "\"" ++ arg ++ "\""
+          "\"" ++ StringEscapeUtils.escapeJava(arg) ++ "\""
         }
```

`StringEscapeUtils` is already imported and used in that file.
