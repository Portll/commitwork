<!-- verified-against: 2026-10-18 ac4181a9 -->
# Deed of Copyright Assignment — draft for solicitor review

> **Draft. Not in force, and not legal advice.** This deed moves the copyright in the four
> components from the individual who wrote them to the company, so that the company becomes the
> party that holds the AGPL and Apache-2.0 grants already made and sells the PolyForm licence.
> Every `[bracketed]` item is a fact the project does not yet hold. It must be executed
> as a **deed** under South Australian law (signed, witnessed, and expressed to be a deed) and
> reviewed by a solicitor first.

**Version 0.2 — 18 October 2026**

## Parties

- **Assignor:** `[full legal name]` of `[address]`, South Australia (**the Author**).
- **Assignee:** `[Company name] Pty Ltd` (ACN `[ACN]`) of `[registered office]`, South Australia
  (**the Company**).

## Background

A. The Author created the software and documentation in the repositories listed in the Schedule,
   and owns the copyright in them except for the third-party and upstream portions identified in
   the Schedule.
B. The Author, trading as Portll, is today the licensor of that software. commitwork has been
   offered since its first public commit (7 October 2026) under the GNU Affero General Public
   License v3.0 or later, with PolyForm Internal Use 1.0.0 available by written agreement and the
   Apache License 2.0 over the wire layer its `manifests/wire-layer.json` lists, and the Author
   is the grantee of its Contributor Licence Agreement. The Company intends to continue offering
   the software on those terms, and to hold and enforce the copyright for that purpose.
C. The Author is a director and shareholder of the Company and wishes to assign the copyright to
   it for the consideration below.

## Operative provisions

**1. Assignment.** In consideration of `[$1 / the issue of shares / other consideration]`, receipt
of which the Author acknowledges, the Author assigns to the Company absolutely all present and
future copyright, and all other intellectual property rights except moral rights, in the Works
listed in the Schedule, for the full term of those rights throughout the world.

**2. Future works.** Copyright in works the Author creates for the Company's software after the
date of this deed vests in the Company on creation, and the Author assigns any such copyright that
does not vest automatically.

**3. Excluded portions.** The assignment does not extend to, and the Author gives no warranty
about, the portions identified in the Schedule as third-party or upstream: those remain under
their own licences, which the Company takes subject to. In particular, memory-layer contains
portions of shodh-memory under the Apache License 2.0, whose NOTICE must be retained.

**4. Moral rights.** The Author consents, under Part IX of the *Copyright Act 1968* (Cth), to the
Company and its licensees doing or omitting any act in relation to the Works that would otherwise
infringe the Author's moral rights, including publishing them without attribution where a licence
requires it and modifying them. The Author retains the right to be identified as an author where
attribution is given.

**5. Warranties.** The Author warrants that, except for the Excluded portions, the Author is the
sole author and owner of the Works, has not assigned or exclusively licensed them to anyone else,
and knows of no claim that they infringe any third party's rights.

**6. Further assurance.** The Author will sign any document and do anything reasonably required
to perfect the assignment, including confirmatory assignments for any registry or platform that
requires one.

**7. Licences already granted.** Any licence the Author granted before this deed over the Works
(including any evaluation permission stated in a repository) continues, and the Company takes the
copyright subject to it.

**8. Governing law.** This deed is governed by the law of South Australia. The parties submit to
the non-exclusive jurisdiction of its courts.

## Schedule — the Works

| Repository | Public name in this tree | Excluded portions |
|---|---|---|
| `Portll/substrate` | overwatch-layer | none identified |
| `Portll/spine` | spine | none identified |
| `Portll/veld` | memory-layer | shodh-memory upstream (Apache-2.0), fork point imported as one squashed commit; 719 third-party crates per its `LICENSING.md` |
| `Portll/commitwork` | commitwork | the third-party works its `docs/THIRD-PARTY-NOTICES.md` inventories (IBM Plex under OFL-1.1; three.js and OrbitControls under MIT; the GitHub Advisory Database distillate under CC-BY-4.0; NVD, MITRE CWE/CAPEC/ATT&CK and FIRST.org EPSS data; the upstream schemas in `schema/upstream/`), each under its own terms |

## Execution

Executed as a deed.

| Signed by the Author | Witness |
|---|---|
| `[signature]` | `[signature]` |
| `[name]` | `[name]` |
| Date `[ ]` | Date `[ ]` |

| Executed by `[Company] Pty Ltd` in accordance with s 127 of the *Corporations Act 2001* (Cth) | |
|---|---|
| `[Director signature]` | `[Director / Secretary signature, or sole director statement]` |
| `[name]` | `[name]` |

---

### Drafting notes — remove before execution

- **Order of operations.** The public grants were not held back for the company: the Author made
  them in the Author's own name when commitwork's public repository opened on 7 October 2026
  (AGPL-3.0-or-later and Apache-2.0 over the wire layer, with its `LICENSE-APACHE-2.0` reading
  "Copyright 2026 Portll"), and the Contributor Licence Agreement of the same date names the
  Author as grantee. The sequence from here is: incorporate → execute this deed, which carries
  those grants with the copyright under clause 7 → the Company confirms or re-states the public
  grants in its own name (the licence files, the Apache copyright line and the CLA under its
  section 9) → sign the first PolyForm order form. No order form is signed before the deed: a
  commercial licence sold by the Company before it holds the copyright is a licence over code the
  seller does not own.
- **Consideration and tax.** Assigning IP into a company you control may have CGT and stamp-duty
  consequences; the solicitor and accountant should rule on the consideration before signing.
- **Co-founder.** A second person who is to hold shares signs a deed in this form with the
  Company. One who contributes without holding shares signs the Contributor Licence Agreement in
  force, `.github/CLA.md` ([CLA.md](CLA.md) points to it): that agreement is a licence to the
  Author trading as Portll, not an assignment, and its section 9 lets it pass to the Company on
  incorporation without the contributor being asked again.
- **The commitwork Schedule row** is drawn from `docs/THIRD-PARTY-NOTICES.md`, which is measured
  over the tracked set and records what it could not determine; re-read it against the tree on
  the day of signing, since the inventory moves with the tree.
