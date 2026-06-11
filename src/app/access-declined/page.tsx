import AccessStateCard from "@/app/access-state-card";

export default function AccessDeclinedPage() {
  return (
    <AccessStateCard
      title="Access not granted"
      body="Your request to access DiscOS wasn't approved. If you think this is a mistake, contact your DiscOS admin."
    />
  );
}
