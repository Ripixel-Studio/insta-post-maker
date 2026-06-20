import { Line } from 'react-konva';
import type { Guide } from './guides';

/** Renders pink alignment guide lines (document coordinates). */
export function SmartGuides({ guides }: { guides: Guide[] }) {
  return (
    <>
      {guides.map((g, i) =>
        g.axis === 'x' ? (
          <Line
            key={`x${i}`}
            points={[g.position, -10000, g.position, 20000]}
            stroke="#f472b6"
            strokeWidth={1}
            listening={false}
          />
        ) : (
          <Line
            key={`y${i}`}
            points={[-10000, g.position, 20000, g.position]}
            stroke="#f472b6"
            strokeWidth={1}
            listening={false}
          />
        ),
      )}
    </>
  );
}
