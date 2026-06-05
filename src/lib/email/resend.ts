type SendEmailParams = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails";

export class EmailSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailSendError";
  }
}

function requireEmailEnv(name: "RESEND_API_KEY" | "EMAIL_FROM") {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new EmailSendError(`${name} is not configured`);
  }

  if (/[\r\n]/.test(value)) {
    throw new EmailSendError(`${name} is invalid`);
  }

  return value;
}

function sanitizeProviderMessage(message: string) {
  return message
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]");
}

async function getResendErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as { message?: unknown; name?: unknown };
    const message = typeof body.message === "string" ? body.message : undefined;

    if (message?.trim()) {
      return sanitizeProviderMessage(message);
    }
  } catch {
    // Fall back to the status-based message below.
  }

  return `Resend request failed with status ${response.status}`;
}

export async function sendEmail({ to, subject, html, text }: SendEmailParams) {
  const apiKey = requireEmailEnv("RESEND_API_KEY");
  const from = requireEmailEnv("EMAIL_FROM");

  const response = await fetch(RESEND_EMAILS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    throw new EmailSendError(await getResendErrorMessage(response));
  }
}
