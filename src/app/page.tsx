// Root redirect — send authenticated users to /projects, others to /login
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function RootPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    redirect("/projects");
  } else {
    redirect("/login");
  }
}
