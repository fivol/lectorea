/**
 * Every event the site sends, and every parameter it sends with one.
 *
 * Here rather than in `src/` for the same reason `schema.ts` is: two sides read
 * it. The frontend checks itself against it while developing — an event or a
 * parameter that is not written down here is a warning in the console, not a
 * silent addition — and `scripts/ga4-setup.ts` provisions the property from it,
 * because a parameter GA4 has no **custom dimension** for is collected and then
 * unreportable, which is the failure mode that looks exactly like success. The
 * events arrive, the numbers go up, and the one breakdown the event was added
 * for is not offered anywhere in the interface.
 *
 * So the rule is one line long: **an event is added here first.** What it costs
 * to forget is a month of data that cannot be read, discovered on the day
 * somebody finally goes looking for it.
 *
 * What may go in a parameter is decided in `src/lib/analytics.ts` and is not
 * negotiable here: ids out of the catalogue, counts, and the search box's words
 * once they have been through `searchTerm`. Nothing else a reader typed, and
 * nothing that identifies a browser.
 */

/**
 * `dimension` is something to break a report down *by* — a course id, a status,
 * a facet. `metric` is something to add up: a count of lectures, a percentage,
 * a number of results. GA4 keeps the two in separate registers with separate
 * limits, and picking the wrong one is a dimension whose values are all
 * distinct numbers, which is a report of one row per event.
 */
export type ParamScope = 'dimension' | 'metric';

export type ParamSpec = {
  scope: ParamScope;
  /** What it is called in a report. Must be unique across the property. */
  label: string;
  note: string;
};

/**
 * The parameters, and what each one is for.
 *
 * `page_path`, `page_title` and `page_location` are deliberately absent: GA4
 * has them already, and a custom dimension over a built-in one is a second
 * column of the same numbers with a slightly different name.
 */
export const ANALYTICS_PARAMS: Record<string, ParamSpec> = {
  course_id: { scope: 'dimension', label: 'Course', note: 'Catalogue id of the course in hand' },
  playlist_id: { scope: 'dimension', label: 'Playlist', note: 'YouTube playlist id' },
  video_id: { scope: 'dimension', label: 'Lecture', note: 'YouTube video id' },
  domain: { scope: 'dimension', label: 'Field of knowledge', note: "The course's first domain" },
  stage: {
    scope: 'dimension',
    label: 'Stage',
    note: 'School, undergraduate, graduate — where the course normally falls',
  },
  status: { scope: 'dimension', label: 'Course status', note: 'none, in_progress, done' },
  by: {
    scope: 'dimension',
    label: 'Marked by',
    note: 'cycle or set for a status; hand or player for a lecture',
  },
  done: { scope: 'dimension', label: 'Marked done', note: '1 when lectures were ticked, 0 unticked' },
  on: { scope: 'dimension', label: 'Switched on', note: '1 when a toggle ended up on' },
  ok: { scope: 'dimension', label: 'Succeeded', note: '1 when the clipboard accepted the write' },
  video_provider: { scope: 'dimension', label: 'Video provider', note: 'Always youtube for now' },
  search_term: {
    scope: 'dimension',
    label: 'Search term',
    note: 'The query, lower-cased — empty when it was refused as personal or overlong',
  },
  kind: {
    scope: 'dimension',
    label: 'Result kind',
    note: 'course, domain, playlist, provider or lecturer — which row was chosen',
  },
  item_id: { scope: 'dimension', label: 'Chosen id', note: 'Catalogue id of the chosen row' },
  suggested: {
    scope: 'dimension',
    label: 'From suggestions',
    note: '1 when the row came from the default panel rather than from a query',
  },
  facet: { scope: 'dimension', label: 'Filter facet', note: 'Which of the playlist filters moved' },
  value: { scope: 'dimension', label: 'Value', note: 'What the facet or setting was set to' },
  setting: { scope: 'dimension', label: 'Setting', note: 'Which setting was pressed' },
  mode: { scope: 'dimension', label: 'Import mode', note: 'replace or merge' },
  view: { scope: 'dimension', label: 'Front page view', note: 'map or blocks' },
  what: { scope: 'dimension', label: 'Copied', note: 'profile, profile-prompt, lecture-prompt' },
  link_domain: { scope: 'dimension', label: 'Outbound host', note: 'Host of a link leaving the site' },
  message: { scope: 'dimension', label: 'Error', note: 'First 100 characters of the message' },
  source: { scope: 'dimension', label: 'Error source', note: 'Bundle file and line, or promise' },

  level: { scope: 'metric', label: 'Course level', note: 'Column: prerequisites deep in the graph' },
  playlists: { scope: 'metric', label: 'Playlists', note: 'How many recordings the course has' },
  lectures: { scope: 'metric', label: 'Lectures', note: 'How many lectures the playlist holds' },
  courses: { scope: 'metric', label: 'Courses in profile', note: 'Size of an imported profile' },
  count: { scope: 'metric', label: 'Lectures marked', note: 'How many marks the press actually moved' },
  video_percent: { scope: 'metric', label: 'Watched %', note: 'Milestone reached: 10, 25, 50, 75, 90' },
  results: { scope: 'metric', label: 'Results', note: 'How many hits the query returned' },
};

/**
 * The events, and the question each one exists to answer.
 *
 * Where a name is one of GA4's own recommended events — `page_view`, `search`,
 * `video_start`, `video_progress`, `video_complete` — that name is used rather
 * than a better one of ours, because the built-in reports are keyed on it and a
 * synonym buys a second, emptier version of a report that already exists.
 */
export const ANALYTICS_EVENTS: Record<string, string> = {
  page_view: 'A view of the site, named by its canonical path',
  course_open: 'A course opened, with its depth, field and how many recordings it has',
  course_status: 'A course moved between not started, in progress and done',
  course_goal: 'A course made a goal, or stopped being one',
  playlist_open: 'A recording opened — by click, or by a pasted link',
  playlist_sealed: 'A whole playlist marked off in one press',
  playlist_saved: 'A playlist saved to the shelf, or taken off it',
  lectures_marked: 'Lectures ticked or unticked, by hand or by the player',
  video_start: 'A lecture began playing in the built-in player',
  video_progress: 'A lecture passed one of the five milestones',
  video_complete: 'A lecture ran to the end',
  search: 'A query, once it stopped being typed',
  search_no_results: 'A query that found nothing — a course the catalogue is missing',
  search_select: 'Which row of the results was chosen',
  filter_apply: 'One facet of the playlist filters moved',
  setting_change: 'A setting pressed in the profile',
  map_view: 'The front page switched between the map and the blocks',
  profile_open: 'The profile panel opened',
  summary_hidden: '«Ваше обучение» put away for the visit',
  resume_continue: '«Продолжить» pressed',
  profile_export: 'The profile downloaded or copied out',
  profile_import: 'A profile file read back in',
  profile_reset: 'The profile erased',
  copy: 'Something copied to the clipboard',
  outbound_click: 'A link followed off the site',
  app_error: 'An uncaught error, as a count rather than a stack',
};

/** GA4 owns these; they are never custom dimensions of ours. */
export const BUILT_IN_PARAMS = new Set(['page_path', 'page_title', 'page_location']);
