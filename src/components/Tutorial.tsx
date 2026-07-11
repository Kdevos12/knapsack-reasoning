import './Tutorial.css';

function Tutorial() {
  return (
    <div className="tutorial">
      <h2>How to play</h2>

      <section className="tutorial-card">
        <h3>The goal</h3>
        <p>
          You have a knapsack with a limited <strong>capacity</strong> and a set of items, each with a{' '}
          <strong>value</strong> (v) and a <strong>weight</strong> (w). Select the combination of items that
          maximises total value without exceeding the capacity. Click a tile to add or remove it, then press{' '}
          <strong>Submit</strong>. A solution within 95% of the true optimum counts as a success.
        </p>
      </section>

      <section className="tutorial-card">
        <h3>Reading the tiles</h3>
        <ul>
          <li><strong>Bigger square = heavier item.</strong> Size mirrors weight, so bulk is visible at a glance.</li>
          <li><strong>Deeper blue = more valuable item.</strong> Colour intensity mirrors value.</li>
          <li>The exact numbers are always shown: <strong>v:</strong> value (large) and <strong>w:</strong> weight (small pill).</li>
          <li>Selected items turn <strong>green</strong>. The weight gauge in the header turns red if you exceed capacity.</li>
        </ul>
      </section>

      <section className="tutorial-card">
        <h3>Modes</h3>
        <ul>
          <li>
            <strong>Training</strong> — fixed difficulty you pick with a slider (0–100). Good for practising at a
            steady level.
          </li>
          <li>
            <strong>Adaptive</strong> — the difficulty adjusts itself: two successes in a row move it up one step, one
            failure moves it down one step. Over a session it settles at the level where you succeed about 70% of the
            time — the sweet spot for training. Your level is saved between sessions.
          </li>
          <li>
            <strong>Advanced</strong> — you set every generation parameter manually (details below).
          </li>
        </ul>
      </section>

      <section className="tutorial-card">
        <h3>Advanced mode parameters</h3>
        <dl>
          <dt>Number of items</dt>
          <dd>
            More items = a much larger search space (each item doubles the number of possible combinations) and a
            heavier working-memory load.
          </dd>

          <dt>Weight min / max</dt>
          <dd>
            The range weights are drawn from. A wide range creates diverse packing options; a narrow range makes items
            interchangeable and comparisons subtler.
          </dd>

          <dt>Value min / max</dt>
          <dd>The range values are drawn from. Same logic as weights, applied to what you are maximising.</dd>

          <dt>Capacity (% of total weight)</dt>
          <dd>
            The knapsack capacity as a share of the summed item weights. Around <strong>50%</strong> sits at the
            "phase transition" where knapsack problems are hardest: about half the items fit, so many competing
            combinations look plausible. Higher percentages (60–70%) are more forgiving.
          </dd>

          <dt>Weight/value correlation</dt>
          <dd>
            How value relates to weight, ordered from easiest to hardest:
            <ul>
              <li><strong>Uncorrelated</strong> — value and weight are independent. Bargains (light + valuable) stand out, so greedy picking works well.</li>
              <li><strong>Weakly correlated</strong> — value roughly tracks weight with some noise. Fewer obvious bargains.</li>
              <li><strong>Strongly correlated</strong> — value is weight plus a constant. Every item has a similar ratio, so the greedy shortcut stops discriminating and you must think in combinations.</li>
              <li><strong>Subset sum</strong> — value equals weight. Ratios are all identical; the task reduces to filling the capacity exactly, a pure combinatorial puzzle.</li>
            </ul>
          </dd>

          <dt>Time limit</dt>
          <dd>
            Optional seconds per round. Short limits (&lt;30s) force fast, intuitive decisions; long limits (&gt;90s)
            allow deliberate search. No limit removes time pressure entirely.
          </dd>
        </dl>
      </section>

      <section className="tutorial-card">
        <h3>Feedback and scoring</h3>
        <p>
          After each submission you see how close your solution was to the optimum (as a percentage). Optimality
          feedback is deliberately hidden <em>while</em> you solve — showing it live would let you tune your selection
          against the meter instead of reasoning about the trade-offs.
        </p>
      </section>
    </div>
  );
}

export default Tutorial;
