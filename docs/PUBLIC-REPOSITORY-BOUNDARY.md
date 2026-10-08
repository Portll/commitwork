<!-- verified-against: 2026-10-04 -->
# Public repository and private sidecar

The release starts from a reviewed snapshot of the current implementation, with one new root
commit and no inherited Git history (operator decision, 2026-09-07). The previous
history-rewrite approach is superseded. The existing private checkout remains a working source
until the snapshot is ready.

## Permanent ownership

| Public repository | Private sidecar |
| --- | --- |
| Generic implementation and schemas | Customer-specific configuration and fleet registries |
| Synthetic fixtures and example configuration | Real scan output, incident evidence and operational records |
| Reviewed public documentation and aggregate results | Private originals, identifying citations and detailed audit records |
| Generic publication and validation tools | Identity mappings, redaction lists and private review findings |

If material requires redaction, its original belongs in the sidecar. A reviewed public derivative
may be copied into the public repository. The mapping between the two remains private. This rule
covers text embedded in source code, comments, tests, filenames, images, generated pages, commit
messages and agent instructions, not just files conventionally labelled as data.

Sensitive material must be written to its private destination from the outset. An ignore rule
does not remove an already tracked file. Public builds and tests use synthetic fixtures and do
not require the operator's sidecar. Optional local integrations must use explicit private paths
or ignored directory links; packaging must not follow those links.

Credentials stay in protected stores excluded from Git, including the sidecar's Git history.
The sidecar is a private evidence repository, not permission to version live credentials.

## Snapshot acceptance

1. Freeze the chosen source state and record its provenance privately, including any intentional
   uncommitted implementation changes. Do not accidentally omit required untracked modules.
2. Preserve private originals in the sidecar and make the public source generic. Route every
   affected producer and consumer to the appropriate destination.
3. Build and test the candidate without access to the operator's private data. Scan the actual
   candidate contents, paths and generated outputs for secrets and identifying material. Keep
   detailed findings and review decisions in the sidecar.
4. Resolve every release-blocking finding and unreviewed input before labelling the snapshot
   clean. Review non-text assets as well as text. Private or obsolete commit citations must not
   masquerade as publicly verifiable evidence.
5. Initialise a fresh Git repository from the accepted files and create one root commit. Do not
   copy the old `.git`, branches, tags, reflogs, notes, remote refs or working-tree checkpoints.
6. Verify the resulting repository and its generated distribution again before publishing.

`node bin/release-candidate.mjs [--ref <rev>] [--out <dir>]` mechanises steps 3 to 6. It runs
`git archive` on the ref (`export-ignore` attributes apply). It makes each `verified-against` stamp
date-only, because the new root cannot cite private history. It then commits one unsigned root whose
author and date come from the source commit, so a rebuild of the same ref gives the same commit.
The candidate then goes through these gates:

- a blob witness: every file is byte-identical to the source except the stamps;
- `pre-publish`, with the reviewed dispositions held in the sidecar;
- the private-name scan;
- `docs-doctor`;
- `npm test`, run with an allowlisted environment, a scratch `HOME` and no sidecar.

The verdict is `accepted`, `blocked` or `incomplete`. It is journalled to the sidecar together with
the source and candidate hashes.

After release, the same boundary applies to every change. Private identity checks run with
sidecar-owned inputs; ordinary public tests use synthetic inputs. Neither an exemption baseline
nor a missing private map establishes that a release is clean.

## Current status

The boundary is decided; the current source tree is not yet an accepted public snapshot. The
checkout still contains tracked operational records and identity mappings, and some publication
tools assume those private inputs live in the source repository. These must be separated before
the first public commit. Clearing history alone does not clean the current file contents, and a
fresh local history does not remove old copies already held by remotes or other checkouts.
