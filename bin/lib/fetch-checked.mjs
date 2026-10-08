// fetch-checked — a fetch that REFUSES to hand back a body a caller could misread as data.
//
// WHY THIS EXISTS, measured 2026-09-06 in one session:
//
//   1. A CircleCI presigned log URL was truncated to 110 chars by a `.slice(0,110)` in the
//      CALLER'S OWN printing code. The shortened URL returned HTTP 404 with a 36-byte JSON body
//      `{"message":"Build not found"}`. The caller parsed that body for error counts, found none,
//      and reported "0 ImpureFunctionCall, 0 UnusedBaselineEntry on the base build" — which was
//      the opposite of the truth and happened to support the conclusion already believed.
//   2. A veld health probe hit three ports read from memory rather than the configured
//      VELD_API_URL. All three refused the connection. The result was published as "veld is
//      unreachable, every session complying with the identity instruction is getting silent
//      nothing" — a fleet-wide claim built on looking at the wrong address.
//
// Both are the same defect: a request that did not reach the intended resource returned SOMETHING,
// and something parses. A 404 body, an error page and an empty result set are all valid inputs to
// a regex, and a regex that finds nothing reports zero rather than raising. The absence of the
// thing you were looking for and the absence of a successful fetch are indistinguishable
// downstream unless the fetch itself refuses.
//
// So the contract here is refusal, not reporting: every failure mode THROWS. A caller cannot
// accidentally treat a failed fetch as an empty answer, because there is no return value to treat.
// Callers wanting a soft failure must catch explicitly, which makes the choice visible at the call
// site instead of implicit in a body nobody inspected.
//
// Deliberately NOT here: retries, backoff, caching. This is a floor under one specific misread,
// and a helper that also had a retry policy would be adopted for the retry policy and inherited
// for the floor, which is how the floor stops being checked.

/** Thrown for every unusable response. `kind` names which floor was hit. */
export class FetchRefused extends Error {
  constructor(kind, message, detail = {}) {
    super(message);
    this.name = 'FetchRefused';
    this.kind = kind; // 'status' | 'short' | 'empty' | 'network' | 'timeout'
    Object.assign(this, detail);
  }
}

/**
 * Fetch `url` and return `{ status, bytes, body, url }` — or THROW.
 *
 * Throws `FetchRefused` when: the request fails or times out; the status is not 2xx; the body is
 * empty; or the body is shorter than `minBytes`. `minBytes` defaults to 1 (empty is always a
 * refusal) — set it higher when you know roughly how big a real answer is, because THAT is what
 * catches an error page that happens to be valid JSON.
 *
 * @param {string} url
 * @param {{minBytes?: number, timeoutMs?: number, headers?: Record<string,string>}} [opts]
 * @returns {Promise<{status:number, bytes:number, body:string, url:string}>}
 */
export async function fetchChecked(url, opts = {}) {
  const { minBytes = 1, timeoutMs = 30_000, headers = {} } = opts;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { headers, signal: ac.signal });
  } catch (e) {
    clearTimeout(timer);
    const timedOut = e?.name === 'AbortError';
    throw new FetchRefused(
      timedOut ? 'timeout' : 'network',
      timedOut
        ? `no response from ${url} within ${timeoutMs}ms — this is a refusal, not an empty result`
        : `could not reach ${url}: ${e?.message || e} — this is a refusal, not an empty result`,
      { url, cause: e },
    );
  }
  clearTimeout(timer);

  const body = await res.text().catch(() => '');
  const bytes = Buffer.byteLength(body, 'utf8');

  if (!res.ok) {
    // The body of a non-2xx is the single most dangerous thing here: it parses, and it is not
    // the resource. Surface a slice of it so the caller sees WHAT they nearly parsed.
    throw new FetchRefused('status', `${url} returned HTTP ${res.status} (${bytes}B). Its body is NOT the resource and must not be parsed: ${JSON.stringify(body.slice(0, 120))}`, { url, status: res.status, bytes, body });
  }
  if (bytes === 0) {
    throw new FetchRefused('empty', `${url} returned HTTP ${res.status} with an EMPTY body — a zero found in nothing is not a measured zero`, { url, status: res.status, bytes });
  }
  if (bytes < minBytes) {
    throw new FetchRefused('short', `${url} returned only ${bytes}B against a minimum of ${minBytes}B — too small to be the resource, and small enough to parse as an empty answer`, { url, status: res.status, bytes, body });
  }
  return { status: res.status, bytes, body, url };
}
