# VedaAI — AI Assessment Extraction & Answer Mapping

Upload question paper + student handwritten answer sheet, extract questions/answers,
map them, highlight exact answer regions on the sheet, grade with AI feedback.

## Status: COMPLETE — all 7 phases built, lint + typecheck + build pass

## Decisions (final)

| Decision | Choice |
|---|---|
| Stack | Next.js 16 App Router, React 19, Tailwind v4, shadcn |
| State management | Plain React state (useReducer + props/context) |
| Persistence | IndexedDB via raw browser API (`lib/storage.ts`) |
| Server / client split | All AI/API calls in route handlers; PDF→page images client-side |
| PDF parsing | `pdfjs-dist`, worker from `/public/pdf.worker.min.mjs` |
| Primary extractor | Sarvam DocAI Extract (`output_format: "json"`) |
| Secondary extractor | Gemini 2.0 Flash Lite (vision LLM) |
| Grading | Gemini Flash Lite (marks + verdict + feedback + summary) |
| Tooling | bun for install, lint, typecheck |
| Deployment | Vercel; API keys server-side only |

## Architecture

```
CLIENT                                    SERVER
├─ pdfjs-dist → page JPEGs + dims         app/api/
├─ IndexedDB: page Blobs + extracted JSON ├─ extract/route.ts
├─ React reducer: pages, Qs, As, map,     │   └─ provider.ts (sarvam | gemini)
│    activeId, pipeline stage             │       └─ sarvam.ts / gemini.ts
├─ Left panel: question list              └─ grade/route.ts   (Gemini-based)
├─ Right pane: sheet viewer + overlays
└─ Pipeline stepper (upload→extract→review→grade)
```

## File structure

```
lib/
  types.ts              — data model (BBox, Question, Answer, MappedItem, Grade, Summary)
  storage.ts            — raw IndexedDB layer (documents + extractions stores)
  pdf.ts                — client-side PDF→JPEG page images
  ai/
    types.ts            — extraction-specific types (ExtractedQuestion, ExtractedAnswer)
    provider.ts         — provider abstraction + Sarvam/Gemini adapters
    mapping.ts          — deterministic number normalization + question↔answer matching

app/
  page.tsx              — main page (header + Workspace)
  layout.tsx            — root layout + metadata
  globals.css           — Tailwind v4 + shadcn theme
  api/
    extract/route.ts    — POST endpoint for extraction
    grade/route.ts      — POST endpoint for grading

components/workspace/
  workspace.tsx         — main orchestrator (upload + extraction + grading + results)
  upload-slot.tsx       — drag-and-drop upload with thumbnails
  sheet-viewer.tsx      — page images with overlay bbox highlighting
  question-list.tsx     — question list with status badges + grades
  grade-summary.tsx     — overall score + verdict breakdown
  pipeline-stepper.tsx  — progress indicator (Upload→Extract→Review→Grade)
  extraction-progress.tsx — loading/error states for async operations

public/
  pdf.worker.min.mjs    — vendored pdf.js worker (no CDN)
```

## Sarvam SDK specifics (verified against sarvamai@1.1.8 types)

- `client.docAi.extract({ file, language, output_format })` — starts async job
- `client.docAi.getStatus(job_id)` — returns `DocAiJobStatusResponse` directly (not wrapped)
- Terminal states: `completed | partially_completed | failed | rejected`
- `client.docAi.getResults(job_id)` — structured results or fall back to ZIP download
- `client.docAi.getDownloadUrl(job_id)` — presigned URL for ZIP download
- `HttpResponsePromise<T>` resolves to `T` directly when awaited (unwraps `.data`)

## Pipeline stages

1. **Upload** — dual dropzones; pdf.js renders pages to JPEG blobs (scale 2.0, max 2400px);
   images accepted directly; page-count cap warning (>15).
2. **Extract** — fires both documents to Sarvam/Gemini in parallel; live stage progress.
3. **Review** — question list (left) + sheet viewer with overlay highlighting (right).
   Click question → highlight answer regions. Unmatched answers in separate bucket.
4. **Grade** — matched pairs graded by Gemini; marks, verdict, feedback per question;
   overall summary card with score, breakdown, circle gauge.

## Highlighting mechanism

- Regions stored normalized 0–1; overlay divs positioned with `%` inside `relative`
  container wrapping each page `<img>` → resolution-independent.
- Click question → `activeId` → boxes animate in.
- Unanswered → explicit badge, no region. Unmatched answers in their own bucket.

## Environment variables

```
SARVAM_API_KEY=      # Sarvam DocAI
GEMINI_API_KEY=      # Google Gemini
```

## Build verification

```
bun run lint          ✓ (0 errors, 0 warnings)
bun run build         ✓ (TypeScript + Turbopack build passes)
```

Routes registered:
- `○ /` (static page)
- `ƒ /api/extract` (dynamic)
- `ƒ /api/grade` (dynamic)
