#!/usr/bin/env node
// Scrapes upcoming Widespread Panic shows from widespreadpanic.com/shows/
// and updates tourDates.json, then regenerates tour.ics.
// Usage: node sync-tour-dates.js [--dry-run]

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const SHOWS_URL = "https://widespreadpanic.com/shows/";
const TOUR_DATES_PATH = path.join(__dirname, "tourDates.json");

function parseShows(html) {
  const shows = [];

  // widespreadpanic.com/shows/ is a WordPress site using the AudioTheme
  // events plugin. Each show is a "gig-summary" block with an hCalendar
  // microformat: an ISO datetime attribute plus venue-name/locality/region
  // spans. Split on the block boundary and pull fields out of each chunk.
  const blocks = html.split(/(?=<div id="post-\d+" class="gig-summary)/).slice(1);

  for (const block of blocks) {
    const dateMatch = block.match(/datetime="(\d{4}-\d{2}-\d{2})T/);
    const venueMatch = block.match(/class="venue-name fn org">([^<]+)</);
    const cityMatch = block.match(/class="locality">([^<]+)</);
    const stateMatch = block.match(/class="region">([^<]+)</);

    if (dateMatch && venueMatch) {
      shows.push({
        date: dateMatch[1],
        venue: venueMatch[1].trim(),
        city: cityMatch ? cityMatch[1].trim() : "Unknown City",
        state: stateMatch ? stateMatch[1].trim() : "",
      });
    }
  }

  return shows;
}

function groupIntoRuns(shows) {
  // Group consecutive shows at the same venue into runs
  const runs = [];
  let current = null;

  for (const show of shows) {
    const key = `${show.venue}|||${show.city}`;

    if (current && current.key === key) {
      current.dates.push(show.date);
    } else {
      if (current) runs.push(current);
      current = {
        key,
        dates: [show.date],
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

  // The shows page only lists upcoming dates, so merge rather than
  // overwrite: keep existing runs that are entirely in the past, and let
  // the fresh scrape (authoritative for today forward) replace the rest.
  const existing = JSON.parse(fs.readFileSync(TOUR_DATES_PATH, "utf8"));
  const today = new Date().toISOString().slice(0, 10);
  const pastRuns = existing.filter(r => r.dates[r.dates.length - 1] < today);
  const merged = [...pastRuns, ...runs].sort((a, b) => a.dates[0].localeCompare(b.dates[0]));

  const changed = JSON.stringify(merged) !== JSON.stringify(existing);

  if (!changed) {
    console.log("\n✓ tourDates.json is already up to date.");
  } else {
    fs.writeFileSync(TOUR_DATES_PATH, JSON.stringify(merged, null, 2));
    console.log("\n✓ tourDates.json updated.");
  }

  // Regenerate ICS
  console.log("Regenerating calendars/widespread-panic.ics...");
  execSync("node build-cal.js", { cwd: __dirname, stdio: "inherit" });
}

main().catch(err => { console.error(err.message); process.exit(1); });
