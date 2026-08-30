"use client";

import { useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Workspace } from "./workspace";

export function ExamRoute({ projectid }: { projectid: string | null }) {
  const router = useRouter();
  const notifyCreatedRef = useRef(false);

  const handleProjectCreated = useCallback(
    (pid: string) => {
      if (notifyCreatedRef.current) return;
      notifyCreatedRef.current = true;
      router.replace(`/exam?projectid=${pid}`, { scroll: false });
    },
    [router],
  );

  if (projectid) {
    return (
      <Workspace
        key={projectid}
        projectId={projectid}
        onResetDone={() => router.replace("/")}
      />
    );
  }

  return (
    <Workspace
      projectId=""
      onProjectCreated={handleProjectCreated}
      onResetDone={() => router.replace("/")}
    />
  );
}