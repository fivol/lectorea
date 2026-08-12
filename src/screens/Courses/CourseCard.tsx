import { memo } from 'react';
import { Link } from 'react-router-dom';
import type { BuiltCourse, BuiltDomain } from '@shared/schema';
import { useT } from '@/i18n';
import { inkOn, withAlpha } from '@/lib/format';
import { CARD_ART_HEIGHT, CARD_HEIGHT, CARD_WIDTH } from '@/lib/layout';
import { EMPHASIS_OPACITY, type Emphasis } from '@/lib/highlight';
import { domainHref, useCatalogParams } from '@/lib/url';
import { useResolvedTheme } from '@/store/profile';
import { useUi } from '@/store/ui';
import CourseArt from '@/components/CourseArt';
import DomainIcon from '@/components/DomainIcon';
import Icon from '@/components/Icon';
import Tooltip from '@/components/Tooltip';
import { FavoriteMark, StatusMark } from './CourseMarks';
import type { CourseStatus } from '@shared/schema';

type Props = {
  course: BuiltCourse;
  domain: BuiltDomain | undefined;
  emphasis: Emphasis;
  /** Cascade delay in ms — zero when reduced motion is requested. */
  delay: number;
  selected: boolean;
  /** In the chain of the selected course: a weaker relative of `selected`. */
  inPath: boolean;
  /** From outside the current filter, here only while it is being read. */
  guest: boolean;
  /** Set for one pulse after the card has been scrolled to. */
  pulsing: boolean;
  status: CourseStatus | null;
  favorite: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
};

function CourseCardInner({
  course,
  domain,
  emphasis,
  delay,
  selected,
  inPath,
  guest,
  pulsing,
  status,
  favorite,
  onSelect,
  onHover,
}: Props) {
  const { t } = useT();
  const scheme = useResolvedTheme();
  // The border is the domain's colour at 45 % — pale hues picked for the dark
  // canvas vanish at that strength on a white card, so it deepens with the theme.
  const colour = inkOn(domain?.color ?? '#4CC9F0', scheme);
  const opacity = EMPHASIS_OPACITY[emphasis];
  const muted = emphasis === 'muted';
  const empty = course.playlistCount === 0;

  const accent = emphasis === 'downstream' ? 'var(--c-accent)' : colour;

  return (
    /*
     * The card is a button, and the field tag on a guest card is a link — one
     * cannot sit inside the other, in markup or for anyone reading with a
     * keyboard. So the geometry, the dimming and the hover lift belong to this
     * wrapper: both parts then move and fade as one card rather than the tag
     * staying behind while the card grows under the pointer.
     */
    <div
      data-course={course.id}
      className={`relative shrink-0 transition-[opacity,transform,filter] duration-base ease-inout
                  hover:z-10 hover:scale-[1.03] motion-reduce:hover:scale-100
                  ${selected ? 'z-10' : ''}`}
      style={{
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        opacity,
        // Colour is the loudest thing on a card; draining it says "not in this
        // chain" without having to take the card's legibility with it.
        filter: muted ? 'grayscale(0.6)' : undefined,
        transitionDelay: `${delay}ms`,
      }}
    >
    <button
      type="button"
      onClick={() => onSelect(course.id)}
      onPointerEnter={() => onHover(course.id)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(course.id)}
      onBlur={() => onHover(null)}
      // `aria-current`, not `aria-selected`: the latter is only valid inside a
      // listbox or a grid, and turning a card full of interactive detail into
      // an `option` would cost more than the attribute name is worth. Both say
      // "this is the one" to a screen reader.
      aria-current={selected ? 'true' : undefined}
      className={`relative h-full w-full overflow-hidden rounded-card border text-left
                  transition-[box-shadow,background-color,border-color]
                  duration-base ease-inout hover:shadow-[var(--shadow-card)]
                  ${pulsing ? 'focus-pulse' : ''}`}
      style={{
        transitionDelay: `${delay}ms`,
        // In-path cards carry a wash of the accent — present, clearly weaker
        // than the ring on the selected card, and readable in both themes.
        background: inPath && !selected ? 'var(--c-accent-soft)' : 'var(--c-surface)',
        borderColor: selected
          ? accent
          : inPath
            ? 'var(--c-accent)'
            : withAlpha(accent, muted ? 0.2 : 0.45),
        borderWidth: selected ? 2 : 1,
        // A card the filter does not cover is drawn on a dashed edge: it is
        // standing in this column on loan, and the outline says so before any
        // label is read.
        borderStyle: guest ? 'dashed' : undefined,
        boxShadow: selected ? `0 0 0 3px ${withAlpha(accent, 0.2)}, var(--shadow-card)` : undefined,
      }}
    >
      <div className="relative w-full" style={{ height: CARD_ART_HEIGHT }}>
        <CourseArt courseId={course.id} color={colour} domain={domain} className="h-full w-full" />
        {/* The marks belong to the picture, not to the metadata row: "mine",
            "done" and "nothing to watch here" have to survive being read at a
            glance across a column of forty cards. */}
        <div className="absolute inset-x-1.5 top-1.5 flex items-start gap-1">
          {empty ? (
            <Tooltip content={t('ui.course.noMaterialsHint')}>
              <span className="on-canvas inline-flex h-[18px] items-center rounded-full px-1.5 text-[10px] leading-none text-ink-faint">
                {t('ui.course.noMaterials')}
              </span>
            </Tooltip>
          ) : null}
          <span className="ml-auto flex flex-wrap items-center justify-end gap-1">
            {favorite ? <FavoriteMark /> : null}
            {status ? <StatusMark status={status} /> : null}
          </span>
        </div>
      </div>

      <div
        className="flex flex-col gap-1 p-2"
        style={{ height: `calc(100% - ${CARD_ART_HEIGHT}px)` }}
      >
        <span className="line-clamp-2 text-[13px] font-semibold leading-tight text-ink">
          {t(`course.${course.id}.title`)}
        </span>
        {/* The one-line description earns its place here: a title alone leaves
            "Общая алгебра" and "Теория категорий" looking interchangeable. */}
        <span className="line-clamp-3 text-[11px] leading-snug text-ink-dim">
          {t(`course.${course.id}.desc`)}
        </span>
        <span className="mt-auto flex items-center justify-between gap-1">
          {/* The column number says where the course sits in this catalogue;
              this says when a person actually meets it, which is the question
              people arrive with. */}
          <Tooltip content={t('ui.legend.stage')}>
            <span className="num min-w-0 truncate text-[11px] text-ink-faint">
              {t(`ui.stage.${course.stage}`)}
            </span>
          </Tooltip>
          {course.playlistCount ? (
            <Tooltip content={t('ui.legend.playlistCount')}>
              <span className="num flex items-center gap-0.5 text-[11px] text-ink-faint">
                {course.playlistCount}
                <Icon name="chevron-right" size={11} />
              </span>
            </Tooltip>
          ) : null}
        </span>
      </div>
      </button>

      {guest && domain ? <FieldTag courseId={course.id} domain={domain} colour={colour} /> : null}
    </div>
  );
}

/**
 * Where a borrowed card came from, and the way there.
 *
 * A guest card is the one card in the columns that is not what the filter says,
 * so it is the one card that has to name its own field — otherwise the reader
 * is left with a course from nowhere standing in the middle of somebody else's
 * discipline. Pressing it moves the columns to that field with the course still
 * selected, which is the whole reason the tag is a link and not a caption.
 *
 * It sits on the foot of the artwork rather than in the text below: the picture
 * is the one part of a card with nothing to read in it, and a strip taken out of
 * the text would cost the description a line on every card in the catalogue.
 *
 * A field is not the only thing that can rule a course out — a stage or a
 * university does it too, and a card kept out by one of those is already in the
 * field on screen. The tag then says which field it is and stops being a link,
 * because the one place it could lead is the place the reader is standing.
 */
function FieldTag({
  courseId,
  domain,
  colour,
}: {
  courseId: string;
  domain: BuiltDomain;
  colour: string;
}) {
  const { t } = useT();
  const params = useCatalogParams();
  const requestFocus = useUi((state) => state.requestFocus);
  const title = t(`domain.${domain.id}.title`);
  const elsewhere = !params.domains.includes(domain.id);

  const shape =
    'glass-strong absolute left-1.5 z-10 flex max-w-[calc(100%-12px)] items-center gap-1 ' +
    'rounded-full border px-1.5 py-[3px] text-[10px] leading-none backdrop-blur';
  const style = {
    top: CARD_ART_HEIGHT - 21,
    borderColor: withAlpha(colour, 0.55),
    color: colour,
  };

  if (!elsewhere) {
    return (
      <span className={shape} style={style} title={t('ui.course.outsideFilter')}>
        <DomainIcon domainId={domain.id} size={11} />
        <span className="truncate">{title}</span>
      </span>
    );
  }

  return (
    <Link
      to={domainHref(courseId, params.search, domain.id)}
      // The columns rebuild around the new field; the pulse is what says which
      // of the cards now on screen is the one that was being followed.
      onClick={() => requestFocus(courseId)}
      title={t('ui.course.fromDomainHint', { domain: title })}
      aria-label={t('ui.course.fromDomainHint', { domain: title })}
      className={`${shape} transition-colors duration-fast ease-out hover:border-accent hover:text-accent`}
      style={style}
    >
      <DomainIcon domainId={domain.id} size={11} />
      <span className="truncate">{title}</span>
      <Icon name="chevron-right" size={10} className="shrink-0 opacity-70" />
    </Link>
  );
}

/** Every card re-rendering on every pointer move is the thing to avoid here. */
export default memo(CourseCardInner);
