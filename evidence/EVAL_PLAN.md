# Evaluation plan

This plan is written and committed before any evaluation run. The commit hash and time of this file show that the question, the data, the baseline and the success rule were fixed before any result existed. If something has to change after a run, the change goes under "Changes after the first run" with its reason, and the original lines stay as they were.

There are no real users in this evaluation. Nobody was recruited, messaged or contacted for it, and our own traffic counts as testing, never as usage.

## Question
Across packs opened on Solana devnet from wallets we control, does every card draw verify against its MagicBlock VRF output and the pack commitment posted before the first sale, do rarity frequencies fit the odds table published before purchase, and what payout rate do players get compared with the 94.2% Bitquery measured for Collector Crypt?

## Metric and threshold
- Metric 1 (verification): k of n packs whose every draw, recomputed by the public verifier from the VRF randomness and the published odds table, matches the cards revealed and the commitment hash posted on Solana before the first sale.
- Metric 2 (odds fit): chi-squared goodness of fit of observed rarity counts over all draws against the published odds table; plus the share of the rarest tier with its interval.
- Metric 3 (payout rate): total table value of cards received divided by total pack price paid, over n packs (bootstrap mean).
- Metric 4 (speed): median ms from sending a reveal on the Ephemeral Rollup to the revealed card being readable, and rollup slots per second, against Solana's ~400 ms slot.
- Threshold: Metric 1: n of n packs verify (any failure is reported as a defect). Metric 2: p > 0.01. Metric 3: the published design payout rate lies inside the 95% interval. Metric 4: reported as measured, no threshold.
- Interval: 95%, from `python3 evidence/interval.py` (Wilson for k of n, bootstrap for a mean or a difference)

## Data
- Dataset: our own packs opened on Solana devnet from wallets we control (addresses listed in the README), read back from devnet and the rollup with the verifier script; Collector Crypt baseline from Bitquery's public investigation (https://bitquery.io/investigations/collector-crypt-jupiter-gacha).
- Version or hash: program ID and commit recorded at the run; the list of pack accounts saved as evidence/packs.json with its SHA-256.
- Split: packs opened while building are excluded; the test set is packs opened by the one-command rerun after the program is frozen for the run (fresh seeds).

## Baseline
- Whose: Bitquery, Collector Crypt: "players got back 94.2 percent of what they spent" (data Dec 7 2025 to Jul 13 2026). Speed: Solana base layer ~400 ms slots (MagicBlock founders, arXiv 2311.02650).

## Success rule
Success: every test pack verifies (Metric 1 n of n), odds fit p > 0.01 (Metric 2), and the design payout rate is inside the measured 95% interval (Metric 3). We claim a payout rate above 94.2% only if the low end of the interval is above 94.2%.

## Models and seeds
- Models: none.
- Seeds: randomness comes from MagicBlock VRF; client seeds 1..n per pack, recorded in evidence/packs.json.

## How results are reported
Every result names its kind at first mention, gives n, the source, the period and a 95% interval, and links its rerun command and commit. Measured numbers and estimates are kept apart, and failures are shown next to successes.

| Kind | Label at first mention | Travels with the number | Never used for this kind |
|---|---|---|---|
| Replay on public data | Back-test on public data (<dataset>, <years>) | n records, source and licence, period, whose baseline, 95% interval, rerun command and commit | `users`, `patients helped`, `customers`, `pilot`, `deployed with`, `proven`, `clinically validated` |
| Estimate from a replay | Estimate, not an observed result | the assumptions, and the data fields used to price it | `impact achieved`, `saved X hours for users`, `lives saved` |
| Real public system | Test transactions from wallets we control (addresses listed), or replayed in our own forks | counts, links, addresses | `users`, `volume`, `traction` |
| Break test | Our own break test (we tried to make it fail) | what we tried, how many attempts, what broke and what we fixed | `users`, `testers`, `validated` |

The README and the submission text open their evidence section with one line before any number:

> Evidence, stated plainly: no real users yet; it was built for this hackathon. Instead: <a back-test on <dataset> against <published baseline>>, <test transactions from wallets we control>, <our own break test of <the main claim>>. Each one reruns from the repo with one command.

Then one card per claim:

> Claim: <product> <does k of n <cases>> at <budget>.
> Evidence type: <label from the table above>, not real users.
> Data: <dataset, link, licence>, <period>, <n rows>. Baseline: <source> scores <x> on the same split.
> Result: <y> (95% interval <a> to <b>).
> Rerun: `<command>` at commit <hash>. Limits: <historical data, no live behaviour; any specific skew>.

Then a short limits paragraph, in numbers: zero real users, the interval, the data's years, and the next real test, with the metric and threshold that would change the conclusion.

## Changes after the first run
<None yet. Each change: the date, what changed, and why.>
