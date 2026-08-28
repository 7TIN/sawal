import { NextResponse } from "next/server";
import { combineExtractionFromRaw } from "@/lib/ai/provider";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      raw?: { qpDigitise?: string[]; asExtract?: unknown; asDigitise?: string[] };
    };
    const raw = body.raw;

    if (!raw || !Array.isArray(raw.qpDigitise) || !Array.isArray(raw.asDigitise)) {
      return NextResponse.json(
        { error: "A saved raw response is required (qpDigitise, asExtract, asDigitise)." },
        { status: 400 },
      );
    }

    const result = await combineExtractionFromRaw({
      qpDigitise: raw.qpDigitise,
      asExtract: raw.asExtract,
      asDigitise: raw.asDigitise,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[extract/offline]", error);
    const message = error instanceof Error ? error.message : "Offline extraction failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}