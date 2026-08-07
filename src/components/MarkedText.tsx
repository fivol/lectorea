import { useMemo, Fragment } from 'react';
import { matchRanges } from '@shared/search';

/**
 * A suggestion with the matched characters marked.
 *
 * Search here is forgiving — it swaps keyboard layouts, transliterates, matches
 * inside words — which means a hit often looks arbitrary: typing «ав» offers
 * «Право» and «Савватеев». Unmarked, that is indistinguishable from a bug.
 * Marked, it is obviously the same two letters both times.
 */
export default function MarkedText({ text, query }: { text: string; query: string }) {
  const parts = useMemo(() => {
    const ranges = matchRanges(text, query);
    if (!ranges.length) return null;

    const out: Array<{ text: string; hit: boolean }> = [];
    let at = 0;
    for (const [start, end] of ranges) {
      if (start > at) out.push({ text: text.slice(at, start), hit: false });
      out.push({ text: text.slice(start, end), hit: true });
      at = end;
    }
    if (at < text.length) out.push({ text: text.slice(at), hit: false });
    return out;
  }, [text, query]);

  if (!parts) return <>{text}</>;

  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>{part.hit ? <mark>{part.text}</mark> : part.text}</Fragment>
      ))}
    </>
  );
}
