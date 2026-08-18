import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { useT } from '@/i18n';
import type { IconName } from '@/components/Icon';
import { copyText } from '@/lib/clipboard';
import Button from './Button';

type Props = Omit<ComponentProps<typeof Button>, 'icon' | 'onClick'> & {
  /** A function when the text is expensive to build — it runs on the press, not on every render. */
  text: string | (() => string);
  /**
   * The glyph while idle. Two sheets say «copy», which is the right answer when
   * copying is the whole of what the button is for — and the wrong one when the
   * clipboard is only how the button does what it says: a question is asked
   * with a question mark on it, and the sheets appear once it is in hand.
   */
  idleIcon?: IconName;
  /**
   * Run on the press, before the text is built.
   *
   * For the side effect a copy sometimes has to come with — a lecture that has
   * to stop running while a question is being written. Kept out of `text` on
   * purpose: a builder that also does something is a builder nobody can call
   * twice.
   */
  onPress?: () => void;
};

/** How long the button stays saying it worked. */
const HOLD = 2000;

/**
 * A button that puts something on the clipboard and says so.
 *
 * The saying-so is the whole point and the reason this is a component rather
 * than an `onClick`. Copying is silent — nothing moves, nothing opens — so
 * without the label changing for a moment the only way to learn whether the
 * press landed is to go and paste somewhere. Failure gets the same treatment
 * for the same reason: a browser that refuses the clipboard must not look
 * exactly like one that agreed.
 */
export default function CopyButton({ text, idleIcon = 'copy', onPress, children, ...rest }: Props) {
  const { t } = useT();
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  const timer = useRef<number>();

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async (): Promise<void> => {
    onPress?.();
    const ok = await copyText(typeof text === 'function' ? text() : text);
    setState(ok ? 'done' : 'failed');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), HOLD);
  };

  const label =
    state === 'done'
      ? t('ui.common.copied')
      : state === 'failed'
        ? t('ui.common.copyFailed')
        : (children ?? t('ui.common.copy'));

  return (
    <Button
      icon={state === 'done' ? 'check' : state === 'failed' ? 'warning' : idleIcon}
      onClick={() => void copy()}
      // The label is the whole answer, so a screen reader has to hear it change
      // — the press itself produces no other event to announce.
      aria-live="polite"
      {...rest}
    >
      {label}
    </Button>
  );
}
