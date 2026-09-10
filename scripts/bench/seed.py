#!/usr/bin/env python3
# Bulk-load mock instance reports into the monitoring SQLite DB (API-269 bench).
# Usage: seed.py DB_PATH INSTANCES DAYS   (table must already exist)

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import sys
import time

CHUNK = 50_000


def instance_id(index: int) -> str:
    return hashlib.sha256(f"instance-{index}".encode()).hexdigest()


def rows(instances: int, days: int):
    base = int(time.time()) - days * 86_400
    for index in range(instances):
        iid, label, total = instance_id(index), f"instance-{index}", 0
        for offset in range(days):
            day = time.strftime("%Y-%m-%d", time.gmtime(base + offset * 86_400))
            volume = 4_000 + (hash((index, offset)) % 7_000)
            total += volume
            data = json.dumps(
                [
                    {"kind": "daily", "name": "billableExecutionPerDay", "value": volume, "date": day},
                    {"kind": "cumulative", "name": "billableExecutionTotal", "value": total},
                ],
                separators=(",", ":"),
            )
            yield (iid, f"backfill-{index}-{day}", label, "1.99.0", data, f"{day}T02:00:00.000Z")


def main() -> int:
    if len(sys.argv) != 4:
        print("usage: seed.py DB_PATH INSTANCES DAYS", file=sys.stderr)
        return 2

    db_path, instances, days = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA synchronous=OFF")

    insert = (
        "INSERT INTO instance_reports (instanceId, batchId, label, n8nVersion, data, receivedAt) "
        "VALUES (?, ?, ?, ?, ?, ?)"
    )

    started, written, batch = time.monotonic(), 0, []
    for row in rows(instances, days):
        batch.append(row)
        if len(batch) >= CHUNK:
            conn.executemany(insert, batch)
            conn.commit()
            written += len(batch)
            batch.clear()
    if batch:
        conn.executemany(insert, batch)
        conn.commit()
        written += len(batch)
    conn.close()

    size_mb = os.path.getsize(db_path) / 1024 / 1024
    print(f"    {written:,} rows, {size_mb:.0f} MB store ({time.monotonic() - started:.1f}s)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
