import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { suggestPlaylistUrl } from '../src/lib/repo';

/**
 * The issue forms are the front door: they are how a reader adds anything at
 * all. Both things checked here fail silently in production — a domain missing
 * from the dropdown is a field nobody can file against, and a prefill key that
 * no longer names a field is simply ignored by GitHub, dropping the course the
 * reader clicked from and leaving them an empty form.
 */

const templates = path.join(__dirname, '../.github/ISSUE_TEMPLATE');

type Field = {
  type: string;
  id?: string;
  attributes?: { options?: string[] };
};

function form(name: string): { labels?: string[]; body: Field[] } {
  return parse(fs.readFileSync(path.join(templates, name), 'utf8'));
}

function fieldIds(name: string): Set<string> {
  return new Set(form(name).body.flatMap((field) => (field.id ? [field.id] : [])));
}

const domains = parse(
  fs.readFileSync(path.join(__dirname, '../data/domains.yaml'), 'utf8')
) as Array<{ id: string }>;

describe('issue templates', () => {
  it('offers every domain in the course form', () => {
    const dropdown = form('2-course.yml').body.find((field) => field.id === 'domain');
    const offered = new Set(
      (dropdown?.attributes?.options ?? []).flatMap((option) => {
        const match = /\(([a-z0-9-]+)\)$/.exec(option.trim());
        return match ? [match[1]] : [];
      })
    );

    const missing = domains.map((domain) => domain.id).filter((id) => !offered.has(id));
    expect(missing).toEqual([]);

    // The other direction too: a domain removed from domains.yaml but left in
    // the dropdown sends courses at a territory that no longer exists.
    const known = new Set(domains.map((domain) => domain.id));
    expect([...offered].filter((id) => !known.has(id))).toEqual([]);
  });

  it('prefills fields the playlist form actually has', () => {
    const url = new URL(suggestPlaylistUrl('probability'));
    const query = url.searchParams;

    expect(query.get('template')).toBe('1-playlist.yml');
    expect(query.get('course')).toBe('probability');

    const ids = fieldIds('1-playlist.yml');
    for (const [key] of query) {
      if (key === 'template') continue;
      expect(ids, `${key} is not a field of 1-playlist.yml`).toContain(key);
    }
  });

  it('labels each form so triage can filter by kind', () => {
    const expected: Record<string, string> = {
      '1-playlist.yml': 'playlist',
      '2-course.yml': 'course',
      '3-domain.yml': 'domain',
      '4-idea.yml': 'idea',
    };
    for (const [file, label] of Object.entries(expected)) {
      expect(form(file).labels, file).toEqual([label]);
    }
  });

  it('never names a field with a key GitHub reserves', () => {
    // `?title=`, `?body=`, `?labels=` set the issue itself; a field with one of
    // those ids can never be prefilled, and the collision is invisible.
    const reserved = new Set(['title', 'body', 'labels', 'assignees', 'milestone', 'projects']);
    for (const file of Object.keys({
      '1-playlist.yml': 0,
      '2-course.yml': 0,
      '3-domain.yml': 0,
      '4-idea.yml': 0,
    })) {
      for (const id of fieldIds(file)) {
        expect(reserved.has(id), `${file}: field id "${id}" is reserved`).toBe(false);
      }
    }
  });
});
