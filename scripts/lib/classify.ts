import type { Completeness, PlaylistKind } from '../../shared/schema.js';

/**
 * Heuristics that turn a YouTube title into catalogue metadata.
 *
 * They live in the build rather than in the crawler on purpose: a wrong guess
 * is then fixed by editing the regex and re-running `data:build`, which costs
 * nothing, instead of re-crawling and spending a day of quota.
 * Anything they get wrong is corrected by hand in `overrides.yaml`.
 */

const LECTURE_RE = /(?:^|\W)(лекци\w*|lectures?|lec)(?:\W|$)/i;
const SEMINAR_RE =
  /(?:^|\W)(семинар\w*|практик\w*|упражнени\w*|seminars?|recitation|problem session|tutorial|discussion section)(?:\W|$)/i;

/**
 * Share of the lectures that must say what they are before the playlist does.
 *
 * A course whose seventh video is called «Семинар 7» has answered the question
 * about itself; one where a single video happens to mention a tutorial has not.
 * `mixed` needs less from each side by construction — it is the claim that both
 * are present, not that either dominates.
 */
const KIND_SHARE = { clear: 0.6, present: 0.2 } as const;

/**
 * Whether a playlist is lectures or seminars, read off its lectures' own names.
 *
 * It used to be read off the playlist's title and description alone, and that
 * left 90% of the catalogue at «неизвестно» — a filter offering three values
 * that between them described 297 playlists out of 2902. The lecture titles are
 * fetched anyway and ship with the shard, and they are the place where the
 * distinction is actually written down: counting them finds four times as many
 * seminar series and two and a half times as many lecture courses.
 *
 * The playlist's own title still speaks when the videos have nothing to say —
 * «Доп. семинары "Механика"» is a clear answer whatever its videos are called.
 */
export function detectKind(title: string, description = '', videoTitles: string[] = []): PlaylistKind {
  const text = `${title} ${description}`;
  if (videoTitles.length >= 5) {
    let lectures = 0;
    let seminars = 0;
    for (const videoTitle of videoTitles) {
      if (LECTURE_RE.test(videoTitle)) lectures++;
      if (SEMINAR_RE.test(videoTitle)) seminars++;
    }
    const lectureShare = lectures / videoTitles.length;
    const seminarShare = seminars / videoTitles.length;
    if (lectureShare >= KIND_SHARE.present && seminarShare >= KIND_SHARE.present) return 'mixed';
    if (seminarShare >= KIND_SHARE.clear) return 'seminars';
    if (lectureShare >= KIND_SHARE.clear) return 'lectures';
  }
  const lectures = LECTURE_RE.test(text);
  const seminars = SEMINAR_RE.test(text);
  if (lectures && seminars) return 'mixed';
  if (lectures) return 'lectures';
  if (seminars) return 'seminars';
  return 'unknown';
}

const FULL_RE = /\b(полный курс|full course|complete course|весь курс)\b/i;
const PARTIAL_RE = /\b(фрагмент|отрывк|избранн|selected|highlights)\b/i;

/**
 * A semester course is roughly 12–30 recordings. Anything much shorter is a
 * fragment; the exact boundary is a judgement call, which is why it is one
 * constant and not a formula.
 */
export function detectCompleteness(
  title: string,
  videoCount: number,
  description = ''
): Completeness {
  const text = `${title} ${description}`;
  if (FULL_RE.test(text)) return 'full';
  if (PARTIAL_RE.test(text)) return 'partial';
  if (videoCount >= 12) return 'full';
  if (videoCount <= 5) return 'partial';
  return 'unknown';
}

const CYRILLIC_RE = /[а-яё]/i;

export function detectLang(title: string, fallback = 'ru'): string {
  if (CYRILLIC_RE.test(title)) return 'ru';
  if (/[a-z]/i.test(title)) return 'en';
  return fallback;
}

/**
 * Pulls a lecturer name out of a title.
 *
 * Six spellings, because the catalogue has six and each of them was leaving the
 * name inside the row's *title* instead of beside the university:
 *
 *   Райгородский А. М.        МФТИ, ВШЭ, МГУ — the common one
 *   Маркеев. А. П.            a dot after the surname, МФТИ again
 *   ПИРКОВСКИЙ А.Ю.           ВШЭ writes some of them in capitals
 *   А. И. Трифанов            ИТМО writes every one of its titles this way
 *   Асеев Виктор Васильевич   МГУ writes them out in full
 *   Кира Вяткина              Лекториум and ИТМО, given name first
 *
 * Deliberately conservative: a wrong name is worse than no name, because the
 * lecturer filter is built from these values. Everything is written back as
 * «Фамилия И.О.» so one lecturer is one row in that filter.
 */

/** What can stand between the title and the name, «лектор» included. */
const LEAD = '(?:^|[—–\\-,|:]+\\s*|(?:лектор\\p{L}*|преподавател\\p{L}*|читает)\\s*[—–\\-:]*\\s*)';
const SURNAME = '[А-ЯЁ](?:[а-яё]+|[А-ЯЁ]+)';

const NAME_RE = new RegExp(`${LEAD}(${SURNAME})\\.?\\s+([А-ЯЁ]\\.\\s*[А-ЯЁ]\\.?)`, 'u');

/**
 * The name written out — «Биохимия - Асеев Виктор Васильевич».
 *
 * The patronymic is what makes this safe to guess at: three capitalised words in
 * a row are a lecturer only occasionally, but three where the last ends in
 * -ович/-евна are a lecturer nearly always.
 */
const PATRONYMIC = '[А-ЯЁ][а-яё]*(?:ович|евич|ьич|овна|евна|ична|инична)';
// The trailing lookahead rather than `\b`: JavaScript's word boundary is ASCII,
// so it never fires after «Васильевич» and the pattern silently matched nothing.
const FULL_NAME_RE = new RegExp(
  `${LEAD}(${SURNAME})\\s+([А-ЯЁ])[а-яё]+\\s+(${PATRONYMIC})(?!\\p{L})`,
  'u'
);

/** The same three in the other order — «Дмитрий Валерьевич Карпов». */
const REVERSED_FULL_RE = new RegExp(
  `${LEAD}([А-ЯЁ])[а-яё]+\\s+(${PATRONYMIC})\\s+(${SURNAME})(?!\\p{L})`,
  'u'
);

/** Initials first, which is how ИТМО writes every one of its titles. */
const REVERSED_RE = new RegExp(
  `${LEAD}([А-ЯЁ])\\.\\s*([А-ЯЁ])\\.\\s*(${SURNAME})(?!\\p{L})`,
  'u'
);

/** Two words and no patronymic — «Кира Вяткина», «Савельев Егор». */
const TWO_WORDS_RE = new RegExp(`${LEAD}([А-ЯЁ][а-яё]+)\\s+([А-ЯЁ][а-яё]+)(?!\\p{L})`, 'gu');

/** A surname on its own, and only ever right after the word «лектор». */
const AFTER_ROLE_RE =
  /(?:лектор\p{L}*|преподавател\p{L}*|читает)\s*[—–\-:]*\s*([А-ЯЁ][а-яё]+)(?!\p{L})/u;

/**
 * Given names common enough to tell «Кира Вяткина» from «Савельев Егор».
 *
 * Two capitalised words are a lecturer in both orders and there is nothing in
 * the shape of them to say which is the surname — «Пастор» is a real surname
 * and a real word. A closed list of first names is the only thing that decides
 * it without guessing, and guessing here writes the wrong name into the filter.
 */
const GIVEN_NAMES = new Set(
  `александр алексей анатолий андрей антон аркадий арсений артем артём артур богдан борис вадим
   валентин валерий василий вениамин виктор виталий владимир владислав вячеслав геннадий георгий
   глеб григорий даниил данила денис дмитрий евгений егор иван игорь илья кирилл константин лев
   леонид максим марк матвей михаил никита николай олег павел петр пётр роман руслан семен семён
   сергей станислав степан тимофей тимур федор фёдор филипп эдуард юрий яков ярослав
   александра алла анастасия анна валентина валерия вера вероника victoria виктория галина дарья
   диана евгения екатерина елена елизавета жанна зоя инна ирина кира ксения лариса лидия любовь
   людмила маргарита марина мария надежда наталия наталья нина оксана олеся ольга полина раиса
   светлана софия софья таисия тамара татьяна ульяна юлия яна`
    .split(/\s+/)
    .filter(Boolean)
);

export function detectLecturer(title: string): string | undefined {
  // «А. М.» and «А.М.» are one lecturer, and the filter lists whatever this
  // returns — so the spacing is decided here rather than by the title.
  const match = NAME_RE.exec(title);
  if (match) {
    const initials = match[2].replace(/\s+/g, '');
    return `${match[1]} ${initials.endsWith('.') ? initials : `${initials}.`}`;
  }
  const full = FULL_NAME_RE.exec(title);
  if (full) return `${full[1]} ${full[2]}.${full[3][0]}.`;
  const reversedFull = REVERSED_FULL_RE.exec(title);
  if (reversedFull) return `${reversedFull[3]} ${reversedFull[1]}.${reversedFull[2][0]}.`;
  const reversed = REVERSED_RE.exec(title);
  if (reversed) return `${reversed[3]} ${reversed[1]}.${reversed[2]}.`;

  // Every pair, not the first one: «Теория Графов | Практика | Мария Сенина»
  // opens with two capitalised words that are the course, and stopping there
  // means the lecturer three words later is never looked at.
  for (const [, first, second] of title.matchAll(TWO_WORDS_RE)) {
    const firstIsGiven = GIVEN_NAMES.has(first.toLowerCase());
    const secondIsGiven = GIVEN_NAMES.has(second.toLowerCase());
    if (firstIsGiven !== secondIsGiven) {
      const [given, surname] = firstIsGiven ? [first, second] : [second, first];
      return `${surname} ${given[0]}.`;
    }
  }

  const afterRole = AFTER_ROLE_RE.exec(title);
  if (afterRole) return afterRole[1];
  return undefined;
}

