import { redirect } from "next/navigation";
import { ExamRoute } from "@/components/workspace/exam-route";

export default async function ExamPage({
  searchParams,
}: {
  searchParams: Promise<{ projectid?: string | string[]; new?: string | string[] }>;
}) {
  const params = await searchParams;
  const projectid = typeof params.projectid === "string" ? params.projectid : null;
  const isNew = params.new === "true";
  if (!projectid && !isNew) redirect("/");
  return <ExamRoute projectid={projectid} />;
}