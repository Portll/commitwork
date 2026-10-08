// admin/routes/oversight.mjs — the panel's write path for HUMAN OVERSIGHT of a determination.
//
// The ledger is bin/lib/verdict-journal-core.mjs's hash chain, not a new one: every record carries `prev`
// (sha256 of the previous line), a fresh file opens at 'genesis', tail-read and append happen
// under one lock so two writers cannot claim the same `prev`, and readJournal already partitions
// a chain into verified / broken / raced / unchained. The rules live in lib/oversight.mjs, which
// is pure — the same validator any CLI author would call. A transport with its own rules is the
// transport with the weaker rules.
//
// `who` COMES FROM THE SESSION AND NEVER FROM THE BODY. The product here is an attributed
// signature; a caller that can name itself can sign as anybody, and the ledger's whole value is
// that the name on a record is the name of whoever was authenticated when it was written. Every
// route requires a session, LOOPBACK INCLUDED — same reasoning as routes/annotations.mjs: on a
// box with nobody logged in there is no one to attribute an attestation to, so there is nothing
// honest to write.
//
// HONESTY CONTRACT OF THE RESPONSE: an oversight record changes no severity, hides no row and
// closes no finding. Every write says so (`suppresses: false`), because a UI that renders ok:true
// as "handled" is how an attestation starts doing a suppression's job.
import { requireSession } from '../lib/route-auth.mjs';
import { validateOversight, overseenBy, subjectKey, STANCES } from '../../lib/oversight.mjs';
import { journal, readJournal } from '../../bin/lib/verdict-journal-core.mjs';
import { sessionWho } from '../../monitor/attribution.mjs';

const GATE = 'oversight';

const subjectFrom = (get) => ({
  repo: get('repo') || undefined,
  file: get('file') || undefined,
  rule: get('rule') || undefined,
  package: get('package') || undefined,
});

export const routes = [
  // GET /api/oversight?repo=&file=&rule=&package= — the folded state for one subject, or the
  // whole ledger when no subject is named. THE CHAIN VERDICT TRAVELS WITH IT: a caller must be
  // able to see that the record it is about to trust sits in a chain that still verifies, and
  // `torn` and `absent` ride along for the same reason.
  {
    method: 'GET',
    path: '/api/oversight',
    handle: (ctx) => {
      const { send, query } = ctx;
      if (!requireSession(ctx)) return send(401, { ok: false, error: 'authentication required' });

      // readJournal fails closed on an unreadable file and that throw is deliberately surfaced:
      // an unreadable ledger and an empty one are different facts, and answering [] would let a
      // broken chain render as "nobody has ever signed anything".
      let led;
      try { led = readJournal(GATE); }
      catch (e) { return send(503, { ok: false, error: `oversight ledger unreadable: ${e.message}` }); }

      const rows = led.records || [];
      const body = {
        ok: true,
        stances: STANCES,
        chain: led.chain,
        torn: led.torn,
        absent: led.absent,
        rotations: led.rotations,
      };
      const subject = subjectFrom((k) => query.get(k));
      const key = subjectKey(subject);
      if (key) {
        body.subject = subject;
        body.oversight = overseenBy(rows, subject);
        body.records = rows.filter((r) => subjectKey(r.subject) === key);
      } else {
        body.records = rows;
        // No subject named, so this is the ledger rather than a verdict about anything in
        // particular. null, not an empty fold — those would read the same and mean different things.
        body.oversight = null;
      }
      return send(200, body);
    },
  },

  // POST /api/oversight — sign. { stance, basis, subject: { repo, file, rule, package } }
  {
    method: 'POST',
    path: '/api/oversight',
    handle: (ctx) => {
      const { req, send, readJsonBody } = ctx;
      const session = requireSession(ctx);
      if (!session) {
        return send(401, { ok: false, error: 'authentication required — an attestation with no authenticated author attests nothing' });
      }
      return readJsonBody(req, (body, err) => {
        if (err) return send(400, { ok: false, error: err });
        if (!body || typeof body !== 'object') return send(400, { ok: false, error: 'body must be a JSON object' });

        // `who` is written from the SESSION after the body is read, so a body naming one cannot
        // win. This ordering is the control; the validator below only checks it is present.
        const record = {
          stance: body.stance,
          basis: body.basis,
          subject: body.subject || {},
          who: sessionWho(session),
        };
        const { errors } = validateOversight(record);
        if (errors.length) return send(400, { ok: false, error: errors.join('; '), errors });

        const res = journal(GATE, record, { session: sessionWho(session) });
        if (!res || res.ok === false) {
          // A refused append is loud and writes nothing. Contention is not corruption, and it is
          // certainly not a reason to silently drop a signature the operator believes they gave.
          return send(503, { ok: false, error: `oversight NOT recorded: ${(res && res.error) || 'append refused'}` });
        }
        return send(200, {
          ok: true,
          recorded: { stance: record.stance, who: record.who, subject: record.subject },
          // Stated on every write, deliberately. See the honesty contract at the top of this file.
          suppresses: false,
          effect: 'none — an oversight record changes no severity and hides no row; it records that a human read the determination and where they stand',
        });
      });
    },
  },
];
