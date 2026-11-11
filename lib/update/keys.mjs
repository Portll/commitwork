// lib/update/keys.mjs — the Ed25519 public keys commitwork trusts for portll-update@1 manifests,
// by keyId (raw 32 bytes, base64). A rotation ships the new key here before anything is signed
// with it. The test key (test-2026-11) is never listed: tests pass their keys in.
//
// EMPTY UNTIL THE RELEASE KEY EXISTS. Contract section 9 step 3: the operator generates the release
// key into the Keychain and commits only its public half, keyId portll-2026-11. Until then every
// manifest is refused as an unknown keyId, so `commitwork update` installs nothing.
export const TRUSTED_KEYS = Object.freeze({
  // 'portll-2026-11': '<raw 32-byte public key, base64>',
});
