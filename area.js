// Main marketing area (Shaun, Nov 22 2026): DeRidder, Leesville, Toledo Bend, Oakdale, Jennings
// and up through Alexandria. This is for ad targeting and copy only. Leads from anywhere are
// still saved and emailed; anything outside is flagged so Blake can decide (big jobs may be
// worth the drive). The check is approximate: about 20 miles from an anchor town.
const ANCHORS = [
  ["DeRidder", 30.8463, -93.2891], ["Leesville", 31.1435, -93.2610], ["Many (Toledo Bend)", 31.5688, -93.4843],
  ["Zwolle (Toledo Bend)", 31.6316, -93.6430], ["Oakdale", 30.8160, -92.6604], ["Oberlin", 30.6202, -92.7626],
  ["Kinder", 30.4855, -92.8507], ["Jennings", 30.2224, -92.6571], ["Pitkin", 30.9369, -92.9364],
  ["Glenmora", 30.9763, -92.5854], ["Alexandria", 31.3113, -92.4451], ["Pineville", 31.3224, -92.4343],
];
export const MAIN_AREA_MILES = 20;
const MAIN_WORDS = /\b(deridder|leesville|toledo bend|many|zwolle|florien|oakdale|oberlin|kinder|jennings|pitkin|glenmora|alexandria|pineville|fort johnson|fort polk|new llano|anacoco|rosepine|elizabeth|boyce|lecompte|welsh|elton|merryville|singer|hornbeck|evans|dry creek|sugartown|beauregard|vernon|sabine|allen|jefferson davis|rapides)\b/i;
const OUTSIDE_WORDS = /\b(lake charles|sulphur|westlake|moss bluff|iowa|vinton|dequincy|calcasieu|natchitoches|avoyelles|marksville|bunkie|evangeline|ville platte|mamou|lafayette|crowley|eunice|opelousas|colfax)\b/i;

function miles(lat1, lon1, lat2, lon2) {
  const r = (d) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(a));
}

/** { status: "main" | "outside" | "unknown", label } for the team email only. Never shown to customers. */
export function areaFlag(lead = {}) {
  const lat = Number(lead.lat), lon = Number(lead.lon);
  if (lead.lat != null && lead.lon != null && Number.isFinite(lat) && Number.isFinite(lon) && lat && lon) {
    let best = null;
    for (const [name, a, b] of ANCHORS) {
      const d = miles(lat, lon, a, b);
      if (!best || d < best.d) best = { name, d };
    }
    if (best.d <= MAIN_AREA_MILES) return { status: "main", label: `Main area (about ${Math.round(best.d)} mi from ${best.name})` };
    return { status: "outside", label: `Outside main area (about ${Math.round(best.d)} mi from ${best.name}). Blake decides.` };
  }
  const text = `${lead.address || ""} ${lead.town || ""}`;
  if (OUTSIDE_WORDS.test(text)) return { status: "outside", label: "Outside main area (by town name). Blake decides." };
  if (MAIN_WORDS.test(text)) return { status: "main", label: "Main area (by town name)" };
  return { status: "unknown", label: text.trim() ? "Area not checked (no map pin). Check the address." : "" };
}
