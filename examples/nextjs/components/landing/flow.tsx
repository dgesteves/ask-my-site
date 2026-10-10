/**
 * How it works, as an HTML diagram: the build-time lane writes the index file, and the
 * request-time function directly below it loads it. Text stays text, so it reads and scales.
 */
export function Flow() {
  return (
    <figure className="flow" aria-label="How ondocs works, at build time and per question">
      <p className="flow-lane-label flow-lane-build">
        <span>Build time</span> once per deploy
      </p>
      <div className="flow-node flow-cli" data-arrow="right">
        <span className="flow-kicker">CLI or framework plugin</span>
        <span className="flow-title">
          <code>ondocs index</code>
        </span>
        <span className="flow-note">
          Reads your Markdown, MDX or built HTML. Splits it at every heading, embeds each chunk and
          quantizes the vectors to int8.
        </span>
      </div>
      <div className="flow-node flow-file" data-arrow="down">
        <span className="flow-kicker">Static file</span>
        <span className="flow-title">
          <code>ask-index.json</code>
        </span>
        <span className="flow-note">1.6 MB per 1,000 chunks, deployed with the site.</span>
      </div>
      <p className="flow-aside">
        Rebuilt on every deploy, re-embedding only the chunks whose text changed.{' '}
        <code>--check</code> fails CI when a committed index is stale.
      </p>

      <p className="flow-lane-label flow-lane-request">
        <span>Request time</span> per question
      </p>
      <div className="flow-node flow-question" data-arrow="right">
        <span className="flow-kicker">Visitor</span>
        <span className="flow-title">Asks a question</span>
        <span className="flow-note">In the dialog, or your own UI with useAsk.</span>
      </div>
      <div className="flow-node flow-search" data-arrow="right">
        <span className="flow-kicker">Your function</span>
        <span className="flow-title">Hybrid search in memory</span>
        <span className="flow-note">BM25 and int8 cosine, fused with reciprocal rank fusion.</span>
      </div>
      <div className="flow-node flow-gate" data-arrow="right">
        <span className="flow-kicker">Relevance gate</span>
        <span className="flow-title">Anything relevant?</span>
        <span className="flow-note">Cosine ≥&nbsp;0.25, or keyword coverage ≥&nbsp;0.5.</span>
      </div>
      <div className="flow-outcomes">
        <div className="flow-node flow-answer">
          <span className="flow-kicker">Yes</span>
          <span className="flow-title">
            Streamed answer, cited <span className="flow-cite">1</span>
            <span className="flow-cite">2</span>
          </span>
          <span className="flow-note">Written by your model, from the sources only.</span>
        </div>
        <div className="flow-node flow-refusal">
          <span className="flow-kicker">No</span>
          <span className="flow-title">“I don’t know”</span>
          <span className="flow-note">Streamed at once. The model is never called.</span>
        </div>
      </div>
    </figure>
  );
}
