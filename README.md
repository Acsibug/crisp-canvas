# CrispNW Field Canvas

> Mobile-first window cleaning CRM — Field Canvas for lead logging, range estimation, and live route mapping.

## Stack
- **Frontend**: Single-file HTML/JS PWA (`index.html`)
- **Backend**: Google Apps Script (`backend.gs`) — deployed as a Web App
- **Database**: Google Sheets (CrispNW Command Center)
- **Geocoding / Zestimate**: RapidAPI ZLLW endpoint
- **Route Map**: Google My Maps (live, synced to sheet)

## Current Version
**V11 — Range Estimation Engine**
- 8-bracket pane matrix (sqft → min/max pane count)
- Price range output with Complex modifier (25% uplift for Zestimate > $1.4M)
- Live backend URL: `https://script.google.com/macros/s/AKfycbzwyXuhH133aqQMWf4J7CJOTlwlYN-iTgHmbbQWL1TCYCjoTVVdi__xpea36Xi2X38v/exec`

## Deployment
The frontend is hosted on **GitHub Pages**:
🔗 https://acsibug.github.io/crisp-canvas/

## Project Board
CrispNW CRM Build — managed in Asana.

## License
Private — CrispNW LLC
