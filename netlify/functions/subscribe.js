/**
 * Mailing-list sign-up endpoint for the marketing homepage.
 *
 * The browser posts here; this function calls EmailOctopus. The API key never
 * reaches the client, and the form never posts to a third party directly.
 *
 * EmailOctopus is configured for double opt-in, so a successful call here means
 * "confirmation email sent", not "subscribed" -- which is why the homepage says
 * "check your inbox" rather than "you're in".
 *
 * See spec/spec-marketing.md section 9.
 */

"use strict";

const API_BASE = "https://api.emailoctopus.com/lists";

const API_KEY = process.env.EMAILOCTOPUS_API_KEY || "";
const LIST_ID = process.env.EMAILOCTOPUS_LIST_ID || "";

// The exact wording the subscriber consented to, recorded alongside the
// address so the consent record survives later copy changes.
const CONSENT_WORDING =
  "Email me about the Epping Forest Finds release, alpha invitations and major updates about the app.";

/**
 * Deliberately permissive: one @, something either side, a dot in the domain.
 * Stricter patterns reject real addresses, and EmailOctopus validates properly
 * anyway. This only catches obvious rubbish before we make a network call.
 */
function isPlausibleEmail(value) {
  if (typeof value !== "string") return false;
  const email = value.trim();
  if (email.length < 6 || email.length > 254) return false;
  if (/\s/.test(email)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(email);
}

/**
 * Bot checks that cost nothing and need no third-party script on the one page
 * that has to load fastest. Returns true when the submission looks automated.
 */
function looksAutomated({ honeypot }) {
  return Boolean(honeypot);
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return response(405, { error: "Method not allowed" });

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return response(400, { error: "Invalid request" });
  }

  if (!isPlausibleEmail(payload.email)) {
    return response(400, { error: "Please enter a valid email address." });
  }

  if (payload.consent !== true) {
    return response(400, { error: "Please tick the box to confirm you're happy to hear from us." });
  }

  // Silently accept anything that looks automated: telling a bot it was
  // detected only teaches it what to change.
  if (looksAutomated(payload)) return response(200, { ok: true });

  if (!API_KEY || !LIST_ID) {
    console.error("subscribe: EMAILOCTOPUS_API_KEY or EMAILOCTOPUS_LIST_ID is not configured");
    return response(500, { error: "Sign-up is temporarily unavailable. Please try again later." });
  }

  const email = payload.email.trim();

  try {
    const upstream = await fetch(`${API_BASE}/${encodeURIComponent(LIST_ID)}/contacts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        email_address: email,
        fields: { ConsentWording: CONSENT_WORDING },
        tags: ["alpha-waitlist"],
        status: "pending",
      }),
    });

    // An address already on the list is not an error the caller should learn
    // about: a response that distinguishes "new" from "already subscribed"
    // turns this endpoint into a way to test whether an address is a member.
    if (upstream.ok || upstream.status === 409) return response(200, { ok: true });

    const detail = await upstream.text();
    console.error(`subscribe: EmailOctopus responded ${upstream.status}: ${detail.slice(0, 500)}`);
    return response(502, { error: "Sign-up is temporarily unavailable. Please try again later." });
  } catch (error) {
    console.error(`subscribe: request failed: ${error && error.message}`);
    return response(502, { error: "Sign-up is temporarily unavailable. Please try again later." });
  }
};

// Exported for tests.
exports.isPlausibleEmail = isPlausibleEmail;
exports.looksAutomated = looksAutomated;
exports.CONSENT_WORDING = CONSENT_WORDING;
