import { Geist, Geist_Mono } from 'next/font/google';

// The Latin subsets of Geist and Geist Mono, self-hosted by next/font at build time. They are
// about half the size of the full fonts in the `geist` package, which also cover Cyrillic and
// other scripts this site never shows.
export const sans = Geist({ subsets: ['latin'], variable: '--font-geist-sans', display: 'swap' });
export const mono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
});
