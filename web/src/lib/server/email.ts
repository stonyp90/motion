import 'server-only';
import { createHash, createHmac } from 'crypto';

/**
 * Azure Communication Services email — server-only.
 *
 * Signs the `/emails:send` request with the ACS HMAC-SHA256 scheme and
 * POSTs the JSON envelope. Env contract:
 *
 *   AZURE_COMMS_ENDPOINT  — hostname only, e.g. `acs-controlcraft-dev-…
 *                            .communication.azure.com`
 *   AZURE_COMMS_KEY       — base64-encoded primary key from
 *                            `commsService.listKeys()`
 *   EMAIL_FROM            — verified sender, e.g.
 *                            `donotreply@<random>.azurecomm.net`
 *   EMAIL_FROM_NAME       — display name (default `ControlCraft`)
 *
 * Failure mode: the function NEVER throws — a failed welcome email
 * shouldn't block signup. Errors are logged and silently swallowed so
 * the caller can still return the JWT.
 */

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  /** Optional plain-text body. Falls back to a tag-stripped HTML. */
  text?: string;
}

export async function sendEmail({ to, subject, html, text }: SendArgs): Promise<boolean> {
  const endpoint = process.env.AZURE_COMMS_ENDPOINT;
  const key = process.env.AZURE_COMMS_KEY;
  const from = process.env.EMAIL_FROM;

  if (!endpoint || !key || !from) {
    console.warn('[email] ACS env not set — skipping send', {
      to,
      subject,
      hasEndpoint: !!endpoint,
      hasKey: !!key,
      hasFrom: !!from,
    });
    return false;
  }

  const payload = {
    senderAddress: from,
    recipients: { to: [{ address: to }] },
    content: {
      subject,
      plainText: text ?? stripHtml(html),
      html,
    },
  };
  const body = JSON.stringify(payload);
  const bodyHash = createHash('sha256').update(body).digest('base64');
  const date = new Date().toUTCString(); // RFC 7231: "Fri, 23 May 2025 12:00:00 GMT"
  const host = endpoint.replace(/\/+$/, '');
  const pathAndQuery = '/emails:send?api-version=2023-03-31';
  const stringToSign = `POST\n${pathAndQuery}\n${date};${host};${bodyHash}`;
  const signature = createHmac('sha256', Buffer.from(key, 'base64'))
    .update(stringToSign, 'utf8')
    .digest('base64');

  try {
    const res = await fetch(`https://${host}${pathAndQuery}`, {
      method: 'POST',
      headers: {
        'x-ms-date': date,
        'x-ms-content-sha256': bodyHash,
        'Content-Type': 'application/json',
        Authorization: `HMAC-SHA256 SignedHeaders=date;host;x-ms-content-sha256&Signature=${signature}`,
      },
      body,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error('[email] ACS send failed', {
        to,
        subject,
        status: res.status,
        body: errBody.slice(0, 500),
      });
      return false;
    }
    return true;
  } catch (e) {
    console.error('[email] ACS network error', { to, subject, err: String(e) });
    return false;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Branded ControlCraft welcome email. HTML-only (the ACS adapter
 * derives a plain-text fallback). Self-contained styling — most clients
 * strip `<style>` blocks, so every style is inline.
 *
 * Brand palette mirrors the web app's design tokens:
 *   --color-bg-primary    #ffffff
 *   --color-bg-secondary  #f8fafc
 *   --color-text-primary  #0f172a
 *   --color-text-secondary #475569
 *   --color-accent-600    #059669  (emerald)
 *   --color-accent-700    #047857
 */
export function welcomeEmailHtml(args: { firstName?: string }): string {
  const greeting = args.firstName ? `Hi ${escapeHtml(args.firstName)},` : 'Welcome,';
  const appUrl = process.env.PUBLIC_APP_URL ?? 'https://www.controlcraft.io';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Welcome to ControlCraft</title>
  </head>
  <body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f8fafc;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
            <!-- Brand bar -->
            <tr>
              <td style="padding:32px 40px 8px 40px;">
                <span style="font-size:18px;font-weight:700;letter-spacing:-0.01em;color:#0f172a;">
                  Control<span style="color:#059669;">Craft</span>
                </span>
              </td>
            </tr>
            <!-- Headline -->
            <tr>
              <td style="padding:8px 40px 24px 40px;">
                <h1 style="margin:0 0 16px 0;font-size:28px;line-height:1.2;font-weight:700;letter-spacing:-0.02em;color:#0f172a;">
                  ${greeting}
                </h1>
                <p style="margin:0;font-size:16px;line-height:1.55;color:#475569;">
                  Your ControlCraft account is ready. Turn a one-line brief into a
                  brand-grade motion graphic in twenty minutes — no agency timeline,
                  no agency invoice.
                </p>
              </td>
            </tr>
            <!-- CTA -->
            <tr>
              <td style="padding:0 40px 32px 40px;">
                <a href="${appUrl}/" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:9999px;">
                  Open ControlCraft →
                </a>
              </td>
            </tr>
            <!-- Three pointers -->
            <tr>
              <td style="padding:0 40px 32px 40px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="padding:14px 0;border-top:1px solid #e2e8f0;font-size:14px;color:#475569;">
                      <strong style="color:#0f172a;">Write a brief.</strong>
                      Paste your launch script, narration, or rough idea. Voice and
                      reference images work too.
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:14px 0;border-top:1px solid #e2e8f0;font-size:14px;color:#475569;">
                      <strong style="color:#0f172a;">Pick a format.</strong>
                      Wide, vertical, square, portrait — pick the platform; we set
                      the rest.
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:14px 0;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;font-size:14px;color:#475569;">
                      <strong style="color:#0f172a;">Generate. Iterate.</strong>
                      Regenerate as many times as you need; export as MP4, Lottie,
                      or per-scene pack.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td style="padding:24px 40px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:13px;color:#64748b;line-height:1.5;">
                You're getting this because you signed up at ControlCraft.
                Questions? Just reply — a human reads every email.
                <br/><br/>
                ControlCraft · <a href="${appUrl}/privacy" style="color:#059669;text-decoration:none;">Privacy</a> · <a href="${appUrl}/terms" style="color:#059669;text-decoration:none;">Terms</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
