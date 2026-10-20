/**
 * Coorg Bliss Estate Stay Management - Google Apps Script Backend
 * FRESH MASTER DATA VERSION
 * 
 * Deploy as Web App:
 *   - Execute as: Me
 *   - Who has access: Anyone
 * 
 * Sheets:
 *   - Bookings_{YYYY_MM}: Monthly booking data
 *   - CheckIns_{YYYY_MM}: Monthly check-in data
 *   - Users: User accounts
 *   - Settings: App configuration
 * 
 * SYNC STRATEGY: REPLACE (not append)
 * - syncAll replaces entire sheet data with frontend data
 * - This guarantees NO duplicates ever
 */

// ==================== MAIN HANDLERS ====================

function doGet(e) {
  try {
    const action = e.parameter.action || 'getAll';
    const month = e.parameter.month || getCurrentMonthKey();
    
    if (action === 'health') {
      return jsonResponse({status: 'ok', timestamp: new Date().toISOString()});
    }
    
    if (action === 'getAll') {
      const bookings = getAllFromSheet('Bookings_' + month);
      const checkIns = getAllFromSheet('CheckIns_' + month);
      return jsonResponse({bookings: bookings, checkIns: checkIns, month: month});
    }
    
    if (action === 'getBookings') {
      return jsonResponse(getAllFromSheet('Bookings_' + month));
    }
    
    if (action === 'getCheckIns') {
      return jsonResponse(getAllFromSheet('CheckIns_' + month));
    }
    
    if (action === 'getUsers') {
      return jsonResponse(getAllFromSheet('Users'));
    }
    
    if (action === 'getAllMonths') {
      const months = getAvailableMonths();
      return jsonResponse(months);
    }
    
    if (action === 'getMonthData') {
      const targetMonth = e.parameter.month || getCurrentMonthKey();
      const bookings = getAllFromSheet('Bookings_' + targetMonth);
      const checkIns = getAllFromSheet('CheckIns_' + targetMonth);
      return jsonResponse({bookings: bookings, checkIns: checkIns, month: targetMonth});
    }
    
    if (action === 'exportCSV') {
      const targetMonth = e.parameter.month || getCurrentMonthKey();
      const type = e.parameter.type || 'bookings';
      const sheetName = type === 'checkins' ? 'CheckIns_' + targetMonth : 'Bookings_' + targetMonth;
      const csv = exportSheetAsCSV(sheetName);
      return jsonResponse({success: true, csv: csv, month: targetMonth, type: type});
    }
    
    if (action === 'getSettings') {
      const settings = getSettings();
      return jsonResponse(settings);
    }
    
    return jsonResponse({error: 'Unknown action: ' + action});
  } catch (err) {
    return jsonResponse({error: err.message, stack: err.stack});
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const month = body.month || getCurrentMonthKey();
    
    // ==================== SINGLE RECORD CREATION ====================
    if (action === 'createBooking') {
      const sheetName = 'Bookings_' + month;
      ensureSheet(sheetName, getBookingHeaders());
      appendRecord(sheetName, body.data, getBookingHeaders());
      return jsonResponse({success: true, message: 'Booking created'});
    }
    
    if (action === 'createCheckIn') {
      const sheetName = 'CheckIns_' + month;
      ensureSheet(sheetName, getCheckInHeaders());
      appendRecord(sheetName, body.data, getCheckInHeaders());
      return jsonResponse({success: true, message: 'Check-in created'});
    }
    
    if (action === 'createUser') {
      ensureSheet('Users', getUserHeaders());
      appendRecord('Users', body.data, getUserHeaders());
      return jsonResponse({success: true, message: 'User created'});
    }
    
    // ==================== UPDATE / DELETE ====================
    if (action === 'updateBooking') {
      const sheetName = 'Bookings_' + month;
      updateRecord(sheetName, body.search, body.data, getBookingHeaders());
      return jsonResponse({success: true, message: 'Booking updated'});
    }
    
    if (action === 'deleteBooking') {
      const sheetName = 'Bookings_' + month;
      deleteRecord(sheetName, body.search, getBookingHeaders());
      return jsonResponse({success: true, message: 'Booking deleted'});
    }
    
    if (action === 'updateCheckIn') {
      const sheetName = 'CheckIns_' + month;
      updateRecord(sheetName, body.search, body.data, getCheckInHeaders());
      return jsonResponse({success: true, message: 'Check-in updated'});
    }
    
    if (action === 'deleteCheckIn') {
      const sheetName = 'CheckIns_' + month;
      deleteRecord(sheetName, body.search, getCheckInHeaders());
      return jsonResponse({success: true, message: 'Check-in deleted'});
    }
    
    if (action === 'updateUser') {
      updateRecord('Users', body.search, body.data, getUserHeaders());
      return jsonResponse({success: true, message: 'User updated'});
    }
    
    if (action === 'deleteUser') {
      deleteRecord('Users', body.search, getUserHeaders());
      return jsonResponse({success: true, message: 'User deleted'});
    }
    
    // ==================== FULL SYNC (REPLACE STRATEGY) ====================
    // This is the KEY fix - replaces entire sheet instead of appending
    if (action === 'syncAll') {
      const bookingsMonth = body.bookingsMonth || getCurrentMonthKey();
      const checkInsMonth = body.checkInsMonth || getCurrentMonthKey();
      
      let bookingsCount = 0;
      let checkInsCount = 0;
      
      // REPLACE bookings sheet entirely
      if (body.bookings !== undefined) {
        const bSheet = 'Bookings_' + bookingsMonth;
        bookingsCount = replaceSheetData(bSheet, getBookingHeaders(), body.bookings || []);
      }
      
      // REPLACE check-ins sheet entirely
      if (body.checkIns !== undefined) {
        const cSheet = 'CheckIns_' + checkInsMonth;
        checkInsCount = replaceSheetData(cSheet, getCheckInHeaders(), body.checkIns || []);
      }
      
      return jsonResponse({
        success: true, 
        message: 'Full sync completed (replace mode)',
        bookingsCount: bookingsCount,
        checkInsCount: checkInsCount
      });
    }
    
    // ==================== USERS SYNC (REPLACE STRATEGY) ====================
    if (action === 'syncUsers') {
      if (body.users !== undefined) {
        const count = replaceSheetData('Users', getUserHeaders(), body.users || []);
        return jsonResponse({success: true, message: 'Users synced (replace mode)', count: count});
      }
      return jsonResponse({success: true, message: 'No users data provided'});
    }
    
    // ==================== SETTINGS ====================
    if (action === 'updateSettings') {
      const settings = getSettings();
      if (body.appsScriptUrl) settings.appsScriptUrl = body.appsScriptUrl;
      setSettings(settings);
      return jsonResponse({success: true, message: 'Settings updated'});
    }
    
    // ==================== CLEANUP DUPLICATES ====================
    if (action === 'cleanup') {
      const sheetName = body.sheet || ('Bookings_' + month);
      const headers = getHeadersForSheet(sheetName);
      const removed = removeDuplicates(sheetName, headers);
      return jsonResponse({success: true, duplicatesRemoved: removed});
    }
    
    return jsonResponse({error: 'Unknown action: ' + action});
  } catch (err) {
    return jsonResponse({error: err.message, stack: err.stack});
  }
}

// ==================== REPLACE STRATEGY (KEY FIX) ====================

function replaceSheetData(sheetName, headers, records) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(sheetName);
  
  // Create sheet if it doesn't exist
  if (!sh) {
    sh = ss.insertSheet(sheetName);
  }
  
  // STEP 1: Clear ALL existing data
  sh.clear();
  
  // STEP 2: Add headers
  sh.appendRow(headers);
  sh.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#4CAF50')
    .setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  
  // STEP 3: Deduplicate incoming records by ID
  const seenIds = new Set();
  const uniqueRecords = [];
  
  records.forEach(record => {
    if (!record || typeof record !== 'object') return;
    
    // Skip if we've already seen this ID
    if (record.id) {
      if (seenIds.has(record.id)) return;
      seenIds.add(record.id);
    }
    
    uniqueRecords.push(record);
  });
  
  // STEP 4: Insert all unique records
  if (uniqueRecords.length > 0) {
    // Batch insert for performance
    const rows = uniqueRecords.map(record => {
      return headers.map(h => {
        let val = record[h];
        
        if (h === 'roomIds') {
          if (Array.isArray(val)) return val.join(';');
          if (typeof val === 'string') return val;
          return '';
        }
        
        if (Array.isArray(val)) return val.join(';');
        
        if ((h === 'checkInDate' || h === 'checkOutDate') && val) {
          return extractDateOnly(val);
        }
        
        return val !== undefined && val !== null ? val : '';
      });
    });
    
    sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  
  return uniqueRecords.length;
}

// ==================== HELPER FUNCTIONS ====================

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getCurrentMonthKey() {
  const now = new Date();
  return now.getFullYear() + '_' + String(now.getMonth() + 1).padStart(2, '0');
}

function getAvailableMonths() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  const months = new Set();
  
  sheets.forEach(sheet => {
    const name = sheet.getName();
    const match = name.match(/^(Bookings|CheckIns)_(\d{4}_\d{2})$/);
    if (match) {
      months.add(match[2]);
    }
  });
  
  months.add(getCurrentMonthKey());
  
  return Array.from(months).sort().reverse();
}

function getAllFromSheet(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(sheetName);
  if (!sh) return [];
  
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return [];
  
  const headers = data[0];
  const records = [];
  const seenIds = new Set();
  
  for (let i = 1; i < data.length; i++) {
    const record = {};
    headers.forEach((h, idx) => {
      if (h) record[h] = data[i][idx];
    });
    
    // Deduplicate by ID on read
    const id = record.id;
    if (id && seenIds.has(id)) continue;
    if (id) seenIds.add(id);
    
    records.push(record);
  }
  return records;
}

function ensureSheet(sheetName, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(sheetName);
  if (!sh) {
    sh = ss.insertSheet(sheetName);
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#4CAF50')
      .setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
  return sh;
}

function extractDateOnly(dateStr) {
  if (!dateStr) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const match = String(dateStr).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : dateStr;
}

function appendRecord(sheetName, record, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(sheetName);
  if (!sh) return;
  
  const row = headers.map(h => {
    let val = record[h];
    
    if (h === 'roomIds') {
      if (Array.isArray(val)) return val.join(';');
      if (typeof val === 'string') return val;
      return '';
    }
    
    if (Array.isArray(val)) return val.join(';');
    
    if ((h === 'checkInDate' || h === 'checkOutDate') && val) {
      return extractDateOnly(val);
    }
    
    return val !== undefined && val !== null ? val : '';
  });
  sh.appendRow(row);
}

function updateRecord(sheetName, search, data, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(sheetName);
  if (!sh) return;
  
  const allData = sh.getDataRange().getValues();
  
  for (let i = 1; i < allData.length; i++) {
    let match = true;
    for (const key in search) {
      const colIdx = headers.indexOf(key);
      if (colIdx === -1 || String(allData[i][colIdx]) !== String(search[key])) {
        match = false;
        break;
      }
    }
    if (match) {
      for (const key in data) {
        const colIdx = headers.indexOf(key);
        if (colIdx !== -1) {
          const val = data[key];
          sh.getRange(i + 1, colIdx + 1).setValue(Array.isArray(val) ? val.join(';') : val);
        }
      }
      break;
    }
  }
}

function deleteRecord(sheetName, search, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(sheetName);
  if (!sh) return;
  
  const allData = sh.getDataRange().getValues();
  
  for (let i = allData.length - 1; i >= 1; i--) {
    let match = true;
    for (const key in search) {
      const colIdx = headers.indexOf(key);
      if (colIdx === -1 || String(allData[i][colIdx]) !== String(search[key])) {
        match = false;
        break;
      }
    }
    if (match) {
      sh.deleteRow(i + 1);
    }
  }
}

function isDuplicate(sheetName, record, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(sheetName);
  if (!sh) return false;
  
  const allData = sh.getDataRange().getValues();
  const idCol = headers.indexOf('id');
  
  // Check by ID first
  if (idCol !== -1 && record.id) {
    for (let i = 1; i < allData.length; i++) {
      if (String(allData[i][idCol]) === String(record.id)) return true;
    }
  }
  
  // Fallback to composite key
  const guestCol = headers.indexOf('guestName');
  const phoneCol = headers.indexOf('phone');
  const checkInCol = headers.indexOf('checkInDate');
  const checkOutCol = headers.indexOf('checkOutDate');
  
  if (guestCol === -1) return false;
  
  const compositeKey = (record.guestName || '') + '|' + 
                       (record.phone || '') + '|' + 
                       extractDateOnly(record.checkInDate) + '|' + 
                       extractDateOnly(record.checkOutDate);
  
  for (let i = 1; i < allData.length; i++) {
    const existingKey = (allData[i][guestCol] || '') + '|' + 
                        (allData[i][phoneCol] || '') + '|' + 
                        extractDateOnly(allData[i][checkInCol]) + '|' + 
                        extractDateOnly(allData[i][checkOutCol]);
    if (existingKey === compositeKey) return true;
  }
  return false;
}

function removeDuplicates(sheetName, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(sheetName);
  if (!sh) return 0;
  
  const allData = sh.getDataRange().getValues();
  const seen = new Set();
  let removed = 0;
  const idCol = headers.indexOf('id');
  
  for (let i = allData.length - 1; i >= 1; i--) {
    const key = idCol !== -1 ? String(allData[i][idCol]) : 
      (allData[i].join('|'));
    if (seen.has(key)) {
      sh.deleteRow(i + 1);
      removed++;
    } else {
      seen.add(key);
    }
  }
  return removed;
}

function exportSheetAsCSV(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(sheetName);
  if (!sh) return '';
  
  const data = sh.getDataRange().getValues();
  let csv = '';
  data.forEach(row => {
    csv += row.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',') + '\n';
  });
  return csv;
}

function getHeadersForSheet(sheetName) {
  if (sheetName.startsWith('Bookings')) return getBookingHeaders();
  if (sheetName.startsWith('CheckIns')) return getCheckInHeaders();
  if (sheetName === 'Users') return getUserHeaders();
  return [];
}

// ==================== SETTINGS MANAGEMENT ====================

function getSettings() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Settings');
  if (!sh) {
    sh = ss.insertSheet('Settings');
    sh.appendRow(['key', 'value']);
    sh.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#607D8B').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    const scriptUrl = ScriptApp.getService().getUrl();
    sh.appendRow(['appsScriptUrl', scriptUrl]);
    return { appsScriptUrl: scriptUrl };
  }
  
  const data = sh.getDataRange().getValues();
  const settings = {};
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) settings[data[i][0]] = data[i][1];
  }
  return settings;
}

function setSettings(settings) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Settings');
  if (!sh) {
    sh = ss.insertSheet('Settings');
    sh.appendRow(['key', 'value']);
    sh.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#607D8B').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
  
  const data = sh.getDataRange().getValues();
  const existingKeys = {};
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) existingKeys[data[i][0]] = i + 1;
  }
  
  for (const key in settings) {
    if (existingKeys[key]) {
      sh.getRange(existingKeys[key], 2).setValue(settings[key]);
    } else {
      sh.appendRow([key, settings[key]]);
    }
  }
}

// ==================== HEADERS ====================

function getBookingHeaders() {
  return [
    'id', 'guestName', 'phone', 'email', 'adults', 'kids', 'roomIds',
    'checkInDate', 'checkOutDate', 'bookingPlan', 'bookingType',
    'totalAmount', 'advancePayment', 'pendingAmount', 'paymentMode',
    'status', 'createdAt', 'idType', 'idNumber', 'collectedPendingAmount', 'guestNote', 'createdBy'
  ];
}

function getCheckInHeaders() {
  return [
    'id', 'bookingId', 'guestName', 'phone', 'email', 'adults', 'kids', 'roomIds',
    'checkInDate', 'checkOutDate', 'bookingPlan', 'bookingType',
    'totalAmount', 'advancePayment', 'pendingAmount', 'paymentMode',
    'status', 'createdAt', 'checkedInAt', 'autoCheckedOut',
    'idType', 'idNumber', 'collectedPendingAmount', 'guestNote', 'createdBy'
  ];
}

function getUserHeaders() {
  return [
    'id', 'username', 'password', 'name', 'role', 'pageAccess',
    'canCheckIn', 'canCreateBooking', 'canEditBooking', 'canDeleteBooking', 'canViewReports',
    'active', 'createdAt', 'phone', 'profilePhoto'
  ];
}

// ==================== INITIALIZATION ====================

function initializeSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const currentMonth = getCurrentMonthKey();
  
  ensureSheet('Bookings_' + currentMonth, getBookingHeaders());
  ensureSheet('CheckIns_' + currentMonth, getCheckInHeaders());
  
  let usersSh = ss.getSheetByName('Users');
  if (!usersSh) {
    usersSh = ensureSheet('Users', getUserHeaders());
    const now = new Date();
    usersSh.appendRow([
      'u1', 'Ashwin', 'ASH@888', 'Ashwin', 'admin',
      'dashboard,checkin,bookings,reports,settings,profile',
      true, true, true, true, true,
      true, now.toISOString(), '', ''
    ]);
    usersSh.appendRow([
      'u2', 'Vinod', 'V@2026', 'Vinod', 'manager',
      'dashboard,checkin,bookings,reports,profile',
      true, true, false, false, true,
      true, now.toISOString(), '', ''
    ]);
    usersSh.appendRow([
      'u3', 'Keerthi', 'K@2026', 'Keerthi', 'manager',
      'dashboard,checkin,bookings,profile',
      true, true, false, false, false,
      true, now.toISOString(), '', ''
    ]);
    usersSh.appendRow([
      'u4', 'Front', 'F@2026', 'Front', 'staff',
      'dashboard,checkin,profile',
      true, false, false, false, false,
      true, now.toISOString(), '', ''
    ]);
  }
  
  getSettings();
  
  return {success: true, message: 'Spreadsheet initialized for month: ' + currentMonth};
}

function testInit() {
  Logger.log(initializeSpreadsheet());
}

// ==================== AUTO CHECKOUT ====================

function autoCheckout() {
  const currentMonth = getCurrentMonthKey();
  const sheetName = 'CheckIns_' + currentMonth;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(sheetName);
  if (!sh) return;
  
  const headers = getCheckInHeaders();
  const data = sh.getDataRange().getValues();
  
  const now = new Date();
  const today = now.getFullYear() + '-' + 
                String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                String(now.getDate()).padStart(2, '0');
  
  const checkoutCol = headers.indexOf('checkOutDate');
  const autoCol = headers.indexOf('autoCheckedOut');
  const statusCol = headers.indexOf('status');
  
  for (let i = 1; i < data.length; i++) {
    const checkoutDate = extractDateOnly(data[i][checkoutCol]);
    const isAutoOut = data[i][autoCol];
    
    if (checkoutDate < today && !isAutoOut) {
      sh.getRange(i + 1, autoCol + 1).setValue(true);
      sh.getRange(i + 1, statusCol + 1).setValue('checked-out');
    }
  }
}

function setupAutoCheckoutTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'autoCheckout') {
      ScriptApp.deleteTrigger(t);
    }
  });
  
  ScriptApp.newTrigger('autoCheckout')
    .timeBased()
    .everyDays(1)
    .atHour(11)
    .nearMinute(30)
    .create();
}
