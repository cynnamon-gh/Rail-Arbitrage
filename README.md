# NEC Fare Finder

A Claude Code skill that finds the cheapest way to travel between NE Corridor cities by combining Amtrak fares with commuter rail alternatives (MARC, SEPTA, NJ Transit, Metro-North, Shore Line East).

## What it does

When you ask Claude something like "cheapest way from Philly to Boston next Tuesday", it:

1. Looks up commuter rail schedules and fares from pre-built data
2. Scrapes Amtrak's website for current fares (direct + split-ticket combos)
3. Finds cross-operator connections (e.g., SEPTA to NJ Transit to Amtrak)
4. Presents a unified results table sorted by price

Typical savings: 30-60% vs direct Amtrak tickets.

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

The build script downloads public GTFS feeds from MARC, SEPTA, NJ Transit, and Metro-North, parses them, and outputs `commuter-data.json` (~475 KB, 955 trips across 5 agencies).

## Usage

Just talk to Claude about train travel on the NE Corridor:

- "Cheapest way from DC to NYC next Friday?"
- "Compare Amtrak vs commuter rail from Philly to Trenton"
- "I need to get from Baltimore to Boston on March 5th"

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
| MARC Penn Line | WAS ↔ BAL | $5-12 |
| SEPTA Regional Rail | PHL ↔ WIL, PHL ↔ TRE | $8-11 |
| NJ Transit NEC | TRE ↔ NYP | $5.50-21 |
| Metro-North New Haven | GCT ↔ NHV | $12.75-24.75 |
| Shore Line East | NHV ↔ NLC | $7.75 |

Note: Metro-North goes to Grand Central, not Penn Station. The skill accounts for the ~15 min transfer.

## Files

| File | Purpose |
|------|---------|
| `SKILL.md` | Skill definition — tells Claude how to use everything |
| `commuter-data.json` | Generated schedules + fares (don't edit, regenerate instead) |
| `build-commuter-data.js` | GTFS download/parse pipeline |
| `station-map.js` | Amtrak station codes ↔ GTFS stop IDs |
| `package.json` | Build dependencies (csv-parse, adm-zip) |
