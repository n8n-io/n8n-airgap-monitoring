# Report download memory benchmark (API-269)

Shows that `GET /api/v1/report` streams instead of buffering the whole report in
memory: it seeds a big store and downloads the report under a heap cap.

```sh
scripts/bench/run.sh                 # 2000 instances × 365 days, 256 MB cap
scripts/bench/run.sh 500 90 128      # instances, days, mem_mb
```

It builds `apps/api`, seeds a throwaway temp DB (auto-removed), downloads the
report under `--max-old-space-size`, and prints peak RSS, size and time.
Needs `python3` (stdlib only).

Run it on the pre-streaming build and a large store OOM-crashes; run it on the
streaming build and the same store downloads fine under the same cap — one
instance's history is materialised at a time.

Measured (2000 × 1095 ≈ 2.19M rows / 893 MB, cap 256 MB): before ≈ 1362 MB peak
→ OOM; after ≈ 234 MB peak → 503 MB downloaded in ~10s.
