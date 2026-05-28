import { isSuperAdmin } from "@/lib/auth/super-admin";
import {
  getAIProviderSettings,
  updateAIModelRouting,
  updateAIProvider,
  validateModelRouting,
} from "@/lib/llm/settings";
import { RECOMMENDED_MODEL_ROUTING, isLLMProvider } from "@/lib/llm/models";
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

async function requireSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { userId: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  if (!(await isSuperAdmin(user.id))) {
    return { userId: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { userId: user.id, response: null };
}

export async function GET() {
  const auth = await requireSuperAdmin();
  if (auth.response) return auth.response;

  return NextResponse.json(await getAIProviderSettings());
}

export async function PATCH(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (auth.response) return auth.response;

  const body = (await req.json().catch(() => null)) as {
    provider?: unknown;
    routes?: unknown;
    use_recommended?: unknown;
  } | null;

  if (!body) {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  try {
    if (body.use_recommended === true) {
      await updateAIModelRouting(RECOMMENDED_MODEL_ROUTING, auth.userId);
    } else if (body.routes) {
      const routes = validateModelRouting(body.routes);
      if (!routes) {
        return NextResponse.json(
          { error: "routes must include cheap, standard, premium, and eval model routes" },
          { status: 400 }
        );
      }
      await updateAIModelRouting(routes, auth.userId);
    } else if (isLLMProvider(body.provider)) {
      await updateAIProvider(body.provider, auth.userId);
    } else {
      return NextResponse.json(
        { error: "Provide routes, use_recommended=true, or provider" },
        { status: 400 }
      );
    }

    return NextResponse.json(await getAIProviderSettings());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update AI provider.";
    return NextResponse.json(
      {
        error: message,
        hint: "If this mentions platform_settings, run migration 0021_platform_ai_settings.sql in Supabase.",
      },
      { status: 500 }
    );
  }
}
