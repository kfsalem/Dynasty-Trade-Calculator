import { useEffect, useMemo, useState } from 'react';
import type { WeeklyPost } from '../engine/weeklyPost';
import { postImage } from '../lib/postImage';
import { postLines, postText } from '../lib/postText';
import { encodeLeague } from '../lib/share';

interface Props {
  post: WeeklyPost;
  leagueName: string;
  leagueId: string;
}

/**
 * Whether to hand the image to the share sheet rather than save it.
 *
 * On a phone the share sheet is where a post for the league chat wants to go.
 * Desktop Chrome on Windows can share files too, but there a file saved to
 * disk is what anyone expects, so the test is the pointer, the same rule the
 * app's density follows. Asked once, with a real file, because `canShare`
 * answers for the payload it is given.
 */
function canShareImages(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false;
  if (!window.matchMedia?.('(pointer: coarse)').matches) return false;
  try {
    return navigator.canShare({ files: [new File([''], 'post.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'league';

/**
 * The last finished week, written up for the league chat (#169).
 *
 * The preview is the post itself, so what a manager reads here is what the
 * chat gets: the text, the image and this all come from `postLines`. The
 * League tab's register applies: real results and the app's own grades, and
 * no predictions.
 */
export function WeeklyPostCard({ post, leagueName, leagueId }: Props) {
  const lines = useMemo(() => postLines(post, leagueName), [post, leagueName]);
  const url = `${window.location.origin}${window.location.pathname}${encodeLeague(leagueId)}`;
  const text = postText(lines, url);
  const [share] = useState(canShareImages);

  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (copied !== 'copied') return;
    const timer = setTimeout(() => setCopied('idle'), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const [image, setImage] = useState<'idle' | 'working' | 'failed'>('idle');

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('copied');
    } catch {
      setCopied('failed');
    }
  }

  async function makeImage() {
    setImage('working');
    try {
      const blob = await postImage(lines, url);
      const file = new File([blob], `${slug(leagueName)}-week-${post.week}.png`, { type: 'image/png' });
      if (share) {
        try {
          await navigator.share({ files: [file] });
        } catch (err) {
          // Closing the share sheet is a choice, not a failure.
          if (!(err instanceof DOMException && err.name === 'AbortError')) throw err;
        }
      } else {
        const href = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = href;
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
      }
      setImage('idle');
    } catch {
      setImage('failed');
    }
  }

  return (
    <section className="card" aria-labelledby="weekly-post-title">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-xl">
          <h3 id="weekly-post-title" className="font-display text-xl font-bold tracking-tight">
            Week {post.week}, for the league chat
          </h3>
          <p className="mt-1 text-sm text-muted">
            Every line is the league's own results or the app's own grades. None of it is a
            prediction.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={makeImage}
            disabled={image === 'working'}
            className="btn-primary text-sm disabled:cursor-wait disabled:opacity-60"
          >
            {image === 'working' ? 'Drawing…' : share ? 'Share image' : 'Save image'}
          </button>
          <button type="button" onClick={copy} className="btn-secondary text-sm">
            {copied === 'copied' ? 'Text copied' : 'Copy text'}
          </button>
        </div>
      </div>

      {image === 'failed' && (
        <p role="alert" className="mt-3 text-sm text-negative">
          The image couldn't be made in this browser. Copy the text instead.
        </p>
      )}
      {copied === 'failed' && (
        <textarea
          readOnly
          value={text}
          rows={8}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="The post's text, to copy by hand"
          className="mt-3 block w-full rounded-xl border border-control bg-surface p-3 text-xs text-muted"
        />
      )}

      <div className="mt-4 max-w-2xl rounded-xl border border-line bg-raised p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-subtle">{lines.rankingsNote}</p>
        <ol className="mt-2 space-y-1 text-sm" aria-label="Power rankings">
          {lines.rankings.map((row) => (
            <li key={`${row.rank}-${row.name}`} className="flex items-center gap-3">
              <span className="w-6 shrink-0 text-right font-semibold tabular text-subtle">{row.rank}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{row.name}</span>
              <span className="shrink-0 tabular text-muted">{row.record}</span>
              <span aria-hidden="true" className="hidden h-1.5 w-24 shrink-0 rounded-full bg-line sm:block">
                <span
                  className="block h-full rounded-full bg-muted"
                  style={{ width: `${Math.max(0, Math.min(100, row.index))}%` }}
                />
              </span>
              <span className="w-8 shrink-0 text-right font-semibold tabular">{row.index}</span>
            </li>
          ))}
        </ol>
        {lines.items.length > 0 && (
          <dl className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
            {lines.items.map((item, i) => (
              <div key={`${item.label}-${i}`}>
                <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">{item.label}</dt>
                <dd className="mt-0.5">{item.text}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  );
}
