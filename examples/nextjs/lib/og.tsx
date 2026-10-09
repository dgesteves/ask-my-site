import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Geist, for `next/og`, which reads TrueType and not WOFF2. */
export async function ogFonts() {
  const dir = path.join(process.cwd(), 'node_modules/geist/dist/fonts');
  const [regular, semibold, mono] = await Promise.all([
    readFile(path.join(dir, 'geist-sans/Geist-Regular.ttf')),
    readFile(path.join(dir, 'geist-sans/Geist-SemiBold.ttf')),
    readFile(path.join(dir, 'geist-mono/GeistMono-Regular.ttf')),
  ]);
  return [
    { name: 'Geist', data: regular, weight: 400 as const, style: 'normal' as const },
    { name: 'Geist', data: semibold, weight: 600 as const, style: 'normal' as const },
    { name: 'Geist Mono', data: mono, weight: 400 as const, style: 'normal' as const },
  ];
}

export const OG_SIZE = { width: 1200, height: 630 };

export const COLORS = {
  ink: '#0d0f12',
  raised: '#14181d',
  border: '#262b33',
  borderStrong: '#353c47',
  fg: '#f5f7fa',
  soft: '#dfe6ee',
  muted: '#9aa6b4',
  subtle: '#7c8796',
  cyan: '#22d3ee',
  cyanBright: '#67e8f9',
  magenta: '#f0468a',
};

export function Spark({ size, color = COLORS.cyan }: { size: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path
        d="M12 2.5c.6 4.9 3.6 7.9 8.5 8.5-4.9.6-7.9 3.6-8.5 8.5-.6-4.9-3.6-7.9-8.5-8.5 4.9-.6 7.9-3.6 8.5-8.5Z"
        fill={color}
      />
    </svg>
  );
}

/** The brand row: the mark and the name. */
export function Brand({ suffix }: { suffix?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 48,
          height: 48,
          borderRadius: 12,
          background: 'rgba(34, 211, 238, 0.08)',
          border: '1.5px solid rgba(34, 211, 238, 0.35)',
        }}
      >
        <Spark size={26} />
      </div>
      <div style={{ display: 'flex', fontSize: 30, fontWeight: 600, color: COLORS.fg }}>
        ask-my-site
        {suffix ? (
          <span style={{ marginLeft: 14, color: COLORS.subtle, fontWeight: 400 }}>{suffix}</span>
        ) : null}
      </div>
    </div>
  );
}
