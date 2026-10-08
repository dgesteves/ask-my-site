// The script embed's build imports its stylesheets as text (see tsdown.config.ts), to inject
// them itself.
declare module '*.css' {
  const css: string;
  export default css;
}
