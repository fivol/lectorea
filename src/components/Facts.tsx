import type { ReactNode } from 'react';
import Icon, { type IconName } from './Icon';
import Tooltip from './Tooltip';

/**
 * The three ways this product prints a fact about something.
 *
 * They exist because the obvious fourth way — a column of «характеристика ·
 * значение» lines — is the one that reads worst. Eight of them in a row is a
 * table with the rules taken out: every line the same weight, the eye walking
 * left to right eight times to find the one number it came for, and no way to
 * tell a count from a category from a share of an audience.
 *
 * So a fact is printed as what kind of fact it is:
 *
 * | Kind | Shape | Example |
 * |---|---|---|
 * | a number that is the point | `FactTile` — glyph, number, caption under it | 26 лекций, 3.7 ч |
 * | a category, one of a few | a `Chip` — the word itself, nothing beside it | «Разная длина», «фрагмент» |
 * | a number against other numbers | `Meter` — glyph, name, number, a bar | просмотры, лайки |
 *
 * The rule of thumb is what the reader does with it. A count is compared with
 * their own time, so it is set large and left alone. A category is compared
 * with nothing — it is a word, and a word laid out as a value in a table is a
 * word pretending to be data. A view count means nothing at all on its own, so
 * it never appears without the scale it is being read against.
 */

/**
 * One number, set large, with the glyph and the word that say what it is.
 *
 * The number leads and the name follows it, which is the opposite of the table
 * this replaced: «лекций 26» is read in the order it was stored, «26 / лекций»
 * in the order it is wanted. The caption is small and quiet on purpose — after
 * the first look it is the number that is being checked, not the label.
 */
export function FactTile({
  icon,
  value,
  label,
  hint,
}: {
  icon: IconName;
  value: string;
  label: string;
  /** What the tile means, where the caption alone cannot carry it. */
  hint?: ReactNode;
}) {
  const tile = (
    <div className={`inlay min-w-0 px-2 py-2 text-center ${hint ? 'cursor-help' : ''}`}>
      <Icon name={icon} size={13} className="ink-soft mx-auto" />
      <p className="num mt-1 truncate text-sm font-medium leading-tight text-ink">{value}</p>
      {/* The caption wraps where the number truncates. A tile is a quarter of a
          sidebar wide, «средняя лекция» does not fit across it in any language
          this is translated into, and a clipped caption is a caption that has
          to be guessed — while the number it belongs to is four characters and
          never near the edge. The tiles are grid items, so the taller caption
          simply makes all three boxes the same taller height. */}
      <p className="ink-soft mt-0.5 text-[11px] leading-tight">{label}</p>
    </div>
  );

  return hint ? <Tooltip content={hint}>{tile}</Tooltip> : tile;
}

/**
 * The row of tiles.
 *
 * `auto-fit` rather than a fixed three: this lands in a sidebar on the desktop
 * and across the width of a phone, and the same three tiles have to be three
 * narrow ones in the first case without becoming three stretched ones in the
 * second. Below the minimum they wrap to two rather than squeezing the digits
 * out of the numbers.
 */
export function FactTiles({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`grid grid-cols-[repeat(auto-fit,minmax(4.5rem,1fr))] gap-1.5 ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * A number that only means something next to other numbers, and the bar that
 * puts it there.
 *
 * The bar is a relative scale — likes and comments are shown against what a
 * playlist of this size usually gets, not against the raw number — so it has
 * to say so, or it reads as a percentage of something.
 *
 * Name and number sit on their own line above the bar: side by side they need
 * three fixed widths to stay aligned, and the sidebar is not a fixed width. The
 * glyph is in front of the name rather than in place of it — an eye is found
 * without reading, and «просмотры» is still there for whoever has not met the
 * glyph before.
 */
export function Meter({
  icon,
  label,
  value,
  fraction,
  hint,
  /** The one bar here that is a real share of a real whole gets the accent. */
  tone = 'formal',
}: {
  icon: IconName;
  label: string;
  value: string;
  fraction: number;
  hint: ReactNode;
  tone?: 'formal' | 'accent';
}) {
  // A sliver rather than nothing at the bottom of the scale: an empty track is
  // indistinguishable from a bar that failed to draw.
  const width = Math.max(4, Math.min(100, fraction * 100));
  return (
    <Tooltip content={hint}>
      <div className="cursor-help">
        <div className="ink-soft flex items-center gap-1.5 text-xs">
          <Icon name={icon} size={13} />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <span className="num shrink-0 text-ink">{value}</span>
        </div>
        <span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-2">
          <span
            className={`block h-full rounded-full ${tone === 'accent' ? 'bg-accent' : 'bg-formal'}`}
            style={{ width: `${width}%` }}
          />
        </span>
      </div>
    </Tooltip>
  );
}
