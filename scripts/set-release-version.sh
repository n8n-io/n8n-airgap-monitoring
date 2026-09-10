#!/usr/bin/env bash
# Writes the release version into the root package.json, the single source of
# truth the release workflows read. Idempotent.
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
