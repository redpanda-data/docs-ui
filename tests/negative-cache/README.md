# Negative-cache tests

Verifies the localStorage negative caching for tooltip data fetches in
`src/js/16-bloblang-interactive.js` (Connect JSON) and
`src/js/19-property-tooltips.js` (properties JSON):

- HTTP `404`/`410` responses are negative-cached for 1 hour, so a missing
  JSON file is not re-requested on every page view (the 404-storm fix).
- Transient failures (`429`, `5xx`, network errors) are **not** cached and
  are retried on the next page view.
- Markers expire after their TTL, and a successful fetch clears the
  properties missing-marker.

The negative cache is disabled in preview mode (`localhost`,
`docs-ui.netlify.app`), so the runner uses Puppeteer request interception to
serve a synthetic test page from a fake production hostname
(`docs.example.test`) and to control the HTTP status of each JSON response.
No real network requests are made.

## Run

```sh
npm run test:negative-cache
```

Results are also written to `test-results-negative-cache.json`.
