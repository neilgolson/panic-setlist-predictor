#!/usr/bin/env node
// Fetches recent Widespread Panic setlists from setlist.fm and appends new shows to setlists.json
// Usage: SETLISTFM_API_KEY=your_key node sync-setlists.js [--dry-run] [--pages N]
// Requires Node 18+ (built-in fetch)

const fs = require("fs");
const path = require("path");

/* ─── CANONICAL SONG NAMES (mirrored from index.html) ─── */
const ALL_SONGS = ["Chilly Water","Travelin' Light","Space Wrangler","Coconut","Porch Song","Stop-Go","Driving Song","Holden Oversoul","Contentment Blues","Me And The Devil Blues","Heaven","Send Your Mind","Walkin' (For Your Love)","Pigeons","Mercy","Rock","Makes Sense To Me","C. Brown","Love Tractor","Weight Of The World","I'm Not Alone","Barstools And Dreamers","Proving Ground","The Last Straw","Pleas","Hatfield","Wondering","Papa's Home","Diner","Better Off","Pickin' Up The Pieces","Henry Parsons Died","Pilgrims","Postcard","Dream Song","Little Kin","Ain't Life Grand","Airplane","Can't Get High","Heroes","Junior","Blackout Blues","Jack","Fishwater","Radio Child","Aunt Avis","Tall Boy","Gradle","Rebirtha","You Got Yours","Greta","Surprise Valley","Bear's Gone Fishin'","Climb To Safety","Blue Indian","The Waker","Dyin' Man","One Arm Steve","Christmas Katie","All Time Low","Nobody's Loss","Fishing","Tortured Artist","Papa Johnny Road","Sparks Fly","Don't Wanna Lose You","Monstrosity","Travelin' Man","Second Skin","Goodpeople","From The Cradle","Ribs And Whiskey","Crazy","You Should Be Glad","May Your Glass Be Filled","Walk On The Flood","Free Somehow","Flicker","Her Dance Needs No Body","Up All Night","Saint Ex","North","Dirty Side Down","Visiting Day","Shut Up And Drive","Cotton Was King","Cosmic Confidante","Tickle the Truth","Time Zones","Sundown Betty","Elevator To The Moon","Entering A Black Hole Backwards","Last Dance","Quarter Tank Of Gasoline","Puppy Sleeps","When You Coming Home","Jaded Tourist","Hope In A Hopeless World","A of D","Action Man","Arleen","B of D","Big Wooly Mammoth","Blight","Blue Carousel","Bust It Big","Casa Del Grillo","Cease Fire","Conrad","Dark Bar","Degenerate","Disco","Down","Drums","Gimme","Give","Halloween Face","Honky Red","Flat Foot Flewzy","I'm So Glad","Imitation Leather Shoes","Impossible","Jam","Jamais Vu","King Baby","Life As A Tree","Little By Little","Machine","Old Joe","Old Neighborhood","Party At Your Mama's House","Ride Me High","Red Hot Mama","Rumble","Small Town","Sometimes","Stop Breakin' Down Blues","Tackle Box Hero","Tail Dragger","The Take Out","Thin Air (Smells Like Mississippi)","This Part Of Town","Thought Sausage","Tie Your Shoes","Trashy","Vacation","Vampire Blues","We Walk Each Other Home","Worry","Little Lilly","Bowlegged Woman","Protein Drink","Sewing Machine","Sharon","Expiration Day","Walk On"];
const COMMON_COVERS = ["Low Spark Of High Heeled Boys","Let's Get Down To Business","Sleeping Man","Mr. Soul","There Is A Time","Let's Get The Show On The Road","Don't Be Denied","Down in a Hole","Who Do You Belong To?","Sitting In Limbo","I Can See Clearly Now","Paranoid","War Pigs","Smokestack Lightning","Pusherman","For What It's Worth","Good Morning Little Schoolgirl","Chainsaw City","I Walk On Guilded Splinters","And It Stoned Me","Spoonful","Maggot Brain","Jack Straw","1 x 1","A Hard Rain's A-Gonna Fall","Bird On A Wire","Black Hole Sun","Black Sabbath","Breathing Slow","Can't Find My Way Home","City of Dreams","Clair de Lune","Comfortably Numb","Cortez the Killer","Cream Puff War","Dead Flowers","Dear Mr. Fantasy","Dear Prudence","Dirty Business","End Of The Show","Fairies Wear Boots","Fixin' To Die","Four Cornered Room","Genesis","Godzilla","Goin' Out West","Happy","Help Me Somebody","Honey Bee","Iron Man","Jessica","Keep Me in Your Heart","Knocking 'Round The Zoo","Lawyers, Guns, And Money","Life During Wartime","Little Wing","Narrow Mind","No Sugar Tonight/New Mother Nature","None of Us Are Free","One Kind Favor","Piece of My Heart","Play a Train Song","Red Beans","Riders On The Storm","Room at the Top","Sleepy Monkey","Slippin' Into Darkness","Soul Kitchen","Steven's Cat","Stranger in a Strange Land","The Harder They Come","Time Is Free","Waitin' For The Bus","We're All Mad Here","White Rabbit","Who Are You","You Can't Always Get What You Want","You Wreck Me","You're Lost Little Girl","Ace of Spades","Are You Ready For The Country?","Come Together","Crazy Train","Don't Drink The Water","Heart of Gold","I Got The Same Old Blues","I Wanna Be Sedated","I'll Sleep When I'm Dead","Jesus Just Left Chicago","Let It Rock","Machine Gun","Mr. Crowley","My Generation","Nobody's Fault But Mine","Ophelia","Over The Rainbow","Papa Legba","Roadhouse Blues","Rockin' In The Free World","Running Down A Dream","Snowblind","Straight To Hell","The Golden Road (To Unlimited Devotion)","The Wizard","This Friendly World","This Must Be The Place (Naive Melody)","Trouble","Use Me","Wish You Were Here","Just Kissed My Baby","Weak Brain, Narrow Mind"];
const ALL_KNOWN = [...ALL_SONGS, ...COMMON_COVERS];

/* ─── SONG NAME NORMALIZATION ─── */
const norm = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
const normMap = new Map(ALL_KNOWN.map(s => [norm(s), s]));

function findCanonical(name) {
  if (ALL_KNOWN.includes(name)) return { song: name, matched: true };
  const n = norm(name);
  if (normMap.has(n)) return { song: normMap.get(n), matched: true };
  // substring fallback for longer names
  if (n.length >= 5) {
    for (const [k, v] of normMap) {
      if (k.includes(n) || n.includes(k)) return { song: v, matched: true };
    }
  }
  return { song: name, matched: false };
}

/* ─── SETLIST.FM HELPERS (mirrored from heardit/src/lib/setlistfm.ts) ─── */
function parseDate(ddMMyyyy) {
  const [dd, mm, yyyy] = ddMMyyyy.split("-");
  return `${yyyy}-${mm}-${dd}`;
}

function parseSongs(sets) {
  const songs = [];
  for (const set of (sets || [])) {
    if (!set.song) continue;
    for (const song of set.song) {
      if (song.name) songs.push(song.name);
    }
  }
  return songs;
}

async function fetchSetlistFm(path) {
  const apiKey = process.env.SETLISTFM_API_KEY;
  if (!apiKey) throw new Error("SETLISTFM_API_KEY not set");
  const res = await fetch(`https://api.setlist.fm/rest/1.0${path}`, {
    headers: { "x-api-key": apiKey, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`setlist.fm API error: ${res.status} ${await res.text()}`);
  return res.json();
}

/* ─── MAIN ─── */
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const pagesIdx = process.argv.indexOf("--pages");
  const pages = pagesIdx !== -1 ? parseInt(process.argv[pagesIdx + 1], 10) : 1;

  const dataPath = path.join(__dirname, "setlists.json");
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const existingDates = new Set(data.setlists.map(s => s.date));

  const newShows = [];
  const unmatchedByShow = {};

  for (let page = 1; page <= pages; page++) {
    const result = await fetchSetlistFm(
      `/search/setlists?artistName=Widespread+Panic&p=${page}`
    );

    for (const sl of (result.setlist || [])) {
      const date = parseDate(sl.eventDate);
      if (existingDates.has(date)) continue;

      const rawSongs = parseSongs(sl.sets?.set);
      if (!rawSongs.length) {
        console.log(`  ⚠  ${date} — empty setlist on setlist.fm, skipping`);
        continue;
      }

      const songs = [];
      const unmatched = [];
      for (const name of rawSongs) {
        const { song, matched } = findCanonical(name);
        songs.push(song);
        if (!matched) unmatched.push(name);
      }

      const city = sl.venue.city.name;
      const stateCode = sl.venue.city.stateCode || sl.venue.city.state || "";
      const cityStr = stateCode ? `${city}, ${stateCode}` : city;

      const show = {
        id: new Date(date + "T00:00:00").getTime(),
        date,
        city: cityStr,
        venue: sl.venue.name,
        songs,
      };

      newShows.push(show);
      if (unmatched.length) unmatchedByShow[date] = unmatched;
    }
  }

  // Report
  if (newShows.length === 0) {
    console.log("✓ setlists.json is up to date — no new shows found.");
    return;
  }

  console.log(`\nFound ${newShows.length} new show(s):\n`);
  newShows.forEach(s => {
    const flag = unmatchedByShow[s.date] ? " ⚠" : " ✓";
    console.log(`${flag} ${s.date} — ${s.venue}, ${s.city} (${s.songs.length} songs)`);
    if (unmatchedByShow[s.date]) {
      console.log(`   Unmatched songs (kept as-is, review manually):`);
      unmatchedByShow[s.date].forEach(n => console.log(`     - ${n}`));
    }
  });

  if (dryRun) {
    console.log("\nDry run — no changes written.");
    return;
  }

  data.setlists = [...data.setlists, ...newShows]
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  data.totalShows = data.setlists.length;
  data.exportDate = new Date().toISOString();

  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
  console.log(`\n✓ setlists.json updated — ${data.totalShows} total shows.`);

  if (Object.keys(unmatchedByShow).length) {
    console.log("\nReview unmatched song names above and add them to ALL_SONGS/COMMON_COVERS in index.html if needed.");
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
