"use client";

import { useState } from "react";
import {
  BookOpen,
  CalendarDays,
  FileText,
  GraduationCap,
  Home,
  Library,
  Settings,
  Sparkles,
  PanelLeft,
} from "lucide-react";

type SidebarProps = {
  onExamsClick?: () => void;
  className?: string;
};

const MENU_ITEMS = [
  {
    label: "Home",
    icon: Home,
    disabled: true,
  },
  {
    label: "My Classroom",
    icon: GraduationCap,
    disabled: true,
  },
  {
    label: "Assignments",
    icon: FileText,
    disabled: true,
  },
  {
    label: "Exams",
    icon: CalendarDays,
    disabled: false,
  },
  {
    label: "My Library",
    icon: Library,
    disabled: true,
  },
];

export function Sidebar({ onExamsClick, className }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(true);

  const handleNavClick = (disabled: boolean, onClick?: () => void) => {
    if (disabled) return;
    setCollapsed(false);
    onClick?.();
  };

  return (
    <aside
      className={`flex h-full border shrink-0 flex-col justify-between rounded-[16px] bg-white p-2 transition-[width] ${
        collapsed ? "w-[64px] items-center" : "w-[320px]"
      } ${className ?? ""}`}
    >
      <div
        className={`flex flex-col ${
          collapsed ? "items-center gap-8" : "gap-[56px]"
        }`}
      >
        {/* Logo */}
        <div className="flex w-full items-center justify-between">
          {collapsed ? (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              aria-label="Expand sidebar"
              className="flex size-10 items-center justify-center rounded-[8px] bg-[#303030]"
            >
              <div className="relative h-[24px] w-[24px]">
                <span className="absolute left-[5px] top-[2px] h-[14px] w-[8px] rotate-[35deg] rounded-[2px] bg-white" />
                <span className="absolute right-[4px] top-[3px] h-[19px] w-[8px] rotate-[-35deg] rounded-[2px] bg-white" />
              </div>
            </button>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <div className="flex size-10 items-center justify-center rounded-[8px] bg-[#303030]">
                  <div className="relative h-[24px] w-[24px]">
                    <span className="absolute left-[5px] top-[2px] h-[14px] w-[8px] rotate-[35deg] rounded-[2px] bg-white" />
                    <span className="absolute right-[4px] top-[3px] h-[19px] w-[8px] rotate-[-35deg] rounded-[2px] bg-white" />
                  </div>
                </div>

                <span className="font-sans text-[28px] font-bold leading-none tracking-[-1.68px] text-[#303030]">
                  VedaAI
                </span>
              </div>

              <button
                type="button"
                onClick={() => setCollapsed(true)}
                aria-label="Collapse sidebar"
                className="p-1"
              >
                <PanelLeft className="size-5 text-[#5E5E5E]" strokeWidth={1.8} />
              </button>
            </>
          )}
        </div>

        {/* AI Teacher's Toolkit */}
        {!collapsed && (
          <div className="flex justify-center">
            <div className="relative flex h-[42px] w-full items-center justify-center gap-2 overflow-hidden rounded-full border-4 border-[#FF7950] bg-[#272727] px-[43px] py-2 shadow-[inset_0px_-1px_3.5px_rgba(177,177,177,0.6),inset_0px_0px_34.5px_rgba(255,255,255,0.25)]">
              <Sparkles className="size-[18px] shrink-0 text-white" strokeWidth={2} />

              <span className="whitespace-nowrap font-sans text-[16px] font-medium leading-7 tracking-[-0.64px] text-white">
                AI Teacher&rsquo;s Toolkit
              </span>
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav
          className={`flex w-full flex-col ${
            collapsed ? "items-center gap-3" : "gap-2"
          }`}
        >
          {MENU_ITEMS.map((item) => {
            const Icon = item.icon;

            const handleClick = () => handleNavClick(item.disabled, onExamsClick);

            if (collapsed) {
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={handleClick}
                  aria-label={item.label}
                  aria-disabled={item.disabled || undefined}
                  title={item.label}
                  className={`flex size-10 shrink-0 items-center justify-center rounded-[8px] transition-none ${
                    item.disabled
                      ? "text-[rgba(94,94,94,0.8)]"
                      : "bg-[#FF5623] text-white"
                  }`}
                >
                  <Icon className="size-5" strokeWidth={1.8} />
                </button>
              );
            }

            if (item.label === "Exams") {
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={handleClick}
                  className="flex h-10 w-full items-center gap-2 rounded-[8px] bg-[#FF5623] px-3 py-[9px] text-left transition-none"
                >
                  <Icon className="size-5 shrink-0 text-white" strokeWidth={1.8} />

                  <span className="font-sans text-[16px] font-medium leading-[1.4] tracking-[-0.64px] text-white">
                    {item.label}
                  </span>
                </button>
              );
            }

            return (
              <div
                key={item.label}
                aria-disabled="true"
                className="flex h-[38px] w-full select-none items-center gap-2 rounded-[8px] px-3 py-2"
              >
                <Icon
                  className="size-5 shrink-0 text-[rgba(94,94,94,0.8)]"
                  strokeWidth={1.8}
                />

                <span className="font-sans text-[16px] font-normal leading-[1.4] tracking-[-0.64px] text-[rgba(94,94,94,0.8)]">
                  {item.label}
                </span>
              </div>
            );
          })}
        </nav>
      </div>

      {/* Bottom section */}
      <div
        className={`flex flex-col ${
          collapsed ? "items-center gap-3" : "gap-2"
        }`}
      >
        {/* Settings - static */}
        {collapsed ? (
          <div
            aria-disabled="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-[8px]"
            title="Settings"
          >
            <Settings className="size-5 text-[rgba(94,94,94,0.8)]" strokeWidth={1.8} />
          </div>
        ) : (
          <div
            aria-disabled="true"
            className="flex h-[38px] w-full select-none items-center gap-2 rounded-[8px] px-3 py-2"
          >
            <Settings className="size-5 shrink-0 text-[rgba(94,94,94,0.8)]" strokeWidth={1.8} />

            <span className="font-sans text-[16px] font-normal leading-[1.4] tracking-[-0.64px] text-[rgba(94,94,94,0.8)]">
              Settings
            </span>
          </div>
        )}

        {/* School */}
        {collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label="Expand sidebar"
            className="flex size-[60px] shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-[#F0F0F0]"
          >
            <BookOpen className="size-7 text-[#5E5E5E]" strokeWidth={1.5} />
          </button>
        ) : (
          <div className="flex w-full items-center gap-2 rounded-[16px] bg-[#F0F0F0] p-3">
            <div className="flex size-[60px] shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-white">
              {/* Replace with your actual school image */}
              <div className="flex size-full items-center justify-center text-[#5E5E5E]">
                <BookOpen className="size-7" strokeWidth={1.5} />
              </div>
            </div>

            <div className="min-w-0">
              <p className="truncate font-sans text-[16px] font-bold leading-[1.4] tracking-[-0.64px] text-[#303030]">
                Delhi Public School
              </p>

              <p className="truncate font-sans text-[14px] font-normal leading-[1.4] tracking-[-0.56px] text-[#5E5E5E]">
                Bokaro Steel City
              </p>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}