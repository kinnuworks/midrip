#!/usr/bin/env bash
# The checks that prove this project works: tests, typecheck, and the end-to-end script
# that walks the demo path in a real browser against the real API, recording a screen
# video of it. Exits non-zero when anything fails.
#
# Keep it fast enough to run often (a few minutes at most), stop any server it starts
# before it exits, and never make a check pass by skipping, weakening or special-casing it.
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p .kit/logs
echo "== program unit tests (draw, EV of the sealed rest, clock price, commitment)"
cargo test -q -p midrip --lib > .kit/logs/check-unit.log 2>&1 || { tail -30 .kit/logs/check-unit.log; exit 1; }
grep -E "test result" .kit/logs/check-unit.log | tail -1

echo "== client typecheck and build"
(cd app && npx tsc -b && npm run -s build) > .kit/logs/check-build.log 2>&1 || { tail -30 .kit/logs/check-build.log; exit 1; }

echo "== devnet end to end on MagicBlock's private rollup (open, VRF draw, reveal, clock sale, verify, settle, privacy checks)"
(cd app && node scripts/e2e.mjs) > .kit/logs/check-e2e.log 2>&1 || { tail -30 .kit/logs/check-e2e.log; exit 1; }
run=$(ls -t evidence/runs/e2e-*.json | head -1)
python3 - "$run" <<'PY'
import json, sys
c = json.load(open(sys.argv[1]))["checks"]
fails = []
if not c["verify"]["ok"]: fails.append("pack did not verify against its commitment")
if not c["salePriceMatchesClock"]: fails.append("sale price differs from the clock price")
if not c["evRestMatches"]: fails.append("on-chain EV of the sealed rest differs from the client's")
if c["sealedReadStranger"] != "null": fails.append("a stranger could read the sealed pack: " + c["sealedReadStranger"])
if c.get("strangerPredictedCorrectly"): fails.append("a stranger rebuilt the pack from visible transactions")
if not c.get("claimsOk"): fails.append("withdrawn cards were not minted as SPL tokens on Solana: " + str(c.get("claims")))
print("e2e", sys.argv[1], "vrf callback ms", c["vrfCallbackMs"], "sale", c["sale"])
if fails:
    print("FAIL:", "; ".join(fails)); sys.exit(1)
PY

echo "== demo path in a real browser (join, open, rip, list, clock falls, peek refused, bot buys, verify), recorded"
(cd app && npx playwright test --reporter=line) > .kit/logs/check-browser.log 2>&1 || { tail -40 .kit/logs/check-browser.log; exit 1; }
tail -2 .kit/logs/check-browser.log | head -1
vid=$(ls -t .kit/e2e-results/*/video.webm 2>/dev/null | head -1)
[ -n "$vid" ] && mkdir -p .kit/rough-cut && cp "$vid" .kit/rough-cut/demo-path-latest.webm

# Evidence labels: once evidence/EVAL_PLAN.md exists, the public text (README, submission text,
# video script) must label every evidence claim for its kind.
if [ -f evidence/EVAL_PLAN.md ] && [ -f evidence_lint.py ]; then
  python3 -I evidence_lint.py
fi

echo "check.sh: all checks passed"
