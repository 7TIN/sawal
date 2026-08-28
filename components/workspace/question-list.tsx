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
    <div className="border-b">
      <button
        type="button"
        onClick={() => { onSelect(q.id); setExpanded((v) => !v); }}
        className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors ${
          active ? "bg-accent" : "hover:bg-accent/60"
        }`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        <StatusIcon className={`mt-0.5 size-4 shrink-0 ${config.color}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Q{q.number}</span>
            {grade && (
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                  VERDICT_STYLE[grade.verdict]?.color ?? ""
                }`}
              >
                {grade.marks}/{grade.maxMarks}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">Page {q.page + 1}</span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {q.text}
          </p>
        </div>
        {isOpen ? (
          <ChevronDown className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="mt-1 size-3.5 shrink-0 text-muted-foreground/60" />
        )}
      </button>

      {isOpen && (
        <div className="bg-background/50 px-3 pb-3" style={{ paddingLeft: `${12 + depth * 16 + 26}px` }}>
          {status === "unanswered" && (
            <div className="mt-1 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-400">
              <HelpCircle className="mt-0.5 size-3.5 shrink-0" />
              <p>No matching answer found on the answer sheet.</p>
            </div>
          )}

          {q.options && q.options.length > 0 && (
            <div className="mt-2 grid gap-1">
              {q.options.map((option) => (
                <div key={option} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                  <span>{option}</span>
                </div>
              ))}
            </div>
          )}

          {answer && (
            <div className="mt-2 rounded-md border px-3 py-2">
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
            <div className="mt-2 flex items-start gap-2 rounded-md border px-3 py-2">
              <MessageSquareText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <div>
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  AI feedback
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      VERDICT_STYLE[grade.verdict]?.color ?? ""
                    }`}
                  >
                    {VERDICT_STYLE[grade.verdict]?.label ?? grade.verdict}
                  </span>
                  <span className="ml-auto text-[10px]">
                    {grade.marks} / {grade.maxMarks} marks
                  </span>
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
    <div className="flex flex-col">
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