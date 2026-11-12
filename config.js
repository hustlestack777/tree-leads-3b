// All routing lives here. Go-live / add-a-person changes are one line.
// Every value can be overridden by an environment variable of the same name.
const list = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);

const PREFERRED_FROM = ["3 B's Tree Removal <3bs@getpros.xyz>", "3 B's Tree Removal <3bs@lagniapperealmlabs.com>"];
function fromList(env) {
  const e = String(env || "").trim();
  if (!e) return PREFERRED_FROM;
  if (/hustlestack/i.test(e)) return [...PREFERRED_FROM, e];
  return [e, ...PREFERRED_FROM.filter((f) => f !== e)];
}

export const config = {
  // Who gets the full lead card (details, photos, ballpark). Comma-separated.
  // Blake's slot: add his address here (or in the LEAD_TEAM_EMAILS env var) to turn his copies on.
  LEAD_TEAM_EMAILS: list(process.env.LEAD_TEAM_EMAILS ?? "shaun.brasher@gmail.com"),
  // Always blind-copied on every customer confirmation email (Shaun's standing rule).
  CUSTOMER_BCC: list(process.env.CUSTOMER_BCC ?? "shaun.brasher@gmail.com"),
  // Sender. Must be on a Resend-verified domain.
  // No Hustle Stack addresses on client mail (Shaun, Nov 12). getpros.xyz is verified in
  // Resend; lagniapperealmlabs.com is the backup. A hustlestack.app RESEND_FROM env value is
  // only used as a last resort if Resend refuses both, so a lead alert is never lost.
  RESEND_FROM: fromList(process.env.RESEND_FROM),
  // Where a customer's reply goes.
  REPLY_TO: list(process.env.REPLY_TO ?? "shaun.brasher@gmail.com"),
  BUSINESS_NAME: "3 B's Tree Removal",
  PHONE_DISPLAY: "318-712-TREE (8733)",
  PHONE_TEL: "+13187128733",
  REGION: "Central & Southwest Louisiana",
  // Public base URL of this service, used for photo links in the team email.
  PUBLIC_URL: process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "",
  // Quote form link given to phone/chat customers so they can add photos.
  SITE_URL: process.env.SITE_URL || "https://hustlestack777.github.io/preview-3b-dc5d2e3804ad/",
  // Browser origins allowed to post the website form.
  // The live lead-magnet page is always allowed, even when the env var overrides the list.
  ALLOWED_ORIGINS: [...new Set([...list(process.env.ALLOWED_ORIGINS ?? "https://hustlestack777.github.io,https://3bstreeremoval.com,https://www.3bstreeremoval.com"), "https://tree-lrl-credit-preview.onrender.com",
    "https://3bs.getpros.xyz", "https://tree.getpros.xyz", "https://getpros.xyz", "https://www.getpros.xyz"])],
};
