# Knapsack Reasoning Trainer

An adaptive cognitive-training tool built around the classic [0-1 Knapsack Problem](https://en.wikipedia.org/wiki/Knapsack_problem): pick the subset of items that maximizes total value without exceeding a weight capacity.

Live app: https://knapsack-reasoning.netlify.app/

## Why a knapsack, not another n-back clone

The knapsack problem is NP-complete: there is no known efficient, universal algorithm that solves every instance the same way. That forces a real cognitive shift — a static strategy that works on one instance (e.g. "always take the best value-per-weight item first") silently stops working on the next, so the brain has to keep re-evaluating and switching problem-solving heuristics rather than executing one memorized routine faster.

This aligns with **Network Neuroscience Theory (NNT)**, a model of intelligence that complements P-FIT (the fronto-parietal integration model behind traditional tasks like n-back and RRT). NNT holds that intelligence emerges from distributed processing across specialized brain networks coordinated by "modal control" regions — and the constant heuristic-shifting a knapsack instance demands targets exactly that coordination mechanism.

An fMRI study mapped brain activity during 0-1 knapsack solving and found a direct link between an instance's computational complexity and dynamic changes in activation and connectivity in the anterior insula, dorsal anterior cingulate cortex (dACC), and intraparietal sulcus/angular gyrus — regions associated with cognitive control and integration. As problem difficulty increases, the brain's network architecture measurably shifts gears in real time (Franco, Bossaerts & Murawski, *The neural dynamics associated with computational complexity*, PLOS Computational Biology, 2024; building on the phase-transition framework in Yadav & Bossaerts).

The design goal of this trainer follows directly from that research: **difficulty should track computational complexity, not just "more objects on screen,"** and the generator should keep forcing a strategy the player already trusts to fail, rather than let them settle into one heuristic and coast.

## Modes

- **Adaptive** — a transformed up-down staircase (Levitt, 1971) drives a single difficulty scalar: two correct solutions in a row move it up one step, one failure moves it down one step, with the step size halved on every reversal. This converges to the difficulty level where you succeed roughly 70.7% of the time, without any hand-tuned per-player calibration. There is no ceiling — the scalar can climb indefinitely for players who keep succeeding. Your level is saved locally and resumed on your next session.
- **Advanced** — every generation parameter is exposed directly (item count, weight/value ranges, capacity ratio, correlation type, correlation tightness, greedy-trap strength). A "seed from difficulty" control fills every field from a chosen difficulty number using the exact same formulas adaptive mode runs, so it's a strict superset: pin a difficulty, then hand-tune anything from there.

## How difficulty is actually constructed

Difficulty is not one lever — scalar item-count growth alone turns out to make a naive value/weight-ratio greedy strategy *more* reliable, not less (see below), so the engine layers several independent, literature-grounded mechanisms instead of just "bigger":

1. **Item count and value/weight spread** scale with the difficulty scalar, but item count is capped well below the point where it would start rescuing a greedy strategy (see "what didn't work"); spread keeps growing freely since it has no measured effect on solvability.
2. **Capacity ratio** is pulled toward 50% of total item weight as difficulty rises — the knapsack "phase transition" (Pisinger, 2005) where instances are hardest because many competing item combinations look plausible.
3. **Correlation type** controls how tightly an item's value tracks its weight — this is the actual lever that breaks a ratio-based greedy strategy, since a useful value/weight ranking degrades as weight and value become tied together. Four regimes, unlocked cumulatively (earlier ones stay in the mix) as difficulty rises:
   - *Uncorrelated* — value and weight are independent; bargains stand out and greedy ranking works well.
   - *Weakly correlated* — value roughly tracks weight with noise; fewer obvious bargains.
   - *Strongly correlated* — value is weight plus a near-constant offset; ratios cluster, so ranking stops discriminating and you have to reason in combinations.
   - *Subset-sum-like* — the tightest member of the correlated family (not literal `value = weight`, which turns out to be *easier* on average — see below). Ratios are nearly tied; the task collapses toward "fill the capacity as exactly as possible."

   Which unlocked regime comes up each round is drawn from a shuffled bag that never repeats the same type twice in a row, so the difficulty scalar converging to one stable value can't leave a player training one heuristic forever.

4. **Correlation tightness** is a continuous 0-1 knob (driven by difficulty) controlling how close the weakly/strongly/subset-sum-like offsets are to zero. It keeps tightening well past difficulty 100 instead of freezing at a fixed "hardest" shape.
5. **Greedy trap** is a deterministic construction layered on top of any correlation type, not a statistical one: one "decoy" item sits at the best value/weight ratio in the instance but wastes a chunk of capacity, while a separate two-item combination tiles the capacity exactly at a slightly lower ratio for a guaranteed-higher total value. A ratio-sorting strategy always takes the decoy; the true optimum always takes the combination. The guaranteed gap grows asymptotically (never reaching a hard ceiling) as difficulty increases, so the engine keeps giving skilled players further headroom instead of plateauing.
6. **A second, independent capacity constraint** (shown in-game as "Volume") unlocks past difficulty 75 — empirically, single-constraint instances are already meaningfully hard by around difficulty 50, so the second axis of hardness starts soon after rather than being held back for elite-tier play only. Tightness and the trap are still one algorithmic axis — how informative a value/weight ratio is; a second constraint is a different axis entirely, since no single ratio can rank items once two independent capacities compete. This tracks the multidimensional-knapsack operations-research literature (a documented jump in difficulty passing from 1 to 2+ constraints, requiring different solution machinery than 1D DP) and the multi-attribute decision-making literature (a distinct vmPFC/OFC/ACC/DLPFC integration process versus single-value comparison). Measured: a strategy that only ranks by the first dimension's ratio — the one every other lever trains — drops from ~50% success at unlock to 2-4% within a few hundred difficulty points and holds there. Once both the trap and the second dimension are unlocked (past difficulty 350), each round uses exactly one (a coin flip) rather than both — combined on the same instance they were measured to interfere and produce misleadingly easy rounds.

### What didn't work (kept here because it shaped the design)

- Letting item count grow without bound to raise difficulty backfired: measured against the exact DP solver, a naive value/weight-ratio greedy strategy's success rate climbed *toward 100%* as item count grew, regardless of correlation type — more items let a simple ranking-and-fill approach converge on a near-optimal packing by sheer combinatorics. Item count is now capped, and difficulty growth is redirected into correlation tightness and the deterministic trap instead.
- Literal `value = weight` (textbook subset-sum) measured *easier* for a greedy strategy than a tight-but-nonzero offset, matching the literature finding that random subset-sum instances are easy on average — a small deliberate offset resists ranking better than a dead tie.
- An early "spanner" instance construction (Pisinger, 2005) — replicating a small base set of items via integer multipliers — measurably made a ranking strategy's job *easier*, not harder, because scaling both weight and value by the same multiplier preserves the ratio. It's a real technique for defeating exact branch-and-bound solvers, not necessarily a ranking heuristic, and isn't used here for that reason.
- Combining the greedy trap with the second capacity dimension on the same instance: the trap's decoy/combo weights are tuned against a single capacity, so adding an independent second one lets a naive strategy accidentally dodge or violate it, measured to produce an anomalous 100% success rate rather than a harder one. They're now mutually exclusive per round.

## Development

```
npm install
npm run dev      # local dev server
npm run build    # type-check + production build
npm run lint      # oxlint
```

Built with React + TypeScript + Vite. No backend — instance generation, the exact DP solver, and the adaptive staircase all run client-side; the only persisted state is the saved adaptive difficulty level (`localStorage`).

Built with the support of the [Mindbuilding community](https://discord.gg/jjzA5m5UjN).
