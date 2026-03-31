/**
 * joplin-local-rag-poc — Main entry point
 *
 * Pipeline:
 *   1. Load a Markdown note from disk.
 *   2. Split it into heading-aware semantic chunks.
 *   3. Initialise the Transformers.js embedding pipeline (fully local, no network
 *      call required after the first model download).
 *   4. Generate 384-dim BGE-small vectors for every chunk.
 *   5. Pretty-print results to stdout.
 */

import fs from 'fs';
import path from 'path';
import { chunkMarkdown, Chunk } from './chunker';

// Transformers.js ships ESM-only; the CJS interop shim is handled by ts-node
// via `esModuleInterop: true` in tsconfig.json.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pipeline, env } = require('@xenova/transformers');

// Force the library to use a local cache directory so the model is stored
// inside the project rather than in an OS-level temp folder.
env.cacheDir = path.resolve(__dirname, '..', '.model-cache');

// Silence verbose progress bars during non-interactive runs.
env.allowLocalModels = true;

const NOTE_PATH = path.resolve(__dirname, '..', 'test_notes', 'sample.md');
const MODEL_ID = 'Xenova/bge-small-en-v1.5';
const TASK = 'feature-extraction';
const VECTOR_PREVIEW_LENGTH = 6;

// ── Helpers ──────────────────────────────────────────────────────────────────

function separator(char = '─', width = 72): string {
  return char.repeat(width);
}

function truncate(s: string, max = 120): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/**
 * Normalises a Float32Array embedding vector to unit length (L2 norm).
 * BGE models are trained with cosine similarity so normalised vectors enable
 * fast dot-product search without an explicit cosine computation.
 */
function l2Normalize(vec: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const norm = Math.sqrt(sum);
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}

/**
 * Extracts the flat embedding vector from the nested tensor output that
 * @xenova/transformers returns for feature-extraction tasks.
 *
 * The raw output shape is [1, sequence_length, hidden_size].
 * BGE uses mean pooling across the sequence dimension to produce a single
 * 384-dimensional sentence vector.
 */
function meanPool(tensorData: number[][][]): Float32Array {
  const sequenceVectors = tensorData[0]; // shape: [seq_len, hidden_size]
  const hiddenSize = sequenceVectors[0].length;
  const pooled = new Float32Array(hiddenSize);

  for (const tokenVec of sequenceVectors) {
    for (let i = 0; i < hiddenSize; i++) {
      pooled[i] += tokenVec[i];
    }
  }

  const seqLen = sequenceVectors.length;
  for (let i = 0; i < hiddenSize; i++) {
    pooled[i] /= seqLen;
  }

  return pooled;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n' + separator('═'));
  console.log('  Joplin Local-First RAG — Proof of Concept');
  console.log('  Model : ' + MODEL_ID);
  console.log('  Task  : ' + TASK);
  console.log(separator('═') + '\n');

  // Step 1 — Load note
  if (!fs.existsSync(NOTE_PATH)) {
    throw new Error(`Sample note not found at: ${NOTE_PATH}`);
  }
  const markdown = fs.readFileSync(NOTE_PATH, 'utf-8');
  console.log(`Loaded note: ${NOTE_PATH}`);
  console.log(`  Total characters : ${markdown.length}`);
  console.log(`  Total lines      : ${markdown.split('\n').length}\n`);

  // Step 2 — Chunk
  console.log('Running heading-aware chunker…');
  const chunks: Chunk[] = chunkMarkdown(markdown);
  console.log(`  Produced ${chunks.length} chunks\n`);

  // Step 3 — Initialise embedding pipeline
  console.log('Initialising Transformers.js pipeline…');
  console.log('  (First run downloads ~45 MB model to .model-cache/ — subsequent runs are instant)\n');
  const extractor = await pipeline(TASK, MODEL_ID, {
    quantized: true, // use the ONNX INT8-quantized variant for lower memory usage
  });
  console.log('  Pipeline ready.\n');

  // Step 4 — Embed each chunk
  console.log(separator());
  console.log('  CHUNK EMBEDDINGS');
  console.log(separator());

  const results: Array<{ chunk: Chunk; vector: Float32Array }> = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    // BGE models perform best when the query prefix is applied at retrieval
    // time, not during indexing. At index time we embed the raw content.
    const output = await extractor(chunk.content, {
      pooling: 'mean',
      normalize: true,
    });

    // output.data is a flat Float32Array of shape [hidden_size] when
    // pooling + normalize are requested directly by the pipeline options.
    // If the pipeline returns nested data, fall back to manual mean pooling.
    let vector: Float32Array;
    if (output.data instanceof Float32Array) {
      vector = output.data;
    } else {
      // Manual mean pool fallback for older transformer.js versions
      const raw = output.tolist() as number[][][];
      vector = l2Normalize(meanPool(raw));
    }

    results.push({ chunk, vector });

    const preview = truncate(chunk.content.replace(/\n/g, ' '), 100);
    const vecSlice = Array.from(vector.slice(0, VECTOR_PREVIEW_LENGTH))
      .map((v) => v.toFixed(5))
      .join(', ');

    console.log(`\n[Chunk ${i + 1}/${chunks.length}]`);
    console.log(`  Breadcrumb : ${chunk.breadcrumb}`);
    console.log(`  Level      : ${'#'.repeat(chunk.level || 1)} (H${chunk.level || 'pre'})`);
    console.log(`  Chars      : ${chunk.content.length}`);
    console.log(`  Preview    : "${preview}"`);
    console.log(`  Dimensions : ${vector.length}`);
    console.log(`  Vector[0:${VECTOR_PREVIEW_LENGTH}]: [${vecSlice}, …]`);
  }

  console.log('\n' + separator());
  console.log('  SUMMARY');
  console.log(separator());
  console.log(`  Chunks embedded : ${results.length}`);
  console.log(`  Vector dims     : ${results[0]?.vector.length ?? 'N/A'}`);
  console.log(`  Memory model    : fully local — zero network calls after model download`);
  console.log(separator() + '\n');
}

main().catch((err: unknown) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
