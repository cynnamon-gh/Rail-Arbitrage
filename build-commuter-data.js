#!/usr/bin/env node
// Downloads GTFS feeds for NEC commuter rail agencies, parses them,
// and outputs commuter-data.json with NEC-relevant trips and fares.

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { parse } = require('csv-parse/sync');

const stationMap = require('./station-map');

const CACHE_DIR = path.join(__dirname, 'gtfs-cache');
const OUTPUT_FILE = path.join(__dirname, 'commuter-data.json');
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Build reverse lookup: GTFS stop_id -> NEC station code, per agency
function buildStopLookup() {
  const lookup = {}; // { agency: { gtfsStopId: necCode } }
  for (const [necCode, agencies] of Object.entries(stationMap)) {
    if (typeof agencies !== 'object' || necCode === 'routes' || necCode === 'feeds' || necCode === 'hardcoded') continue;
    for (const [agency, stopIds] of Object.entries(agencies)) {
      if (!lookup[agency]) lookup[agency] = {};
      if (typeof stopIds === 'object' && stopIds.sb) {
        // MARC-style directional stops
        lookup[agency][stopIds.sb] = necCode;
        lookup[agency][stopIds.nb] = necCode;
      } else {
        lookup[agency][stopIds] = necCode;
      }
    }
  }
  return lookup;
}

async function downloadFeed(agency, url) {
  const dest = path.join(CACHE_DIR, `${agency}.zip`);
  if (fs.existsSync(dest)) {
    const stat = fs.statSync(dest);
    if (Date.now() - stat.mtimeMs < CACHE_MAX_AGE_MS) {
      console.log(`  ${agency}: using cached feed`);
      return dest;
    }
  }
  console.log(`  ${agency}: downloading from ${url}...`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to download ${agency}: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`  ${agency}: saved (${(buf.length / 1024).toFixed(0)} KB)`);
  return dest;
}

function parseCsv(text) {
  // Handle BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  return parse(text, { columns: true, skip_empty_lines: true, relax_column_count: true });
}

function readGtfsFile(zip, filename) {
  const entry = zip.getEntry(filename);
  if (!entry) return [];
  return parseCsv(zip.readAsText(entry));
}

function extractZipEntries(zipPath, agency) {
  if (agency === 'septa') {
    // SEPTA has nested zip: gtfs_public.zip -> google_rail.zip
    const outer = new AdmZip(zipPath);
    const railEntry = outer.getEntry('google_rail.zip');
    if (!railEntry) throw new Error('SEPTA: google_rail.zip not found inside gtfs_public.zip');
    return new AdmZip(railEntry.getData());
  }
  return new AdmZip(zipPath);
}

function processAgency(zipPath, agency, stopLookup) {
  console.log(`  Processing ${agency}...`);
  const zip = extractZipEntries(zipPath, agency);

  const routeIds = new Set(stationMap.routes[agency] || []);
  const agencyStops = stopLookup[agency] || {};

  // Parse GTFS files
  const trips = readGtfsFile(zip, 'trips.txt');
  const stopTimes = readGtfsFile(zip, 'stop_times.txt');
  const calendarRaw = readGtfsFile(zip, 'calendar.txt');
  const calendarDates = readGtfsFile(zip, 'calendar_dates.txt');

  // Filter trips to NEC routes
  const necTripIds = new Set();
  const tripMeta = {}; // trip_id -> { serviceId, headsign, shortName }
  for (const t of trips) {
    if (routeIds.has(t.route_id)) {
      necTripIds.add(t.trip_id);
      tripMeta[t.trip_id] = {
        serviceId: t.service_id,
        headsign: t.trip_headsign || '',
        shortName: t.trip_short_name || '',
      };
    }
  }
  console.log(`    ${necTripIds.size} NEC trips found`);

  // Build calendar: service_id -> { days: [1-7], except: [], also: [] }
  const calendar = {};
  const dayFields = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  for (const c of calendarRaw) {
    const days = [];
    dayFields.forEach((d, i) => { if (c[d] === '1') days.push(i + 1); });
    calendar[c.service_id] = { days, startDate: c.start_date, endDate: c.end_date, except: [], also: [] };
  }
  // If no calendar.txt (NJT/MNR use calendar_dates only), build from calendar_dates
  for (const cd of calendarDates) {
    if (!calendar[cd.service_id]) {
      calendar[cd.service_id] = { days: [], except: [], also: [] };
    }
    if (cd.exception_type === '2') {
      calendar[cd.service_id].except.push(cd.date);
    } else if (cd.exception_type === '1') {
      calendar[cd.service_id].also.push(cd.date);
    }
  }

  // Group stop_times by trip, keeping only NEC stops
  const tripStops = {}; // trip_id -> [ { s, a, d, seq } ]
  for (const st of stopTimes) {
    if (!necTripIds.has(st.trip_id)) continue;
    const necCode = agencyStops[st.stop_id];
    if (!necCode) continue;
    if (!tripStops[st.trip_id]) tripStops[st.trip_id] = [];
    tripStops[st.trip_id].push({
      s: necCode,
      a: st.arrival_time ? st.arrival_time.trim() : undefined,
      d: st.departure_time ? st.departure_time.trim() : undefined,
      seq: parseInt(st.stop_sequence, 10),
    });
  }

  // Build output trips
  const result = [];
  for (const [tripId, stops] of Object.entries(tripStops)) {
    if (stops.length < 2) continue; // Need at least 2 NEC stops
    stops.sort((a, b) => a.seq - b.seq);

    const meta = tripMeta[tripId];
    const cal = calendar[meta.serviceId];

    // Format times to HH:MM (strip seconds)
    const fmtStops = stops.map(s => {
      const entry = { s: s.s };
      if (s.a) entry.a = s.a.slice(0, 5);
      if (s.d) entry.d = s.d.slice(0, 5);
      return entry;
    });
    // First stop: remove arrival. Last stop: remove departure.
    delete fmtStops[0].a;
    delete fmtStops[fmtStops.length - 1].d;

    const trip = {
      id: `${agency}_${tripId}`,
      agency,
      route: getRouteName(agency),
      trainNum: meta.shortName || undefined,
      stops: fmtStops,
    };

    if (cal) {
      if (cal.days.length > 0) trip.days = cal.days;
      if (cal.except.length > 0) trip.except = cal.except;
      if (cal.also.length > 0) trip.also = cal.also;
    }

    result.push(trip);
  }

  console.log(`    ${result.length} trips with 2+ NEC stops`);
  return result;
}

function getRouteName(agency) {
  const names = {
    marc: 'Penn Line',
    septa_WIL: 'Wilmington/Newark Line',
    septa_TRE: 'Trenton Line',
    septa: 'Regional Rail',
    njt: 'Northeast Corridor',
    mnr: 'New Haven Line',
    sle: 'Shore Line East',
  };
  return names[agency] || agency;
}

// Derive service days for agencies that only have calendar_dates (no calendar.txt)
// by analyzing which dates trips run on
function inferDaysFromCalendarDates(trips) {
  for (const trip of trips) {
    if (trip.days && trip.days.length > 0) continue;
    if (!trip.also || trip.also.length === 0) continue;
    // Infer days of week from the "also" dates
    const dayCounts = [0, 0, 0, 0, 0, 0, 0]; // Mon-Sun
    for (const dateStr of trip.also) {
      const y = parseInt(dateStr.slice(0, 4));
      const m = parseInt(dateStr.slice(4, 6)) - 1;
      const d = parseInt(dateStr.slice(6, 8));
      const dow = new Date(y, m, d).getDay(); // 0=Sun
      const isoDay = dow === 0 ? 7 : dow; // 1=Mon...7=Sun
      dayCounts[isoDay - 1]++;
    }
    // If a day appears in >30% of weeks, consider it a regular day
    const totalWeeks = Math.max(1, trip.also.length / 5);
    const days = [];
    dayCounts.forEach((count, i) => {
      if (count >= totalWeeks * 0.3) days.push(i + 1);
    });
    if (days.length > 0) trip.days = days;
  }
}

function buildFares() {
  // Hardcoded from published fare schedules (change ~1x/year).
  // Where agencies have peak/off-peak, both are listed.
  return {
    // MARC Penn Line — flat fares, no peak/off-peak
    'WAS->NCR': { fare: 6, agency: 'marc' },
    'WAS->BWI': { fare: 8, agency: 'marc' },
    'WAS->BAL': { fare: 9, agency: 'marc' },
    'WAS->ABE': { fare: 11, agency: 'marc' },
    'WAS->PVL': { fare: 12, agency: 'marc' },
    'NCR->BWI': { fare: 6, agency: 'marc' },
    'NCR->BAL': { fare: 8, agency: 'marc' },
    'NCR->ABE': { fare: 10, agency: 'marc' },
    'NCR->PVL': { fare: 11, agency: 'marc' },
    'BWI->BAL': { fare: 5, agency: 'marc' },
    'BWI->ABE': { fare: 8, agency: 'marc' },
    'BWI->PVL': { fare: 10, agency: 'marc' },
    'BAL->ABE': { fare: 6, agency: 'marc' },
    'BAL->PVL': { fare: 8, agency: 'marc' },
    'ABE->PVL': { fare: 5, agency: 'marc' },

    // SEPTA — peak/off-peak by zone
    'PHL->WIL': { peak: 10.75, offPeak: 8.00, agency: 'septa' },
    'PHL->TRE': { peak: 10.75, offPeak: 8.00, agency: 'septa' },
    'WIL->PHL': { peak: 10.75, offPeak: 8.00, agency: 'septa' },
    'TRE->PHL': { peak: 10.75, offPeak: 8.00, agency: 'septa' },

    // NJ Transit NEC — peak/off-peak
    'TRE->NWK': { peak: 15.75, offPeak: 11.50, agency: 'njt' },
    'TRE->NYP': { peak: 21.00, offPeak: 15.25, agency: 'njt' },
    'NWK->NYP': { peak: 7.50, offPeak: 5.50, agency: 'njt' },
    'NYP->NWK': { peak: 7.50, offPeak: 5.50, agency: 'njt' },
    'NYP->TRE': { peak: 21.00, offPeak: 15.25, agency: 'njt' },
    'NWK->TRE': { peak: 15.75, offPeak: 11.50, agency: 'njt' },

    // Metro-North New Haven Line — peak/off-peak (from GCT, not NYP)
    'GCT->STM': { peak: 16.75, offPeak: 12.75, agency: 'mnr' },
    'GCT->NHV': { peak: 24.75, offPeak: 18.75, agency: 'mnr' },
    'STM->GCT': { peak: 16.75, offPeak: 12.75, agency: 'mnr' },
    'NHV->GCT': { peak: 24.75, offPeak: 18.75, agency: 'mnr' },
    'STM->NHV': { peak: 16.75, offPeak: 12.75, agency: 'mnr' },
    'NHV->STM': { peak: 16.75, offPeak: 12.75, agency: 'mnr' },

    // Shore Line East — flat fares
    'NHV->NLC': { fare: 7.75, agency: 'sle' },
    'NLC->NHV': { fare: 7.75, agency: 'sle' },

    lastUpdated: '2026-02',
  };
}

function buildSleTrips() {
  // Shore Line East: hardcoded since GTFS feed not publicly downloadable.
  // ~12 trains/day each direction, NHV <-> NLC, weekdays only.
  // Representative schedule (actual times from published timetable).
  const wbTrips = [ // Westbound: NLC -> NHV
    { dep: '05:26', arr: '06:16' },
    { dep: '06:05', arr: '06:55' },
    { dep: '06:55', arr: '07:45' },
    { dep: '07:40', arr: '08:30' },
    { dep: '08:30', arr: '09:15' },
    { dep: '12:15', arr: '13:05' },
    { dep: '15:15', arr: '16:05' },
    { dep: '17:00', arr: '17:50' },
    { dep: '18:05', arr: '18:55' },
    { dep: '19:15', arr: '20:05' },
    { dep: '20:55', arr: '21:40' },
  ];
  const ebTrips = [ // Eastbound: NHV -> NLC
    { dep: '06:20', arr: '07:10' },
    { dep: '07:35', arr: '08:25' },
    { dep: '08:45', arr: '09:35' },
    { dep: '09:40', arr: '10:30' },
    { dep: '13:25', arr: '14:15' },
    { dep: '15:50', arr: '16:40' },
    { dep: '16:55', arr: '17:45' },
    { dep: '17:55', arr: '18:45' },
    { dep: '18:55', arr: '19:45' },
    { dep: '20:10', arr: '21:00' },
    { dep: '22:10', arr: '22:55' },
  ];

  const result = [];
  wbTrips.forEach((t, i) => {
    result.push({
      id: `sle_wb_${i + 1}`,
      agency: 'sle',
      route: 'Shore Line East',
      stops: [
        { s: 'NLC', d: t.dep },
        { s: 'NHV', a: t.arr },
      ],
      days: [1, 2, 3, 4, 5], // weekdays only
    });
  });
  ebTrips.forEach((t, i) => {
    result.push({
      id: `sle_eb_${i + 1}`,
      agency: 'sle',
      route: 'Shore Line East',
      stops: [
        { s: 'NHV', d: t.dep },
        { s: 'NLC', a: t.arr },
      ],
      days: [1, 2, 3, 4, 5],
    });
  });
  return result;
}

async function main() {
  console.log('NEC Commuter Rail Data Builder\n');

  // Ensure cache directory
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  // Download feeds
  console.log('Downloading GTFS feeds...');
  const zipPaths = {};
  for (const [agency, url] of Object.entries(stationMap.feeds)) {
    zipPaths[agency] = await downloadFeed(agency, url);
  }

  // Build stop lookup
  const stopLookup = buildStopLookup();

  // Process each agency
  console.log('\nParsing GTFS data...');
  let allTrips = [];
  for (const agency of Object.keys(stationMap.feeds)) {
    const trips = processAgency(zipPaths[agency], agency, stopLookup);
    inferDaysFromCalendarDates(trips);
    allTrips = allTrips.concat(trips);
  }

  // Deduplicate: merge trips with identical stops+times (same train, different service dates)
  const tripKey = t => t.agency + '|' + t.stops.map(s => `${s.s}:${s.a||''}:${s.d||''}`).join(',');
  const merged = new Map();
  for (const trip of allTrips) {
    const key = tripKey(trip);
    if (merged.has(key)) {
      const existing = merged.get(key);
      // Merge days
      if (trip.days) {
        if (!existing.days) existing.days = [];
        for (const d of trip.days) {
          if (!existing.days.includes(d)) existing.days.push(d);
        }
        existing.days.sort();
      }
      // Merge also dates
      if (trip.also) {
        if (!existing.also) existing.also = [];
        for (const d of trip.also) {
          if (!existing.also.includes(d)) existing.also.push(d);
        }
      }
      // Merge except dates (intersection — only exclude if excluded in ALL variants)
      if (trip.except && existing.except) {
        existing.except = existing.except.filter(d => trip.except.includes(d));
      } else {
        delete existing.except;
      }
    } else {
      merged.set(key, { ...trip });
    }
  }
  allTrips = [...merged.values()];
  console.log(`  Deduplicated to ${allTrips.length} unique trips`);

  // Optimize: drop "also" arrays when days have been inferred
  let trimmed = 0;
  for (const trip of allTrips) {
    if (trip.days && trip.days.length > 0 && trip.also && trip.also.length > 0) {
      const sorted = trip.also.sort();
      trip.validFrom = sorted[0];
      trip.validUntil = sorted[sorted.length - 1];
      delete trip.also;
      trimmed++;
    }
  }
  if (trimmed > 0) console.log(`  Optimized ${trimmed} trips (replaced date arrays with ranges)`);

  // Add SLE hardcoded trips
  console.log('  Adding Shore Line East (hardcoded)...');
  const sleTrips = buildSleTrips();
  allTrips = allTrips.concat(sleTrips);
  console.log(`    ${sleTrips.length} SLE trips added`);

  // Build fares
  const fares = buildFares();

  // Build output
  const output = {
    generatedAt: new Date().toISOString(),
    trips: allTrips,
    fares,
    agencies: {
      marc: 'MARC Penn Line',
      septa: 'SEPTA Regional Rail',
      njt: 'NJ Transit NEC',
      mnr: 'Metro-North New Haven Line',
      sle: 'Shore Line East',
    },
    notes: {
      mnr: 'Metro-North goes to Grand Central Terminal (GCT), not Penn Station. Transfer required (~15 min subway/walk).',
      sle: 'Shore Line East schedules are hardcoded approximations. Run build script to refresh GTFS agencies.',
      times: 'Times past 24:00 (e.g., 25:30) mean next calendar day (1:30 AM). Keep raw for computation.',
      fares: `Fares last verified ${fares.lastUpdated}. Check agency websites for current prices.`,
    },
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\nDone! Wrote ${OUTPUT_FILE}`);
  console.log(`  ${allTrips.length} total trips across ${Object.keys(output.agencies).length} agencies`);
  console.log(`  ${Object.keys(fares).filter(k => k !== 'lastUpdated').length} fare pairs`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
