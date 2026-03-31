# Local AI Memory Budgets: A Systems Deep Dive

Local large language models occupy a fundamentally different resource space than their cloud-hosted counterparts.
When a model such as Mistral-7B is loaded entirely into RAM, it consumes approximately 14 GB of VRAM in
full-precision (FP32) mode, or roughly 7 GB when quantized to INT8. Understanding this cost is the first
step in designing a sustainable local AI architecture for note-management software like Joplin.

## Why Memory Budgets Matter for Local LLMs

Unlike cloud APIs where the infrastructure is abstracted away, a local AI assistant must coexist with the
host operating system, the Electron shell, and every other running process. On a typical developer machine
with 16 GB of unified memory (e.g., Apple M-series or mid-range Windows laptop), the memory pressure from
a naively integrated LLM can render the entire application unusable.

The key insight is that **inference and embedding are separate workloads** with very different memory profiles:

- **Embedding models** (e.g., `bge-small-en-v1.5`): ~30–90 MB on disk, minimal RAM overhead at runtime.
- **Generative LLMs** (e.g., Mistral-7B Q4_K_M): ~4–5 GB RAM, requires a persistent server process.
- **KV Cache**: Scales with context window size; a 4096-token context can add another 1–2 GB of transient memory.

For a Retrieval-Augmented Generation (RAG) pipeline, the embedding model does the heavy lifting of
**semantic search** while the generative model only ever sees a small, pre-filtered context window.
This decoupling is the architectural cornerstone of any memory-efficient local AI system.

## Quantization Strategies and Their Trade-offs

Quantization reduces the numerical precision of model weights, trading a small amount of accuracy for
dramatic reductions in memory footprint and inference latency.

### GGUF / llama.cpp Formats

The GGUF format, popularized by the `llama.cpp` project, supports a range of quantization levels:

```
Q4_K_M  ~4.8 GB  — Best quality-to-size ratio for 7B models. Recommended default.
Q5_K_M  ~5.7 GB  — Slightly better quality, acceptable memory overhead.
Q8_0    ~7.7 GB  — Near-lossless; requires 16 GB+ RAM to run comfortably.
F16     ~14 GB   — Full half-precision; only practical on high-end hardware.
```

A practical rule of thumb: **quantize to the largest format your system can load with 20% free RAM
headroom remaining**. Running with less headroom causes OS-level swap thrashing, which increases
inference time from milliseconds to seconds.

### ONNX / Transformers.js

For embedding-only workloads — which is exactly the use case for a Joplin RAG pipeline — the
`@xenova/transformers` library (Transformers.js) provides ONNX-quantized models that run entirely
in Node.js without any native binaries or GPU drivers.

The `Xenova/bge-small-en-v1.5` model produces 384-dimensional dense vectors and weighs under 50 MB.
This makes it the ideal candidate for a local-first note embedding system that must be installable
via a single `npm install` command with zero system-level dependencies.

## Chunking Strategy and Its Impact on Retrieval Quality

The quality of a RAG system is bounded by its chunking strategy. Naive fixed-size character splitting
produces chunks that may cut across sentence or paragraph boundaries, severing semantic units and
degrading both embedding quality and retrieval precision.

A **heading-aware chunking** strategy treats each Markdown section as a discrete semantic unit:

1. Split the document at heading boundaries (`#`, `##`, `###`).
2. Preserve the heading text as a prefix within its own chunk to anchor the semantic topic.
3. Optionally carry the parent heading as a breadcrumb for nested sections.

This approach is superior for note-taking corpora because Joplin notes are inherently structured
documents, not free-form prose. The heading hierarchy is a user-expressed semantic signal that
should be preserved, not discarded during preprocessing.

## Persistent Vector Stores Without a Database Server

For a production Joplin integration, embeddings must persist across sessions without requiring
a running database server. The recommended architecture for this constraint is:

- **`usearch`** or **`hnswlib-node`**: Approximate nearest-neighbor index serializable to a flat file.
- **SQLite with `sqlite-vss`**: Vector similarity search as a SQLite extension — aligns perfectly
  with Joplin's existing use of SQLite for its note database.
- **`vectra`**: A pure JavaScript local vector store that stores index data as JSON files in the
  user's profile directory.

The `sqlite-vss` path is architecturally the most coherent for Joplin, as it reuses the existing
database infrastructure and allows vector lookups to be co-located with full-text search via FTS5.
