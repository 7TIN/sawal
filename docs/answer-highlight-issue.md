# Answer-Sheet Highlights Not Rendering — Full Issue Report

Status: **BUG OPEN — NO HIGHLIGHT BOXES RENDER AT ALL** (as of the raw-response/stored-offline round).
This document is a self-contained, line-referenced handoff so another engineer/model can diagnose and fix it without re-discovering the history.

---

## 1. Symptom

- After an extraction (live **or** "Use saved" offline), questions/answers exist, but the answer-sheet viewer shows **zero** highlight boxes — not one region, not even on any page.
- `[extract] gap-clustered X/35 answers across ... regions` console line — when this prints **0/0**, zero boxes is guaranteed. (See §5 for how to read the logs.)
- Simulated printed-sheet data produced 35/35 correct boxes (§7), yet the real sheet renders nothing → the failure is **specific to the real digitise output shape/content**, not the renderer.

> Check first: is the answer-sheet PDF itself visible in the viewer (page images)? If pages are missing, `SheetViewer` renders nothing by definition — that is a *slot-hydration* issue, not a geometry issue. Everything below assumes pages render and the bug is *geometry*.

---

## 2. Goal / Expected Behavior

For every extracted answer there should be a green dashed box on the correct answer-sheet page at the real handwritten-answer location. Clicking a question (`QuestionList → activeQuestionId`) keeps only that question's box highlighted (solid emerald, label chip) and scrolls to it.

---

## 3. End-to-End Data Flow (who draws what)

```
Sarvan DocAI
  ├─ digitise(question-paper, output_format:"md") → qpContent: string[]  (per-page JSON
  │    with {"page_num","image_width","image_height","blocks":[{text,coordinates:{x1,y1,x2,y2}}]})
  ├─ extract(answer-sheet, output_format:"json", schema) → asExtract: object
  │    → answers:[{label,text,page,bbox_x,bbox_y,bbox_w,bbox_h}]   ← bbox_* are NULL (see §4)
  └─ digitise(answer-sheet, output_format:"md") → asDigitise: string[] (real coordinates, pixel space)

server: lib/ai/provider.ts
  sarvamExtract (L30) → fetch raw payloads → combineExtractionFromRaw (L128)
    ├─ buildQuestionsFromDigitise (L151)          → questions[]
    ├─ answersFromRaw (L167)
    │    ├─ parseAnswerResults (L464)             → answersByPage w/ bbox ORIGINALLY {0,0,0,0}
    │    └─ assignAnswerRegionsFromBlocks (L730)   → WRITES BACK real regions (L765)
    │         └─ buildPageLines (L644) → clusterLinesIntoRegions (L704)
    └─ result.rawData = {qpDigitise, asExtract, asDigitise}   (stored raw, untouched)

api: app/api/extract/route.ts                  → POST returns extraction JSON
api: app/api/extract/offline/route.ts          → combineExtractionFromRaw(stored raw), no API cost

client: components/workspace/workspace.tsx
  applyExtractionResult (~L375)       → flattens answersByPage → extraction.answers[] (regions kept)
  overlays memo (L284)                → one overlay per answer.regions[]  {id,page,bbox,label}
  activeAnswerIds (L303)              → ids of the matched answer for the active question
  degenerateRegions guard (L316)      → amber warning if all overlays collapse to ~same spot

renderer: components/workspace/sheet-viewer.tsx
  toPct (L38)  → pixel→% normalize via naturalSizes (L84 onLoad)
  L101         unsized = bbox.w === 0 && bbox.h === 0
  L102-103     if (hasActive && !isActive) return null;  if (unsized) return null;
```

The renderer is known-good (verified earlier when boxes appeared). **The kill-switch is `sheet-viewer.tsx:103` (`if (unsized) return null`).**

---

## 4. Root Cause Analysis

### 4.1 Primary cause: extract API returns NO coordinates

Sarvam's schema `extract` result gives **`bbox_x/bbox_y/bbox_w/bbox_h = null` per answer**. Captured from a real run:

```json
{"label":"1","text":"D) All of the mentioned","page":0,
 "bbox_x":null,"bbox_y":null,"bbox_w":null,"bbox_h":null}
```

`parseAnswerResults` (provider.ts:464) → `normalizeBboxWithPage` (provider.ts:515) → all inputs `toNum(null)=0` → **`{x:0,y:0,w:0,h:0}`** for every answer. So `answersByPage.regions[]` start life as all-zero rectangles.

### 4.2 The overwrite path (the intended fix) silently no-ops

`assignAnswerRegionsFromBlocks` (provider.ts:730) is responsible for **replacing** those zeros with real coordinates derived from the answer-sheet **digitise** blocks:

- It builds per-page "lines" from digitise blocks, clusters lines into regions, then:
  - L763 `count = Math.min(allAnswers.length, orderedRegions.length)`
  - L765 `allAnswers[k].regions = [{ page, bbox }]` — only answers `0..count-1` get real boxes.
- **If `orderedRegions.length === 0`, nothing is replaced.** Every answer keeps `{0,0,0,0}`.
- All-zero regions → `sheet-viewer.tsx:101-103` skips them (`unsized`) → **nothing renders**. This exactly matches the "no box at all" symptom.

### 4.3 Why `orderedRegions` can be empty on the real sheet

`orderedRegions` is built per page only from lines that survive `assignAnswerRegionsFromBlocks` filters (provider.ts:745-751):

```ts
line.bbox.y >= 0.08                                // top margin cut
    && line.text.trim().length > 0
    && !HEADER_LINE.test(line.text)                // ^(name|roll|class|…)\b
    && !(page === 0 && line.bbox.y < 0.14)         // page-0 header block
```

then `clusterLinesIntoRegions` (provider.ts:704) drops ALL lines before the FIRST line matching `isQuestionStartLine` (provider.ts:673):

```ts
line.bbox.x < 0.16                         // must sit at left margin
    && /^\d+\s*[.)\s]/.test(text.trim())   // must start with number + . ) or space
```

Any one of the following on the real PDF zeroes the region count:

| # | Failure mode | Where |
|---|--------------|-------|
| 1 | `parseDigitiseBlocks` (provider.ts:547) returns `null` — content isn't JSON (`/^[\[{]/` fails) or `walkDigitise` (L565) found no `text`+`coordinates` blocks (e.g. actual field is `block_id`/`layouts`/nested `children`) | digitise parsing |
| 2 | `walkDigitise` misses real coords because they live under a key other than `coordinates`/`bbox` (e.g. `x1,y1,x2,y2` at top level, or inside `["words"]` with `left/top/width/height`) | L583-595 |
| 3 | Question-number lines filtered out: header word at line start (regex false positives like `Answer`/`Marks`, mixed-case) or margin cut `y>=0.08` / page-0 `y<0.14` purges short handwritten markers | filters L745-751 |
| 4 | `isQuestionStartLine` never matches real OCR: numbers read as `Q.1`, `(1)`, `1 a)`, `1.` merged as `1D)` (still matches), or blocks use a slightly-right margin so `x >= 0.16` rejects them | L673-677 |
| 5 | One page's `image_width/height` not found → `normalizeDigitiseBlock` uses fallback basis; mixing pixel/markdown basis can push `x` beyond `0.16` | L602-618 |
| 6 | SUB-QUESTIONS (a/b/c or (i)/(ii)) aren't number-leading → whole tail after a `>` cut is dropped until the next number-leading line | L709-716 |

If only SOME regions are produced (e.g. 3 of 6 pages cluster), the rest retain zero boxes → they're invisible while a few render — but if lines fail on every page, the count is **0 → total blackout**.

### 4.4 Contributing: coordinates live in one API, answer text in another

The extract API gives **text + labels but no geometry**; the digitise API gives **geometry but no answer labels**. The bridge is purely positional/order-based (cluster all line regions, then assign in array order, provider.ts:763-765). Order assumptions:
- `answersByPage` flatten order = schema-extract `answers` array order (question paper reading order).
- digitise region order = reading order **within each page, sorted by `y1` then `x1`** (buildPageLines L650).

If the two APIs disagree on order (e.g. extract returns answers grouped differently, or digitise merges/drops a line), regions are assigned to the wrong answers even when boxes render.

---

## 5. Diagnostics (how to see what's happening)

Open the dev terminal where `next dev` runs — the server prints these on **every** extract/offline run:

- `[extract] raw first answer bbox: {...null...} | no page dims` — confirms extract has no geometry (§4.1).
- `[extract] digitised N question-paper page(s) (first page: "...")` — shows the shape of digitise content.
- `[extract] answer-sheet page 0 (12 lines, ">" marks question starts):` — per-line x/y/w/h + first 60 chars; `>` = lines `isQuestionStartLine` accepted. **This is the money log**: it tells you which lines survived filters vs which got dropped, and whether question starts are found at all.
- `[extract] gap-clustered X/35 answers across Y regions (Z pages) | unmatched: ...` — X/Y = assigned count, Y = total regions found.
- `[extract] offline combine: parsed N question(s), M page(s) with answers` — offline path.

Client-side checks (browser):
- Logs panel → extract log → `answers[].regions` → are bboxes `{x:0,y:0,w:0,h:0}`?
- "Degenerate region" amber chip (workspace.tsx:316) fires only when ≥3 overlays share a spot — it does **not** fire for all-zero (they're all skipped), so no chip while blacked out.
- `SheetViewer` pages prop: is the answer-sheet visible? If not, it's settings/slot hydration, not geometry.

**For the next extract, capture and paste these four console lines — they pinpoint the exact failing stage in one shot.**

---

## 6. What Has Already Been Tried (decisions/timeline)

1. **normalizeBboxWithPage heuristics** (provider.ts:515): tried to read every plausible coordinate format from the extract answer; impossible — fields are `null`.
2. **Label→block matching** (`blockStartsWithNumber`): matched only 7/35.
3. **Marker-segmentation** (`isMarkerText` + `answerNumberFromLabel`, segment at "answer number" markers): *drawn* wrong — Q1 box landed on page 2 bottom / whole 4th page, because textual marker detection mis-located cut points.
4. **Hence the current positional clustering**: buildPageLines → HEADER_LINE filter → isQuestionStartLine regex + left-margin → clusterLinesIntoRegions → splitOversizedGroup (region height cap 0.3) → unionNormalizedRects. Round-trip assignment in order.
5. **Raw-response store + offline combine** (storage v3, `/api/extract/offline`): live/offline now share `combineExtractionFromRaw` (provider.ts:128), so debugging one path fixes both. The raw Sarvam payload (including `asDigitise`) is persisted in IndexedDB in the **"Saved API responses"** panel.

Verified green: `bunx tsc --noEmit` = 0, `bun run lint` = 0, `bun run build` = 0 (includes `/api/extract/offline`).

---

## 7. Test Evidence

- Simulated printed sheet (6 pages × 6 questions, left-margin "1. Which of…" + hand marks on same line): **35/35 regions, correct pages, correct order** — `ALL OK`. The renderer + clustering logic are therefore correct for that synthetic shape.
- Real sheet: region count drops to 0 → the real digitise JSON differs from the simulated shape somewhere in §4.3 rows 1–6. **This is the remaining unknown to resolve.**

---

## 8. Recommended Fix Direction (for the next engineer/model)

1. **Instrument, don't guess**: add `console.log` dumps at (a) `parseDigitiseBlocks` return value, (b) `buildPageLines` raw lines before filters, (c) `isQuestionStartLine` results per line. Re-run "Use saved" — **no API credits consumed** — and compare real shapes to the simulation assumptions.
2. **Robustify `walkDigitise`** to handle `words[]`/`children[]`/nested coordinate layouts and multiple line-group keys (`lines`,`regions`,`elements`), not just `coordinates`/`bbox` at the block level.
3. **Relax `isQuestionStartLine`**: also match `Q\d`, `(1)`, `1 a)`, and don't gate solely on `x < 0.16` (compute margin relative to each page's min line-`x` instead).
4. **Make failure loud**: if `orderedRegions.length === 0`, `assignAnswerRegionsFromBlocks` should return a distinct flag/`answerLayout=[]` AND the client should show "no coordinates — check digits" instead of silently blank.
5. **Consider a different coordinate source**: e.g. the extract `downloadUrl` zip fallback (`_zipPages`, provider.ts:~430) contains per-page block bboxes keyed by page — could be more reliable than positional clustering for this sheet's handwritten layout.

---

## 9. Files / Responsibilities

| File | Responsibility | Lines of interest |
|------|---------------|-------------------|
| `lib/ai/provider.ts` | All Sarvam raw fetching + parsing + region assembly | extractWithProvider L15; sarvamExtract L30; combineExtractionFromRaw L128; buildQuestionsFromDigitise L151; answersFromRaw L167; parseAnswerResults L464; normalizeBboxWithPage L515; parseDigitiseBlocks L547; walkDigitise L565; buildPageLines L644; HEADER_LINE L669; isQuestionStartLine L673; splitOversizedGroup L681; clusterLinesIntoRegions L704; assignAnswerRegionsFromBlocks L730 (write-back L763-776); logAnswerSheetLayout ~L785 |
| `lib/ai/types.ts` | `ExtractionResult.answersByPage` / `.answerLayout` / `.rawData` | L23-32 |
| `lib/storage.ts` | IndexedDB (v3): docs, extractions, logs, **rawExtractions** | RAW_STORE + raw get/put/del ~L160+ |
| `app/api/extract/route.ts` | Live extraction endpoint | — |
| `app/api/extract/offline/route.ts` | Rebuild from stored raw, no API cost | — |
| `components/workspace/workspace.tsx` | Flatten answers, overlays, active-answer ids, saved-response panel, v5 cache gate | applyExtractionResult ~L375; overlays L284; activeAnswerIds L303; degenerate guard L316; handleUseSaved ~L498; saved panel ~L859 |
| `components/workspace/sheet-viewer.tsx` | Renders (or **skips**) overlays | toPct L38; naturalSizes L84-93; **unsized skip L101-103** |
| `components/workspace/question-list.tsx` | Question click → activeQuestionId | — |
| `lib/ai/mapping.ts` | Question↔answer matching (status/grade, not geometry) | — |

Cache/keys to be aware of: extraction cache `version === 5` gate (workspace.tsx hydrate + save); stored-raw records in `rawExtractions` store (add a fresh record via a live "Extract", or Delete old ones, when re-testing).

---

## 10. Cutting Summary for the Next Model

- The **renderer is not the bug**: it just skips `w=0 && h=0` boxes.
- Answers start at zero geometry because the extract API returns NULL bboxes.
- The ONLY writer that gives them real geometry is `assignAnswerRegionsFromBlocks` (provider.ts:765).
- If its cluster step yields 0 regions for the real sheet, every box stays zero → total invisibility.
- The real sheet's digitise JSON evidently doesn't match the assumptions made in `walkDigitise`/`buildPageLines`/`isQuestionStartLine` (or header/margin filters erase the question lines).
- **Next concrete step: capture the `[extract] answer-sheet page N …` and `[extract] gap-clustered N/35 …` logs from a "Use saved" run, then align the parsing/clustering to that real shape.** No API re-call needed to iterate.