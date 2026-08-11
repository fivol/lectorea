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
