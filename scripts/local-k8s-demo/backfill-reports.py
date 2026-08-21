#!/usr/bin/env python3
"""Post backdated daily reports to the monitoring service.

A cluster created five minutes ago has no history, so the dashboard's daily
metric is a single zero. This invents a plausible run of past days and sends
them as ordinary reports, which the collector already supports: a daily data
point carries its own `date`, so nothing has to pretend the reports arrived
back then.

Note what this does NOT do: n8n itself still has no insights history, so the
live reporter keeps sending yesterday's real (zero) figure every minute. The
backfill therefore stops at the day before yesterday, leaving yesterday to the
instance. Overlapping would put two rows with the same date in the history
panel, one from here and one from n8n.

Python's standard library only, matching seed-workflow.py.

Usage: backfill-reports.py N8N_URL MONITORING_URL LABEL DAYS
Env:   N8N_EMAIL, N8N_PASSWORD, N8N_ENCRYPTION_KEY, INSTANCE_TOKEN
"""

from __future__ import annotations

import datetime
import hashlib
import json
import os
import random
import sys
import urllib.error
import urllib.request
from http.cookiejar import CookieJar

METRIC = "billableExecutionPerDay"


def instance_id_from(encryption_key: str) -> str:
    """Reproduce n8n's own derivation (InstanceSettings.generateInstanceId).

    Lets the backfill address an instance before it has ever reported, instead
    of waiting a reporting interval to learn its id.
    """
    tail = encryption_key[round(len(encryption_key) / 2) :]
    return hashlib.sha256(tail.encode()).hexdigest()


def daily_volume(instance_id: str, day: datetime.date) -> int:
    """A believable execution count: per-instance baseline, quieter weekends,
    day-to-day jitter.

    Seeded from the instance and the date so re-running `make up` reproduces
    the same series rather than reshuffling the chart under the viewer.
    """
    seed = int(hashlib.sha256(f"{instance_id}:{day}".encode()).hexdigest()[:16], 16)
    rng = random.Random(seed)

    baseline = random.Random(instance_id).uniform(4_000, 11_000)
    weekend = day.weekday() >= 5
    volume = baseline * rng.uniform(0.82, 1.18) * (rng.uniform(0.3, 0.5) if weekend else 1.0)

    return round(volume)


def main() -> int:
    if len(sys.argv) != 5:
        print(__doc__, file=sys.stderr)
        return 2

    n8n_url, monitoring_url, label, days = sys.argv[1:]
    n8n_url, monitoring_url, days = n8n_url.rstrip("/"), monitoring_url.rstrip("/"), int(days)

    try:
        email = os.environ["N8N_EMAIL"]
        password = os.environ["N8N_PASSWORD"]
        encryption_key = os.environ["N8N_ENCRYPTION_KEY"]
        instance_token = os.environ["INSTANCE_TOKEN"]
    except KeyError as missing:
        print(f"missing environment variable: {missing}", file=sys.stderr)
        return 2

    if days < 1:
        print(f"{label}: nothing to backfill")
        return 0

    # The instance's real version, so the dashboard does not show a made-up one
    # for the minute before the first live report corrects it.
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))

    def n8n(path: str, body: dict | None = None) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(
            f"{n8n_url}{path}",
            data=data,
            method="POST" if data else "GET",
            headers={"Content-Type": "application/json"},
        )
        with opener.open(request, timeout=30) as response:
            return json.loads(response.read() or "{}")

    n8n("/rest/login", {"emailOrLdapLoginId": email, "password": password})
    version = n8n("/rest/settings")["data"]["versionCli"]

    instance_id = instance_id_from(encryption_key)
    # Stop at the day before yesterday: yesterday belongs to the live reporter.
    last_day = datetime.datetime.now(datetime.timezone.utc).date() - datetime.timedelta(days=2)
    dates = [last_day - datetime.timedelta(days=offset) for offset in reversed(range(days))]

    payload = {
        "instanceId": instance_id,
        "label": label,
        "n8nVersion": version,
        "dataPoints": [
            {
                "kind": "daily",
                "name": METRIC,
                "value": daily_volume(instance_id, day),
                # Deterministic, so a re-run overwrites its own earlier point
                # instead of stacking a second one for the same day.
                "batchId": f"backfill-{instance_id[:12]}-{day}",
                "date": day.isoformat(),
            }
            for day in dates
        ],
    }

    request = urllib.request.Request(
        f"{monitoring_url}/api/v1/instance-reports",
        data=json.dumps(payload).encode(),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {instance_token}",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        response.read()

    volumes = ", ".join(f"{p['date']}={p['value']}" for p in payload["dataPoints"])
    print(f"{label}: backfilled {days} day(s) — {volumes}")
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
