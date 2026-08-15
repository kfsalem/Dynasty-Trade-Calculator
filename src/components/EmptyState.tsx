import type { ReactNode } from 'react';

/**
 * A surface with nothing in it yet — designed, rather than left as a sentence.
 *
 * An empty state is the *first* thing a new user sees on a tab, and it is the
 * only moment where they will read an explanation of what the tab is for. A
 * centred grey line of text spends that moment saying nothing; a panel with a
 * title, a reason and the next action spends it teaching.
 *
 * Dashed, not solid: a dashed outline is the established convention for "this
 * frame is real and its contents are not", and it keeps this visually distinct
 * from `.card`, which always holds something.
 */
interface Props {
  title: string;
  children: ReactNode;
  /** Optional next step. A state that can name an action should offer it. */
  action?: ReactNode;
}

export function EmptyState({ title, children, action }: Props) {
  return (
    <div className="rounded-xl border border-dashed border-line px-5 py-10 text-center">
      <p className="font-semibold">{title}</p>
      <div className="mx-auto mt-2 max-w-md text-sm text-muted">{children}</div>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
