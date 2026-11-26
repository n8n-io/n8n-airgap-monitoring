# submit-ui

The page operators use to send their monthly usage to n8n. It lists every
month the service holds data for and shows whether each month is upcoming,
pending or already submitted. **Submit** sends the pending months to n8n,
oldest first.

The data leaves through the operator's browser, not through the service: the
page fetches each month from `GET /api/v1/report`, gzips the stream unchanged
and posts it to the n8n endpoint. Once n8n accepts a month, the page records
that with `POST /api/v1/submissions/:month`. The monitoring service itself
makes no outbound request.

## How it ships

This is a library package, not a deployable app. `vite build` writes static
files to `dist/`, and `apps/api` depends on this package and serves `dist/`
at `/`. Because of `"files": ["dist"]`, the image's `node_modules/submit-ui`
holds only the built page, and Vue is bundled into it, so it's a
`devDependency`. Turbo builds this package before the API (`dependsOn:
["^build"]`). If `dist/` is missing, for example under the API's unit tests,
the API starts without the page and logs a warning.

Nothing about the destination is built into the page. The API reads it at
start-up and serves it with the overview:

- **`N8N_MONITORING_REPORT_UPLOAD_FORM_URL`**, the link to the manual upload
  form. Without it the page does not offer a manual upload.

- **`N8N_MONITORING_REPORT_DESTINATION`** and
  **`N8N_MONITORING_REPORT_DESTINATION_AUTH_TOKEN`**, the n8n URL the page posts
  to and the token it sends as `Authorization: Bearer <token>`. Both come from
  n8n and are set together or not at all. They come with
  `GET /api/v1/submissions`, behind the read token, and can't be changed in the
  browser. Without them Submit stays disabled.
- **A Content-Security-Policy** header, set by the API on the page, that only
  allows requests to this service and to the destination's origin.

## Authentication

The page asks for the service's read token (`N8N_MONITORING_READ_TOKEN`) on
every load and keeps it in memory only. Every API call sends it as
`Authorization: Bearer <token>`. A 401 puts the page back at the token
prompt. See [docs/AUTHORIZATION.md](../../docs/AUTHORIZATION.md).

## Manual upload

When n8n cannot be reached or rejects the data, and the service has an upload
form URL, Submit opens a dialog. Without the URL, Submit shows only the error
banner. The dialog has a row for each pending month, with its own download and
upload form link. Each month's report is read for its consumer IDs when the
dialog opens. A link carries the `month` query parameter. It also carries
`consumerId` when that month's report holds exactly one ID. Reports with none
or several IDs leave the field for the user. The names are constants in
`src/manual-upload.ts`. Other failures, such as a
report this service cannot serve, show only the error banner. To see the dialog
locally, post the test data below, stop the stand-in in terminal 2, and press
Submit.

## Run it locally

Commands are run from the repository root. Use three terminals.

**1. The API**, on port 3456, in token mode so you can post test data:

```sh
N8N_MONITORING_READ_TOKEN=dev-read-token N8N_MONITORING_WRITE_TOKEN=dev-write-token \
  N8N_MONITORING_REPORT_DESTINATION=http://localhost:5678/webhook \
  N8N_MONITORING_REPORT_DESTINATION_AUTH_TOKEN=dev-destination-token \
  N8N_MONITORING_REPORT_UPLOAD_FORM_URL=https://n8n.example.com/form \
  pnpm --filter api dev
```

**2. A stand-in for the n8n endpoint**, which logs what it receives, including
the authorization header, and answers the browser's CORS preflight:

```sh
node -e "require('node:http').createServer((q,s)=>{s.setHeader('access-control-allow-origin','*');s.setHeader('access-control-allow-headers','content-type, authorization');let n=0;q.on('data',c=>n+=c.length);q.on('end',()=>{console.log(q.method,q.url,q.headers.authorization,n,'bytes');s.end()})}).listen(5678)"
```

**3. The page**, with hot reload. Vite proxies `/api` to the API:

```sh
pnpm --filter submit-ui dev
```

Open the URL Vite prints and enter `dev-read-token`. The destination and the
upload form URL are read when the API starts, so restart terminal 1 to change
them. Any absolute http(s) URL works as the upload form URL locally. To send to a real n8n
webhook instead, point `N8N_MONITORING_REPORT_DESTINATION` and its auth token
at it. The webhook has to allow CORS from the page's origin, including the
`authorization` header.

### Test data

A fresh database shows an empty page. A month becomes pending on the 2nd of
the following month (UTC), so post a report with enough daily history to
reach back past the current month:

```sh
pnpm --filter api --silent mock-report --label demo --days 60 | \
  curl -sS -X POST localhost:3456/api/v1/instance-reports \
    -H 'authorization: Bearer dev-write-token' -H 'content-type: application/json' -d @-
```

That gives one instance with the last two finished months pending and the
current month upcoming. Post more reports with different `--instance-id`
values and `--days` counts to see months with missing instances. The data is
in `apps/api/data/`, so delete that directory to start over.

### Against the built page

To check the page the way the image serves it, from the API at `/`:

```sh
pnpm turbo run build --filter api...
```

Then start the API as in step 1 and open http://localhost:3456/. The API
looks for `dist/` once, at startup, so restart it after a rebuild.
`docker compose up --build` does the same in the production image, on port
3001.

## Checks

```sh
pnpm --filter submit-ui typecheck
pnpm --filter submit-ui build
```

The package has no unit tests. The API routes it calls are covered in
`apps/api`.
