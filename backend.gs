// ═══════════════════════════════════════════════════════════════════════════
// CrispNW LLC — Field Canvas Backend
// Google Apps Script — Version 12  (AppSheet Schema Engine)
// Sheet ID : 1ZkHOFiswN83JLggTyE_O3QBkCrtZcga1a-V7hjTqR9o
//
// Tabs written by this script:
//   Field_Leads       ← primary write target (enriched GPS capture)
//   Service_Locations ← upserted on each Interested / Maybe lead
//   Clients           ← upserted on each Interested / Maybe lead
//
// Tabs managed by AppSheet (read-only from GAS):
//   Estimates_and_Proposals
//   Jobs
//   Line_Items
//   Invoices_and_Payments
//
// Payload format (unchanged from V10/V11 iframe engine):
//   e.parameter.data → JSON string { timestamp, lat, lng, status, notes }
// ═══════════════════════════════════════════════════════════════════════════

// ─── CONFIG ─────────────────────────────────────────────────────────────────
var CONFIG = {
  SHEET_ID             : '1ZkHOFiswN83JLggTyE_O3QBkCrtZcga1a-V7hjTqR9o',
  TAB_LEADS            : 'Field_Leads',
  TAB_LOCATIONS        : 'Service_Locations',
  TAB_CLIENTS          : 'Clients',
  RAPIDAPI_KEY         : '0acecfd46emsheccb4973e880f97p1c2b39jsnff27791fbd1e',
  RAPIDAPI_HOST        : 'zllw-working-api.p.rapidapi.com',
  COMPLEXITY_THRESHOLD : 1400000,   // $1,400,000 — strictly enforced
  VERSION              : 12
};

// ─── ID GENERATOR ────────────────────────────────────────────────────────────
// Produces collision-resistant IDs without external libraries.
// Format: PREFIX-yyyyMMdd-xxxxxx  (e.g. LEAD-20260401-a3f7b2)
function makeId(prefix) {
  var now  = new Date();
  var date = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMdd');
  var hex  = Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
  return prefix + '-' + date + '-' + hex;
}


// ═══════════════════════════════════════════════════════════════════════════
// HELPER 1 — getZillowData(address)
//   Returns: { sqft: Number|'', zestimate: Number }
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
    if (response.getResponseCode() !== 200) return result;
    var details  = JSON.parse(response.getContentText()).propertyDetails || {};
    result.sqft      = details.livingArea || details.livingAreaValue
                    || details.sqft || details.finishedSqFt || '';
    result.zestimate = Number(details.zestimate) || 0;
    Logger.log('[getZillowData] sqft=' + result.sqft + '  zestimate=$' + result.zestimate);
  } catch (err) {
    Logger.log('[getZillowData] ERROR: ' + err.toString());
  }
  return result;
}


// ═══════════════════════════════════════════════════════════════════════════
// HELPER 2a — panesForSqft(sqft)
//   8-bracket pane matrix, field-calibrated for Eastside WA market.
//   Returns: { minPanes, maxPanes }
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
//   6-tier Eastside-calibrated base price.
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
//   V12: Returns both numeric min/max (AppSheet-friendly) and label strings.
//   Returns: { panesMin, panesMax, paneLabel, priceMin, priceMax,
//              priceLabel, isComplex }
// ═══════════════════════════════════════════════════════════════════════════
function calculatePrice(sqft, zestimate) {
  var empty = { panesMin: '', panesMax: '', paneLabel: '',
                priceMin: '', priceMax: '', priceLabel: '', isComplex: false };
  if (!sqft || isNaN(Number(sqft))) return empty;

  var bracket   = panesForSqft(sqft);
  var minPanes  = bracket.minPanes;
  var maxPanes  = bracket.maxPanes;
  var minBase   = basePriceForPanes(minPanes);
  var maxBase   = basePriceForPanes(maxPanes);

  // Complexity Modifier: +25% when Zestimate > $1,400,000
  var isComplex = Number(zestimate) > CONFIG.COMPLEXITY_THRESHOLD;
  var minFinal  = isComplex ? Math.round(minBase * 1.25) : minBase;
  var maxFinal  = isComplex ? Math.round(maxBase * 1.25) : maxBase;

  Logger.log('[calculatePrice] sqft=' + sqft + '  panes=' + minPanes + '-' + maxPanes
    + '  complex=' + isComplex + '  price=$' + minFinal + '-$' + maxFinal);

  return {
    panesMin  : minPanes,
    panesMax  : maxPanes,
    paneLabel : minPanes + ' - ' + maxPanes,
    priceMin  : minFinal,
    priceMax  : maxFinal,
    priceLabel: '$' + minFinal + ' - $' + maxFinal + (isComplex ? ' \u2605 Complex' : ''),
    isComplex : isComplex
  };
}


// ═══════════════════════════════════════════════════════════════════════════
// HELPER 3 — upsertRow(sheet, lookupCol, lookupVal, rowData)
//   Checks if a row with lookupVal in column lookupCol already exists.
//   If yes: returns that row's ID (col 0) without overwriting.
//   If no:  appends rowData and returns the new ID.
//   Returns: { id, isNew }
// ═══════════════════════════════════════════════════════════════════════════
function upsertRow(sheet, lookupCol, lookupVal, rowData) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][lookupCol]).trim() === String(lookupVal).trim()) {
      return { id: data[i][0], isNew: false };
    }
  }
  sheet.appendRow(rowData);
  return { id: rowData[0], isNew: true };
}


// ═══════════════════════════════════════════════════════════════════════════
// HELPER 4 — geocodeLatLng(lat, lng)
//   Returns: { address, streetNumber, streetName, city, state, zip }
// ═══════════════════════════════════════════════════════════════════════════
function geocodeLatLng(lat, lng) {
  var result = { address: 'Address not found',
                 streetNumber: '', streetName: '', city: '', state: '', zip: '' };
  try {
    var geo = Maps.newGeocoder().reverseGeocode(lat, lng);
    if (geo.status !== 'OK' || geo.results.length === 0) return result;
    var comp = geo.results[0].address_components;
    for (var i = 0; i < comp.length; i++) {
      var t = comp[i].types;
      if (t.indexOf('street_number')              !== -1) result.streetNumber = comp[i].long_name;
      if (t.indexOf('route')                       !== -1) result.streetName   = comp[i].long_name;
      if (t.indexOf('locality')                    !== -1) result.city         = comp[i].long_name;
      if (t.indexOf('administrative_area_level_1') !== -1) result.state        = comp[i].short_name;
      if (t.indexOf('postal_code')                 !== -1) result.zip          = comp[i].long_name;
    }
    var street = (result.streetNumber + ' ' + result.streetName).trim();
    result.address = street && result.city
      ? street + ', ' + result.city + ', ' + result.state + ' ' + result.zip
      : (street || result.city || result.address);
  } catch (err) {
    Logger.log('[geocodeLatLng] ERROR: ' + err.toString());
  }
  return result;
}


// ═══════════════════════════════════════════════════════════════════════════
// MAIN — doPost(e)
//   Orchestrates: parse → geocode → Zillow → price → multi-tab write
//   Payload arrives as hidden-form POST field: e.parameter.data
//   (V10+ iframe engine — not subject to CORS or 302-redirect stripping)
// ═══════════════════════════════════════════════════════════════════════════
function doPost(e) {
  try {
    // ── 1. Parse payload ─────────────────────────────────────────────────
    var data   = JSON.parse(e.parameter.data);
    var ts     = data.timestamp;
    var lat    = Number(data.lat);
    var lng    = Number(data.lng);
    var status = data.status;
    var notes  = data.notes || '';

    // ── 2. Format date / time ────────────────────────────────────────────
    var d       = new Date(ts);
    var tz      = Session.getScriptTimeZone();
    var fmtDate = Utilities.formatDate(d, tz, 'MM/dd/yyyy');
    var fmtTime = Utilities.formatDate(d, tz, 'hh:mm a');

    // ── 3. Geocode ───────────────────────────────────────────────────────
    var geo = geocodeLatLng(lat, lng);

    // ── 4. Zillow enrichment + pricing (Interested / Maybe only) ─────────
    var sqft      = '';
    var zestimate = 0;
    var pricing   = { panesMin: '', panesMax: '', paneLabel: '',
                      priceMin: '', priceMax: '', priceLabel: '', isComplex: false };

    if (status === 'Interested' || status === 'Maybe') {
      var zillow = getZillowData(geo.address);
      sqft       = zillow.sqft;
      zestimate  = zillow.zestimate;
      pricing    = calculatePrice(sqft, zestimate);
    }

    // ── 5. Open spreadsheet ──────────────────────────────────────────────
    var ss          = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    var leadsSheet  = ss.getSheetByName(CONFIG.TAB_LEADS)     || ss.insertSheet(CONFIG.TAB_LEADS);
    var locSheet    = ss.getSheetByName(CONFIG.TAB_LOCATIONS) || ss.insertSheet(CONFIG.TAB_LOCATIONS);
    var clientSheet = ss.getSheetByName(CONFIG.TAB_CLIENTS)   || ss.insertSheet(CONFIG.TAB_CLIENTS);

    // ── 6. Upsert Client (keyed on Address_Full, col 7) ──────────────────
    //   "Not Interested" leads don't create Client or Location records —
    //   keeps the relational tables clean for AppSheet.
    var clientId   = '';
    var locationId = '';

    if (status === 'Interested' || status === 'Maybe') {
      var cResult = upsertRow(clientSheet, 7, geo.address, [
        makeId('CLI'),   // [0]  Client_ID
        '',              // [1]  First_Name        (AppSheet fills on follow-up)
        '',              // [2]  Last_Name
        '',              // [3]  Email
        '',              // [4]  Phone
        '',              // [5]  Preferred_Contact
        'Field Canvas',  // [6]  Source
        fmtDate,         // [7]  Created_Date  ← also serves as lookup key
        'Prospect',      // [8]  Status
        geo.city,        // [9]  City
        geo.state,       // [10] State
        notes            // [11] Notes
      ]);
      clientId = cResult.id;

      // ── 7. Upsert Service Location (keyed on Address_Full, col 2) ──────
      var lResult = upsertRow(locSheet, 2, geo.address, [
        makeId('LOC'),                      // [0]  Location_ID
        clientId,                           // [1]  Client_ID (FK)
        geo.address,                        // [2]  Address_Full
        geo.streetNumber,                   // [3]  Street_Number
        geo.streetName,                     // [4]  Street_Name
        geo.city,                           // [5]  City
        geo.state,                          // [6]  State
        geo.zip,                            // [7]  ZIP
        lat,                                // [8]  GPS_Lat
        lng,                                // [9]  GPS_Lng
        'Residential',                      // [10] Property_Type
        sqft,                               // [11] SqFt
        zestimate,                          // [12] Zestimate
        '',                                 // [13] Pane_Count_Actual (on-site verify)
        pricing.isComplex ? 'Yes' : 'No',   // [14] Complexity_Flag
        notes                               // [15] Notes
      ]);
      locationId = lResult.id;
    }

    // ── 8. Append to Field_Leads ──────────────────────────────────────────
    var leadId = makeId('LEAD');
    leadsSheet.appendRow([
      leadId,                             // [0]  Lead_ID
      fmtDate,                            // [1]  Captured_Date
      fmtTime,                            // [2]  Captured_Time
      ts,                                 // [3]  Captured_Timestamp_ISO
      '',                                 // [4]  Technician_Name (AppSheet user)
      lat,                                // [5]  GPS_Lat
      lng,                                // [6]  GPS_Lng
      geo.address,                        // [7]  Address_Full
      geo.streetNumber,                   // [8]  Street_Number
      geo.streetName,                     // [9]  Street_Name
      geo.city,                           // [10] City
      geo.state,                          // [11] State
      geo.zip,                            // [12] ZIP
      status,                             // [13] Interest_Status
      notes,                              // [14] Notes
      sqft,                               // [15] SqFt
      zestimate,                          // [16] Zestimate
      pricing.panesMin,                   // [17] Est_Panes_Min
      pricing.panesMax,                   // [18] Est_Panes_Max
      pricing.paneLabel,                  // [19] Est_Panes_Label
      pricing.priceMin,                   // [20] Est_Price_Min
      pricing.priceMax,                   // [21] Est_Price_Max
      pricing.priceLabel,                 // [22] Est_Price_Label
      pricing.isComplex ? 'Yes' : 'No',   // [23] Is_Complex
      clientId,                           // [24] Client_ID  (FK → Clients)
      locationId,                         // [25] Location_ID (FK → Service_Locations)
      '',                                 // [26] Estimate_ID (FK → Estimates, AppSheet fills)
      CONFIG.VERSION                      // [27] Schema_Version
    ]);

    Logger.log('[doPost] v12 OK — ' + leadId + ' | ' + geo.address
      + ' | ' + status + ' | ' + pricing.priceLabel);

    return ContentService
      .createTextOutput(JSON.stringify({
        success  : true,
        version  : CONFIG.VERSION,
        lead_id  : leadId
      }))
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
// ═══════════════════════════════════════════════════════════════════════════
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({
      status : 'CrispNW Logger v12 active',
      version: CONFIG.VERSION
    }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ═══════════════════════════════════════════════════════════════════════════
// SETUP — ensureHeaders()
//   Run ONCE from the Apps Script editor after pasting this code.
//   Writes column headers to all three GAS-managed tabs.
//   Safe to re-run — only writes if the sheet is empty.
// ═══════════════════════════════════════════════════════════════════════════
function ensureHeaders() {
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);

  var tabs = {
    'Field_Leads': [
      'Lead_ID','Captured_Date','Captured_Time','Captured_Timestamp_ISO',
      'Technician_Name','GPS_Lat','GPS_Lng','Address_Full',
      'Street_Number','Street_Name','City','State','ZIP',
      'Interest_Status','Notes','SqFt','Zestimate',
      'Est_Panes_Min','Est_Panes_Max','Est_Panes_Label',
      'Est_Price_Min','Est_Price_Max','Est_Price_Label','Is_Complex',
      'Client_ID','Location_ID','Estimate_ID','Schema_Version'
    ],
    'Clients': [
      'Client_ID','First_Name','Last_Name','Email','Phone',
      'Preferred_Contact','Source','Created_Date','Status',
      'City','State','Notes'
    ],
    'Service_Locations': [
      'Location_ID','Client_ID','Address_Full','Street_Number','Street_Name',
      'City','State','ZIP','GPS_Lat','GPS_Lng','Property_Type',
      'SqFt','Zestimate','Pane_Count_Actual','Complexity_Flag','Notes'
    ],
    'Estimates_and_Proposals': [
      'Estimate_ID','Location_ID','Client_ID','Lead_ID',
      'Created_Date','Expiry_Date','Technician',
      'Total_Panes_Min','Total_Panes_Max','Price_Min','Price_Max',
      'Complexity_Modifier','Final_Price',
      'Status','Notes'
    ],
    'Jobs': [
      'Job_ID','Estimate_ID','Location_ID','Client_ID',
      'Scheduled_Date','Scheduled_Time','Technician_Assigned',
      'Job_Type','Status','Actual_Panes','Final_Price',
      'Completion_Notes','Invoice_ID'
    ],
    'Line_Items': [
      'Line_ID','Estimate_ID','Job_ID',
      'Service_Type','Description','Quantity','Unit_Price','Total_Price','Notes'
    ],
    'Invoices_and_Payments': [
      'Invoice_ID','Job_ID','Client_ID',
      'Invoice_Date','Due_Date','Amount_Due','Amount_Paid',
      'Payment_Method','Payment_Date','Status','Notes'
    ]
  };

  Object.keys(tabs).forEach(function(tabName) {
    var sheet = ss.getSheetByName(tabName) || ss.insertSheet(tabName);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(tabs[tabName]);
      Logger.log('[ensureHeaders] Wrote headers to ' + tabName);
    } else {
      Logger.log('[ensureHeaders] ' + tabName + ' already has data — skipped.');
    }
  });
}


// ═══════════════════════════════════════════════════════════════════════════
// DEV TOOLS — run from Apps Script editor
// ═══════════════════════════════════════════════════════════════════════════
function testDoPostV12() {
  // Carnation tech, offline queue flush scenario
  var payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    lat      : 47.6478,
    lng      : -121.9127,
    status   : 'Interested',
    notes    : 'Spoke to owner. 2-story. Lots of skylights.'
  });
  var mock = { parameter: { data: payload } };
  var result = doPost(mock);
  Logger.log('[testDoPostV12] ' + result.getContent());
}

function testPriceMatrix() {
  var cases = [
    [800,    500000,  'Bracket 1 — <1000 sqft, simple       '],
    [1300,   750000,  'Bracket 2 — 1000-1500 sqft, simple   '],
    [1750,   900000,  'Bracket 3 — 1500-2000 sqft, simple   '],
    [2200,   1100000, 'Bracket 4 — 2000-2500 sqft, simple   '],
    [2700,   1200000, 'Bracket 5 — 2500-3000 sqft, simple   '],
    [3200,   1400000, 'Bracket 6 — 3000-4000 sqft, AT limit '],
    [3200,   1400001, 'Bracket 6 — 3000-4000 sqft, COMPLEX  '],
    [4500,   2800000, 'Bracket 7 — 4000-5000 sqft, COMPLEX  '],
    [5400,   4241500, 'Bracket 8 — 5000+ sqft,    COMPLEX   ']
  ];
  cases.forEach(function(c) {
    var r = calculatePrice(c[0], c[1]);
    Logger.log(c[2] + ' | panes=' + r.paneLabel + '  price=' + r.priceLabel);
  });
}
