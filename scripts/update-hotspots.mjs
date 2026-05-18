import { writeFileSync } from "node:fs";

function beijingIsoString(date = new Date()) {
  const formatted = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);

  return `${formatted.replace(" ", "T")}+08:00`;
}

const updatedAt = beijingIsoString();
const content = `window.UPDATE_META = {
  lastUpdatedAt: "${updatedAt}",
  updateMode: "scheduled-framework",
  note: "GitHub Actions scheduled update framework is running. Real hotspot crawling will be connected later.",
};
`;

writeFileSync("update-meta.js", content, "utf8");
console.log(`Updated update-meta.js at ${updatedAt}`);
