import { Workspace } from "@/components/workspace/workspace";

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
        <Workspace />
      </main>
    </div>
  );
}
