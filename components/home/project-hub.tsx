"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Clock, FileText, Plus, Sparkles } from "lucide-react";
import {
  getDocumentInfo,
  getProjects,
  type Project,
} from "@/lib/storage";

type HubProject = Project & {
  questionPaper?: string;
  answerSheet?: string;
};

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const projectSubtitle = (project: HubProject) => {
  if (project.questionPaper && project.answerSheet) {
    return `${project.questionPaper} · ${project.answerSheet}`;
  }
  return project.questionPaper ?? project.answerSheet ?? "No documents yet";
};

export function ProjectHub() {
  const router = useRouter();
  const [projects, setProjects] = useState<HubProject[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await getProjects();
        const withDocs = await Promise.all(
          list.map(async (project) => {
            const [qp, as] = await Promise.all([
              getDocumentInfo(project.id, "question-paper"),
              getDocumentInfo(project.id, "answer-sheet"),
            ]);
            return {
              ...project,
              questionPaper: qp?.fileName,
              answerSheet: as?.fileName,
            };
          }),
        );
        if (!cancelled) setProjects(withDocs);
      } catch {
        if (!cancelled) setProjects([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (projects && projects.length === 0) {
      router.replace("/exam?new=true");
    }
  }, [projects, router]);

  if (!projects) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading exams…
      </div>
    );
  }

  const latest = projects[0];

  return (
    <div className="thin-scrollbar h-full min-h-0 overflow-y-auto">
      <div className="flex h-full min-h-0 flex-col gap-6 p-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-sans text-2xl font-bold leading-none tracking-[-0.96px] text-[#303030]">
              My Exams
            </h1>
            <p className="mt-1.5 text-sm text-[#5E5E5E]">
              Continue where you left off or start a new assessment
            </p>
          </div>

          <button
            type="button"
            onClick={() => router.push("/exam?new=true")}
            className="inline-flex items-center gap-2 rounded-full bg-[#FF5623] py-2.5 pl-4 pr-5 text-sm font-medium text-white transition-all hover:opacity-90"
          >
            <Plus className="size-4" strokeWidth={2} />
            New exam
          </button>
        </header>

        {latest && (
          <button
            type="button"
            onClick={() => router.push(`/exam?projectid=${latest.id}`)}
            className="group flex flex-col gap-3 rounded-2xl border bg-white p-5 text-left transition-all hover:border-[#FF5623]/50 hover:shadow-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-[#FF5623] text-white">
                <Sparkles className="size-6" strokeWidth={1.8} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-sans text-lg font-semibold tracking-[-0.72px] text-[#303030]">
                  Continue latest exam
                  <ArrowRight className="size-4 text-[#FF5623] transition-transform group-hover:translate-x-0.5" />
                </div>
                <p className="mt-0.5 truncate text-sm text-[#5E5E5E]">
                  {projectSubtitle(latest)}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-[#A9A9A9]">
                  <Clock className="size-3" strokeWidth={1.8} />
                  Updated {formatTime(latest.updatedAt)}
                </p>
              </div>
            </div>
          </button>
        )}

        <section className="min-h-0">
          <h2 className="mb-3 font-sans text-sm font-semibold uppercase tracking-wide text-[#5E5E5E]">
            All exams
          </h2>

          <div className="grid gap-3 sm:grid-cols-2">
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => router.push(`/exam?projectid=${project.id}`)}
                className="group flex flex-col gap-2 rounded-2xl border bg-white p-4 text-left transition-all hover:border-[#FF5623]/50 hover:shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#F0F0F0] text-[#5E5E5E]">
                    <FileText className="size-5" strokeWidth={1.8} />
                  </div>
                  <p className="truncate font-sans text-[15px] font-semibold tracking-[-0.6px] text-[#303030]">
                    {projectSubtitle(project)}
                  </p>
                </div>
                <p className="flex items-center gap-1 text-xs text-[#A9A9A9]">
                  <Clock className="size-3" strokeWidth={1.8} />
                  Created {formatTime(project.createdAt)}
                </p>
                <p className="flex items-center gap-1 text-xs text-[#A9A9A9]">
                  <Clock className="size-3" strokeWidth={1.8} />
                  Updated {formatTime(project.updatedAt)}
                </p>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}