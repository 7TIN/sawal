import { NextResponse } from "next/server";
import { extractWithProvider, type ProviderName } from "@/lib/ai/provider";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const qpFile = formData.get("questionPaper") as File | null;
    const asFile = formData.get("answerSheet") as File | null;
    const provider = (formData.get("provider") as ProviderName) || "sarvam";

    if (!qpFile || !asFile) {
      return NextResponse.json(
        { error: "Both questionPaper and answerSheet are required." },
        { status: 400 },
      );
    }

    const qpBlob = new Blob([await qpFile.arrayBuffer()], { type: qpFile.type });
    const asBlob = new Blob([await asFile.arrayBuffer()], { type: asFile.type });

    const result = await extractWithProvider(
      provider,
      qpBlob,
      asBlob,
      qpFile.name || "question-paper",
      asFile.name || "answer-sheet",
      (stage) => {
        console.log("[extract]", stage);
      },
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("[extract]", error);
    const message = error instanceof Error ? error.message : "Extraction failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}