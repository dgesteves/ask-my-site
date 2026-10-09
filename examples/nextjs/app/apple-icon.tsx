import { ImageResponse } from 'next/og';

import { COLORS, Spark } from '../lib/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/** The home screen icon: the spark on the page's ink, full bleed, as iOS rounds it itself. */
export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        background: `radial-gradient(circle at 50% 45%, #10232a, ${COLORS.ink} 75%)`,
      }}
    >
      <Spark size={104} />
    </div>,
    size,
  );
}
