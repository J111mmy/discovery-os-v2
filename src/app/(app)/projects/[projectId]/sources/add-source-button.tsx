"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { AddEvidenceModal } from "@/app/(app)/components/AddEvidenceModal";

interface AddSourceButtonProps {
  projectId: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function AddSourceButton({
  projectId,
  children,
  className,
  style,
}: AddSourceButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={className}
        style={style}
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      <AddEvidenceModal open={open} onClose={() => setOpen(false)} projectId={projectId} />
    </>
  );
}
