<!-- verified-against: 2026-09-09 -->
# Terms of Use — overwatch-layer, spine, memory-layer and commitwork

> **Draft. Not yet in force, and not legal advice.** These terms were drafted by the project for
> a solicitor to review before publication. Every `[bracketed]` item is a fact the project does
> not yet hold and must not be guessed at. Nothing here takes effect until it is published
> without this banner by the legal person named in section 1.

**Version 0.2 — 9 September 2026.** Component names are the ones this tree carries; the
product names are settled at release.

## 1. Who these terms are between

These terms are between **you** and **Portll** (`[full legal name of the individual or Pty Ltd
trading as Portll]`, ABN `[ABN]`, of South Australia, Australia), referred to as **we** or
**us**. Contact: **john@portll.net**.

Until a company is registered, "Portll" is a trading name and the contracting party is the
individual behind it. If Portll is registered as a business name, ASIC registration of that name
is required before these terms are published under it.

## 2. What these terms cover, and what they do not

These terms cover three things:

- **the software** — overwatch-layer, spine, memory-layer and commitwork, as distributed by us;
- **the hosted surface** — any instance of overwatch-layer that we operate and publish over a
  network;
- **evaluation** of builds that are not yet published under an open-source licence.

These terms do **not** replace the software licence. The software is offered under the GNU
Affero General Public License v3.0 or later, or under a commercial licence agreed with us
separately. Where these terms and the AGPL differ about the software itself, the AGPL prevails,
and nothing here narrows a right the AGPL grants you. These terms add the things a licence does
not address: the hosted surface, acceptable use, and the position under Australian law.

## 3. Licence to the software

**3.1 Published components.** A component whose repository carries an AGPL-3.0-or-later
`LICENSE` file is licensed to you under it. You may instead take **PolyForm Internal Use
1.0.0** from us by written agreement (section 14); the licence text is used verbatim, and the
agreement adds only the licensee, components, versions, term, fee, support and governing law.
Taking it does not remove the AGPL grant from you or anyone else.

**3.2 Unpublished components — evaluation only.** A component that is not yet public, or whose
`LICENSING.md` states that its licence is not yet in force, is provided for **evaluation only**.
You may install, run, read and assess it on hardware you control, and only against repositories
and systems you own or have been granted full authority to test. No other right is granted, by
implication or otherwise. This grant ends when we publish the component under the AGPL, at which
point the AGPL replaces it, or when we withdraw the build, on notice.

**3.3 Upstream and third-party parts.** memory-layer contains portions of shodh-memory under
the Apache License 2.0; the attribution in its `NOTICE` file must be retained. Third-party dependencies
carry their own licences, listed in each component's `LICENSING.md`. Where a third-party licence
grants you more than these terms do, that licence prevails for that part.

**3.4 Your outputs are yours.** Reports, SBOMs, VEX documents, attestations, memories, ledgers
and every other artefact the software generates from your inputs belong to you and carry no
licence obligation to us. You may file them with a regulator, an auditor or a customer without
asking.

## 4. Acceptable use — authorised testing only

commitwork actively probes live targets. Its runtime lanes (`dast-nuclei`, `dast-authz-bola`,
`api-fuzz`, `tls-headers` and any lane added later) send requests to systems and try to elicit
defective behaviour from them.

**You may point the software only at systems you own or are expressly authorised to test.**
Unauthorised access to, or impairment of, a computer system is an offence under Part 10.7 of
the *Criminal Code Act 1995* (Cth) and under the equivalent law of every Australian state and
territory, and under the law of most other countries. Authorisation is yours to obtain and yours
to prove. We do not verify it and we will not defend it.

You must not use the software or the hosted surface:

- against a system without the owner's authority, including "bug bounty" targets outside the
  published scope of that programme;
- to build, train or improve a product that competes with the software using access obtained
  under an evaluation grant (section 3.2) — the AGPL imposes no such limit, and once a component
  is published under it this bullet no longer applies to that component;
- to interfere with the hosted surface, other users of it, or the tunnel and infrastructure
  behind it;
- in breach of any law that applies to you, including export-control law. The software is
  published open-source security tooling; we do not assert that it is a controlled item under
  the Defence and Strategic Goods List, and `[a solicitor should confirm the "in the public
  domain" exemption applies once the components are public]`.

## 5. The hosted surface

**5.1 Access.** The hosted surface is available to accounts we provision. Sign-in is through
Google; we receive the identity Google returns and nothing more from Google. We may suspend or
close an account that breaches section 4, on notice where practicable.

**5.2 What it is.** The hosted surface is a single-operator instance running on our own
hardware, published through a tunnel. It is **not** a multi-tenant service and it is not offered
with any availability, backup or support commitment. It may go away, change or be reset without
notice to you.

**5.3 Your data.** Data the software stores runs on your own machine unless you route it to
the hosted surface yourself. On the hosted surface we hold: the identity returned by sign-in,
session records, and whatever you file into spine or memory-layer through it. We use it to run the
service and for nothing else. We do not sell it and we do not use it to train models. You can
ask for it to be deleted at the contact address in section 1 and we will do so within 30 days,
except where a signed evidence artefact you have already relied on would be broken by the
deletion, in which case we will tell you.

**5.4 Privacy.** We are a small business and the *Privacy Act 1988* (Cth) may not bind us under
the small-business exemption; `[confirm current turnover position and whether the exemption
still stands at publication — its repeal has been proposed]`. We hold ourselves to the Australian
Privacy Principles regardless. If our position changes we will say so here.

## 6. Security reporting

Report a suspected vulnerability in any of the four components to **john@portll.net**. Please
do not open a public issue for it first. We acknowledge reports within five business days and
tell you what we found. We will not take legal action against good-faith research that stays
within section 4, and we ask that you give us a reasonable window to fix a defect before
disclosing it. This is the single contact for all four components: a defect that crosses a wire
between them is still one report.

## 7. Feedback and contributions

Feedback you send us may be used without obligation. A contribution you submit to a component's
repository is licensed to everyone under that component's AGPL licence. Because we also offer
the software under PolyForm Internal Use 1.0.0, we need the right to include your contribution
in that grant: before we accept a non-trivial contribution you will be asked to sign a short
contributor licence agreement giving us that right. Until you have, your contribution is
accepted under a DCO sign-off and is not included in any build offered under the PolyForm
licence. We will not relicense your contribution under terms that restrict it more than the
AGPL does without your consent.

## 8. Warranty and what the Australian Consumer Law does not let us exclude

**8.1 As is.** To the extent the law permits, the software and the hosted surface are provided
**as is**, without warranty of any kind, express or implied, including merchantability, fitness
for a particular purpose, title and non-infringement. Unpublished builds are unreleased,
incomplete and unsupported.

**8.2 Consumer guarantees.** The *Australian Consumer Law* (Schedule 2 to the *Competition and
Consumer Act 2010* (Cth)) provides guarantees that cannot be excluded, restricted or modified,
including that services are supplied with due care and skill and that software supplied as
goods is of acceptable quality. **Nothing in these terms excludes, restricts or modifies any
such guarantee, right or remedy.** Where the law allows us to limit our liability for breach of
a guarantee, and the software or service is not of a kind ordinarily acquired for personal,
domestic or household use, our liability is limited, at our option, to resupplying the software
or service, or paying the cost of having it resupplied.

**8.3 Gratuitous supply.** Most use of the software is free of charge. Where a supply is not in
trade or commerce, or is not to a "consumer" as the Australian Consumer Law defines one, the
consumer guarantees may not apply to it. We state this so that the position is visible, not to
rely on it against someone it does not fit.

## 9. Liability

To the maximum extent the law permits, and subject to section 8.2, we are not liable to you for
any loss arising from the software or the hosted surface, whether in contract, tort (including
negligence), statute or otherwise, including loss of data, loss of profit, and any loss that
follows from a scan result being wrong in either direction. The software's stated design is to
report what it did not measure; a "not scanned" result is not a "clean" result and we do not
warrant it as one.

Nothing in these terms limits liability that cannot lawfully be limited, including for fraud or
for death or personal injury caused by negligence.

## 10. Unfair contract terms

These are standard-form terms. If you are a small business as the Australian Consumer Law
defines one, Part 2-3 of that law applies to this contract. We have drafted these terms to avoid
the kinds of terms that law names as unfair: we do not vary them without notice (section 12),
we do not terminate without cause where you have paid us (section 11), and every limit on our
liability is subject to section 8.2. If a court finds a term unfair, that term is severed and
the rest continues.

## 11. Term and termination

These terms apply from the first time you use the software under section 3.2 or sign in to the
hosted surface, and continue until ended.

You may stop at any time. We may end your access to the hosted surface, or withdraw an
evaluation grant, for breach of section 4 immediately, and otherwise on 30 days' notice. Ending
these terms does not end an AGPL grant already made to you; the AGPL is irrevocable on its own
terms. Sections 3.3, 3.4, 8, 9 and 13 survive.

## 12. Changes

We may change these terms. A change takes effect 30 days after we publish it, with the version
and date at the top updated, or immediately where the change only adds a right for you or is
required by law. Continued use after that date is acceptance. We do not apply a change to a
commercial licence already agreed without agreeing it with you.

## 13. Governing law

These terms are governed by the law of South Australia, Australia. You submit to the
non-exclusive jurisdiction of the courts of South Australia and the courts that hear appeals
from them. Acceptance by clicking, by installing or by continued use is valid under the
*Electronic Transactions Act 1999* (Cth) and its state equivalents.

## 14. Commercial licence, prices and tax

The commercial licence is **PolyForm Internal Use 1.0.0**, granted by a written order form
that names the licensee, the components and versions, the term, the fee, the support level and
the governing law. The licence text is not modified. It permits use inside the licensee's
organisation, including by its contractors, and does not permit distribution, offering the
software as a service to third parties, or building a competing product. Any price we quote is
in Australian dollars and excludes GST unless it says otherwise; a tax invoice will show our
ABN. We do not offer a self-serve purchase path and nothing in these terms is an offer to sell.

## 15. Entire terms

These terms, the licence that applies to each component, and any commercial licence you have
agreed with us are the whole agreement about their subject matter. If any provision is held
unenforceable it is severed and the rest continues in force.

---

### Drafting notes for the reviewing solicitor — remove before publication

- **Contracting party.** Section 1 needs the legal person. If a Pty Ltd is formed before
  publication, name it and consider assigning copyright in all four components to it first, so
  the entity that grants the AGPL and sells the commercial licence is the entity that owns the
  code. Confirm whether "Portll" needs ASIC business-name registration.
- **ACL scope.** Sections 8.2 and 8.3 track ss 54–64A of the ACL. Confirm the s 64A limitation
  wording and whether the A$100,000 consumer threshold catches any intended commercial-licence
  price point.
- **UCT regime.** Section 10 is a response to the November 2023 amendments (penalties for unfair
  terms in small-business standard-form contracts). Please check sections 5.2, 11 and 12 against
  the s 25 examples in particular.
- **Privacy.** Section 5.4 assumes the small-business exemption still exists at publication;
  confirm.
- **Export control.** Section 4's last bullet: commitwork orchestrates published scanners and is
  itself to be published open source. Confirm the DSGL public-domain exemption covers it and that
  no component contains "intrusion software" as defined.
- **AGPL interaction.** Sections 2 and 11 are written so that these terms never subtract from
  the AGPL; please confirm that no clause could be read as an "additional restriction" under
  AGPL section 7, which would be void and could be argued to breach the licence.
- **Hosted surface.** Section 5 describes a single-operator instance. If it becomes
  multi-tenant, this section becomes a service agreement and needs availability, data-residency
  and breach-notification terms (Notifiable Data Breaches scheme) it does not have now.
