#!/bin/sh
# Build the modules in an amd64 container (works on Apple Silicon).
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)

docker build --platform linux/amd64 -t velocloud-sdk -f "$HERE/Dockerfile" "$HERE"
docker run --rm --platform linux/amd64 \
	-v "$ROOT:/work" -w /work \
	velocloud-sdk /work/build/build.sh
