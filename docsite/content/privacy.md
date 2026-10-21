# Privacy

This policy covers **this site** — the document site at `i.commitwork.online`. It does not cover
the commitwork software itself, which runs on your own machine and sends nothing here.

## What this site collects

Nothing, directly. Every statement below is a property of the published bundle that can be checked
from the page you are reading:

- **No scripts.** No page on this site carries a `<script>` tag, inline or external. There is no analytics beacon, no tag manager and no third-party pixel. View the source and search for it.
- **No cookies.** Nothing here sets one. The site has no accounts and no sessions.
- **No forms.** No page has a form. The only inputs are the display toggles on the taxonomy reference page, which change what that page shows and submit nothing, so there is nothing for the site to receive.
- **No third-party requests.** Styles, fonts and images are inline or `data:` URIs. Opening a page makes requests to this origin and to nowhere else. Links to other sites are links; following one is your act, not the page's.

The editing interface is not published here. It is served from a separate authenticated origin and
is not reachable from this site.

## What the host necessarily processes

This site is static files on **Cloudflare Pages**. Serving a page requires Cloudflare to handle the
request, which means it processes the connection metadata every HTTP request carries: your IP
address, the time, the URL requested, and the user-agent string your browser sends. That handling
is Cloudflare's, under Cloudflare's own terms as the host and network provider. It is not avoidable
by a site that is hosted at all, and it happens whether or not the site has any interest in it.

The domain also has Network Error Logging enabled, which is why responses carry a `NEL` header: if
your browser cannot complete a connection to this site, it may report that failure to Cloudflare.
That mechanism reports connection errors, not page content and not browsing history.

## Your data

There is no account to delete and no profile to export, because there is nothing here that holds
one. If you want to ask about this policy, or about anything Cloudflare holds as this site's host,
write to [john@portll.net](mailto:john@portll.net).

## Changes

This page is generated from its source in the commitwork repository and is republished with the
site. There is no change feed; the current text is the current policy.
