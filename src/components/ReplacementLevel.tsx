/**
 * The one idea this app is built on, taught in one screen.
 *
 * It sits on the first-run view because that is the only screen a new user
 * reads rather than scans, and because the idea has to land *before* the
 * numbers do. Someone who arrives knowing KTC and sees a quarterback priced at
 * 500 concludes the calculator is broken. The same person, having read this,
 * concludes their league is deep at quarterback — which is the actual finding,
 * and the reason to be here rather than on a site that quotes one number for
 * every league on earth.
 *
 * Type and scale carry it, not a chart. The register is "loud with type,
 * disciplined with hue" (docs/DESIGN-SYSTEM.md §3), and a three-row subtraction
 * set in large tabular figures *is* the explanation — drawing it as bars would
 * add a legend and an axis to an idea that is one arithmetic operation.
 */

/** One line of the sum. `emphasis` is the answer; the rest are its inputs. */
function Row({
  label,
  value,
  note,
  emphasis,
}: {
  label: string;
  value: string;
  note: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 py-2 ${
        emphasis ? 'border-t border-line pt-3' : ''
      }`}
    >
      <div className="min-w-0">
        <dt className={`text-sm ${emphasis ? 'font-semibold text-ink' : 'text-muted'}`}>
          {label}
        </dt>
        <dd className="mt-0.5 text-xs text-subtle">{note}</dd>
      </div>
      <dd
        className={`tabular shrink-0 font-bold ${
          emphasis ? 'text-3xl text-accent' : 'text-2xl text-subtle'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

export function ReplacementLevel() {
  return (
    <section className="card mt-8" aria-labelledby="replacement-level-heading">
      <h2 id="replacement-level-heading" className="font-semibold">
        Why a player is worth less here than on KTC
      </h2>
      <p className="mt-2 text-sm text-muted">
        Every other calculator prices a player against the whole of fantasy football.
        This one prices him against the man who would start in his place{' '}
        <em>on your roster, in your league</em> — because that is what you actually
        gain by trading for him.
      </p>

      <dl className="mt-4">
        <Row
          label="What the market pays for him"
          note="The number you'd see anywhere else"
          value="2,400"
        />
        {/*
          The minus is load-bearing. Without it the three rows read as three
          unrelated figures and the reader has to work out that the third is the
          first two subtracted — which is the entire idea being taught. A real
          minus sign (U+2212), not a hyphen, so it aligns with the digits.
        */}
        <Row
          label="What you'd otherwise start"
          note="Your next-best option at that position, already on your roster"
          value="− 1,900"
        />
        <Row
          label="What he adds to your lineup"
          note="The number this app trades on"
          value="= 500"
          emphasis
        />
      </dl>

      {/*
        The payoff sentence. Without it the example reads as "this app returns
        smaller numbers", which is a downgrade; with it, the smaller number is
        the *point* — the same player is genuinely worth different amounts in
        two leagues, and only a calculator that has read your league can say so.
      */}
      <p className="mt-4 border-t border-line pt-4 text-sm text-muted">
        Move that quarterback to a superflex league and the man he replaces is far
        worse, so the gap — and his price here — grows. Same player, different league,
        different number. That is why this asks for your league id.
      </p>
    </section>
  );
}
