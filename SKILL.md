---
name: amtrak-arbitrage
description: Use when checking Amtrak fares, finding cheaper split-ticket combinations, or looking for train fare arbitrage on the NE Corridor. Triggers on mentions of Amtrak prices, ticket splitting, fare comparison, or travel between NE Corridor cities (Washington DC to Boston).
---

# NEC Fare Finder

Finds the cheapest way to travel between NE Corridor cities (DC to Boston) by combining Amtrak with commuter rail alternatives (MARC, SEPTA, NJ Transit, Shore Line East). Split-ticket Amtrak, cross-operator transfers, and mixed itineraries can save 30-60% vs direct Amtrak.

**Scope:** Any Amtrak service on the NEC (Northeast Regional, Acela, Keystone, etc.) plus commuter rail. DC to Boston corridor. All train types welcome — they all share the same stations.

## Key Constraints

- **Same-station transfers only.** Never suggest options that require walking, subway, or bus between different stations. If two services don't share a station, they can't connect. This means **no Metro-North** — MNR goes to Grand Central Terminal, not Penn Station, so it can't connect with Amtrak without leaving the station.
- **Multiple split points.** Always search several intermediate stations, not just one. Amtrak pricing is unpredictable and the cheapest split could be anywhere.

## When to Use

- User wants to travel between any two NEC cities and wants the cheapest option
- User asks about Amtrak fare arbitrage or ticket splitting
- User wants to compare Amtrak vs commuter rail for a specific date
- Any mention of train travel between cities from WAS to BOS

## NEC Stations (south to north)

WAS, NCR, BWI, BAL, ABE, WIL, PHL, TRE, NWK, NYP, STM, NHV, NLC, PVD, RTE, BBY, BOS

Additional commuter-only stations: PVL (Perryville, MARC), EWR (Newark Airport, NJT)

## Commuter Rail Coverage

| Agency | Segment | Typical Fare | vs Amtrak |
|--------|---------|-------------|-----------|
| MARC Penn Line | WAS ↔ BAL | $9 | Amtrak $40+ |
| SEPTA | PHL ↔ WIL / PHL ↔ TRE | $8-11 | Amtrak $20-40 |
| NJ Transit NEC | TRE ↔ NYP | $15-21 | Amtrak $40-80 |
| Shore Line East | NHV ↔ NLC | $8 | Amtrak $15-25 |

All of these agencies share stations with Amtrak — no station changes needed.

## Execution

### Step 1: Parse User Request & Gather Preferences

Extract from the user's message: origin, destination, travel date. Then **ask** about any preferences they haven't already mentioned:

- **Preferred departure or arrival time?** (e.g. "need to arrive by 2pm", "leaving after 9am")
- **Max budget?** (e.g. "under $80", or no limit)
- **Transfer tolerance?** (e.g. "direct only", "up to 30 min layover ok", "willing to wait up to 2 hours if it saves money")

These are all optional — if the user doesn't care, search everything and sort by price.

Map city names to codes: "Philly" = PHL, "New York" / "NYC" / "Penn Station" = NYP, "Boston" / "Back Bay" = BBY, "DC" / "Washington" = WAS, "Baltimore" = BAL, "New Haven" = NHV, "Stamford" = STM, "Trenton" = TRE, "Newark" = NWK, "Wilmington" = WIL, "Providence" = PVD, "New London" = NLC.

Determine the day of week (1=Mon...7=Sun) for peak/off-peak fare logic.

Use preferences to filter results in Step 7 (e.g. exclude options outside their time window or over budget, flag long layovers if they set a max).

### Step 2: Load Commuter Rail Data

Read `commuter-data.json` from the skill directory (`~/.claude/skills/amtrak-arbitrage/commuter-data.json`).

Filter trips for the requested day of week:
```javascript
const dayOfWeek = date.getDay() === 0 ? 7 : date.getDay(); // 1-7
const relevantTrips = data.trips.filter(t => t.days && t.days.includes(dayOfWeek));
```

### Step 3: Identify Split Points

Get all NEC stations between origin and destination (inclusive). These are the potential split/transfer points.

Station order: WAS, NCR, BWI, BAL, ABE, PVL, WIL, PHL, TRE, NWK, EWR, NYP, STM, NHV, NLC, PVD, RTE, BBY, BOS

**Which split points to search:** Search ALL major intermediate stations — not just one or two. Amtrak pricing is unpredictable, and the cheapest split can be at any station. For a PHL→BBY trip, search split points at TRE, NYP, and NHV at minimum. For longer trips (e.g. WAS→BOS), search at least BAL, PHL, TRE, NYP, NHV.

### Step 4: Find Commuter Rail Options

For the origin-destination pair and all intermediate stops, find commuter rail trips that cover segments of the journey.

**Direct commuter segments** (single agency, no transfer):
- Check if any agency serves both origin and destination directly
- Example: MARC WAS→BAL, SEPTA PHL→TRE, NJT TRE→NYP

**Adjacent system chains** (2-3 agencies connecting at shared stations):
- SEPTA → NJT at TRE
- (MARC and SEPTA don't connect — there's a gap between PVL and WIL with no commuter rail)

For each commuter segment found, compute the fare:
```javascript
const fareKey = `${origin}->${dest}`;
const fare = data.fares[fareKey];
// Use peak or off-peak based on day/time
const price = fare.peak ? (isPeak ? fare.peak : fare.offPeak) : fare.fare;
```

**Peak/off-peak rules:**
- SEPTA: Peak = weekday, arriving Center City before 10am or departing 4-6:30pm
- NJ Transit: Peak = weekday AM rush (arriving NYP 6-10am) or PM rush (departing NYP 4-7pm)
- MARC, SLE: No peak/off-peak — always flat fare

### Step 5: Scrape Amtrak Fares

Use the MCP Playwright browser to scrape amtrak.com.

**IMPORTANT: The MCP browser is a single shared session.** You cannot use subagents for parallel scraping — there is only one browser. All searches must be done **sequentially** in the main conversation.

**Routes to search:**
1. **Direct**: origin → destination
2. **Split legs**: For each promising intermediate stop, search BOTH legs
   - Example for PHL→BBY: search PHL→NYP, NYP→BBY, PHL→NHV, NHV→BBY, TRE→BBY
   - You already know commuter fares for segments like PHL→TRE, so you only need the Amtrak leg from the split point onward
   - Search ALL reasonable split points. Don't shortcut to just one.

**Amtrak form interaction pattern:**

The form retains values from the previous search. To change stations:

a. Click the **From station button** (shows current station name)
b. A combobox appears — type the new city name
c. Wait for the dropdown to populate with station options
d. Click the correct station option (pick the main NEC station, e.g. "Union Station" for NHV, not "State Street")
e. If the **To** station also needs changing, click the To button and repeat
f. Verify the date is still correct
g. Click **FIND TRAINS** and wait for the results page to load

**Extracting fares from sessionStorage** (run via browser_evaluate after results load):

```javascript
() => {
  const data = JSON.parse(sessionStorage.getItem('searchresults'));
  const options = data.journeySolutionOption.journeyLegs[0].journeyLegOptions;
  return options.map(o => {
    const segs = o.travelLegs || [];
    const accom = o.reservableAccommodations || [];
    const faresByFamily = {};
    accom.forEach(a => {
      const price = parseFloat(a.accommodationFare?.dollarsAmount?.total || '0');
      const family = a.fareFamily;
      if (!faresByFamily[family] || price < faresByFamily[family]) faresByFamily[family] = price;
    });
    return {
      train: segs.map(s => s.travelService?.number || '?').join('+'),
      depart: segs[0]?.origin?.schedule?.departureDateTime?.slice(0, 16) || '',
      arrive: segs[segs.length-1]?.destination?.schedule?.arrivalDateTime?.slice(0, 16) || '',
      coach: faresByFamily['VLU'] || null,
      business: faresByFamily['NA'] || null,
      soldOut: o.isSoldOut || (!faresByFamily['VLU'] && !faresByFamily['FLX'] && !faresByFamily['NA']),
    };
  });
}
```

**Fare families:** VLU = Coach Value, FLX = Coach Flex, NA = Business, FIR = First

**After extracting, navigate back to amtrak.com/home** to set up the next search. The form will retain the previous From/To values — just click and change whichever fields need updating.

**Tips:**
- The MCP browser session persists — no need to open/close between searches
- Amtrak has bot detection that blocks standalone Playwright; MCP browser works
- Some routes/dates may have no results — skip gracefully
- Extract sessionStorage immediately after results load (before navigating away)
- Results may paginate (e.g. "Showing 1-10 of 14") — extract sessionStorage anyway, it contains ALL results regardless of pagination

### Step 6: Build Combined Options

Combine all results into a unified set of travel options:

| Type | What | Example |
|------|------|---------|
| **Direct** | Single Amtrak train (Regional, Acela, etc.) | Amtrak 150 PHL→BBY $70 |
| **Split** | Same train, two tickets | Amtrak 150 PHL→NYP $15 + NYP→BBY $45 = $60 |
| **Transfer** | Two different trains, same station | Amtrak 118→82 via NYP (37min) $86 |
| **Commuter** | Commuter rail only | NJT TRE→NYP $21 |
| **Mixed** | Amtrak + commuter legs | SEPTA PHL→TRE + NJT TRE→NYP + Amtrak NYP→BBY $69.75 |

**Same-train splits are the sweet spot.** The biggest no-brainer savings come from buying two tickets for the same train — same departure, same arrival, same seat, just cheaper. Always check these first.

**Cross-operator connections (same-station only):**
For each intermediate stop, check these patterns:
1. Commuter leg1 + Amtrak leg2 (e.g., SEPTA PHL→TRE + Amtrak TRE→BBY)
2. Amtrak leg1 + Commuter leg2 (e.g., Amtrak WAS→BAL + commuter onward)
3. Commuter chains (e.g., SEPTA PHL→TRE + NJT TRE→NYP + Amtrak NYP→BBY)

**Layover rules:** Default 10-60 minutes between legs at the same station, but respect the user's transfer tolerance preference from Step 1. If they're willing to wait longer for savings, include options with longer layovers (flag the wait time clearly). Support up to 3 segments max.

### Step 7: Present Results

Sort all options by total price ascending. Present as a markdown table:

```
## PHL → BBY — Wednesday Feb 25, 2026

| Depart | Arrive | Type     | Route                                    | Price             |
|--------|--------|----------|------------------------------------------|-------------------|
| 05:15  | 11:02  | Split    | Amtrak 150 via NYP (same train)          | $60 ($15+$45)     |
| 05:15  | 11:02  | Direct   | Amtrak 150                               | $70               |
| ~06:00 | ~14:08 | Mixed    | SEPTA+NJT→NYP, Amtrak 162               | $69.75            |
| 12:06  | 18:40  | Transfer | Amtrak 118→82 via NYP (37min)            | $86 ($48+$38)     |
| 12:28  | 18:40  | Split    | Amtrak 82 via NYP (same train)           | $106 ($68+$38)    |
| 12:28  | 18:40  | Direct   | Amtrak 82                                | $144              |

Best deal: Same-train split on Amtrak 150 — $60 (saves $10 vs $70 direct)

Notes:
- Includes all Amtrak services (Regional, Acela, Keystone). Acela tends to be pricier but sometimes competitive.
- Commuter fares as of Feb 2026. SEPTA/NJT peak pricing applied for weekday.
- All transfers are same-station (no walking between stations).
```

### Step 8: Summarize

Call out the best deal clearly with savings vs the cheapest direct Amtrak option. Note any caveats (transfers, peak pricing, time tradeoffs).

If direct is cheapest, say so — that's useful info too.

For same-train splits, emphasize that it's the exact same ride — just two tickets instead of one.

## Quick Reference: Commuter Fare Pairs

All fares from `commuter-data.json`. Reverse direction same price.

**MARC (flat):** WAS↔BAL $9, WAS↔BWI $8, BWI↔BAL $5
**SEPTA (peak/off-peak):** PHL↔WIL $10.75/$8, PHL↔TRE $10.75/$8
**NJT (peak/off-peak):** TRE↔NYP $21/$15.25, NWK↔NYP $7.50/$5.50
**SLE (flat):** NHV↔NLC $7.75
