/**
 * A unit of content before chunking: usually one page.
 *
 * Every loader produces this shape, and it is also the shape to hand `buildIndex` directly when
 * content comes from somewhere other than files (a CMS, a database, an API).
 */
export interface SourceDocument {
  /** Stable, unique identifier. The file loaders use the path relative to the content root. */
  id: string;
  /** Where the page lives, e.g. `/docs/install` or `https://example.com/docs/install`. */
  url: string;
  /** Human-readable title, shown on citations. */
  title: string;
  /**
   * Markdown or plain text. ATX headings (`#` to `######`) drive chunk boundaries and become the
   * anchors citations deep-link to.
   */
  content: string;
  /**
   * Where heading anchors come from. `slug`, the default, slugs each heading as GitHub,
   * rehype-slug and Docusaurus do, unless it has an explicit `{#id}`: right for Markdown that a
   * renderer gives those ids. `explicit` takes only `{#id}`s, for a page that already has its ids,
   * such as built HTML (`fromHtml` sets it); a heading without one links to the nearest heading
   * above it that has one, or to the page.
   */
  anchors?: 'slug' | 'explicit';
}

/** A retrievable slice of a document. Chunks never span two sections. */
export interface Chunk {
  /** `${documentId}#${ordinal}`: stable as long as the document's structure is. */
  id: string;
  documentId: string;
  /** The document's URL, without an anchor. */
  url: string;
  /** The document's title. */
  title: string;
  /** Heading path from the outermost section down, joined with ` › `. Empty at the top. */
  heading: string;
  /** Slug of the innermost heading, used to deep-link citations. */
  anchor?: string;
  text: string;
}

/** Options for {@link chunkDocument}. */
export interface ChunkingOptions {
  /** Upper bound on a chunk's text length, in characters. Default 1200. */
  maxChars?: number;
  /** Characters of trailing context repeated at the start of the next chunk. Default 150. */
  overlap?: number;
}
