# NEC Fare Finder

A Claude Code skill that shows you all the ways to travel between NE Corridor cities — direct Amtrak, split tickets, commuter rail, and mixed itineraries — so you can pick the best combination of price, time, and convenience.

## What it does

When you ask Claude something like "I need to get from Philly to Boston next Tuesday", it:

1. Looks up commuter rail schedules and fares from pre-built data
2. Scrapes Amtrak's website for current fares (direct + split-ticket combos)
3. Finds cross-operator connections (e.g., SEPTA to NJ Transit to Amtrak)
4. Presents a unified results table so you can compare everything side by side

The point isn't to push you toward the cheapest option — it's to make sure you're not overpaying for the same thing. If buying two tickets for the same train is $44 instead of $68, you should know about it.

## Setup

Requires [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and Node.js 18+.

```bash
# Clone into your Claude skills directory
git clone <this-repo> ~/.claude/skills/amtrak-arbitrage
cd ~/.claude/skills/amtrak-arbitrage

# Install build dependencies
npm install

# Download GTFS feeds and build commuter rail data
node build-commuter-data.js
```

The build script downloads public GTFS feeds from MARC, SEPTA, and NJ Transit, parses them, and outputs `commuter-data.json`.

## Usage

Just talk to Claude about train travel on the NE Corridor:

- "What are my options from DC to NYC next Friday?"
- "Compare Amtrak vs commuter rail from Philly to Trenton"
- "I need to get from Baltimore to Boston on March 5th, leaving after 9am"

Claude handles everything — no web app, no copy-pasting.

## Refreshing data

GTFS feeds update periodically. Re-run the build to get fresh schedules:

```bash
# Delete cache to force re-download
rm -rf gtfs-cache/
node build-commuter-data.js
```

Fares are hardcoded in `build-commuter-data.js` since most agencies don't include fares in GTFS. They change ~1x/year — check agency websites if prices seem off.

## Covered agencies

| Agency | Segment | Fare Range |
|--------|---------|-----------|
| MARC Penn Line | WAS ↔ BAL | $5-9 |
| SEPTA Regional Rail | PHL ↔ WIL, PHL ↔ TRE | $8-11 |
| NJ Transit NEC | TRE ↔ NYP | $5.50-21 |
| Shore Line East | NHV ↔ NLC | $7.75 |

All of these share stations with Amtrak — no station changes needed.

## Files

| File | Purpose |
|------|---------|
| `SKILL.md` | Skill definition — tells Claude how to use everything |
| `commuter-data.json` | Generated schedules + fares (don't edit, regenerate instead) |
| `build-commuter-data.js` | GTFS download/parse pipeline |
| `station-map.js` | Amtrak station codes ↔ GTFS stop IDs |
| `package.json` | Build dependencies (csv-parse, adm-zip) |
