import { Workspace } from "@/components/workspace/workspace";
import { isProd } from "@/lib/env";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-6">
          <span className="text-sm font-semibold tracking-tight">Veda AI</span>
          <span aria-hidden className="h-3.5 w-px bg-border" />
          <span className="text-sm text-muted-foreground">
            Assessment extraction &amp; answer mapping
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 pb-24 pt-10">
        {!isProd && (
          <div className="max-w-xl">
            <h1 className="text-2xl font-semibold tracking-tight">
              Map student answers to questions
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Upload the question paper and one handwritten answer sheet. Every
              question is matched with the region of the sheet where it was
              answered — unanswered and unmatched answers are flagged.
            </p>
          </div>
        )}
        <Workspace />
      </main>
    </div>
  );
}
