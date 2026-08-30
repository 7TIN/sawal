"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  PenLine,
  MessageSquareText,
  HelpCircle,
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

const getScoreStyle = (grade?: Grade, status?: MatchStatus) => {
  if (!grade) {
    return status === "unanswered"
      ? {
          background: "#FFE9E2",
          color: "#C0350A",
        }
      : {
          background: "#F6F6F6",
          color: "#303030",
        };
  }

  const percentage =
    grade.maxMarks > 0 ? grade.marks / grade.maxMarks : 0;

  if (percentage >= 0.8) {
    return {
      background: "rgba(69, 181, 41, 0.1)",
      color: "#34AC15",
    };
  }

  if (percentage > 0) {
    return {
      background: "rgba(255, 153, 0, 0.1)",
      color: "#E3600F",
    };
  }

  return {
    background: "#FFE9E2",
    color: "#C0350A",
  };
};

function QuestionRow({
  q,
  status,
  grade,
  answer,
  active,
  expanded,
  onSelect,
  onToggle,
  depth = 0,
}: {
  q: Question;
  status: MatchStatus;
  grade?: Grade;
  answer?: Answer | null;
  active: boolean;
  expanded: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  depth?: number;
}) {
  const scoreStyle = getScoreStyle(grade, status);

  const handleToggle = () => {
    onSelect(q.id);
    onToggle(q.id);
  };

  return (
    <div
      className={[
        "w-full overflow-hidden rounded-[16px] bg-white",
        "transition-all duration-150",
        expanded || active
          ? "border-2 border-[#FF5623]"
          : "border-2 border-transparent",
      ].join(" ")}
      style={{
        marginLeft: depth > 0 ? `${depth * 14}px` : undefined,
      }}
    >
      {/* Question header */}
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-4 p-3 text-left"
      >
        {/* Question number */}
        <span
          className={[
            "flex size-8 shrink-0 items-center justify-center",
            "rounded-full border-2 border-white",
            "font-sans text-[20px] font-extrabold",
            "leading-none tracking-[-0.8px] text-white",
            "shadow-[0px_8px_8.8px_rgba(134,134,134,0.1),0px_4px_16px_rgba(67,67,67,0.1)]",
            expanded ? "bg-[#FF5623]" : "bg-[rgba(43,43,43,0.8)]",
          ].join(" ")}
        >
          {q.number}
        </span>

        {/* Question */}
        <span className="min-w-0 flex-1 font-sans text-[16px] font-normal leading-[1.4] tracking-[-0.64px] text-[#303030]">
          {q.text}
        </span>

        {/* Score + expand */}
        <span className="flex shrink-0 items-center gap-4">
          {grade && (
            <span
              className="rounded-full px-3 py-1 font-sans text-[16px] font-bold leading-[1.4] tracking-[-0.64px]"
              style={{
                backgroundColor: scoreStyle.background,
                color: scoreStyle.color,
              }}
            >
              {grade.marks} / {grade.maxMarks}
            </span>
          )}

          {status === "unanswered" && !grade && (
            <span
              className="rounded-full px-3 py-1 font-sans text-[14px] font-bold"
              style={{
                backgroundColor: scoreStyle.background,
                color: scoreStyle.color,
              }}
            >
              —
            </span>
          )}

          <span className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-[#F6F6F6]">
            {expanded ? (
              <ChevronUp
                className="size-4 text-[#303030]"
                strokeWidth={2}
              />
            ) : (
              <ChevronDown
                className="size-4 text-[#303030]"
                strokeWidth={2}
              />
            )}
          </span>
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="space-y-3 px-3 pb-3">
          {/* Unanswered */}
          {status === "unanswered" && (
            <div className="flex items-start gap-2 rounded-[12px] bg-[#FFE9E2] px-4 py-3 text-sm text-[#C0350A]">
              <HelpCircle className="mt-0.5 size-4 shrink-0" />

              <p className="font-sans leading-[1.4]">
                No matching answer found on the answer sheet.
              </p>
            </div>
          )}

          {/* Options */}
          {q.options && q.options.length > 0 && (
            <div className="rounded-[16px] bg-[#F6F6F6] px-6 py-4">
              <div className="space-y-2">
                {q.options.map((option, index) => (
                  <div
                    key={option}
                    className="flex items-start gap-3 font-sans text-sm leading-[1.4] text-[#303030]"
                  >
                    <span className="shrink-0 font-semibold">
                      {String.fromCharCode(65 + index)}.
                    </span>

                    <span>{option}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Student answer */}
          {answer && (
            <div className="rounded-[16px] bg-[#F6F6F6] px-6 py-4">
              <div className="flex items-center gap-2">
                <PenLine className="size-4 text-[#303030]" />

                <h3 className="font-sans text-[16px] font-bold leading-[1.4] tracking-[-0.64px] text-[#303030]">
                  Student Answer
                </h3>

                {status === "matched" && answer.regions?.length > 0 && (
                  <span className="ml-auto font-sans text-xs text-[#34AC15]">
                    Located on page{" "}
                    {(answer.regions[0]?.page ?? 0) + 1}
                  </span>
                )}
              </div>

              <div className="mt-3 rounded-[12px] bg-white px-4 py-3">
                <p className="whitespace-pre-wrap font-sans text-[14px] font-normal leading-[1.4] tracking-[-0.56px] text-[#303030]">
                  {answer.text || "—"}
                </p>
              </div>
            </div>
          )}

          {/* AI Feedback */}
          {grade && (
            <div className="rounded-[16px] bg-[#F6F6F6] px-6 py-4">
              <div className="flex items-start gap-2">
                <MessageSquareText className="mt-0.5 size-4 shrink-0 text-[#303030]" />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-sans text-[16px] font-bold leading-[1.4] tracking-[-0.64px] text-[#303030]">
                      AI Feedback
                    </h3>

                    <span
                      className="rounded-full px-2 py-0.5 font-sans text-xs font-bold"
                      style={{
                        backgroundColor: scoreStyle.background,
                        color: scoreStyle.color,
                      }}
                    >
                      {grade.marks} / {grade.maxMarks}
                    </span>
                  </div>

                  <p className="mt-2 font-sans text-[14px] font-normal leading-[1.4] tracking-[-0.56px] text-[#303030]">
                    {grade.feedback}
                  </p>
                </div>
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
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(activeId ? [activeId] : [])
  );

  const allExpanded =
    questions.length > 0 &&
    questions.every((q) => expandedIds.has(q.id));

  const toggleQuestion = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  };

  const toggleAll = () => {
    if (allExpanded) {
      setExpandedIds(new Set());
    } else {
      setExpandedIds(new Set(questions.map((q) => q.id)));
    }
  };

  return (
    <div className="flex flex-col gap-4 scrollbar-none">
      {/* Header */}
      <div className="flex w-full items-center justify-between">
        <h2 className="font-sans text-sm sm:text-[16px] font-bold leading-[1.4] tracking-[-0.64px] text-[#303030]">
          Extracted Questions (from question paper)
        </h2>

        <button
          type="button"
          onClick={toggleAll}
          className="sm:rounded-full rounded-lg bg-white px-2 py-2 sm:px-4 sm:py-3 font-sans text-xs sm:text-[14px] font-medium sm:leading-[1.4] sm:tracking-[-0.56px] text-[#181818] transition-colors hover:bg-[#F6F6F6]"
        >
          {allExpanded ? "Collapse All" : "Expand All"}
        </button>
      </div>

      {/* Question list */}
      <div className="flex flex-col gap-2 scrollbar-none">
        {questions.map((q) => (
          <QuestionRow
            key={q.id}
            q={q}
            status={statuses[q.id] ?? "unanswered"}
            grade={grades[q.id]}
            answer={answersById[q.id]}
            active={activeId === q.id}
            expanded={expandedIds.has(q.id)}
            onSelect={onSelect}
            onToggle={toggleQuestion}
          />
        ))}
      </div>
    </div>
  );
}