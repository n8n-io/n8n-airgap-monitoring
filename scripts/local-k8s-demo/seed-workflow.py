#!/usr/bin/env python3
"""Create and activate a workflow on a running n8n instance.

Used by `make seed` to give both demo instances something that produces
executions, so the numbers the monitoring service collects are not all zero.

Python's standard library only — no pip install, and no jq/curl juggling to pull
ids out of the JSON responses.

Usage: seed-workflow.py BASE_URL EMAIL PASSWORD WORKFLOW_JSON
"""

# `dict | None` in an annotation is a syntax error on the Python 3.9 that ships
# with macOS unless annotations are left unevaluated.
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from http.cookiejar import CookieJar


def main() -> int:
    if len(sys.argv) != 5:
        print(__doc__, file=sys.stderr)
        return 2

    base_url, email, password, workflow_path = sys.argv[1:]
    base_url = base_url.rstrip("/")

    with open(workflow_path, encoding="utf-8") as f:
        workflow = json.load(f)
    name = workflow["name"]

    # n8n's /rest API authenticates with a cookie, so requests go through an
    # opener that keeps one rather than through urlopen directly.
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(CookieJar())
    )

    def call(method: str, path: str, body: dict | None = None) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(
            f"{base_url}{path}",
            data=data,
            method=method,
            headers={"Content-Type": "application/json"},
        )
        with opener.open(request, timeout=30) as response:
            return json.loads(response.read() or "{}")

    call("POST", "/rest/login", {"emailOrLdapLoginId": email, "password": password})

    existing = call("GET", "/rest/workflows").get("data", [])
    if isinstance(existing, dict):  # some versions wrap the list one level deeper
        existing = existing.get("data", [])
    if any(w.get("name") == name for w in existing):
        print(f"{base_url}: '{name}' already exists, leaving it alone")
        return 0

    created = call("POST", "/rest/workflows", workflow)["data"]

    # Activation is its own endpoint; PATCHing `active` onto the workflow is
    # silently ignored. versionId is required and guards against activating a
    # workflow someone else has edited in the meantime.
    call(
        "POST",
        f"/rest/workflows/{created['id']}/activate",
        {"versionId": created["versionId"]},
    )

    print(f"{base_url}: created and activated '{name}' ({created['id']})")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except urllib.error.HTTPError as error:
        print(f"HTTP {error.code} from {error.url}: {error.read().decode()}", file=sys.stderr)
        sys.exit(1)
    except OSError as error:
        print(f"Request failed: {error}", file=sys.stderr)
        sys.exit(1)
