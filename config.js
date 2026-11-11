// All routing lives here. Go-live / add-a-person changes are one line.
// Every value can be overridden by an environment variable of the same name.
const list = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);

export const config = {
  // Who gets the full lead card (details, photos, ballpark). Comma-separated.
  // Blake's slot: add berryblake98@gmail.com here (or in the LEAD_TEAM_EMAILS env var) to turn his copies on.
  LEAD_TEAM_EMAILS: list(process.env.LEAD_TEAM_EMAILS ?? "shaun.brasher@gmail.com"),
  // Sender. Must be on a Resend-verified domain.
  RESEND_FROM: process.env.RESEND_FROM || "3 B's Tree Removal <leads@hustlestack.app>",
  // Where a customer's reply goes.
  REPLY_TO: list(process.env.REPLY_TO ?? "shaun.brasher@gmail.com"),
  BUSINESS_NAME: "3 B's Tree Removal",
  PHONE_DISPLAY: "318-712-TREE (8733)",
  PHONE_TEL: "+13187128733",
  REGION: "Central & Southwest Louisiana",
  // Public base URL of this service, used for photo links in the team email.
  PUBLIC_URL: process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "",
  // Browser origins allowed to post the website form.
  ALLOWED_ORIGINS: list(process.env.ALLOWED_ORIGINS ?? "https://hustlestack777.github.io,https://3bstreeremoval.com,https://www.3bstreeremoval.com"),
};
