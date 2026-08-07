import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

/**
 * Runs the built sandbox against a DOM stub.
 *
 * It asserts nothing about how the map looks — that is what the sandbox itself
 * is for. What it catches is the failure that costs the most time: the bundle
 * throwing on load, so the page is blank and the panel never appears. Every
 * DOM call the app makes has to survive being made.
 */

const SANDBOX = path.join('.map-poc', 'sandbox.html');

function buildSandbox(): string {
  if (!fs.existsSync(SANDBOX)) {
    execFileSync('npx', ['tsx', 'scripts/map-sandbox.ts'], { stdio: 'pipe' });
  }
  return fs.readFileSync(SANDBOX, 'utf8');
}

/** The smallest DOM that lets the app run: nodes that accept anything. */
function makeDom() {
  const created: string[] = [];

  const makeNode = (tag: string): Record<string, unknown> => {
    created.push(tag);
    const node: Record<string, unknown> = {
      tagName: tag.toUpperCase(),
      children: [] as unknown[],
      dataset: {},
      style: {
        setProperty() {},
        removeProperty() {},
      },
      classList: { add() {}, remove() {}, toggle() {} },
      append(...items: unknown[]) {
        (node.children as unknown[]).push(...items);
      },
      replaceChildren(...items: unknown[]) {
        node.children = items;
      },
      insertAdjacentHTML(_where: string, html: string) {
        node.__html = html;
      },
      addEventListener() {},
      removeAttribute() {},
      setAttribute() {},
      remove() {},
      click() {},
      querySelector: () => makeNode('svg'),
      querySelectorAll: () => [],
      get clientWidth() {
        return 1200;
      },
    };
    return node;
  };

  const document = {
    createElement: (tag: string) => makeNode(tag),
    createTextNode: (text: string) => ({ text }),
    getElementById: () => makeNode('div'),
  };

  return { document, created };
}

describe('map sandbox', () => {
  const html = buildSandbox();

  it('inlines its data and its script', () => {
    expect(html).toContain('window.__MAP_DATA__');
    expect(html).toMatch(/<script>[\s\S]{2000,}<\/script>/);
  });

  // Generous: the stub fires timers synchronously, so one run of this test is
  // two full map generations at final quality — the real work, not a mock of it.
  it('runs to completion against a DOM stub', { timeout: 120_000 }, () => {
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts.length).toBe(2);

    const { document, created } = makeDom();
    const context: Record<string, unknown> = {
      document,
      setTimeout: (fn: () => void) => {
        fn();
        return 0;
      },
      clearTimeout() {},
      structuredClone: (value: unknown) => JSON.parse(JSON.stringify(value)),
      ResizeObserver: class {
        observe() {}
        disconnect() {}
      },
      URL: { createObjectURL: () => 'blob:', revokeObjectURL() {} },
      Blob: class {},
      Image: class {},
      console,
    };
    context.window = context;
    vm.createContext(context);

    for (const script of scripts) {
      vm.runInContext(script, context, { timeout: 60_000 });
    }

    // The panel is built from real config, so a healthy run creates a control
    // for every knob plus the export buttons. The floor is deliberately low:
    // the panel is meant to stay small, and a test that demands more knobs
    // would fight the next simplification instead of catching a broken page.
    expect(created.filter((tag) => tag === 'input').length).toBeGreaterThan(8);
    expect(created.filter((tag) => tag === 'button').length).toBeGreaterThan(5);
    expect((context.__MAP_DATA__ as { domains: unknown[] }).domains.length).toBeGreaterThan(30);
  });
});
