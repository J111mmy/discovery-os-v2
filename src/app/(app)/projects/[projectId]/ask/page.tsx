import { getProjectForUser } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { AskInterface } from "./ask-interface";

interface Props {
  params: { projectId: string };
}

export default async function AskPage({ params }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const project = await getProjectForUser<{ id: string; org_id: string; name: string }>(
    user.id,
    params.projectId,
    "id, org_id, name"
  );

  if (!project) notFound();

  return (
    <div className="mx-auto max-w-6xl">
      {/* Studio chrome header */}
      <div
        style={{
          marginBottom: 24,
          paddingBottom: 16,
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 10,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--ink-faint)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            Ask
          </span>
          <span style={{ color: "var(--line)", userSelect: "none" }}>·</span>
          <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>{project.name}</span>
        </div>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 600,
            color: "var(--ink)",
            letterSpacing: "-0.01em",
            marginBottom: 6,
          }}
        >
          Ask your research
        </h1>
        <p style={{ fontSize: 13, color: "var(--ink-2)", maxWidth: 560, lineHeight: 1.6 }}>
          Query evidence, themes, and problems in plain language. Answers cite their sources.
        </p>
      </div>

      <AskInterface projectId={project.id} projectName={project.name} />
    </div>
  );
}
