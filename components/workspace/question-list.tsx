"use client";

import { useState } from "react";
import {
  CheckCircle2,
  HelpCircle,
  CircleDot,
  ChevronRight,
  ChevronDown,
  MessageSquareText,
  Star,
  PenLine,
} from "lucide-react";
import type { Question, Grade, MatchStatus, Answer } from "@/lib/types";

type QuestionListProps = {
  questions: Question[];
  statuses: Record<string, MatchStatus>;
  grades: Record<string, Grade>;
  answersById: Record<string, Answer | null>;
  activeId?: string | null;
  onSelect: (id: string) => void;
};

const STATUS_CONFIG: Record<MatchStatus, { icon: typeof CheckCircle2; color: string; label: string }> = {
  matched: {
    icon: CheckCircle2,
    color: "text-emerald-600 dark:text-emerald-400",
    label: "Answered",
  },
  unanswered: {
    icon: HelpCircle,
    color: "text-red-600 dark:text-red-400",
    label: "Unanswered",
  },
  unmatched: {
    icon: CircleDot,
    color: "text-muted-foreground",
    label: "Unmatched",
  },
};

const VERDICT_STYLE: Record<string, { label: string; color: string; icon: typeof Star }> = {
  correct: {
    label: "Correct",
    color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    icon: Star,
  },
  partial: {
    label: "Partial",
    color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    icon: Star,
  },
  incorrect: {
    label: "Incorrect",
    color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    icon: Star,
  },
};

function QuestionRow({
  q,
  status,
  grade,
  answer,
  active,
  onSelect,
  depth = 0,
}: {
  q: Question;
  status: MatchStatus;
  grade?: Grade;
  answer?: Answer | null;
  active: boolean;
  onSelect: (id: string) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const config = STATUS_CONFIG[status];
  const StatusIcon = config.icon;
  const isOpen = active || expanded;

  return (
    <div
      className={`overflow-hidden rounded-lg border transition-colors ${
        active
          ? "border-emerald-500/50 ring-2 ring-emerald-500/20"
          : "border-border hover:border-emerald-500/40"
      }`}
      style={{ marginLeft: depth > 0 ? `${depth * 14}px` : undefined }}
    >
      <button
        type="button"
        onClick={() => { onSelect(q.id); setExpanded((v) => !v); }}
        className={`flex w-full items-start gap-3 px-3 py-3 text-left transition-colors ${
          active ? "bg-accent/50" : "hover:bg-accent/40"
        }`}
      >
        <span
          className={`flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-bold ${
            active
              ? "bg-emerald-600 text-white"
              : "bg-secondary text-secondary-foreground"
          }`}
        >
          Q{q.number}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusIcon className={`size-3.5 shrink-0 ${config.color}`} />
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Page {q.page + 1}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-sm leading-5">{q.text}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {answer && (
              <span className="max-w-full truncate rounded-md bg-secondary px-2 py-1 text-[11px] text-muted-foreground">
                {answer.text || "Answered"}
              </span>
            )}
          </div>
        </div>
        <div className="ml-2 flex shrink-0 items-center gap-2">
          {grade && (
            <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-bold ${VERDICT_STYLE[grade.verdict]?.color ?? ""}`}>
              {grade.marks}/{grade.maxMarks}
            </span>
          )}
          {isOpen ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />
          )}
        </div>
      </button>

      {isOpen && (
        <div className="space-y-2 border-t bg-background/50 px-3 py-3">
          {status === "unanswered" && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-400">
              <HelpCircle className="mt-0.5 size-3.5 shrink-0" />
              <p>No matching answer found on the answer sheet.</p>
            </div>
          )}

          {q.options && q.options.length > 0 && (
            <div className="grid gap-1">
              {q.options.map((option) => (
                <div key={option} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                  <span>{option}</span>
                </div>
              ))}
            </div>
          )}

          {answer && (
            <div className="rounded-md border px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <PenLine className="size-3" />
                Student answer
                {status === "matched" && (
                  <span className="ml-auto text-[10px] text-emerald-600 dark:text-emerald-400">
                    Located on page {(answer.regions[0]?.page ?? 0) + 1}
                  </span>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-5">{answer.text || "—"}</p>
            </div>
          )}

          {grade && (
            <div className="flex items-start gap-2 rounded-md border px-3 py-2">
              <MessageSquareText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <div>
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  AI feedback
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${VERDICT_STYLE[grade.verdict]?.color ?? ""}`}>
                    {VERDICT_STYLE[grade.verdict]?.label ?? grade.verdict}
                  </span>
                  <span className="ml-auto text-[10px]">{grade.marks} / {grade.maxMarks} marks</span>
                </div>
                <p className="mt-1 text-xs leading-5">{grade.feedback}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function QuestionList({
  questions,
  statuses,
  grades,
  answersById,
  activeId,
  onSelect,
}: QuestionListProps) {
  return (
    <div className="flex flex-col gap-1.5 p-2">
      {questions.map((q) => (
        <QuestionRow
          key={q.id}
          q={q}
          status={statuses[q.id] ?? "unanswered"}
          grade={grades[q.id]}
          answer={answersById[q.id]}
          active={activeId === q.id}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}