import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const TEXT_FILE_EXTENSIONS = new Set(["txt", "md", "markdown"]);

function fileExtension(name: string) {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function cleanExtractedText(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

async function extractPdfText(buffer: Buffer) {
  const { extractText } = await import("unpdf");
  const result = await extractText(new Uint8Array(buffer), { mergePages: true });
  return cleanExtractedText(result.text ?? "");
}

async function extractDocxText(buffer: Buffer) {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return cleanExtractedText(result.value ?? "");
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file." }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "File is too large. Upload a file under 10MB." },
      { status: 413 }
    );
  }

  const extension = fileExtension(file.name);
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    let text = "";

    if (TEXT_FILE_EXTENSIONS.has(extension)) {
      text = cleanExtractedText(new TextDecoder("utf-8").decode(buffer));
    } else if (extension === "pdf") {
      text = await extractPdfText(buffer);
    } else if (extension === "docx") {
      text = await extractDocxText(buffer);
    } else if (extension === "doc") {
      return NextResponse.json(
        {
          error:
            "Legacy .doc files cannot be extracted reliably. Save as .docx or paste the text manually.",
        },
        { status: 400 }
      );
    } else {
      return NextResponse.json(
        { error: "Unsupported file type. Upload a .pdf, .docx, .txt, .md, or .markdown file." },
        { status: 400 }
      );
    }

    if (!text) {
      return NextResponse.json(
        { error: "No readable text was found in this file." },
        { status: 422 }
      );
    }

    return NextResponse.json({ text });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not extract text from this file.";
    return NextResponse.json(
      { error: `Could not extract text from this file. ${message}` },
      { status: 500 }
    );
  }
}
