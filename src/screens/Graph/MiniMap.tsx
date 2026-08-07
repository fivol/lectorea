import type { BuiltCourse } from '@shared/schema';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { CARD_HEIGHT, CARD_WIDTH, type Rect } from '@/lib/layout';

type Props = {
  courses: BuiltCourse[];
  bounds: { width: number; height: number };
  viewport: Rect;
  selectedId: string | null;
  onJump: (x: number, y: number) => void;
};

const MAX_WIDTH = 190;
const MAX_HEIGHT = 190;

/** Where you are in a graph that is several screens wide in both directions. */
export default function MiniMap({ courses, bounds, viewport, selectedId, onJump }: Props) {
  const catalog = useCatalog();
  const { t } = useT();

  // The graph is far taller than it is wide once a hundred level-0 courses
  // stack up, so the minimap is fitted into a box rather than scaled by width
  // alone — otherwise it grows into a strip down the middle of the canvas.
  const scale = Math.min(MAX_WIDTH / bounds.width, MAX_HEIGHT / bounds.height);
  const width = Math.max(48, Math.round(bounds.width * scale));
  const height = Math.max(48, Math.round(bounds.height * scale));

  const jump = (event: React.MouseEvent<SVGSVGElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * bounds.width;
    const y = ((event.clientY - rect.top) / rect.height) * bounds.height;
    onJump(x, y);
  };

  return (
    <div className="absolute bottom-3 right-3 hidden overflow-hidden rounded-lg border border-line bg-surface/85 backdrop-blur md:block">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${bounds.width} ${bounds.height}`}
        onClick={jump}
        role="img"
        aria-label={t('ui.graph.minimap')}
        className="cursor-pointer"
      >
        {courses.map((course) => (
          <rect
            key={course.id}
            x={course.x}
            y={course.y}
            width={CARD_WIDTH}
            height={CARD_HEIGHT}
            rx={18}
            fill={catalog.domainById.get(course.domains[0])?.color ?? 'currentColor'}
            opacity={course.id === selectedId ? 1 : 0.45}
          />
        ))}
        <rect
          x={viewport.x}
          y={viewport.y}
          width={viewport.width}
          height={viewport.height}
          fill="var(--c-ink)"
          fillOpacity={0.08}
          stroke="var(--c-ink)"
          strokeOpacity={0.6}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
