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
  <body style="margin:0;padding:0;background:#f4f5f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f8;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e6e8ee;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 8px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:40px;height:40px;background:#6366F1;border-radius:10px;text-align:center;vertical-align:middle;color:#ffffff;font-weight:700;font-size:20px;">D</td>
                    <td style="padding-left:12px;vertical-align:middle;">
                      <div style="font-weight:700;font-size:17px;color:#0e1424;line-height:1.1;">DiscOS</div>
                      <div style="font-size:13px;color:#8a93a3;line-height:1.2;">Evidence workspace</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 0 32px;">
                <h1 style="margin:0 0 8px 0;font-size:22px;color:#0e1424;font-weight:700;">You've been invited to DiscOS</h1>
                <p style="margin:0 0 24px 0;font-size:15px;line-height:1.55;color:#5b6472;">${intro}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 8px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td align="center" style="border-radius:10px;background:#6366F1;">
                      <a href="${acceptUrl}" style="display:block;padding:14px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">Accept your invitation</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 28px 32px;">
                <p style="margin:0;font-size:13px;line-height:1.5;color:#8a93a3;">
                  This secure link opens DiscOS so you can finish joining the workspace. If you were not expecting this invite, you can ignore this email.
                </p>
              </td>
            </tr>
          </table>
          <p style="max-width:480px;margin:16px auto 0 auto;font-size:12px;color:#aab2bf;text-align:center;">DiscOS · Evidence workspace</p>
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
