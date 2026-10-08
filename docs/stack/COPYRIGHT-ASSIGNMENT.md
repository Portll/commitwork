<!-- verified-against: 2026-09-11 -->
# Deed of Copyright Assignment — draft for solicitor review

> **Draft. Not in force, and not legal advice.** Prepared 2026-09-11 under operator ruling D19
> item 5. This deed moves the copyright in the four components from the individual who wrote them
> to the company, so that the company is the party that grants the AGPL and sells the PolyForm
> licence. Every `[bracketed]` item is a fact the project does not yet hold. It must be executed
> as a **deed** under South Australian law (signed, witnessed, and expressed to be a deed) and
> reviewed by a solicitor first.

**Version 0.1 — 11 September 2026**

## Parties

- **Assignor:** `[full legal name]` of `[address]`, South Australia (**the Author**).
- **Assignee:** `[Company name] Pty Ltd` (ACN `[ACN]`) of `[registered office]`, South Australia
  (**the Company**).

## Background

A. The Author created the software and documentation in the repositories listed in the Schedule,
   and owns the copyright in them except for the third-party and upstream portions identified in
   the Schedule.
B. The Company intends to offer that software under the GNU Affero General Public License v3.0 or
   later and, by agreement, under PolyForm Internal Use 1.0.0, and to hold and enforce the
   copyright for that purpose.
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
| `Portll/commitwork` | commitwork | vendored third-party references and fixtures identified in its `LICENSING.md` and `NOTICE`, if any |

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

- **Order of operations.** Incorporate → execute this deed → publish the AGPL grant in the
  company's name → sign the first PolyForm order form. A commercial licence sold before the deed
  is a licence over code the seller does not own.
- **Consideration and tax.** Assigning IP into a company you control may have CGT and stamp-duty
  consequences; the solicitor and accountant should rule on the consideration before signing.
- **Co-founder.** If a second person has contributed or will, they sign the same deed or the
  Contributor Licence Agreement ([CLA.md](CLA.md)), depending on whether they are to hold shares.
- **The commitwork Schedule row** needs the third-party inventory that the publication work is
  producing; do not sign with "if any" left in.
