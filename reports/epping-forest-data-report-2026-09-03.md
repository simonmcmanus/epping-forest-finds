# Epping Forest Map Data — Weekly Validity Report

**Report date:** Wednesday, 3 September 2026
**Coverage area:** Epping Forest and boundary settlements (Loughton, Chingford, Buckhurst Hill, Chigwell, Theydon Bois, Epping, Woodford Green, Waltham Abbey)
**Status:** Sample report — see *Methodology & limitations* before treating any item below as verified for the dataset.

This is a one-off demonstration run of the weekly check you asked for. It shows the report format and the kind of findings the recurring task will surface. No changes have been made to the map data — this run only reports.

---

## At a glance

| Area checked | Findings this run |
|---|---|
| Shops, cafés, restaurants & pubs | 1 likely closure, 1 likely opening — both need on-the-ground confirmation before editing the dataset |
| Road closures & roadworks | 1 active closure starting 8 September, 1 access-hours change from 15 September |
| Special events in the forest | 1 event this week (6 September), a May–October events brochure in circulation |

The current map dataset (`data/local-landmarks-food.geojson`) carries **683 food & retail points** in scope: 211 restaurants, 158 cafés, 127 convenience stores, 74 pubs, 35 supermarkets, 23 bars, 22 bakeries, 15 butchers, 8 confectioners, 4 greengrocers, 3 delis, and single entries for farm shop, pastry shop and kiosk.

---

## 1. Business directory: shops, cafés, restaurants & pubs

### Likely closure

**Morrisons Café — Loughton (246–250 High Road, IG10 1HW)**
The in-store café at the Loughton Morrisons is listed as closed on Yelp (updated August 2026). The supermarket itself (`way/172447802`) appears to still be trading — this looks like the café concession closing, not the store. The dataset currently has no separate point for this café (it's folded into the supermarket entry), so no edit is needed yet, but worth a phone/visit check before the next refresh in case a standalone café point needs removing elsewhere.
Source: [Morrisons Loughton Cafe — Yelp](https://www.yelp.com/biz/morrisons-loughton-cafe-loughton-4)

### Likely opening

**La Sala — Woodford Green**
Trade press reports a new restaurant, La Sala, opening in Woodford Green. Not yet in `data/local-landmarks-food.geojson`. Exact address wasn't accessible this run (site blocked automated fetch) — needs a manual look-up before adding.
Source: [La Sala Woodford Green opens its doors — The Caterer](https://www.thecaterer.com/news/la-sala-woodford-green-opens-its-doors)

### Nothing else surfaced

General sweeps for Chingford, Buckhurst Hill, Chigwell and Theydon Bois returned no specific closure/opening stories this week — only directory listings and older (2023) news. That's expected: a broad news search mostly catches chain closures or stories with press coverage, not the small independent turnover that actually drives most of the changes in a 683-point dataset. See *Methodology* below for how the automated version should close that gap.

---

## 2. Road closures & roadworks

**Bakers Lane, Epping — closing 8 September for ~16 weeks (3 phases)**
Essential highway improvements and resurfacing ahead of the new Epping Leisure Centre opening.
- Phase 1: St John's Road junction to the Bakers Lane roundabout (Cottis Lane)
- Phase 2: Cottis Lane roundabout to Albany Court junction
- Phase 3: overnight closure on Albany Court for resurfacing
- Daytime works, resident access maintained; pavements stay open; Cottis Yard and M&S car parks stay accessible
- Diversions signed via St John's Road, Coronation Hill and Lincolns Field

Source: [Advance notice of Epping road closures — Epping Forest District Council](https://www.eppingforestdc.gov.uk/advance-notice-of-epping-road-closures)

**Forest car park hours reducing — from 15 September**
City of London Corporation is cutting car park opening hours from 7am–8pm to 7am–6:30pm from 15 September 2026. Not a closure, but worth reflecting if the map shows car park hours anywhere.
Source: [What's new in Epping Forest — City of London Corporation](https://www.cityoflondon.gov.uk/things-to-do/green-spaces/epping-forest/whats-new-in-epping-forest)

**No live Essex Highways roadworks list pulled this run**
[Essex Highways' Future Roadworks Map](https://www.essexhighways.org/interactive-maps-and-live-travel-information/future-roadworks-map) and [Live Traffic Map](https://www.essexhighways.org/interactive-maps-and-live-travel-information/live-traffic-map) are interactive tools rather than static pages, so this run couldn't extract a list automatically. The automated version should query these (or Essex CC's open data feed, if one exists) directly rather than relying on search results.

---

## 3. Special events in the forest

**Skylark Conservation Event — Saturday 6 September, 2–4pm**
Harrow Road Pavilion, Wanstead Flats. Free, no booking required.
Source: [What's new in Epping Forest — City of London Corporation](https://www.cityoflondon.gov.uk/things-to-do/green-spaces/epping-forest/whats-new-in-epping-forest)

**"What's On in Epping Forest" brochure — May to October 2026**
Epping Forest District Council's season brochure lists forest-adjacent activities (Treasure Trails, Youth Express, walking football, and similar) without dates/locations on the web page itself — full detail is only in the PDF brochure or via their booking site. The automated version should fetch and parse this PDF directly for a complete calendar rather than a summary.
Source: [What's On in Epping Forest — Epping Forest District Council](https://www.eppingforestdc.gov.uk/whats-on-in-epping-forest/)

**Other closures/restrictions already in force (not new, but relevant context):**
- Fishing closed season: 15 March – 15 June 2026 (already over)
- Railway Field: closed to public access
- Horse riding season opened 17 April 2026

Source: [What's new in Epping Forest — City of London Corporation](https://www.cityoflondon.gov.uk/things-to-do/green-spaces/epping-forest/whats-new-in-epping-forest)

---

## Methodology & limitations (read before acting on this)

This sample run used general web search and a handful of council/City of London pages — it is a **demonstration of the report format**, not a systematic audit of all 683 business points. Two things to be aware of before this becomes a standing weekly task:

1. **Coverage gap on businesses.** General news search only surfaces closures/openings that got press coverage — mostly chains or notable independents. Small independent turnover (a café changing hands, a shop shutting quietly) won't show up this way. A more systematic version would spot-check a rotating sample of the dataset's 683 points each week (e.g. against Google Places status, Companies House dissolutions, or OSM's own recent-edit history for these node IDs) rather than relying on open-ended search.
2. **Roadworks source.** Essex Highways' roadworks/traffic maps are interactive and weren't machine-readable this run. Worth checking whether Essex CC publishes an open data feed for roadworks, which would be far more reliable than search.
3. **Events brochure.** The District Council's brochure is a PDF; this run only saw the web page's summary. Fetching the PDF directly would give exact dates/locations for the automated version.

None of the findings above have been applied to the dataset — this is report-only, as requested. When you're ready to move to the "update the dataset" phase, the closure/opening candidates above would be the first two edits (with the caveats noted).
