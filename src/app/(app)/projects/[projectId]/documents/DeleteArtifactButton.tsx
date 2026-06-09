"use client";

import { deleteArtifactAction } from "./actions";

interface Props {
  projectId: string;
  artifactId: string;
}

export function DeleteArtifactButton({ projectId, artifactId }: Props) {
  async function handleDelete() {
    if (!window.confirm("Delete this document? This cannot be undone.")) return;
    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("artifact_id", artifactId);
    await deleteArtifactAction(formData);
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      className="rounded-lg border border-neg/20 px-2.5 py-1 text-xs font-medium text-neg transition-colors hover:border-neg"
    >
      Delete
    </button>
  );
}
