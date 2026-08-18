# Negative-cache tests

Verifies the localStorage negative caching for tooltip data fetches in
`src/js/16-bloblang-interactive.js` (Connect JSON) and
`src/js/19-property-tooltips.js` (properties JSON):

- HTTP `404`/`410` responses are negative-cached for 1 hour, so a missing
  JSON file is not re-requested on every page view (the 404-storm fix).
  Both caches are keyed per URL, so browsing multiple doc versions with
  missing JSON cannot thrash a shared marker.
- Transient failures (`429`, `5xx`, network errors, JSON parse errors) are
  **not** cached and are retried on the next page view.
- Markers expire after their TTL, and a successful fetch clears the
  matching properties missing-marker and populates the dataset cache.
- Preview mode never writes markers and always retries.

Preview mode means the hostname is `localhost`, `127.0.0.1`, or contains
`docs-ui.netlify.app`. Content-repo deploy previews (other `*.netlify.app`
hosts) are treated as production, so a 404 seen there is negative-cached
for up to 1 hour on that origin; clear the browser's localStorage to retry
sooner.

The runner uses Puppeteer request interception to serve a synthetic test
page from a fake production hostname (`docs.example.test`) — and from
`localhost` for the preview-mode scenario — controlling the HTTP status of
each JSON response. No real network requests are made.

## Run

```sh
npm run test:negative-cache
```

Results are also written to `test-results-negative-cache.json`.
