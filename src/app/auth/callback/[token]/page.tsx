import { InviteAuthCallback } from "./invite-auth-callback";

interface InviteAuthCallbackPageProps {
  params: {
    token: string;
  };
}

export default function InviteAuthCallbackPage({ params }: InviteAuthCallbackPageProps) {
  return <InviteAuthCallback token={params.token} />;
}
