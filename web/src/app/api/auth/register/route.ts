import { NextRequest, NextResponse } from 'next/server';
import { KcError, adminCreateUser, passwordLogin } from '@/lib/server/keycloak';
import { sendEmail, welcomeEmailHtml } from '@/lib/server/email';

/**
 * POST /api/auth/register
 *
 * Body:  { email, password, first_name?, last_name? }
 * Reply: { access_token, refresh_token, expires_in, expires_at }
 *
 * Two-step server flow:
 *   1) Admin REST POST /users — creates the Keycloak user.
 *   2) Direct grant immediately as that user — returns tokens to the
 *      caller so the UX is "form submit → logged in" with no extra
 *      round-trip.
 *
 * The realm export currently has `registrationAllowed: false`, so this
 * is the only path through which a user can be created. Email
 * verification is also disabled (`verifyEmail: false`), so the new
 * user can log in immediately.
 *
 * ## Anti-enumeration / abuse mitigations
 *
 * - **Per-IP rate limit** (5 attempts / 15 min, in-memory sliding
 *   window). Cheap defense against a wordlist walker; the prod
 *   deploy is single-instance ACA so a process-local store is fine.
 *   Multi-instance setups should swap this for Redis.
 * - **Equalized latency on the 409 branch** (`await sleep(...)` to
 *   match the happy-path Keycloak round-trip) so an attacker can't
 *   distinguish duplicate from new via response time. Combined with
 *   a non-specific error string, this raises the bar for enumeration
 *   without breaking the existing UX (real signups still get tokens).
 * - **firstName / lastName sanitization** (length cap + control-char
 *   strip) blocks CRLF/SMTP injection through the welcome email.
 */

// --- per-IP sliding-window rate limit (in-memory) -------------------

/** Window size for the rate-limit bucket. */
const RATE_LIMIT_WINDOW_MS = 15 * 60_000;
/** Max attempts per IP in the window. */
const RATE_LIMIT_MAX = 5;
const ipBuckets: Map<string, number[]> = new Map();

function rateLimit(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const hits = (ipBuckets.get(ip) ?? []).filter((t) => t > cutoff);
  if (hits.length >= RATE_LIMIT_MAX) {
    ipBuckets.set(ip, hits);
    return false;
  }
  hits.push(now);
  ipBuckets.set(ip, hits);
  return true;
}

/** Best-effort client IP — works behind ACA's ingress proxy. */
function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

/** Caps + strips control chars from user-supplied name fields so they
 *  cannot be used for SMTP/CRLF injection through the welcome email. */
function safeName(s: unknown): string | undefined {
  if (typeof s !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const cleaned = s.replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (!cleaned) return undefined;
  return cleaned.slice(0, 50);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  // Rate limit before doing any work — fail fast under attack.
  const ip = clientIp(req);
  if (!rateLimit(ip)) {
    return NextResponse.json(
      { error: 'too many signup attempts; please try again later' },
      { status: 429, headers: { 'Retry-After': '900' } },
    );
  }

  let body: {
    email?: unknown;
    password?: unknown;
    first_name?: unknown;
    last_name?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const firstName = safeName(body.first_name);
  const lastName = safeName(body.last_name);

  if (!email || !password) {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
  }
  if (email.length > 320 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'invalid email' }, { status: 400 });
  }
  if (password.length < 8 || password.length > 256) {
    return NextResponse.json({ error: 'password must be 8–256 characters' }, { status: 400 });
  }

  try {
    await adminCreateUser({ email, password, firstName, lastName });
    const t = await passwordLogin(email, password);
    // Fire branded welcome email — fire-and-forget so a transient ACS
    // hiccup doesn't block signup. `sendEmail` catches its own errors
    // + returns false; we just kick it off and move on.
    void sendEmail({
      to: email,
      subject: 'Welcome to ControlCraft',
      html: welcomeEmailHtml({ firstName }),
    });
    return NextResponse.json({
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_in: t.expires_in,
      expires_at: Date.now() + t.expires_in * 1000,
    });
  } catch (e) {
    if (e instanceof KcError) {
      // Equalize duplicate-email response timing with the happy path
      // (one Keycloak admin POST + one direct-grant token call ≈ 200ms
      // round-trip locally; production typically 50-150ms). Also mask
      // the duplicate signal in the error body — combined with the
      // sleep this makes enumeration impractically slow at 5 req/15min.
      if (e.status === 409) {
        await sleep(150);
        return NextResponse.json(
          { error: 'registration failed; if you already have an account, please sign in' },
          { status: 409 },
        );
      }
      const status = e.status === 401 || e.status === 400 ? 400 : 500;
      return NextResponse.json({ error: e.message }, { status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
