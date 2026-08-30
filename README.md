# Sawal AI

Sawal AI turns a scanned or photographed question paper and a handwritten answer sheet into a graded answer-by-answer breakdown — no manual marking required.

Upload your documents, let Sawal AI extract the questions and their marks, map each student answer to the question it answers, review the mapping, and grade the whole sheet with one click.

## Features

- **Multi-project workspace** — keep every exam separate. The home screen lists all your exams and lets you continue the most recent one, jump back into an older one, or start a new one.
- **Automatic question + marks extraction** — reads the question paper and recovers each question's actual max marks from the paper itself: inline marks (`(2 Marks)`), section headers (`Part I: MCQ (1 Mark Each)`), and marks tables (`| QsNo | Question | Max Marks |`). No guessing, no hard-coded defaults.
- **Handwritten answer extraction** — locates the handwritten answer regions on the answer sheet.
- **Question ↔ answer mapping** — matches answers to questions and draws clickable overlays on the answer sheet pages so you can verify the pairing visually.
- **One-click AI grading** — grades every answer against its question and real max marks, with an overall score summary.
- **Review before grading** — inspect the extracted questions and the answer mapping, and re-run mapping if something looks off.
- **Fully cached** — documents, extraction, and grading results are saved in the browser; revisiting an exam restores your exact place and never re-invokes the AI or re-charges the APIs.
- **Private by default** — files never leave the app except to the extraction/grading API you choose, and keys stay server-side.

## How it works

```
Upload question paper + answer sheet
        │
        ▼
Extract ──► questions (with max marks) + answer regions
        │
        ▼
Map answers to questions (overlays on the answer sheet)
        │
        ▼
Review / re-map if needed
        │
        ▼
Grade ──► per-question scores + summary
```

Everything (files, extraction, grading) is stored in the browser's IndexedDB, scoped per project. A completed exam can be revisited offline — the results are restored from cache instead of running the APIs again.

## Tech stack

- [Next.js 16](https://nextjs.org) (App Router, Turbopack) + React 19
- TypeScript
- Tailwind CSS 4
- [Sarvam AI DocAI](https://sarvam.ai) — primary document extraction
- [Google Gemini](https://ai.google.dev) — secondary extraction + grading
- pdf.js — client-side PDF rendering
- IndexedDB — local, project-scoped persistence

## Prerequisites

- Node.js 18.18+ (or [Bun](https://bun.sh) 1.x, the project's package manager)
- API keys for at least one of the two AI providers above

## Setup

1. Install dependencies:

   ```bash
   bun install
   ```

2. Create the environment file:

   ```bash
   cp .env.example .env
   ```

3. Add your API keys:

   | Variable | Required | Purpose |
   | --- | --- | --- |
   | `SARVAM_API_KEY` | recommended | Primary extractor (Sarvam DocAI) |
   | `GEMINI_API_KEY` | for grading | Grading model + fallback extraction |

   Optional flags:

   | Variable | Purpose |
   | --- | --- |
   | `NEXT_PUBLIC_APP_ENV=production` | Force the production UI even on a dev server (hides debug-only panels) |
   | `NEXT_PUBLIC_SHOW_DEBUG=1` | Force debug panels back on |

4. Start the dev server (or `bun run build && bun run start` for production):

   ```bash
   bun run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000).

## Walkthrough

1. **Home screen** — first visit with no exams takes you straight into a new exam. With exams already saved, you'll see a "Continue latest exam" card, a list of all previous exams (with document names and timestamps), and a "New exam" button.

2. **New exam** — the upload screen appears immediately. Drop in:
   - the **question paper** (PDF or images), and
   - the **handwritten answer sheet** (PDF or images).

3. **Extract** — Sawal AI digitises both documents and pulls out the questions, their max marks, and the answer regions. Watch progress in the pipeline stepper.

4. **Review** — the extracted question list appears alongside the answer sheet. Hover or select an answer to see which question it was mapped to (highlighted overlays) across pages. If the pairing looks wrong, re-run mapping.

5. **Grade** — click to grade the whole sheet. Results show a per-question breakdown with the score achieved against each question's true max marks, plus an overall summary.

6. **Switch or reset** — the sidebar and back arrow take you to the home screen; "Reset" deletes the current exam and returns to the list.

### Notes

- Extraction results are cached per project version, so re-opening a finished exam restores your results without extra API calls.
- The grading prompt reads the exact marks printed on the paper — one-and-a-half-mark sections are scored as such, never assumed to be full marks.
- Raw API responses and pipeline logs are visible when the debug panels are enabled (dev mode only).

## Scripts

| Command | Description |
| --- | --- |
| `bun run dev` | Start the development server |
| `bun run build` | Create a production build |
| `bun run start` | Serve the production build |
| `bun run lint` | Run ESLint |