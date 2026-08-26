# VedaAI â€” AI Assessment Extraction & Answer Mapping

Build plan: upload question paper + student handwritten answer sheet, extract questions/answers,
map them, highlight exact answer regions on the sheet, grade with AI feedback.

## Status: DECIDED â€” awaiting go-ahead to build

## Decisions (final)

| Decision | Choice |
|---|---|
| Stack | Next.js 16 App Router, React 19, Tailwind v4, shadcn |
| State management | **No zustand.** Plain React state (`useReducer` + props/context) for live UI state |
| Persistence | **IndexedDB via raw browser API** (zero extra deps; `lib/storage.ts` modeled on the user's proven openDatabase/transaction pattern) for heavy data: page image Blobs + extracted JSON; hydrate on mount so refresh mid-flow doesn't lose work |
| Server / client split | **All AI/API calls in route handlers** (`app/api/*/route.ts`). **Heavy browser-capable processing stays client-side**: PDFâ†’page images (pdfjs-dist), image prep, region overlay math |
| PDF parsing | `pdfjs-dist`, fully client-side; worker served locally from `/public` (no CDN dependency) |
| Primary extractor | **Sarvam DocAI Digitise** (`output_format: "json"` â†’ ZIP with `metadata/page_NNN.json`: text blocks + tags + bounding boxes) |
| Secondary extractor | Gemini flash-lite (vision LLM, one-shot OCR + structure + normalized bboxes) |
| Fallback | Z.ai GLM-4.6V-flash |
| Grading | Included in v1 (marks + verdict + per-question feedback + overall summary) |
| UI guide | Follow `frontendSkill.md`: functional visualizations over decoration, restrained surfaces/borders/shadows, hierarchy before effects, intentional light/dark |
| Tooling | bun for install, lint, typecheck |
| Deployment | Vercel; API keys server-side only |

## Sarvam JS/TS SDK specifics (verified against docs)

- Client: `new SarvamAIClient({ apiSubscriptionKey: process.env.SARVAM_API_KEY })`
- `client.docAi.digitise({ file: [new File([buffer], name, { type })], language: "en-IN", output_format: "json" })`
  - `file` must be a **list**, even single document
  - use `language` / `output_format` (**not** `language_code`, not `"markdown"` â€” 400 error)
- `client.docAi.getStatus(job_id)` â€” `job_id` is a **positional argument**
- Terminal states: `completed | partially_completed | failed | rejected`
- `client.docAi.getDownloadUrl(job_id)` â†’ fetch ZIP â†’ parse `metadata/page_NNN.json`
- Each block: `text`, `tag` (paragraph/heading/tableâ€¦), **bounding box**

### Sarvam caveats handled by design

1. **Block-level granularity** â€” an answer may span several blocks â†’ after mapping answer text
   to constituent blocks, compute **union rect** as the answer region.
2. **Coordinate units unknown until tested** â€” one adapter function normalizes whatever units
   Sarvam returns to `0â€“1` relative to page size. Verify against a sample in Phase 3.
3. **Async job lifecycle latency (~10â€“30s/doc)** â€” client fires question-paper and answer-sheet
   jobs in parallel, live stage progress shown.
4. **ZIP parsing** â€” `fflate` (tiny) to unzip; only page JSONs needed.

## Architecture

```
CLIENT (heavy local processing)             SERVER (all external API calls)
â”œâ”€ pdfjs-dist â†’ page JPEGs + dims           app/api/
â”‚    both uploads unified to image arrays   â”œâ”€ extract/route.ts
â”œâ”€ IndexedDB (idb-keyval):                  â”‚    â”œâ”€ sarvam.ts   (job â†’ poll â†’ zip â†’ blocks)
â”‚    page Blobs + extracted JSON            â”‚    â””â”€ gemini.ts   (vision LLM, zod-validated JSON)
â”œâ”€ React reducer: pages, Qs, As, map,       â”œâ”€ match/route.ts   (LLM fallback for leftovers)
â”‚    activeId, pipeline stage               â””â”€ grade/route.ts   (batched pairs)
â”œâ”€ Left panel: question list
â””â”€ Right pane: sheet viewer + %-based overlay boxes
```

Provider abstraction (`lib/ai/provider.ts`): `sarvam | gemini | glm` via env var; all adapters
return the same normalized shape. Gemini/GLM prompts request normalized `[0â€“1]` boxes
(Gemini native convention: `[ymin,xmin,ymax,xmax] Ã· 1000`) â€” same target schema as the
Sarvam adapter output. Keys never reach the client.

## Data model (`lib/types.ts`)

```ts
PageImage   { id, index, url, width, height }
BBox        { x, y, w, h }              // normalized 0â€“1
Question    { id, number: "11(a)", text, page }
Answer      { id, label, text, regions: { page: number; bbox: BBox }[] }
MappedItem  { question, answer | null, status: "matched" | "unanswered" | "unmatched", grade? }
Grade       { marks, maxMarks, verdict, feedback }
Summary     { totalScore, perVerdictCounts, overallFeedback }
```

## Pipeline stages (progress stepper UI)

1. **Upload** â€” dual dropzones; pdf.js renders pages to JPEG blobs (scale â‰ˆ 2.0);
   images accepted directly; page-count cap warning (>15).
2. **Extract questions** â€” preserves original numbering; labelled sub-parts split into
   separate entries (`11(a)`, `11(b)`); printed order preserved.
3. **Extract answers** â€” per-page blocks/regions; multi-page answers â†’ multiple regions;
   Sarvam path merges consecutive/overlapping blocks into answer regions.
4. **Map** â€” deterministic number normalization first (`11(a)` â‰¡ `11 a` â‰¡ `Q11(i)`),
   order-independent; `/api/match` LLM fallback only for leftovers.
5. **Grade** â€” batched matched pairs â†’ marks, verdict, feedback, overall summary card.

## Highlighting mechanism (core feature)

- Regions stored normalized `0â€“1`; overlay divs positioned with `%` inside a `relative`
  container wrapping each page `<img>` â†’ resolution-independent, no pixel math.
- Hover/click question â†’ set `activeId` â†’ boxes animate in + page auto-scrolls.
- Unanswered â†’ explicit badge, no region. Unmatched answers listed in their own bucket.

## Edge cases covered

Out-of-order answers Â· unanswered questions Â· unmatched answers bucket Â· multi-page spans Â·
sub-part splitting Â· rotated/skewed scans (provider-dependent) Â· empty/unreadable pages Â·
refresh resilience via IndexedDB.

## Build phases (each ends with lint + typecheck via bun)

1. Scaffold: dropzones, client-side parse, page thumbnails, reducer store, IndexedDB layer.
2. `/api/extract` â€” Sarvam adapter first (job lifecycle + zip parsing + bbox normalization).
3. Gemini adapter behind same interface; compare on a real messy sheet; verify Sarvam bbox
   units here. Pick default provider based on results.
4. Sheet viewer with overlay highlighting â€” validate visually before building further.
5. Mapping logic + status badges.
6. Grading endpoints + summary UI.
7. Figma polish per `frontendSkill.md`, README (approach, models, assumptions), deploy.

## Risks

- **Sarvam bbox fidelity on handwriting** â€” block boxes may be coarse for cursive layouts;
  mitigated by union-rect merging and Gemini fallback.
- **Vercel function timeouts** â€” polling loops kept short; client-driven parallel jobs +
  progress instead of one long request.
- **LLM JSON drift** â€” all model outputs zod-validated; one retry, then fallback provider.
- **Local env quirk observed** â€” two `bun add` runs failed with transient `EPERM`
  (`NtSetInformationFile`) while caching packages; retry/split installs when build starts.
