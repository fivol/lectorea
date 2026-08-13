import type { BuiltPlaylist } from '@shared/schema';

/**
 * What to call a playlist inside the panel of the course it belongs to.
 *
 * The row used to lead with the source — «МФТИ · 2016» — and add a third part
 * only to rows that collided with another. Two things were wrong with it. The
 * third part was the lecture count in 782 rows out of 2902, which is a number
 * the line below already prints; and 1027 rows lead with «Прочие каналы»,
 * because a third of the catalogue was found on a course page rather than on a
 * channel, so a third of the list said nothing at all above the fold.
 *
 * So the recording's own name goes first, when it has one of its own, and who
 * recorded it follows in a quieter colour. The name is what a person would say
 * out loud to tell two recordings of one course apart; the source is what they
 * would say to decide which to trust. Both belong on the line, in that order.
 */
export type LabelParts = {
  /**
   * The recording's own name — «Часть 2», «AP Physics C: Mechanics» — or null
   * when everything in the title was already said by the course heading and the
   * source, which is the case for about half the catalogue.
   */
  name: string | null;
  /** «МГУ · Кобельков Г.М.» — never empty; falls back to the channel. */
  source: string;
  /** The whole title, course name and all. What the tooltip is for. */
  detail: string;
};

type Context = {
  providerTitle: (id: string) => string | undefined;
};

/** Compares titles the way a reader does: case, spacing and punctuation aside. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Drops a leading course name — «Топология — », «Топология: », «Топология, ».
 *
 * The comma is in the list because a good third of these titles are written
 * «Алгоритмы, продвинутый поток» rather than with a dash, and leaving it turns
 * the remainder into «, продвинутый поток».
 */
export function stripCoursePrefix(title: string, courseTitle: string): string {
  const trimmed = title.trim();
  if (!courseTitle || !trimmed.toLowerCase().startsWith(courseTitle.toLowerCase())) return trimmed;
  const rest = trimmed.slice(courseTitle.length).replace(/^\s*[—–\-:.,;·|]\s*/, '');
  // A title that is *only* the course name has nothing else to offer.
  return rest || trimmed;
}

/**
 * A term and its year — «Осень 2020», «Fall 2019», «весной 2021».
 *
 * Unicode classes rather than `\w`, which in JavaScript is ASCII only: `осен\w*`
 * stops at the «ь» and leaves one behind.
 */
const TERM =
  /(^|\P{L})(?:осен\p{L}*|весн\p{L}*|зим\p{L}*|летн\p{L}*|fall|spring|autumn|winter|summer)(?=\P{L}|$)[\s,]*(?:\d{2,4})?/giu;

/**
 * When it was filmed, written in months: «Jan 2025», «Jul - Dec 2020».
 *
 * Only ever removed with a year or another month beside it. A bare «May» is a
 * word, and «Mar» is somebody's initials as often as it is March.
 */
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\\p{L}*';
const MONTH_SPAN = new RegExp(
  `(^|\\P{L})${MONTH}(?:\\s*[-–—]\\s*${MONTH})?[\\s,]*(?:19|20)\\d{2}`,
  'giu'
);

/**
 * Words that name the genre rather than the recording.
 *
 * Every one of them is true of most of the catalogue, so none of them separates
 * this row from the one under it. «Семинары» is deliberately absent: that one
 * does separate, and it is the type badge's business.
 */
const GENRE =
  /(^|\P{L})(?:курс лекций|полный курс|весь курс|видеолекци\p{L}*|лекции по курсу|по курсу|full course|complete course|lecture collection|lectures? on the course|playlist|плейлист)(?=\P{L}|$)/giu;

/** A lone «лекции»/«lectures» left over once the genre phrases are gone. */
const BARE_LECTURES = /(^|\P{L})(?:лекци\p{L}*|lectures?)(?=\P{L}|$)/giu;

/** «(fall 2019)», «[s1 | 2025]» — brackets that carry no word of their own. */
const BRACKETED = /[([][^()[\]]*[)\]]/g;
const TRAILING_BRACKET = /\s*[([][^()[\]]*[)\]]\s*$/;
const REAL_WORD = /\p{L}{3,}/u;

/** Initials in either order: «А. В. Ершов», «Ершов А.В.», «Prof. Pavan». */
const INITIALS = /(?:\p{Lu}\.\s?){1,2}\s?\p{Lu}\p{Ll}+|\p{Lu}\p{Ll}+\s?(?:\p{Lu}\.\s?){1,2}/gu;

/**
 * The same name written out — «Асеев Виктор Васильевич», which is how МГУ names
 * every one of its recordings.
 *
 * Removed even though the row prints the lecturer beside the source: the build
 * stores «Асеев В.В.» and the title says it in full, so matching the stored
 * name literally never catches it. The patronymic is what makes the guess safe.
 */
const PATRONYMIC = '\\p{Lu}\\p{Ll}*(?:ович|евич|ьич|овна|евна|ична|инична)';
const FULL_NAME = new RegExp(
  `\\p{Lu}\\p{Ll}+\\s+\\p{Lu}\\p{Ll}+\\s+${PATRONYMIC}(?!\\p{L})` +
    `|\\p{Lu}\\p{Ll}+\\s+${PATRONYMIC}\\s+\\p{Lu}\\p{Ll}+(?!\\p{L})`,
  'gu'
);

/**
 * Drops a quotation mark whose partner was carried off by an earlier pass.
 *
 * «Курс «Байесовские методы»» keeps both of its own; «Лекции по курсу
 * "Компьютерные сети"» has the course name taken out from between them and must
 * not be left holding a lone quote at either end.
 */
function unpaired(text: string): string {
  let out = text;
  if (/^["“«]/.test(out) && !/["”»]/.test(out.slice(1))) out = out.slice(1).trim();
  if (/["”»]$/.test(out) && !/["“«]/.test(out.slice(0, -1))) out = out.slice(0, -1).trim();
  return out;
}

/** Escapes a catalogue name so it can be matched literally inside a title. */
function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The part of a title that belongs to this recording and to nothing else.
 *
 * Everything removed here is removed because the row says it elsewhere: the
 * course name is the heading above the list, the university and the lecturer
 * are the grey tail of this very line, the year is the line below, and «курс
 * лекций» is true of the whole catalogue. What survives is the difference.
 *
 * Deliberately conservative about punctuation: an earlier draft split on every
 * dot and turned «MIT 6.837» into «6 · 837». Separators are only touched where
 * a removal left them stranded.
 */
export function ownName(
  playlist: BuiltPlaylist,
  courseTitle: string,
  sources: string[]
): string | null {
  let text = ` ${playlist.title} `;

  // Longest first, so «Московский государственный университет» is not left as
  // «Московский …» by an earlier pass over a shorter name that it contains.
  const names = [...sources, playlist.lecturer, courseTitle]
    .filter((name): name is string => Boolean(name && name.trim().length >= 3))
    .sort((a, b) => b.length - a.length);
  for (const name of names) {
    // The character before the name is put back rather than swallowed: it is
    // often the opening quote of «"Линейная алгебра"», and eating it leaves the
    // closing one stranded where nothing downstream can pair it off.
    text = text.replace(new RegExp(`(^|\\W)${literal(name.trim())}(?=\\W|$)`, 'gi'), '$1 ');
  }

  text = text
    .replace(FULL_NAME, ' ')
    .replace(INITIALS, ' ')
    .replace(MONTH_SPAN, '$1 ')
    .replace(TERM, '$1 ')
    .replace(GENRE, '$1 ');
  // Only once the genre phrases are gone, so «курс лекций» is not left as
  // «курс» by the bare word going first.
  text = text.replace(BARE_LECTURES, '$1 ');
  text = text.replace(/\b(19|20)\d{2}\b/g, ' ');
  // What a title puts in brackets at the end is the small print — «(1 курс,
  // 2020)», «(2к ФРТК)», «(SMA 5503)» — and none of it tells two recordings of
  // one course apart. Mid-title brackets are kept unless they have lost their
  // contents to the passes above, or never held a word to begin with.
  text = text.replace(TRAILING_BRACKET, ' ');
  text = text.replace(BRACKETED, (chunk) => (REAL_WORD.test(chunk) ? chunk : ' '));
  // Quotation marks left facing each other once what they quoted was removed.
  text = text.replace(/["“”«][\s·.,\-—|]*["“”»]/g, ' ');

  const cleaned = unpaired(
    text
      .replace(/\s*([—–\-:;·|,.]\s*){2,}/g, ' · ')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s\-–—:;·|,.]+|[\s\-–—:;·|,.]+$/g, '')
      .trim()
  );

  // «(практика)» is the whole of what this recording is called once the course
  // name and the lecturer are out of it, and the brackets it was written in are
  // punctuation belonging to a sentence that no longer exists.
  const unwrapped = /^[([][^()[\]]*[)\]]$/.test(cleaned) ? cleaned.slice(1, -1).trim() : cleaned;

  if (!unwrapped || unwrapped.length < 2) return null;
  // A "name" that is the course under another spelling names nothing.
  if (normalize(unwrapped) === normalize(courseTitle)) return null;
  // Nor does one that is only a number: «12» is the lecture count wearing a hat.
  if (!/\p{L}/u.test(unwrapped)) return null;
  return unwrapped;
}

export function playlistHeadings(
  playlists: BuiltPlaylist[],
  courseTitle: string,
  context: Context
): Map<string, LabelParts> {
  const out = new Map<string, LabelParts>();
  for (const playlist of playlists) {
    const provider = context.providerTitle(playlist.providerId);
    // The channel is the fallback and not the other way round: a provider is a
    // name somebody vouched for, a channel title is whatever YouTube holds. But
    // «Прочие каналы» is the provider of last resort and says less than the
    // channel it is standing in for, so a real channel title wins over it.
    const known = provider && playlist.providerId !== 'unknown' ? provider : null;
    const source = known || playlist.channelTitle || provider || '';
    const named = [provider, playlist.channelTitle].filter((name): name is string => Boolean(name));
    out.set(playlist.id, {
      name: ownName(playlist, courseTitle, named),
      source: [source, playlist.lecturer].filter(Boolean).join(' · '),
      detail: stripCoursePrefix(playlist.title, courseTitle),
    });
  }
  return out;
}
