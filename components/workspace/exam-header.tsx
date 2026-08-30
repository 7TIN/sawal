"use client";

import {
  ArrowLeft,
  Bell,
  ChevronDown,
  ClipboardList,
  Menu,
  Sparkles,
} from "lucide-react";
import { useIsMobile } from "@/lib/use-media-query";
import { VedaMark } from "./veda-brand";

type ExamHeaderProps = {
  onBack?: () => void;
  userName?: string;
  userAvatar?: string;
  onMenuToggle?: () => void;
};

export function ExamHeader({
  onBack,
  userName = "Madhur Rastogi",
  userAvatar,
  onMenuToggle,
}: ExamHeaderProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <header className="flex h-14 w-full shrink-0 items-center gap-2 overflow-hidden rounded-2xl border bg-white px-3">
        {/* Back */}
        <button
          type="button"
          onClick={onBack}
          aria-label="Go back"
          className="flex size-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[#F6F6F6]"
        >
          <ArrowLeft className="size-5 text-[#303030]" strokeWidth={1.8} />
        </button>

        {/* Logo + name */}
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2"
        >
          <VedaMark />
          <span className="truncate font-sans text-[18px] font-bold leading-none tracking-[-0.72px] text-[#303030]">
            VedaAI
          </span>
        </button>

        {/* Profile photo */}
        <button
          type="button"
          aria-label="Profile"
          className="flex size-9 shrink-0 items-center justify-center rounded-full"
        >
          {userAvatar ? (
            <img src={userAvatar} alt="" className="size-8 rounded-full object-cover" />
          ) : (
            <div className="flex size-8 items-center justify-center rounded-full bg-[#303030] font-sans text-xs font-semibold text-white">
              MR
            </div>
          )}
        </button>

        {/* Notifications */}
        <button
          type="button"
          aria-label="Notifications"
          className="relative flex size-9 shrink-0 items-center justify-center rounded-full"
        >
          <Bell className="size-5 text-[#303030]" strokeWidth={1.8} />
          <span className="absolute right-[7px] top-[6px] size-2 rounded-full border border-white bg-[#FF5623]" />
        </button>

        {/* 3-line toggle menu */}
        <button
          type="button"
          onClick={onMenuToggle}
          aria-label="Open menu"
          className="flex size-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[#F6F6F6]"
        >
          <Menu className="size-5 text-[#303030]" strokeWidth={2} />
        </button>
      </header>
    );
  }

  return (
    <header className="flex h-12 w-full shrink-0 items-center gap-[10px] overflow-hidden rounded-2xl border bg-white pl-6 pr-2">
      {/* Back */}
      <button
        type="button"
        onClick={onBack}
        aria-label="Go back"
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white transition-colors hover:bg-[#F6F6F6]"
      >
        <ArrowLeft className="size-5 text-[#303030]" strokeWidth={1.8} />
      </button>

      {/* Page title */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <ClipboardList className="size-5 shrink-0 text-[#A9A9A9]" strokeWidth={1.8} />

        <span className="truncate font-sans text-[16px] font-semibold leading-normal tracking-[-0.64px] text-[#A9A9A9]">
          Exams
        </span>
      </div>

      {/* Help */}
      <button
        type="button"
        aria-label="Help"
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#F6F6F6]"
      >
        <span className="flex size-6 items-center justify-center rounded-full border-2 border-[#303030]">
          <span className="font-sans text-[16px] font-bold leading-none text-[#303030]">
            ?
          </span>
        </span>
      </button>

      {/* Notifications */}
      <button
        type="button"
        aria-label="Notifications"
        className="relative flex size-9 shrink-0 items-center justify-center rounded-full"
      >
        <Bell className="size-5 text-[#303030]" strokeWidth={1.8} />

        <span className="absolute right-[7px] top-[6px] size-2 rounded-full border border-white bg-[#FF5623]" />
      </button>

      {/* AI */}
      <button
        type="button"
        aria-label="AI tools"
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white"
      >
        <Sparkles className="size-5 text-[#303030]" strokeWidth={1.8} />
      </button>

      {/* User */}
      <button
        type="button"
        className="flex shrink-0 items-center gap-2 rounded-xl px-3 py-1.5 transition-colors hover:bg-[#F6F6F6]"
      >
        {/* Avatar */}
        <div className="size-8 shrink-0 overflow-hidden rounded-full bg-[#F6F6F6]">
          {userAvatar ? (
            <img src={userAvatar} alt="" className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center bg-[#303030] font-sans text-xs font-semibold text-white">
              MR
            </div>
          )}
        </div>

        {/* Name */}
        <span className="max-w-[180px] truncate font-sans text-[16px] font-semibold leading-normal tracking-[-0.64px] text-[#303030]">
          {userName}
        </span>

        <ChevronDown className="size-4 shrink-0 text-[#303030]" strokeWidth={1.8} />
      </button>
    </header>
  );
}