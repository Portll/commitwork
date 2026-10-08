// PLANTED — secrets lane. Every value here is shaped like a credential and functional as nothing.
//
// THE FIRST TWO CHOICES DID NOT FIRE, AND THAT IS THE POINT OF HAVING RUN IT.
// Measured 2026-09-02, gitleaks 8.30.1:
//   AKIAIOSFODNN7EXAMPLE / wJalrX...EXAMPLEKEY  -> 0 findings. AWS's own published pair. Scanners
//     allowlist the canonical documentation key precisely because it appears in every tutorial.
//   AKIACANARYFAKE123456                        -> 0 findings. Matches the AWS id shape, still
//     nothing: this build flags no AWS-token rule at all, verified against a positive control
//     where a github PAT and a generic high-entropy key both fired from the same invocation.
// A credential safe enough to commit is frequently safe enough to be ignored, and a plant that
// cannot fire is not a plant — it is a lane reported as tested that was never exercised.
//
// So these are shapes this scanner DEMONSTRABLY catches, confirmed by running it:

// github-pat rule. Not an issued token — a real one is minted by GitHub and revoked on publish;
// this is 36 characters of keyboard noise behind the ghp_ prefix and authenticates to nothing.
export const GITHUB_TOKEN = 'ghp_C4n4ryF4keT0k3nZzQqWwEeRrTtYyUu9182';

// generic-api-key rule — fires on the assignment shape plus entropy, not on any provider.
export const API_KEY = '3f8a1c9e7b2d4056af13c8e5b90d7246';

// PLANTED — the DSN class .gitleaks.toml was written for: the userinfo IS the credential and there
// is no password component, so a `user:pass@host` rule sails straight past it. The key is 32 hex characters of
// keyboard noise and the host is under .invalid, which RFC 2606 reserves so it can never resolve.
// IT WAS 32 ZEROES FIRST AND DID NOT FIRE: that rule requires 16+ characters of HIGH ENTROPY, and
// an all-zero key has none. Too obviously fake to be detected is still undetected. This one needs the
// repository's own config to fire; it is the rule commitwork added after both scanners missed a
// live GlitchTip DSN on 2026-08-20.
export const DSN = 'https://a3f9c1e8b2d47056af13c8e5b90d7246@app.example.invalid/1';
