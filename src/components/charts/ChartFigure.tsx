import { useId, type ReactNode } from 'react';

/**
 * The frame every chart in this app is drawn in.
 *
 * This component is the whole of what #16 means by "one chart language". It is
 * not styling — it is the three things a chart here is *obliged* to carry:
 *
 * 1. **A title**, always. A single-series chart gets no legend box, because the
 *    title already names what is plotted.
 * 2. **A legend, whenever there are two or more series.** Colour-matching is
 *    never the only identity channel.
 * 3. **A table view.** Note that `table` is a required prop and not an optional
 *    one. That is the enforcement mechanism: a chart cannot be added to this app
 *    without its WCAG-clean twin, so "every value is reachable without hovering"
 *    is guaranteed by the type checker rather than by remembering. A tooltip
 *    enhances; it never gates.
 */

export interface LegendItem {
  label: string;
  /**
   * Tailwind class painting the swatch. A class rather than a colour value,
   * deliberately — Tailwind 4 tree-shakes theme variables that no utility
   * references, and `docs/DESIGN-SYSTEM.md` §8 records two tokens that had
   * already gone that way and were resolving to the empty string at runtime.
   * Naming the utility keeps the token alive in the scanner's view.
   */
  swatch: string;
  /** Mirror the mark: a bar is a rect, a line is a line, a point is a dot. */
  shape?: 'rect' | 'line' | 'dot' | 'outline';
}

export interface ChartTable {
  columns: string[];
  /** Pre-formatted — the chart owns its own number formatting. */
  rows: (string | number)[][];
}

interface Props {
  title: string;
  /** The prose that explains what the reader is looking at. */
  description?: ReactNode;
  legend?: LegendItem[];
  table: ChartTable;
  /** Label on the table-view disclosure. */
  tableLabel?: string;
  children: ReactNode;
}

function LegendSwatch({ item }: { item: LegendItem }) {
  const shape = item.shape ?? 'rect';

  if (shape === 'line') {
    return <span className={`h-0.5 w-4 shrink-0 rounded-full ${item.swatch}`} aria-hidden="true" />;
  }
  if (shape === 'dot') {
    return <span className={`h-2 w-2 shrink-0 rounded-full ${item.swatch}`} aria-hidden="true" />;
  }
  if (shape === 'outline') {
    return (
      <span
        className={`h-2.5 w-3.5 shrink-0 rounded-xs border bg-transparent ${item.swatch}`}
        aria-hidden="true"
      />
    );
  }
  return <span className={`h-2.5 w-3.5 shrink-0 rounded-xs ${item.swatch}`} aria-hidden="true" />;
}

export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-xs text-muted">
          <LegendSwatch item={item} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export function ChartFigure({
  title,
  description,
  legend,
  table,
  tableLabel = 'Show the numbers',
  children,
}: Props) {
  const titleId = useId();

  return (
    <figure aria-labelledby={titleId} className="card mt-4">
      <h3 id={titleId} className="font-semibold">
        {title}
      </h3>
      {description && <p className="mt-1 text-sm text-subtle">{description}</p>}

      {/* A legend belongs to the chart, so it sits above the plot and below the
          prose — never floating inside the plot area competing with marks. */}
      {legend && legend.length > 1 && <ChartLegend items={legend} />}

      <div className="mt-4">{children}</div>

      {/*
        The table view is a disclosure rather than a toggle that swaps the chart
        out. Swapping hides the chart to show the numbers and hides the numbers
        to show the chart; a disclosure lets a reader who wants both have both,
        and lets a screen reader walk the table without any state to discover.
      */}
      <details className="group mt-4 border-t border-line pt-3">
        <summary className="cursor-pointer text-xs font-semibold text-muted hover:text-ink">
          {tableLabel}
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line">
                {table.columns.map((column, i) => (
                  <th
                    key={column}
                    scope="col"
                    className={`pb-1.5 font-semibold text-muted ${i === 0 ? '' : 'text-right'}`}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={String(row[0])} className="border-b border-line last:border-0">
                  {row.map((cell, i) => (
                    <td
                      key={table.columns[i] ?? i}
                      className={
                        i === 0
                          ? 'py-1.5 text-ink'
                          : 'tabular py-1.5 text-right text-muted'
                      }
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
