---
name: amtrak-arbitrage
description: Use when checking Amtrak fares, comparing train options, or planning travel on the NE Corridor. Triggers on mentions of Amtrak prices, ticket splitting, fare comparison, or travel between NE Corridor cities (Washington DC to Boston).
---

# NEC Fare Finder

Shows all the ways to travel between NE Corridor cities (DC to Boston) — direct Amtrak, split tickets, commuter rail, and mixed itineraries — so the user can pick the best combination of price, time, and convenience. The goal isn't necessarily the cheapest option; it's making sure the user sees what's available and doesn't overpay for the same thing.

**Scope:** Any Amtrak service on the NEC (Northeast Regional, Acela, Keystone, etc.) plus commuter rail. DC to Boston corridor. All train types welcome — they all share the same stations.

## Key Constraints

- **Same-station transfers only.** Never suggest options that require walking, subway, or bus between different stations. If two services don't share a station, they can't connect. This means **no Metro-North** — MNR goes to Grand Central Terminal, not Penn Station, so it can't connect with Amtrak without leaving the station.
- **Multiple split points.** Always search several intermediate stations, not just one. Amtrak pricing is unpredictable and the cheapest split could be anywhere.

## When to Use

- User wants to travel between any two NEC cities and wants to see their options
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

**Looking up commuter trip times (important for layover matching):**

Each trip in `commuter-data.json` has a `stops` array with arrival (`a`) and departure (`d`) times at each station, in order. To find commuter trains for a segment:

1. Filter trips by agency and day of week
2. Check **stop order** to determine direction — the origin station must appear BEFORE the destination in the `stops` array
3. Read the departure time at origin (`stops[originIdx].d`) and arrival time at destination (`stops[destIdx].a`)

```javascript
// Example: find SEPTA PHL→TRE trips on a Wednesday
const septaTrips = relevantTrips.filter(t => {
  if (t.agency !== 'septa') return false;
  const phlIdx = t.stops.findIndex(s => s.s === 'PHL');
  const treIdx = t.stops.findIndex(s => s.s === 'TRE');
  return phlIdx >= 0 && treIdx >= 0 && phlIdx < treIdx; // direction check!
});
// Each matching trip gives you: depart PHL at stops[phlIdx].d, arrive TRE at stops[treIdx].a
```

**These times are what you use for layover calculations in mixed itineraries.** For example, if SEPTA arrives TRE at 06:20 and an Amtrak departs TRE at 06:45, that's a 25-minute layover.

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

You now have two datasets:
- **Amtrak results**: from Step 5, keyed by route (e.g. `PHL→BBY`, `PHL→NYP`, `NYP→BBY`). Each result has `{train, depart, arrive, coach, business, soldOut}`.
- **Commuter trips**: from Steps 2/4, filtered by day + direction. Each trip has stop-by-stop times.

Combine them into concrete itineraries. **Every itinerary must have specific train numbers, exact departure/arrival times for every leg, and a price per leg.** No tildes, no approximations.

**Layover rules:** Default 10-60 minutes between legs at the same station, but respect the user's transfer tolerance from Step 1. If they're ok waiting longer for savings, include those (flag the wait time). Max 3 segments.

**Also check `validFrom`/`validUntil` on commuter trips** — skip trips whose validity range doesn't cover the travel date.

#### 6a. Direct Amtrak

Take each non-sold-out result from the origin→destination search. These are your baseline options.

#### 6b. Same-train splits

For each intermediate station you searched (e.g. NYP):
- Look at the Amtrak results for origin→intermediate and intermediate→destination
- **Match by train number.** If train 150 appears in both PHL→NYP results and NYP→BBY results, that's the same physical train — you just buy two tickets
- Total price = leg1 coach + leg2 coach
- Depart = leg1 depart, Arrive = leg2 arrive (same as direct, since it's the same train)
- Compare split total vs direct price for that same train number
- **Keep only the cheaper option.** The split and direct are the same physical ride — same train, same seats, same times. Only the ticketing differs. For each train number, show ONE row: whichever is cheapest (split or direct). Never show both.

#### 6c. Different-train Amtrak transfers

For each intermediate station:
- For each leg1 result (origin→intermediate), look at all leg2 results (intermediate→destination)
- A valid connection exists when: `leg2.depart >= leg1.arrive + min_layover` AND `leg2.depart <= leg1.arrive + max_layover`
- Parse the datetime strings to compare (format is `2026-02-25T06:40`)
- Total price = leg1 coach + leg2 coach
- Record the layover duration

#### 6d. Mixed: Commuter → Amtrak

For each commuter segment that starts at/near the origin (e.g. SEPTA PHL→TRE):
- For each commuter trip in the right direction, get the arrival time at the transfer station
- Find Amtrak trains departing that station where: `amtrak.depart >= commuter_arrival + min_layover`
- Total price = commuter fare + Amtrak coach price
- Depart = commuter departure time, Arrive = Amtrak arrival time
- Record layover duration at the transfer station

Example: SEPTA train departs PHL 05:25, arrives TRE 06:20. Amtrak 150 departs TRE 05:45 — too early, skip. Amtrak 82 departs TRE 12:58 — 6h38m layover, probably too long unless user said they're ok with it.

#### 6e. Mixed: Amtrak → Commuter

Same logic reversed:
- For each Amtrak train arriving at a station served by commuter rail
- Find commuter trips departing after arrival + min_layover
- Total = Amtrak fare + commuter fare

#### 6f. Commuter chains + Amtrak

For multi-commuter connections (e.g. SEPTA PHL→TRE + NJT TRE→NYP + Amtrak NYP→BBY):
- Start with SEPTA trips PHL→TRE, get arrival time at TRE
- Find NJT trips TRE→NYP departing after SEPTA arrival + min_layover, get arrival time at NYP
- Find Amtrak trains departing NYP after NJT arrival + min_layover
- Total = SEPTA fare + NJT fare + Amtrak fare
- Depart = SEPTA departure, Arrive = Amtrak arrival
- Record both layover durations

#### 6g. Commuter-only (for short segments)

If the origin and destination are both served by commuter rail (e.g. PHL→TRE, TRE→NYP, WAS→BAL), list the commuter-only options with specific trip times and fares. These may be the cheapest option for short hops.

### Step 7: Present Results

Sort all options by total price ascending. Present as a markdown table. **Every row must have exact times and specific train identifiers — no approximations.**

```
## PHL → BBY — Wednesday Feb 25, 2026

| Depart | Arrive | Type     | Route                                              | Layover    | Price              |
|--------|--------|----------|----------------------------------------------------|-----------|--------------------|
| 05:25  | 14:08  | Mixed    | SEPTA 1705 PHL→TRE (arr 06:20) + Amtrak 162 TRE 08:49→BBY | 2h29m TRE | $48.75 ($10.75+$38)|
| 05:15  | 11:02  | Split    | Amtrak 150 PHL→NYP + NYP→BBY (same train)         | —         | $60 ($15+$45)      |
| 12:06  | 18:40  | Transfer | Amtrak 118 PHL→NYP (arr 13:35) + Amtrak 82 NYP→BBY (dep 14:12) | 37m NYP  | $86 ($48+$38)     |
| 12:28  | 18:40  | Split    | Amtrak 82 PHL→NYP + NYP→BBY (same train)          | —         | $106 ($68+$38)     |
```

Note: Amtrak 150 direct was $70 but the split is $60 for the same train — only the split is shown. Amtrak 82 direct was $144 but the split is $106 — only the split is shown.

**Requirements for the table:**
- Depart and Arrive are the trip's true start and end times (first leg depart, last leg arrive)
- Route column includes specific train numbers for EVERY leg (Amtrak train numbers, commuter train IDs)
- For multi-leg trips, show arrival and departure times at transfer stations so the user can see the layover
- Layover column shows wait time and station (e.g. "37m NYP", "2h29m TRE")
- Price column shows total and breakdown per leg

### Step 8: Summarize

Help the user understand what they're looking at. The goal is informed choice, not pushing the cheapest option. Highlight:

- **Where splits saved money on the same train** — flag these clearly since it's the same ride for less. The user should know when a split exists so they don't accidentally overpay.
- **Tradeoffs worth noting** — a $26 option with a 25-minute transfer vs a $48 direct is a real choice. Present both sides: "saves $22 but adds a transfer at Trenton."
- **Time clusters** — if several options leave around the same time at different prices, group that observation so the user can compare.

Don't declare a "best deal" or tell the user what to pick. Let the table speak for itself.

## Quick Reference: Commuter Fare Pairs

All fares from `commuter-data.json`. Reverse direction same price.

**MARC (flat):** WAS↔BAL $9, WAS↔BWI $8, BWI↔BAL $5
**SEPTA (peak/off-peak):** PHL↔WIL $10.75/$8, PHL↔TRE $10.75/$8
**NJT (peak/off-peak):** TRE↔NYP $21/$15.25, NWK↔NYP $7.50/$5.50
**SLE (flat):** NHV↔NLC $7.75
