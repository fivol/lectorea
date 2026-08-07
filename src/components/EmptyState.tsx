import Icon, { type IconName } from './Icon';

type Props = {
  icon: IconName;
  /** One line. If it needs two, the tab is explaining too much. */
  text: string;
  action?: { label: string; onClick: () => void };
};

/**
 * A tab with nothing in it yet.
 *
 * An empty panel is indistinguishable from a broken one, so every one of them
 * says what would put something here and offers the click that starts it.
 */
export default function EmptyState({ icon, text, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-ink-faint">
        <Icon name={icon} size={20} />
      </span>
      <p className="max-w-xs text-caption text-ink-dim">{text}</p>
      {action ? (
        <button type="button" className="btn" onClick={action.onClick}>
          {action.label}
          <Icon name="chevron-right" size={12} />
        </button>
      ) : null}
    </div>
  );
}
