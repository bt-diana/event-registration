#!/usr/bin/env bash
# Run on a machine with archive access. Submits each sources.csv URL to the Wayback Machine (Save Page Now).
# Usage: bash archive_pages.sh sources.csv > archived_urls.txt
python3 - "$1" <<'PY' | while read -r u; do
import csv,sys
for r in csv.DictReader(open(sys.argv[1])): print(r['url'])
PY
  echo "$u -> $(curl -sI "https://web.archive.org/save/$u" | grep -i '^location:' | tr -d '\r')"
  sleep 6
done
