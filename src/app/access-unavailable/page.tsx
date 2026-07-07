import AccessStateCard from "@/app/access-state-card";

export default function AccessUnavailablePage() {
  return (
    <AccessStateCard
      title="We could not verify access"
      body="This looks temporary. Try again in a moment. If it keeps happening, sign out and sign in again."
      actionHref="/projects"
      actionLabel="Try again"
      signOutLabel="Sign out"
    />
  );
}
