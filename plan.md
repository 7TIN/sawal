# VedaAI — AI Assessment Extraction & Answer Mapping

Upload question paper + student handwritten answer sheet, extract questions/answers,
map them, highlight exact answer regions on the sheet, grade with AI feedback.

## Status: COMPLETE — all phases built; lint + typecheck + build pass

## Extraction pipeline hardening (completed)

- **Whole-file upload** — client stores the original file (`StoredDocument.originalFile`)
  and streams it to `/api/extract` (previously rendered page JPEGs were re-combined and sent,
  which broke OCR). Filenames are passed through to the providers.
- **Question paper** → Sarvam `digitise` (`output_format: "md"`), so question text is exact.
- **Answer sheet** → Sarvam `extract` with a JSON schema (`answers[]` with
  `label/text/page/bbox_x/bbox_y/bbox_w/bbox_h`). Schema requires `description` on every node
  incl. root + `items` (Sarvam rejects `SCHEMA_INVALID` otherwise).
- **Smart question parser** (`lib/ai/parser.ts`) — detects `1.` / `1)` / `(1)` / `Q1` /
  `Question 1` and sub-questions `1(a)` `1(b)`, `a) b) c)`, `a(1) a(2)`, roman `(i) (ii)`;
  flattens to numbered keys for matching (`1a` ≡ `1(a)`). Strips markdown artifacts
  (`**`, `#`, `-`, backticks) before matching one-line-at-a-time.
- **Sarvam digitise decoding** — digitise returns one JSON string *per page*
  (`{"page_num":N,"blocks":[{"coordinates":{x1,y1,..},"text":"..."}]}`), NOT markdown.
  `reconstructDigitisePage` parses each page, walks `blocks/pages/elements/content`
  containers, pulls block `text`, and sorts by `(y1,x1)` into reading order before the
  question parser sees it. Orphan bare-number markers (`1` + next line) are glued together.
- **MCQ option handling** — after a numbered question, up to 6 uppercase single-letter lines
  (`A.`–`E.`) are absorbed as `question.options` (rendered in the expanded panel), so options
  are NOT mis-read as sub-questions. Genuine `a)`/`(a)`/roman sub-parts still become subs.
- **No silent failures** — if `questions` AND `answers` come back empty, the client shows an
  explicit warning card with a raw-text preview and a retry button instead of hiding behind
  the upload stage. Server logs the parsed counts + a sample of the digitised page text.
- **Matching** (`lib/ai/mapping.ts`) — label/text includes, answer number ref detection,
  word-overlap scoring, roman-number conversion; unmatched answers bucketed separately.
  Answers whose label/text carry the question number get a strong direct-match bonus;
  a **positional fallback** then fills numeric gaps between two matched neighbours'
  regions (e.g. Q10 between Q9/Q11, Q17 between Q16/Q18) so no answered question is left
  unresolved when OCR/transcript omits the number.
- **UI** — expandable question rows (click → student answer + AI feedback in same panel),
  unanswered questions shown in red, click-to-locate that auto-scrolls the sheet
  viewer to the right page. Answer regions render as **rounded, dotted-line green boxes**
  (no page dimming); hover shows any region, active question's boxes are emphasised.
- **IndexedDB caching + logging** — extract/mapping/grade results are persisted and reused
  on reload so API cost isn't repeated; Reset deletes the cached extraction + logs for a
  fresh run. Raw `/api/extract`, `/api/grade` and mapping payloads are logged to a `logs`
  store and viewable in an in-app "API & mapping logs" panel.
- **Grading** — rubric-based Gemini prompt (correctness/completeness/clarity/evidence),
  `temperature 0.3`, JSON-parse fallback to zero grades, per-question marks + verdict +
  feedback + overall summary.
- Sarvam `digitise` may return a ZIP (marked-text) — fallback uses `getDownloadUrl` + `fflate`.

## Decisions (final)

| Decision | Choice |
|---|---|
| Stack | Next.js 16 App Router, React 19, Tailwind v4, shadcn |
| State management | Plain React state (useReducer + props/context) |
| Persistence | IndexedDB via raw browser API (`lib/storage.ts`) |
| Server / client split | All AI/API calls in route handlers; PDF→page images client-side |
| PDF parsing | `pdfjs-dist`, worker from `/public/pdf.worker.min.mjs` |
| Primary extractor | Sarvam DocAI Extract (`output_format: "json"`) |
| Secondary extractor | Gemini 3.5 Flash-Lite (vision LLM) |
| Grading | Gemini 3.5 Flash-Lite (marks + verdict + feedback + summary) |
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
    parser.ts           — smart question/number parsing + normalization
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
- Click question → `activeId` → boxes animate in; sheet auto-scrolls to the answer page.
- Non-active pages dim while a question is focused.
- Unanswered → red badge + explanation. Unmatched answers in their own bucket.
- Labels on the canvas show the matched question number (e.g. `Q1(a)`).

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
