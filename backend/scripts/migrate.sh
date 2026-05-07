#!/usr/bin/env bash
# One-off migration runner — call from a single deploy step (e.g. Railway pre-deploy
# or `railway run`), NOT from per-replica startup. The Dockerfile CMD still runs
# `alembic upgrade head` as a fallback for single-replica deploys, but for
# multi-replica deploys you should invoke this script once and remove the
# alembic step from CMD to prevent races.
set -euo pipefail
cd "$(dirname "$0")/.."
exec alembic upgrade head
