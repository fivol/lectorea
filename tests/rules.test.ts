import { describe, expect, it } from 'vitest';
import { cleanSegments, isNotACourse } from '../scripts/lib/rules.js';

const refuses = (title: string) => cleanSegments(title).some(isNotACourse);

/**
 * The unit this catalogue publishes is the semester. A channel that publishes
 * one playlist per chapter names its course in a clause of its own, so every
 * fragment binds exactly as confidently as the course does — and the course
 * then shows sixteen entries that are each a sixteenth of itself.
 * docs/channel-hunt.md refused a whole channel over this shape; the rule is the
 * same judgement, made without a person.
 */
describe('a chapter is not a course', () => {
  it('refuses a fragment that names its course in another clause', () => {
    expect(refuses('CPU Scheduling | Chapter 5 | Operating System')).toBe(true);
    expect(refuses('Finite Automata | Chapter 2 | Theory of Computation (TOC)')).toBe(true);
    expect(refuses('Modern Robotics, Chapter 10:  Motion Planning')).toBe(true);
    expect(refuses('Введение в тему. Глава 1 | Дискретная математика')).toBe(true);
  });

  /**
   * «Часть» is the trap: it marks a real half of a real course and the NOISE
   * pass deliberately keeps its number, so «Матанализ. Часть 2» stays a
   * distinguishable course. It is absent from the rule for that reason.
   */
  it('leaves «Часть N» alone — that is half a course, not a fragment of one', () => {
    expect(refuses('Квантовая теория поля. Часть 1. Лекции')).toBe(false);
    expect(refuses('Геология и геохимия горючих ископаемых. Часть 1')).toBe(false);
    expect(refuses('Теория групп. Часть II - Исаев Алексей Петрович')).toBe(false);
  });

  it('does not fire on a chapter word without a bare number of its own', () => {
    expect(refuses('Chapter and Verse: Reading the Odyssey')).toBe(false);
    expect(refuses('Главы избранные по алгебре')).toBe(false);
  });
});
