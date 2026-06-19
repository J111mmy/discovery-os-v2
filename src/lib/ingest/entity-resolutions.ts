import { z } from "zod";
import { normalizeSpeakerName } from "@/lib/speakers/resolve";

export const ProjectEntityRoleSchema = z.enum([
  "customer",
  "internal",
  "interviewer",
]);

export const EntityResolutionSchema = z.object({
  raw_label: z.string().trim().min(1),
  resolved_name: z.string().trim().min(1).nullable().optional(),
  person_id: z.string().uuid().nullable().optional(),
  project_role: ProjectEntityRoleSchema.nullable().optional(),
  org_name: z.string().trim().min(1).nullable().optional(),
  company_id: z.string().uuid().nullable().optional(),
  is_tool_or_product: z.boolean().optional().default(false),
});

export const EntityResolutionsSchema = z
  .array(EntityResolutionSchema)
  .max(100)
  .optional()
  .default([]);

export type ProjectEntityRole = z.infer<typeof ProjectEntityRoleSchema>;
export type EntityResolution = z.infer<typeof EntityResolutionSchema>;

export function parseEntityResolutions(value: unknown): EntityResolution[] {
  const parsed = EntityResolutionsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function normalizedResolutionLabel(value: string | null | undefined) {
  return normalizeSpeakerName(value ?? "");
}

export function buildResolutionLookup(resolutions: EntityResolution[]) {
  const byLabel = new Map<string, EntityResolution>();

  for (const resolution of resolutions) {
    const labels = [
      resolution.raw_label,
      resolution.resolved_name ?? null,
    ]
      .map(normalizedResolutionLabel)
      .filter(Boolean);

    for (const label of labels) {
      if (!byLabel.has(label)) byLabel.set(label, resolution);
    }
  }

  return byLabel;
}

export function findResolutionForSpeaker(
  resolutions: EntityResolution[],
  speaker: string | null | undefined
) {
  const normalizedSpeaker = normalizedResolutionLabel(speaker);
  if (!normalizedSpeaker) return null;

  return buildResolutionLookup(resolutions).get(normalizedSpeaker) ?? null;
}

export function resolvedSpeakerName(
  resolutions: EntityResolution[],
  speaker: string | null | undefined
) {
  const resolution = findResolutionForSpeaker(resolutions, speaker);
  return resolution?.resolved_name?.trim() || speaker;
}

export function isInternalProjectRole(role: ProjectEntityRole | null | undefined) {
  return role === "internal" || role === "interviewer";
}
