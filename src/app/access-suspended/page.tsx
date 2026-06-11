import AccessStateCard from "@/app/access-state-card";

export default function AccessSuspendedPage() {
  return (
    <AccessStateCard
      title="Your access has been suspended"
      body="Your account access has been paused. Contact your DiscOS admin if you believe this is a mistake."
    />
  );
}
