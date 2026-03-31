/**
 * Heading-Aware Markdown Chunker
 *
 * Design rationale: Joplin notes are structured documents. Every `#` or `##`
 * heading is an explicit semantic boundary authored by the user. Slicing on
 * those boundaries — and carrying the heading text into each chunk — preserves
 * the topical identity of each piece of content during embedding and retrieval.
 *
 * This is intentionally NOT a generic recursive character splitter. It is a
 * document-structure-aware strategy tuned for Markdown note corpora.
 */

export interface Chunk {
  /** The heading path leading to this chunk, e.g. "Parent Heading > Sub Heading" */
  breadcrumb: string;
  /** The full text content of the chunk including its own heading line */
  content: string;
  /** Source heading level (1 = #, 2 = ##, 0 = preamble before any heading) */
  level: number;
}

/**
 * Heading line regex. Captures:
 *   group 1 — the `#` characters (determines heading level)
 *   group 2 — the heading title text (trimmed)
 */
const HEADING_RE = /^(#{1,6})\s+(.+)$/;

/**
 * Splits a Markdown string into semantically coherent chunks at heading
 * boundaries. Each chunk includes:
 *   - Its own heading line (so embedding captures the topic signal)
 *   - All body text up until the next heading of equal or higher rank
 *
 * Behaviour:
 *   - A preamble chunk is emitted for any content before the first heading.
 *   - Empty chunks (headings with no body text) are still included; the heading
 *     itself carries semantic value.
 *   - Code fences are treated as opaque blocks — headings inside ``` are ignored.
 *
 * @param markdown - Raw Markdown string to be chunked.
 * @param minChunkLength - Chunks shorter than this (in characters) are merged
 *                         with the following chunk. Defaults to 40.
 */
export function chunkMarkdown(markdown: string, minChunkLength = 40): Chunk[] {
  const lines = markdown.split('\n');
  const chunks: Chunk[] = [];

  let currentHeading = '';
  let currentLevel = 0;
  let currentLines: string[] = [];
  let inCodeFence = false;

  // Breadcrumb stack: index = heading level (1-based), value = heading title
  const breadcrumbStack: string[] = new Array(7).fill('');

  const flushChunk = (): void => {
    const content = currentLines.join('\n').trimEnd();
    if (content.length === 0) return;

    // Build breadcrumb from all ancestor headings
    const ancestors = breadcrumbStack
      .slice(1, currentLevel)
      .filter((s) => s.length > 0);
    const breadcrumb =
      ancestors.length > 0
        ? [...ancestors, currentHeading].filter(Boolean).join(' > ')
        : currentHeading;

    chunks.push({
      breadcrumb: breadcrumb || '(preamble)',
      content,
      level: currentLevel,
    });
  };

  for (const line of lines) {
    // Track code fences to avoid treating headings inside them as section breaks
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inCodeFence = !inCodeFence;
      currentLines.push(line);
      continue;
    }

    if (!inCodeFence) {
      const match = HEADING_RE.exec(trimmed);
      if (match) {
        const level = match[1].length;
        const title = match[2].trim();

        // Flush the previous chunk before starting a new section
        flushChunk();

        // Clear breadcrumb stack for any levels deeper than the new heading
        for (let i = level; i < breadcrumbStack.length; i++) {
          breadcrumbStack[i] = '';
        }
        breadcrumbStack[level] = title;

        currentHeading = title;
        currentLevel = level;
        currentLines = [line]; // include the heading line itself in the chunk
        continue;
      }
    }

    currentLines.push(line);
  }

  // Flush the final section
  flushChunk();

  // Merge chunks that are too short into their successor to avoid
  // degenerate single-sentence embeddings
  return mergeShortChunks(chunks, minChunkLength);
}

function mergeShortChunks(chunks: Chunk[], minLength: number): Chunk[] {
  if (chunks.length === 0) return chunks;

  const merged: Chunk[] = [];
  let pending: Chunk | null = null;

  for (const chunk of chunks) {
    if (pending === null) {
      pending = { ...chunk };
      continue;
    }

    if (pending.content.length < minLength) {
      // Absorb the current chunk into the pending one
      pending = {
        breadcrumb: pending.breadcrumb,
        content: pending.content + '\n\n' + chunk.content,
        level: pending.level,
      };
    } else {
      merged.push(pending);
      pending = { ...chunk };
    }
  }

  if (pending !== null) {
    merged.push(pending);
  }

  return merged;
}
