// Markdown files are bundled as plain text (esbuild loader 'text' in build.mjs).
declare module '*.md' {
  const text: string;
  export default text;
}
