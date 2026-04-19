#!/usr/bin/env node
// Scrapes upcoming Widespread Panic shows from widespreadpanic.com/shows/
// and updates tourDates.json, then regenerates tour.ics.
// Usage: node sync-tour-dates.js [--dry-run]

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const SHOWS_URL = "https://widespreadpanic.com/shows/";
const TOUR_DATES_PATH = path.join(__dirname, "tourDates.json");

const MONTH_MAP = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function inferYear(month) {
  const today = new Date();
  const currentMonth = today.getMonth() + 1;
  const m = parseInt(MONTH_MAP[month], 10);
  // If the month is earlier than current month, it's next year
  return m < currentMonth - 1 ? today.getFullYear() + 1 : today.getFullYear();
}

function parseShows(html) {
  const shows = [];

  // widespreadpanic.com embeds page data in __NEXT_DATA__ — try that first
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(nextDataMatch[1]);
      // Walk the props tree looking for show arrays
      const json = JSON.stringify(nextData);
      // Extract date patterns like "Apr 17" with venue/city context
      const eventMatches = [...json.matchAll(/"date"\s*:\s*"([A-Z][a-z]{2}\s+\d{1,2})"/g)];
      if (eventMatches.length > 0) {
        // If we found structured data, parse it more carefully
        const props = nextData?.props?.pageProps;
        if (props?.shows || props?.events || props?.dates) {
          const raw = props.shows || props.events || props.dates;
          for (const ev of raw) {
            const dateStr = ev.date || ev.startDate || ev.event_date;
            const venue = ev.venue?.name || ev.venueName || ev.venue;
            const city = ev.venue?.city || ev.city;
            const state = ev.venue?.state || ev.stateCode || ev.state;
            if (dateStr && venue && city) {
              shows.push({ dateStr, venue, city, state: state || "" });
            }
          }
          if (shows.length) return shows;
        }
      }
    } catch (e) {
      // fall through to HTML parsing
    }
  }

  // HTML fallback: parse show rows
  // Each show has a date like "Apr 17" and venue/city text
  const rowPattern = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\b/g;
  const venuePattern = /<[^>]+class="[^"]*venue[^"]*"[^>]*>\s*([^<]+)/gi;
  const cityPattern = /<[^>]+class="[^"]*city[^"]*"[^>]*>\s*([^<]+)/gi;

  const dates = [...html.matchAll(rowPattern)].map(m => ({
    month: m[1],
    day: m[2].padStart(2, "0"),
  }));

  const venues = [...html.matchAll(venuePattern)].map(m => m[1].trim());
  const cities = [...html.matchAll(cityPattern)].map(m => m[1].trim());

  for (let i = 0; i < dates.length; i++) {
    shows.push({
      dateStr: `${dates[i].month} ${dates[i].day}`,
      venue: venues[i] || "Unknown Venue",
      city: cities[i] ? cities[i].split(",")[0].trim() : "Unknown City",
      state: cities[i] ? (cities[i].split(",")[1] || "").trim() : "",
    });
  }

  return shows;
}

function buildDate(month, day) {
  const year = inferYear(month);
  return `${year}-${MONTH_MAP[month]}-${day.toString().padStart(2, "0")}`;
}

function groupIntoRuns(shows) {
  // Group consecutive shows at the same venue into runs
  const runs = [];
  let current = null;

  for (const show of shows) {
    const [month, day] = show.dateStr.split(" ");
    const date = buildDate(month, day);
    const key = `${show.venue}|||${show.city}`;

    if (current && current.key === key) {
      current.dates.push(date);
    } else {
      if (current) runs.push(current);
      current = {
        key,
        dates: [date],
        venue: show.venue,
        city: show.city,
        state: show.state,
      };
    }
  }
  if (current) runs.push(current);

  return runs.map(({ dates, venue, city, state }) => ({
    dates: dates.sort(),
    venue,
    city,
    state,
  }));
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  console.log(`Fetching ${SHOWS_URL}...`);
  const res = await fetch(SHOWS_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; PanicPredictor/1.0)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const shows = parseShows(html);
  if (!shows.length) throw new Error("No shows parsed — page structure may have changed.");

  const runs = groupIntoRuns(shows);
  console.log(`\nParsed ${shows.length} show date(s) → ${runs.length} run(s):\n`);
  runs.forEach(r => {
    const nights = r.dates.length === 1 ? "1 night" : `${r.dates.length} nights`;
    console.log(`  ${r.dates[0]}${r.dates.length > 1 ? ` – ${r.dates[r.dates.length - 1]}` : ""} — ${r.venue}, ${r.city}, ${r.state} (${nights})`);
  });

  if (dryRun) {
    console.log("\nDry run — no changes written.");
    return;
  }

  const existing = JSON.parse(fs.readFileSync(TOUR_DATES_PATH, "utf8"));
  const changed = JSON.stringify(runs) !== JSON.stringify(existing);

  if (!changed) {
    console.log("\n✓ tourDates.json is already up to date.");
  } else {
    fs.writeFileSync(TOUR_DATES_PATH, JSON.stringify(runs, null, 2));
    console.log("\n✓ tourDates.json updated.");
  }

  // Regenerate ICS
  console.log("Regenerating calendars/widespread-panic.ics...");
  execSync("node build-cal.js", { cwd: __dirname, stdio: "inherit" });
}

main().catch(err => { console.error(err.message); process.exit(1); });
