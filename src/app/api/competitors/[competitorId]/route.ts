import { createClient } from "@/lib/supabase/server";
import { getActiveOrgId } from "@/lib/auth/org";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const BattleCardPatchSchema = z.object({
  your_counter: z.string().nullable().optional(),
  one_proof_point: z.string().nullable().optional(),
});

interface Props {
  params: { competitorId: string };
}

type BattleCardValue = {
  their_pitch?: string;
  where_they_win?: string;
  their_gap?: string;
  your_counter?: string | null;
  one_proof_point?: string | null;
};

export async function PATCH(req: NextRequest, { params }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = await getActiveOrgId(user.id);

  if (!orgId) {
    return NextResponse.json({ error: "Org not found" }, { status: 404 });
  }

  const parsed = BattleCardPatchSchema.safeParse(await req.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { data: competitor, error: competitorError } = await supabase
    .from("competitors")
    .select("battle_card")
    .eq("org_id", orgId)
    .eq("id", params.competitorId)
    .single();

  if (competitorError || !competitor) {
    return NextResponse.json({ error: "Competitor not found" }, { status: 404 });
  }

  const existingBattleCard =
    competitor.battle_card && typeof competitor.battle_card === "object"
      ? (competitor.battle_card as BattleCardValue)
      : {};

  const nextBattleCard = {
    ...existingBattleCard,
    ...(Object.prototype.hasOwnProperty.call(parsed.data, "your_counter")
      ? { your_counter: parsed.data.your_counter }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(parsed.data, "one_proof_point")
      ? { one_proof_point: parsed.data.one_proof_point }
      : {}),
  };

  const { error } = await supabase
    .from("competitors")
    .update({ battle_card: nextBattleCard, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", params.competitorId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
