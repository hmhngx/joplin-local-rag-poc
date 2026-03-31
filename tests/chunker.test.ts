import { chunkMarkdown, Chunk } from '../src/chunker';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SIMPLE_DOC = `# Alpha

First paragraph of Alpha.
Second sentence of the first paragraph.

## Beta

Content under Beta.
More content here.

## Gamma

Content under Gamma.
`;

const PREAMBLE_DOC = `This is content before any heading.
It should form a preamble chunk.

# First Heading

Body of first heading.
`;

const CODE_FENCE_DOC = `# Real Heading

Some text before the fence.

\`\`\`
# This looks like a heading but is inside a code fence
## Also fake
\`\`\`

After the fence.
`;

const DEEP_NESTING_DOC = `# Root

Root content.

## Child

Child content.

### Grandchild

Grandchild content.
`;

const EMPTY_HEADING_DOC = `# Heading With No Body

# Next Heading

Has body.
`;

const MULTI_PARAGRAPH_DOC = `# Section

Paragraph one. It contains multiple sentences. No break mid-sentence should occur.
Paragraph two follows. It also has multiple sentences and should stay with its section.
`;

// ── Suite: basic splitting ────────────────────────────────────────────────────

describe('chunkMarkdown — basic splitting', () => {
  // Use minChunkLength=0 so no merging obscures individual sections
  let chunks: Chunk[];

  beforeEach(() => {
    chunks = chunkMarkdown(SIMPLE_DOC, 0);
  });

  it('produces one chunk per top-level heading section', () => {
    // Beta and Gamma are H2 under Alpha — breadcrumb includes ancestor path
    const headings = chunks.map((c) => c.breadcrumb);
    expect(headings).toContain('Alpha');
    expect(headings).toContain('Alpha > Beta');
    expect(headings).toContain('Alpha > Gamma');
  });

  it('includes the heading line inside the chunk content', () => {
    const alphaChunk = chunks.find((c) => c.breadcrumb === 'Alpha');
    expect(alphaChunk).toBeDefined();
    expect(alphaChunk!.content).toMatch(/^# Alpha/);
  });

  it('keeps body text together with its heading', () => {
    const betaChunk = chunks.find((c) => c.breadcrumb === 'Alpha > Beta');
    expect(betaChunk).toBeDefined();
    expect(betaChunk!.content).toContain('Content under Beta.');
    expect(betaChunk!.content).toContain('More content here.');
  });

  it('does not bleed content from one section into another', () => {
    const betaChunk = chunks.find((c) => c.breadcrumb === 'Alpha > Beta');
    expect(betaChunk!.content).not.toContain('Content under Gamma.');
  });

  it('records the correct heading level', () => {
    const alphaChunk = chunks.find((c) => c.breadcrumb === 'Alpha');
    const betaChunk = chunks.find((c) => c.breadcrumb === 'Alpha > Beta');
    expect(alphaChunk!.level).toBe(1);
    expect(betaChunk!.level).toBe(2);
  });
});

// ── Suite: preamble handling ──────────────────────────────────────────────────

describe('chunkMarkdown — preamble handling', () => {
  it('creates a preamble chunk for content before the first heading', () => {
    const chunks = chunkMarkdown(PREAMBLE_DOC);
    const preamble = chunks.find((c) => c.breadcrumb === '(preamble)');
    expect(preamble).toBeDefined();
    expect(preamble!.content).toContain('This is content before any heading.');
  });

  it('preamble chunk has level 0', () => {
    const chunks = chunkMarkdown(PREAMBLE_DOC);
    const preamble = chunks.find((c) => c.breadcrumb === '(preamble)');
    expect(preamble!.level).toBe(0);
  });
});

// ── Suite: code fence immunity ────────────────────────────────────────────────

describe('chunkMarkdown — code fence immunity', () => {
  it('does not treat headings inside code fences as section boundaries', () => {
    const chunks = chunkMarkdown(CODE_FENCE_DOC);
    const headingTitles = chunks.map((c) => c.breadcrumb);

    // The real heading should produce a chunk
    expect(headingTitles).toContain('Real Heading');

    // Headings inside the fence must NOT produce chunks
    expect(headingTitles).not.toContain('This looks like a heading but is inside a code fence');
    expect(headingTitles).not.toContain('Also fake');
  });

  it('keeps code fence content inside the parent section chunk', () => {
    const chunks = chunkMarkdown(CODE_FENCE_DOC);
    const realChunk = chunks.find((c) => c.breadcrumb === 'Real Heading');
    expect(realChunk!.content).toContain('# This looks like a heading but is inside a code fence');
  });
});

// ── Suite: deep nesting / breadcrumbs ────────────────────────────────────────

describe('chunkMarkdown — deep nesting and breadcrumbs', () => {
  // Disable merging so every section is individually addressable in assertions
  let chunks: Chunk[];

  beforeEach(() => {
    chunks = chunkMarkdown(DEEP_NESTING_DOC, 0);
  });

  it('builds breadcrumb path for nested sections', () => {
    const grandchild = chunks.find((c) => c.breadcrumb.includes('Grandchild'));
    expect(grandchild).toBeDefined();
    expect(grandchild!.breadcrumb).toBe('Root > Child > Grandchild');
  });

  it('does not include deeper-level ancestors in a parent chunk breadcrumb', () => {
    const child = chunks.find((c) => c.breadcrumb === 'Root > Child');
    expect(child).toBeDefined();
    expect(child!.breadcrumb).not.toContain('Grandchild');
  });
});

// ── Suite: sentence integrity ─────────────────────────────────────────────────

describe('chunkMarkdown — sentence integrity', () => {
  it('never splits mid-sentence', () => {
    const chunks = chunkMarkdown(MULTI_PARAGRAPH_DOC);
    const section = chunks.find((c) => c.breadcrumb === 'Section');
    expect(section).toBeDefined();

    // Both full sentences must be present and unbroken
    expect(section!.content).toContain(
      'Paragraph one. It contains multiple sentences. No break mid-sentence should occur.'
    );
    expect(section!.content).toContain(
      'Paragraph two follows. It also has multiple sentences and should stay with its section.'
    );
  });
});

// ── Suite: edge cases ─────────────────────────────────────────────────────────

describe('chunkMarkdown — edge cases', () => {
  it('returns an empty array for an empty string', () => {
    expect(chunkMarkdown('')).toEqual([]);
  });

  it('returns a single preamble chunk for content with no headings', () => {
    const chunks = chunkMarkdown('Just some plain text.\nNo headings at all.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].breadcrumb).toBe('(preamble)');
  });

  it('handles a document that is only headings with no body (empty heading)', () => {
    // empty headings may be merged due to minChunkLength — just assert no crash
    // and that we get at least one chunk back
    const chunks = chunkMarkdown(EMPTY_HEADING_DOC);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('does not produce chunks with undefined or null content', () => {
    const chunks = chunkMarkdown(SIMPLE_DOC);
    for (const chunk of chunks) {
      expect(chunk.content).toBeDefined();
      expect(chunk.content).not.toBeNull();
      expect(typeof chunk.content).toBe('string');
    }
  });

  it('respects minChunkLength by merging very short chunks', () => {
    // With a high threshold every chunk should be merged
    const chunksLowThreshold = chunkMarkdown(SIMPLE_DOC, 0);
    const chunksHighThreshold = chunkMarkdown(SIMPLE_DOC, 100_000);
    // High threshold forces everything into fewer (or equal) chunks
    expect(chunksHighThreshold.length).toBeLessThanOrEqual(chunksLowThreshold.length);
  });
});
