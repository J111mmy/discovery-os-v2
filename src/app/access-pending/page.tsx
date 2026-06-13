import AccessStateCard from "@/app/access-state-card";

export default function AccessPendingPage() {
  return (
    <AccessStateCard
      title="Your access is pending review"
      body="We've received your request and a team member will review it shortly. You'll get an email once you're approved."
      signOutLabel="Not you? Sign out"
    />
  );
}
