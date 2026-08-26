"use client";

import {
  CheckCircle2,
  HelpCircle,
  CircleDot,
  ChevronRight,
} from "lucide-react";
import type { Question, Grade, MatchStatus } from "@/lib/types";

type QuestionListProps = {
  questions: Question[];
  statuses: Record<string, MatchStatus>;
  grades: Record<string, Grade>;
  activeId?: string | null;
  onSelect: (id: string) => void;
};

const STATUS_CONFIG: Record<
  MatchStatus,
  { icon: typeof CheckCircle2; color: string; label: string }
> = {
  matched: {
    icon: CheckCircle2,
    color: "text-emerald-600 dark:text-emerald-400",
    label: "Matched",
  },
  unanswered: {
    icon: HelpCircle,
    color: "text-amber-600 dark:text-amber-400",
    label: "Unanswered",
  },
  unmatched: {
    icon: CircleDot,
    color: "text-muted-foreground",
    label: "Unmatched",
  },
};

const VERDICT_COLOR: Record<string, string> = {
  correct: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  partial: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  incorrect: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

export function QuestionList({
  questions,
  statuses,
  grades,
  activeId,
  onSelect,
}: QuestionListProps) {
  return (
    <div className="flex flex-col">
      {questions.map((q) => {
        const status = statuses[q.id] ?? "unanswered";
        const config = STATUS_CONFIG[status];
        const Icon = config.icon;
        const grade = grades[q.id];
        const isActive = activeId === q.id;

        return (
          <button
            key={q.id}
            type="button"
            onClick={() => onSelect(q.id)}
            className={`group flex items-start gap-2.5 border-b px-3 py-2.5 text-left transition-colors ${
              isActive
                ? "bg-accent"
                : "hover:bg-accent/50"
            }`}
          >
            <Icon className={`mt-0.5 size-4 shrink-0 ${config.color}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  Q{q.number}
                </span>
                {grade && (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${VERDICT_COLOR[grade.verdict]}`}
                  >
                    {grade.marks}/{grade.maxMarks}
                  </span>
                )}
              </div>
              <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
                {q.text}
              </p>
              {grade && (
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                  {grade.feedback}
                </p>
              )}
            </div>
            <ChevronRight className="mt-1 size-3.5 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        );
      })}
    </div>
  );
}
