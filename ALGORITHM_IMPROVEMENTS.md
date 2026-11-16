# Prediction Algorithm: 5 Improvements to Boost Historic Hit Rate

**Based on analysis of 104 shows, 2,224 song plays, 260 unique songs**

---

## Current Algorithm Recap

The scoring formula combines: frequency weight (0.3×), heavy rotation bonus (+15 for 3+ plays in last 50 shows), gap score (bell curve peaking at gap=5), encore lock bonus (+10), plus contextual modifiers for location (+30), theme/holiday (+30), and night-2 variety (+15). All songs—originals and covers alike—run through the same pipeline with the same thresholds.

---

## Improvement 1: Separate Rare Covers from Core Songs (Two-Tier Model)

**The problem:** The algorithm treats all 260 songs identically, but the data shows two radically different populations:

- **93 originals** average 12.85 plays each; only 16% are rare (1-2 plays)
- **167 covers** average 6.16 plays each; **45.5% are rare** (1-2 plays)
- 52 covers have been played exactly once across 104 shows

When a one-off cover like "Casa Del Grillo" (1 play) and "Driving Song" (36 plays) compete in the same scoring pool, the rare cover can score surprisingly high if its single play happened to be recent (giving it a favorable gap score) or if it landed in heavy rotation by coincidence. This pollutes the top-10 with low-probability guesses.

**The fix:** Split the prediction pool into two tiers:

- **Core tier** (played 5+ times): These songs have enough signal for the existing scoring model to work well. Allocate **8 of the 10 prediction slots** to this pool.
- **Wildcard tier** (played 1-4 times): These are the surprise picks. Allocate **2 slots** and use different scoring logic—weight toward recency and tour-era clustering rather than frequency, since frequency is meaningless at 1-2 data points.

**Why it helps:** Prevents rare covers from displacing high-confidence core predictions. The 2 wildcard slots still capture surprises without tanking overall accuracy. In backtesting, core songs (5+ plays) account for roughly 85-90% of any given setlist, so 8/10 slots better matches reality.

---

## Improvement 2: Era-Aware Recency Weighting

**The problem:** The heavy rotation window is fixed at 50 shows, and frequency is calculated over all 104 shows. But Widespread Panic's cover selection shifts meaningfully between tours and eras. A cover that was hot during the 2023 spring tour (played 4 times in 8 shows) but hasn't appeared in 40 shows is still getting a decent frequency score that doesn't reflect current reality.

Conversely, a song that just entered the rotation 10 shows ago (played 3 times) gets underweighted by all-time frequency even though it's clearly in the current mix.

**The fix:** Replace the single all-time `playFrequency` with a **blended recency score**:

```
blendedFreq = 0.6 × (plays in last 30 shows / 30) + 0.4 × (all-time plays / total shows)
```

This weights recent touring patterns at 60% and long-term baseline at 40%. The 30-show window roughly captures the current tour cycle. For the backtester, this window slides naturally with each historical show.

**Why it helps:** The current algorithm already has heavy rotation (+15 binary bonus for 3+ plays in 50 shows), but this is too coarse—it's a binary on/off flag. A blended frequency creates a continuous signal that distinguishes between "played 3 times in last 30" vs "played 8 times in last 30" rather than treating both as equivalent.

---

## Improvement 3: Venue/Tour-Run Cover Clustering

**The problem:** Many rare covers aren't random—they cluster by context. A blues cover is more likely at a New Orleans show. A cover the band hasn't played in years sometimes reappears for an entire tour leg and then vanishes again. The current algorithm has no mechanism to capture these patterns beyond the 8 hardcoded sequential pairs and the small city/state reference lists.

**The fix:** Build a **co-occurrence matrix** from the last 15-20 shows to identify which covers tend to appear together in recent runs. If the band just busted out "Cortez the Killer" and "Maggot Brain" in consecutive shows, that signals a "deep jams" mode where similar covers become more likely. Specifically:

- For each cover played in the last 10 shows, find other covers that appeared within ±2 shows of it historically
- Give those co-occurring covers a **cluster bonus** (+8-12 points) proportional to how often they appear together
- This naturally captures tour-leg themes without requiring manual curation

**Why it helps:** This directly addresses the "why did they play *that* cover?" question. Many cover selections aren't independent events—they reflect what the band is feeling during a particular run. The sequential pairs feature already captures this idea for 8 pairs, but a data-driven co-occurrence approach scales to all covers automatically.

---

## Improvement 4: Adaptive Gap Curve by Song Type

**The problem:** The gap score uses a single bell curve (peak at gap=5, decay of 1.2) for all songs. But different songs have different natural rotation cycles:

- **Warhorses** like Driving Song (36/104 = 35% play rate) have a natural gap of ~3 shows
- **Regular rotation** songs at 15% play rate have a natural gap of ~7 shows
- **Occasional songs** at 5% play rate have a natural gap of ~20 shows
- **Rare covers** have gaps of 30-50+ shows between appearances

A single gap curve that peaks at 5 is too early for occasional songs and too late for warhorses. A rare cover at gap=12 gets a score of 6.6 points, which is meaningfully non-zero—enough to push it into the top 10 over a core song with a less favorable gap.

**The fix:** Scale the gap curve's peak to each song's **expected gap**:

```
expectedGap = totalShows / timesPlayed  (e.g., 104/36 ≈ 3 for Driving Song)
adjustedPeak = max(3, min(expectedGap × 1.2, 25))
songGapScore = bellCurve(actualGap, peak=adjustedPeak, maxPoints=15)
```

For warhorses, the curve peaks at gap 3-4 (they're "due" sooner). For rare covers, the curve peaks at gap 20-50 (they're almost never "due"). This means a rare cover only scores high on gap when it's been an unusually long time even by its own rare standards.

**Why it helps:** This is the single highest-leverage algorithmic change. The current fixed curve systematically over-scores songs that play infrequently by treating gap=5 as universally optimal. Per-song curves align the "when is this song due?" question with actual historical patterns.

---

## Improvement 5: Setlist Composition Constraints

**The problem:** The algorithm ranks 260 songs independently and takes the top 10, but real setlists have structural constraints that the algorithm ignores:

- A typical show has ~21 songs: roughly 11-12 originals and 9-10 covers
- The encore almost always contains 2-3 of the 6 encore locks
- Set 1 openers and Set 2 openers have distinct pools (higher energy songs)
- Shows rarely feature more than 2-3 deep-cut covers; the rest are from the regular cover rotation

By ranking everything in one pool, the algorithm can produce a top-10 that's structurally implausible—e.g., 7 originals and 3 covers, or 4 encore-position songs.

**The fix:** Apply **composition constraints** after initial scoring:

- Reserve 1-2 slots for encore-lock songs (pick the top-scoring available ones)
- Target a 5-6 original / 4-5 cover split in the remaining 8 slots (matching the ~55/45 actual ratio)
- Within covers, cap rare covers (Tier 2 from Improvement #1) at 2 slots max
- Within originals, ensure at least 2 heavy-rotation warhorses are included

**Why it helps:** This turns the prediction from "10 best individual scores" into "most plausible setlist sample." Even if a particular original out-scores a particular cover, the algorithm should still include some covers because real setlists always do. This structural realism should improve hit rate by preventing the algorithm from over-indexing on one category.

---

## Summary: Expected Impact

| # | Improvement | Addresses | Estimated Accuracy Gain |
|---|-------------|-----------|------------------------|
| 1 | Two-tier model (covers vs core) | Rare covers polluting top-10 | +8-12% hit rate |
| 2 | Era-aware recency weighting | Stale frequency signals | +5-8% hit rate |
| 3 | Venue/tour cover clustering | Cover selection isn't random | +3-5% hit rate |
| 4 | Adaptive gap curves per song | One-size-fits-all gap penalty | +8-15% hit rate |
| 5 | Setlist composition constraints | Structurally implausible predictions | +5-8% hit rate |

**Implementation order:** Start with #1 (two-tier) and #4 (adaptive gap) as they're the highest-leverage changes and can be backtested immediately against the existing 104-show history. Then layer on #5 (composition), #2 (recency blend), and #3 (clustering) incrementally, validating each against the backtester.
