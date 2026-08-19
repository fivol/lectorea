/**
 * Where the catalogue lives on GitHub. Every link that sends a reader to the
 * data — to propose a playlist, to correct a course — is built from here, so
 * a fork points at itself and nothing has to be found and edited by hand.
 */
export const REPO = import.meta.env.VITE_REPO;

/** A URL inside the repository, e.g. `repoUrl('/issues/new')`. */
export function repoUrl(path = ''): string {
  return `https://github.com/${REPO}${path}`;
}

/**
 * A prefilled issue form. The keys are the `id`s of the fields in
 * `.github/ISSUE_TEMPLATE/`, which is how GitHub fills a form from a link —
 * so a reader arrives with the part the app already knows filled in and only
 * has the part it cannot know left to type.
 *
 * `title`, `body` and `labels` are reserved by GitHub and are never field ids;
 * tests/issue-templates.test.ts holds the rest of the names to the forms.
 */
function issueUrl(template: string, fields: Record<string, string> = {}): string {
  const query = new URLSearchParams({ template, ...fields });
  return repoUrl(`/issues/new?${query}`);
}

/**
 * «Предложить плейлист», with whichever half the app already knows filled in.
 *
 * From a course panel that is the course; from the search box it is the address
 * that was pasted and not found, which is the *required* field of the form —
 * the one case where the reader arrives with nothing left to type but the
 * button.
 */
export function suggestPlaylistUrl(courseId = '', url = ''): string {
  return issueUrl('1-playlist.yml', {
    ...(courseId ? { course: courseId } : {}),
    ...(url ? { url } : {}),
  });
}

/**
 * «Предложить курс», carrying whatever was searched for and not found.
 *
 * The form asks for a name, and the reader has just typed one — sending them
 * to an empty field to type it a second time is how a link like this goes
 * unclicked. The field of knowledge is not prefilled: it is a dropdown, and
 * GitHub matches those on the visible label rather than on the id.
 */
export function suggestCourseUrl(name = ''): string {
  return issueUrl('2-course.yml', name.trim() ? { name: name.trim() } : {});
}

/**
 * The chooser — playlist, course, domain, or anything else.
 *
 * The one link that reaches the forms this app has no natural place to offer:
 * nothing on screen is a domain, and nothing is an idea.
 */
export function contributeUrl(): string {
  return repoUrl('/issues/new/choose');
}

/**
 * Straight to the course entry on GitHub. Courses are stored one file per area,
 * named after the primary domain — which is exactly why that rule is worth
 * enforcing: it makes the file derivable instead of something to look up.
 */
export function fixDataUrl(courseId: string, primaryDomain: string): string {
  return repoUrl(
    `/blob/main/data/courses/${primaryDomain}.yaml#:~:text=${encodeURIComponent(`id: ${courseId}`)}`
  );
}
