// ═══════════════════════════════════════════════════════════════════════════
// CrispNW LLC — Field Canvas Backend
// Google Apps Script — Version 11  (Range Estimation Engine)
// Sheet ID : 1ZkHOFiswN83JLggTyE_O3QBkCrtZcga1a-V7hjTqR9o
// Columns  : Date | Time | Address | Status | Notes | SqFt | Est.Panes | Est.Price
// ═══════════════════════════════════════════════════════════════════════════

// ─── CONFIG (single source of truth) ────────────────────────────────────────
var CONFIG = {
  SHEET_ID             : '1ZkHOFiswN83JLggTyE_O3QBkCrtZcga1a-V7hjTqR9o',
  SHEET_TAB            : 'Leads',
  RAPIDAPI_KEY         : '0acecfd46emsheccb4973e880f97p1c2b39jsnff27791fbd1e',
  RAPIDAPI_HOST        : 'zllw-working-api.p.rapidapi.com',
  COMPLEXITY_THRESHOLD : 1400000,   // ← $1,400,000 — strictly enforced
  VERSION              : 11
};


// ═══════════════════════════════════════════════════════════════════════════
// HELPER 1 — getZillowData(address)
//   Returns: { sqft: Number|'', zestimate: Number }
//   Isolates all RapidAPI / ZLLW concerns in one place.
// ═══════════════════════════════════════════════════════════════════════════
function getZillowData(address) {
  var result = { sqft: '', zestimate: 0 };
  try {
    var apiUrl = 'https://' + CONFIG.RAPIDAPI_HOST
               + '/pro/byaddress?propertyaddress='
               + encodeURIComponent(address);

    var response = UrlFetchApp.fetch(apiUrl, {
      method : 'GET',
      headers: {
        'x-rapidapi-host': CONFIG.RAPIDAPI_HOST,
        'x-rapidapi-key' : CONFIG.RAPIDAPI_KEY
      },
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    Logger.log('[getZillowData] HTTP ' + code + ' for: ' + address);

    if (code !== 200) return result;

    var details = JSON.parse(response.getContentText()).propertyDetails || {};

    result.sqft      = details.livingArea
                    || details.livingAreaValue
                    || details.sqft
                    || details.finishedSqFt
                    || '';
    result.zestimate = Number(details.zestimate) || 0;

    Logger.log('[getZillowData] sqft=' + result.sqft + '  zestimate=' + result.zestimate);
  } catch (err) {
    Logger.log('[getZillowData] ERROR: ' + err.toString());
  }
  return result;
}


// ══════════════════════════════════════════════════════════════════════════
// HELPER 2a — panesForSqft(sqft)
//   Returns: { minPanes: Number, maxPanes: Number }
//   Pane Matrix — 8 brackets based on measured field data.
// ═══════════════════════════════════════════════════════════════════════════
function panesForSqft(sqft) {
  var s = Number(sqft);
  if      (s < 1000) return { minPanes: 10,  maxPanes: 18  };
  else if (s < 1500) return { minPanes: 16,  maxPanes: 24  };
  else if (s < 2000) return { minPanes: 22,  maxPanes: 32  };
  else if (s < 2500) return { minPanes: 28,  maxPanes: 40  };
  else if (s < 3000) return { minPanes: 36,  maxPanes: 50  };
  else if (s < 4000) return { minPanes: 45,  maxPanes: 65  };
  else if (s < 5000) return { minPanes: 60,  maxPanes: 85  };
  else               return { minPanes: 80,  maxPanes: 120 };
}


// ═══════════════════════════════════════════════════════════════════════════
// HELPER 2b — basePriceForPanes(panes)
//   Returns: Number — 6-tier Eastside-calibrated base price for a pane count.
// ═══════════════════════════════════════════════════════════════════════════
function basePriceForPanes(panes) {
  if      (panes <= 15) return 150;
  else if (panes <= 25) return 225;
  else if (panes <= 35) return 325;
  else if (panes <= 45) return 425;
  else if (panes <= 55) return 525;
  else                  return 525 + Math.round((panes - 55) * 15);
}


// ═══════════════════════════════════════════════════════════════════════════
// HELPER 2 — calculatePrice(sqft, zestimate)
//   Returns: { panes: String, price: String, isComplex: Boolean }
//   V11: Returns a RANGE for both panes and price.
//     panes  → "45 - 65"
//     price  → "$500 - $725" (+ " ★ Complex" if Zestimate > $1.4M)
// ═══════════════════════════════════════════════════════════════════════════
function calculatePrice(sqft, zestimate) {
  var empty = { panes: '', price: '', isComplex: false };
  if (!sqft || isNaN(Number(sqft))) return empty;

  // ── Step 1: resolve pane range from matrix ────────────────────────────────
  var bracket   = panesForSqft(sqft);
  var minPanes  = bracket.minPanes;
  var maxPanes  = bracket.maxPanes;

  // ── Step 2: base prices for both endpoints ───────────────────────────────
  var minBase = basePriceForPanes(minPanes);
  var maxBase = basePriceForPanes(maxPanes);

  // ── Step 3: Complexity Modifier — strictly enforced at $1,400,000 ────────
  var isComplex = (Number(zestimate) > CONFIG.COMPLEXITY_THRESHOLD);
  var minFinal  = isComplex ? Math.round(minBase * 1.25) : minBase;
  var maxFinal  = isComplex ? Math.round(maxBase * 1.25) : maxBase;

  // ── Step 4: build range strings ──────────────────────────────────────────
  var panesLabel = minPanes + ' - ' + maxPanes;
  var priceLabel = '$' + minFinal + ' - $' + maxFinal
                 + (isComplex ? ' \u2605 Complex' : '');

  Logger.log('[calculatePrice] sqft=' + sqft
    + '  panes=' + panesLabel
    + '  baseRange=$' + minBase + '-$' + maxBase
    + '  complex=' + isComplex
    + '  final=' + priceLabel);

  return { panes: panesLabel, price: priceLabel, isComplex: isComplex };
}


// ═══════════════════════════════════════════════════════════════════════════
// MAIN — doPost(e)
//   V10/11: Payload arrives as hidden-form POST field: e.parameter.data
//   Hidden iframe form submission bypasses fetch() entirely — not subject
//   to browser CORS or 302-redirect body stripping on any platform.
//   Orchestrates: parse → format → geocode → Zillow → price → Sheet write
// ═══════════════════════════════════════════════════════════════════════════
function doPost(e) {
  try {
    // V10/11: payload is a form-encoded POST field named "data"
    var data      = JSON.parse(e.parameter.data);
    var timestamp = data.timestamp;
    var lat       = data.lat;
    var lng       = data.lng;
    var status    = data.status;
    var notes     = data.notes || '';

    // ── Format date / time ───────────────────────────────────────────────
    var dateObj   = new Date(timestamp);
    var month     = String(dateObj.getMonth() + 1).padStart(2, '0');
    var day       = String(dateObj.getDate()).padStart(2, '0');
    var year      = dateObj.getFullYear();
    var fmtDate   = month + '/' + day + '/' + year;

    var rawH      = dateObj.getHours();
    var minutes   = String(dateObj.getMinutes()).padStart(2, '0');
    var ampm      = rawH >= 12 ? 'PM' : 'AM';
    var fmtTime   = (rawH % 12 || 12) + ':' + minutes + ' ' + ampm;

    // ── Reverse-geocode lat/lng → street address ─────────────────────────
    var address = 'Address not found';
    try {
      var geo = Maps.newGeocoder().reverseGeocode(lat, lng);
      if (geo.status === 'OK' && geo.results.length > 0) {
        var comp = geo.results[0].address_components;
        var num  = '', route = '', city = '';
        for (var i = 0; i < comp.length; i++) {
          var t = comp[i].types;
          if (t.indexOf('street_number') !== -1) num   = comp[i].long_name;
          if (t.indexOf('route')         !== -1) route = comp[i].long_name;
          if (t.indexOf('locality')      !== -1) city  = comp[i].long_name;
        }
        var street = (num + ' ' + route).trim();
        address = street && city ? street + ', ' + city : (street || city || address);
      }
    } catch (geoErr) {
      Logger.log('[doPost] Geocode error: ' + geoErr.toString());
    }

    // ── Zillow + pricing (Interested / Maybe only) ───────────────────────
    var sqft = '', panes = '', price = '';

    if (status === 'Interested' || status === 'Maybe') {
      var zillow  = getZillowData(address);
      var pricing = calculatePrice(zillow.sqft, zillow.zestimate);
      sqft  = zillow.sqft;
      panes = pricing.panes;
      price = pricing.price;
    }

    // ── Append row to Google Sheet ───────────────────────────────────────
    SpreadsheetApp
      .openById(CONFIG.SHEET_ID)
      .getSheetByName(CONFIG.SHEET_TAB)
      .appendRow([fmtDate, fmtTime, address, status, notes, sqft, panes, price]);

    Logger.log('[doPost] Row written — ' + address + ' | ' + status + ' | ' + price);

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, version: CONFIG.VERSION }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    Logger.log('[doPost] FATAL: ' + err.toString());
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// HEALTH CHECK — doGet(e)
//   Returns version info when hit directly (no data param).
// ═══════════════════════════════════════════════════════════════════════════
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({
      status : 'CrispNW Logger v11 active',
      version: CONFIG.VERSION
    }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ═══════════════════════════════════════════════════════════════════════════
// DEV TOOLS — run from Apps Script editor
// ═══════════════════════════════════════════════════════════════════════════
function testDoPostV11() {
  // Simulate hidden-form POST — Kirkland address (5400 sqft, $4.2M → Complex)
  var payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    lat  : 47.6815,
    lng  : -122.2087,
    status: 'Interested',
    notes : 'v11 range engine test'
  });
  var mock = { parameter: { data: payload } };
  var result = doPost(mock);
  Logger.log('[testDoPostV11] Result: ' + result.getContent());
}

function testCalculatePrice() {
  // < 1000 sqft, below threshold → expect panes "10 - 18"
  var r1 = calculatePrice(800, 500000);
  Logger.log('800sqft $500k    → ' + JSON.stringify(r1));

  // 1500-1999 sqft, below threshold → expect panes "22 - 32"
  var r2 = calculatePrice(1750, 900000);
  Logger.log('1750sqft $900k   → ' + JSON.stringify(r2));

  // 3000-3999 sqft, below threshold → expect panes "45 - 65"
  var r3 = calculatePrice(3200, 1400000);
  Logger.log('3200sqft $1.4M   → ' + JSON.stringify(r3));

  // 3000-3999 sqft, ABOVE threshold → expect "45 - 65" panes + ★ Complex
  var r4 = calculatePrice(3200, 1400001);
  Logger.log('3200sqft $1.4M+1 → ' + JSON.stringify(r4));

  // 5000+ sqft, ABOVE threshold → expect panes "80 - 120" + ★ Complex
  var r5 = calculatePrice(5400, 4241500);
  Logger.log('5400sqft $4.24M  → ' + JSON.stringify(r5));
}

function readLastRow() {
  var sheet = SpreadsheetApp
    .openById(CONFIG.SHEET_ID)
    .getSheetByName(CONFIG.SHEET_TAB);
  var last = sheet.getLastRow();
  var row  = sheet.getRange(last, 1, 1, 8).getValues()[0];
  Logger.log('=== LAST ROW (row ' + last + ') ===');
  Logger.log('Date:       ' + row[0]);
  Logger.log('Time:       ' + row[1]);
  Logger.log('Address:    ' + row[2]);
  Logger.log('Status:     ' + row[3]);
  Logger.log('Notes:      ' + row[4]);
  Logger.log('SqFt:       ' + row[5]);
  Logger.log('Est.Panes:  ' + row[6]);
  Logger.log('Est.Price:  ' + row[7]);
  Logger.log('================');
}
