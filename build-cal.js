#!/usr/bin/env node
// Generates tour.ics from tourDates.json for calendar subscription.
// Hosted at neilgolson.com/tour.ics — subscribe via webcal://neilgolson.com/tour.ics
// Usage: node build-cal.js

const fs = require("fs");
const path = require("path");

const TOUR_DATES_PATH = path.join(__dirname, "tourDates.json");
const OUTPUT_PATH = path.join(__dirname, "calendars", "widespread-panic.ics");
const SITE_URL = "https://neilgolson.com";

function toIcsDate(yyyy_mm_dd) {
  return yyyy_mm_dd.replace(/-/g, "");
}

function nextDay(yyyy_mm_dd) {
  const d = new Date(yyyy_mm_dd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split("T")[0].replace(/-/g, "");
}

function escapeIcs(str) {
  return str.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function buildEvent(run, date) {
  const isMultiNight = run.dates.length > 1;
  const nightNum = run.dates.indexOf(date) + 1;
  const nightLabel = isMultiNight ? ` (Night ${nightNum} of ${run.dates.length})` : "";
  const summary = `Widespread Panic – ${run.venue}${nightLabel}`;
  const location = `${run.venue}, ${run.city}, ${run.state}`;
  const uid = `${date}-${run.city.toLowerCase().replace(/\s+/g, "-")}@panicpredictor`;

  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTART;VALUE=DATE:${toIcsDate(date)}`,
    `DTEND;VALUE=DATE:${nextDay(date)}`,
    `SUMMARY:${escapeIcs(summary)}`,
    `LOCATION:${escapeIcs(location)}`,
    `URL:${SITE_URL}`,
    `DESCRIPTION:Panic Predictor: ${SITE_URL}`,
    "END:VEVENT",
  ].join("\r\n");
}

function main() {
  const runs = JSON.parse(fs.readFileSync(TOUR_DATES_PATH, "utf8"));
  const today = new Date().toISOString().split("T")[0];

  // Only include upcoming dates
  const events = [];
  for (const run of runs) {
    for (const date of run.dates) {
      if (date >= today) events.push(buildEvent(run, date));
    }
  }

  const cal = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Panic Predictor//Widespread Panic Tour//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Widespread Panic Tour",
    "X-WR-CALDESC:Upcoming Widespread Panic tour dates",
    "X-PUBLISHED-TTL:PT12H",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");

  fs.writeFileSync(OUTPUT_PATH, cal);
  console.log(`✓ tour.ics written — ${events.length} upcoming date(s).`);
}

main();
