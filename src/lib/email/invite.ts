import { sendEmail } from "@/lib/email/resend";

type InviteEmailParams = {
  to: string;
  acceptUrl: string;
  orgName: string;
  inviterName?: string;
  role: "owner" | "admin" | "member";
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function roleLabel(role: InviteEmailParams["role"]) {
  if (role === "owner") return "an owner";
  return role === "admin" ? "an admin" : "a member";
}

function invitationIntro(params: InviteEmailParams) {
  const orgName = escapeHtml(params.orgName);
  const role = escapeHtml(roleLabel(params.role));

  if (params.inviterName) {
    return `${escapeHtml(params.inviterName)} invited you to join ${orgName} in DiscOS as ${role}.`;
  }

  return `You have been invited to join ${orgName} in DiscOS as ${role}.`;
}

function renderInviteHtml(params: InviteEmailParams) {
  const intro = invitationIntro(params);
  const acceptUrl = escapeHtml(params.acceptUrl);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>You've been invited to DiscOS</title>
  </head>
  <body style="margin:0;background:#0d0d10;color:#e8e8f0;font-family:Inter,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d10;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#141418;border:1px solid #30303a;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:28px 28px 20px;">
                <div style="display:inline-block;background:#5b63f0;color:#ffffff;border-radius:8px;padding:8px 10px;font-size:18px;font-weight:700;line-height:1;">D</div>
                <h1 style="margin:20px 0 10px;color:#ffffff;font-size:24px;line-height:1.25;font-weight:700;">You've been invited to DiscOS</h1>
                <p style="margin:0;color:#b7b7c8;font-size:15px;line-height:1.7;">${intro}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 28px;">
                <a href="${acceptUrl}" style="display:inline-block;background:#5b63f0;color:#ffffff;text-decoration:none;border-radius:8px;padding:12px 18px;font-size:14px;font-weight:700;">Accept your invitation</a>
                <p style="margin:22px 0 0;color:#9090a8;font-size:13px;line-height:1.6;">This secure link opens DiscOS so you can finish joining the workspace. If you were not expecting this invite, you can ignore this email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderInviteText(params: InviteEmailParams) {
  const intro = params.inviterName
    ? `${params.inviterName} invited you to join ${params.orgName} in DiscOS as ${roleLabel(params.role)}.`
    : `You have been invited to join ${params.orgName} in DiscOS as ${roleLabel(params.role)}.`;

  return `${intro}

Accept your invitation:
${params.acceptUrl}

This secure link opens DiscOS so you can finish joining the workspace. If you were not expecting this invite, you can ignore this email.`;
}

export async function sendInviteEmail(params: InviteEmailParams) {
  await sendEmail({
    to: params.to,
    subject: "You've been invited to DiscOS",
    html: renderInviteHtml(params),
    text: renderInviteText(params),
  });
}
