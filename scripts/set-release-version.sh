#!/usr/bin/env bash
# Writes the release version into the root package.json, the single source of
# truth the release workflows read, and into the Helm chart's appVersion, so the
# chart deploys the image of the release it ships with. Idempotent.
set -euo pipefail

VERSION="${1:?usage: set-release-version.sh <version>}"
# Reject rather than normalize (e.g. strip a leading "v"): this string becomes the
# published image tag and the git tag, and the workflows accept exactly this shape.
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
	echo "ERROR: version must be x.y.z, got '${VERSION}'" >&2
	exit 1
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

npm pkg set version="$VERSION" --prefix "$ROOT"

# The chart's appVersion is the default image tag. Its own `version` field is
# left alone: that tracks changes to the chart, not to the app inside it.
CHART="$ROOT/docs/charts/airgap-monitoring/Chart.yaml"
sed -i.bak -E "s/^appVersion: .*/appVersion: \"${VERSION}\"/" "$CHART"
rm -f "$CHART.bak"
grep -q "^appVersion: \"${VERSION}\"$" "$CHART" || {
	echo "ERROR: failed to set appVersion in ${CHART}" >&2
	exit 1
}
