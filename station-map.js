// Maps Amtrak NEC station codes to GTFS stop IDs for each commuter rail agency.
// MARC has separate stop IDs for southbound (sb) and northbound (nb) platforms.
// MNR goes to Grand Central (GCT), not Penn Station — transfer required.

module.exports = {
  WAS: {
    marc: { sb: '11958', nb: '11958' }, // Union Station (same both directions)
  },
  NCR: {
    marc: { sb: '11988', nb: '11989' }, // New Carrollton
  },
  BWI: {
    marc: { sb: '11984', nb: '11993' }, // BWI Rail Station
  },
  BAL: {
    marc: { sb: '11980', nb: '12002' }, // Penn Station Baltimore
  },
  ABE: {
    marc: { sb: '11977', nb: '12005' }, // Aberdeen
  },
  PVL: {
    marc: { sb: '11976', nb: '11976' }, // Perryville (terminal)
  },
  WIL: {
    septa: '90203', // Wilmington
  },
  PHL: {
    septa: '90004', // Gray 30th Street Station
  },
  TRE: {
    septa: '90701', // Trenton (SEPTA)
    njt: '148',     // Trenton Transit Center (NJT)
  },
  NWK: {
    njt: '107', // Newark Penn Station
  },
  EWR: {
    njt: '37953', // Newark Airport Railroad Station
  },
  NYP: {
    njt: '105', // New York Penn Station
  },
  GCT: {
    mnr: '1', // Grand Central Terminal (not an Amtrak station, but MNR hub)
  },
  STM: {
    mnr: '124', // Stamford
  },
  NHV: {
    mnr: '149', // New Haven Union Station
  },

  // Route IDs for filtering trips to NEC-relevant lines
  routes: {
    marc: ['11705'],           // Penn Line (PENN - WASHINGTON)
    septa: ['WIL', 'TRE'],    // Wilmington/Newark Line + Trenton Line
    njt: ['9'],                // Northeast Corridor
    mnr: ['3'],                // New Haven Line
  },

  // Feed download URLs
  feeds: {
    marc: 'https://feeds.mta.maryland.gov/gtfs/marc',
    septa: 'https://github.com/septadev/GTFS/releases/latest/download/gtfs_public.zip',
    njt: 'https://www.njtransit.com/rail_data.zip',
    mnr: 'https://rrgtfsfeeds.s3.amazonaws.com/gtfsmnr.zip',
  },

  // Agencies that don't have downloadable GTFS feeds (hardcoded in build script)
  hardcoded: ['sle'],
};
