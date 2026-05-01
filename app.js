/* ═══════════════════════════════════════════════════════════
   ALOG Attendance Viewer — app.js
   Logic: Parse raw punch records → pair IN/OUT per employee
          per day → display in table with filters
   ═══════════════════════════════════════════════════════════ */

'use strict';
/* ─── STATE ─────────────────────────────────────────────── */
let allRows      = [];
let filteredRows = [];
let currentPage  = 1;
let pageSize     = 100;

// Update: Sort parameters for 3-state sort
let sortCol      = ''; // Empty by default
let sortDir      = 1;

let applyTimer   = null;
const nameMap = new Map();

// Variables to store original file data for TXT Export
let originalFileText = "";
let originalFileName = "";

/* ─── DOM REFS ───────────────────────────────────────────── */
const uploadScreen = document.getElementById('upload-screen');
const app          = document.getElementById('app');
const dropZone     = document.getElementById('drop-zone');
const fileInput    = document.getElementById('file-input');
const loadingBar   = document.getElementById('loading-bar');
const loadingLabel = document.getElementById('loading-label');
const progressFill = document.getElementById('progress-fill');
const tableArea    = document.getElementById('table-area');
const tableWrapper = document.getElementById('table-wrapper');
const pagination   = document.getElementById('pagination');
const resultCount  = document.getElementById('result-count');
const filterBadge  = document.getElementById('filter-badge');
const toast        = document.getElementById('toast');

/* ─── THEME LOGIC ────────────────────────────────────────── */
const themeToggle = document.getElementById('theme-toggle');
if(themeToggle) {
  themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('light-theme');
    const isLight = document.body.classList.contains('light-theme');
    localStorage.setItem('alog-theme', isLight ? 'light' : 'dark');
  });
}
// Load saved theme
if(localStorage.getItem('alog-theme') === 'light') {
  document.body.classList.add('light-theme');
}

/* ─── CUSTOM DROPDOWNS & EXPORTS ─────────────────────────── */
const exportBtnDropdown = document.getElementById('export-btn');
const exportDropdownContainer = document.querySelector('.dropdown');

const empBtnDropdown = document.getElementById('emp-dropdown-btn');
const empDropdownContainer = document.getElementById('emp-dropdown-container');

if(exportBtnDropdown) {
  exportBtnDropdown.addEventListener('click', (e) => {
    e.preventDefault();
    exportDropdownContainer.classList.toggle('active');
    if(empDropdownContainer) empDropdownContainer.classList.remove('active');
  });
}

if(empBtnDropdown) {
  empBtnDropdown.addEventListener('click', (e) => {
    e.preventDefault();
    empDropdownContainer.classList.toggle('active');
    if(exportDropdownContainer) exportDropdownContainer.classList.remove('active');
    // Auto focus search when opening
    if(empDropdownContainer.classList.contains('active')) {
      setTimeout(() => document.getElementById('emp-search-input').focus(), 100);
    }
  });
}

// Close dropdowns smoothly when clicking outside
window.addEventListener('click', (e) => {
  if (exportDropdownContainer && !exportDropdownContainer.contains(e.target)) {
    exportDropdownContainer.classList.remove('active');
  }
  if (empDropdownContainer && !empDropdownContainer.contains(e.target)) {
    empDropdownContainer.classList.remove('active');
  }
});

// Employee Search Logic
const empSearchInput = document.getElementById('emp-search-input');
if(empSearchInput) {
  empSearchInput.addEventListener('input', function() {
      const val = this.value.toLowerCase();
      const options = document.querySelectorAll('#emp-options a');
      options.forEach(a => {
          if(a.textContent.toLowerCase().includes(val)) {
              a.style.display = 'block';
          } else {
              a.style.display = 'none';
          }
      });
  });
}

const exportExcelBtn = document.getElementById('export-excel');
if(exportExcelBtn) {
  exportExcelBtn.addEventListener('click', (e) => {
    e.preventDefault(); 
    if(exportDropdownContainer) exportDropdownContainer.classList.remove('active'); 
    exportToExcel();
  });
}

const exportPdfBtn = document.getElementById('export-pdf');
if(exportPdfBtn) {
  exportPdfBtn.addEventListener('click', (e) => {
    e.preventDefault(); 
    if(exportDropdownContainer) exportDropdownContainer.classList.remove('active'); 
    exportToPDF();
  });
}

const exportTxtBtn = document.getElementById('export-txt');
if(exportTxtBtn) {
  exportTxtBtn.addEventListener('click', (e) => {
    e.preventDefault(); 
    if(exportDropdownContainer) exportDropdownContainer.classList.remove('active'); 
    exportToTXT();
  });
}

/* ─── UPLOAD / FILE HANDLING ─────────────────────────────── */
document.getElementById('browse-btn').addEventListener('click', () => fileInput.click());
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) loadFile(fileInput.files[0]);
});

document.getElementById('reset-btn').addEventListener('click', resetApp);
document.getElementById('apply-btn').addEventListener('click', applyFilters);
document.getElementById('clear-btn').addEventListener('click', clearFilters);

// Removed f-search DOM binding to match HTML changes, maintaining robust flow.
document.getElementById('f-date-from').addEventListener('change', scheduleApply);
document.getElementById('f-date-to').addEventListener('change', scheduleApply);

const statusFilter = document.getElementById('f-status');
if (statusFilter) {
  statusFilter.addEventListener('change', applyFilters);
}

/* ─── LOAD & PARSE FILE ──────────────────────────────────── */
function loadFile(file) {
  originalFileName = file.name; 
  loadingBar.style.display = 'block';
  loadingLabel.textContent = `Reading "${file.name}"…`;
  setProgress(10);

  const reader = new FileReader();
  reader.onload = e => {
    originalFileText = e.target.result; 
    setProgress(35);
    loadingLabel.textContent = 'Parsing records…';
    setTimeout(() => {
      try {
        parseFile(originalFileText, file.name);
      } catch (err) {
        alert('Error parsing file:\n' + err.message);
        loadingBar.style.display = 'none';
      }
    }, 30);
  };
  reader.onerror = () => alert('Could not read file. Please try again.');
  reader.readAsText(file, 'UTF-16');
}

function setProgress(pct) {
  progressFill.style.width = pct + '%';
}

/* ─── PARSE RAW TEXT → RAW RECORDS ──────────────────────── */
function parseFile(text, filename) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.split(/\r?\n/);
  const rawRecords = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const p = line.split('\t');
    if (p.length < 9) continue;

    const dateTime = (p[9] || '').trim();
    if (!dateTime) continue;

    const date = dateTime.substring(0, 10);
    const time = dateTime.substring(11, 19);
    const enNo = p[2].trim();
    const name = p[3].trim();
    if (name) {
      const existing = nameMap.get(enNo) || '';
      if (name.length > existing.length) nameMap.set(enNo, name);
    }

    rawRecords.push({
      enNo,
      name,
      mode:      p[5].trim(),
      inOut:     p[6].trim(),
      antipass:  p[7].trim(),
      proxyWork: p[8].trim(),
      date,
      time,
    });
  }

  setProgress(60);
  loadingLabel.textContent = 'Pairing IN / OUT punches…';
  setTimeout(() => {
    const rows = buildAttendanceRows(rawRecords);
    setProgress(85);
    loadingLabel.textContent = 'Building dashboard…';

    setTimeout(() => {
      finalise(rows, filename, rawRecords.length);
    }, 30);
  }, 30);
}

/* ─── BUILD ATTENDANCE ROWS ──────────────────────────────── */
function buildAttendanceRows(rawRecords) {
  const groups = new Map();
  for (const r of rawRecords) {
    const key = r.enNo + '|' + r.date;
    if (!groups.has(key)) {
      groups.set(key, { enNo: r.enNo, date: r.date, punches: [] });
    }
    groups.get(key).punches.push(r);
  }

  const rows = [];
  let srNo = 1;
  const sortedKeys = [...groups.keys()].sort((a, b) => {
    const [, da] = a.split('|');
    const [, db] = b.split('|');
    return da.localeCompare(db) || a.localeCompare(b);
  });

  for (const key of sortedKeys) {
    const { enNo, date, punches } = groups.get(key);
    punches.sort((a, b) => a.time.localeCompare(b.time));

    const inPunches  = punches.filter(p => p.inOut === '1');
    const outPunches = punches.filter(p => p.inOut === '0');
    
    let inTime  = inPunches.length ? inPunches[0].time : null;
    let outTime = outPunches.length ? outPunches[outPunches.length - 1].time : null;

    if (inTime && outTime) {
      if (timeToMinutes(inTime) > timeToMinutes(outTime)) {
        let temp = inTime; inTime = outTime; outTime = temp;
      }
    }
    if (!inTime && outTime) { inTime = outTime; outTime = null; }

    /* ─── ULTIMATE CHRONOLOGICAL OVERRIDE ─── */
    if (punches.length > 0) {
        let actualFirstPunch = punches[0].time;
        let actualLastPunch = punches[punches.length - 1].time;
        inTime = actualFirstPunch; 
        if (punches.length > 1 && timeToMinutes(actualLastPunch) > timeToMinutes(actualFirstPunch)) {
            outTime = actualLastPunch; 
        } else {
            outTime = null; 
        }
    }

    let status;
    if (inTime && outTime)   status = 'both';
    else if (inTime)         status = 'only-in';
    else                     status = 'only-out'; 

    const modeCount = {};
    for (const p of punches) modeCount[p.mode] = (modeCount[p.mode] || 0) + 1;
    const mode = Object.entries(modeCount).sort((a, b) => b[1] - a[1])[0][0];

    const antipass  = punches.some(p => p.antipass  === '1') ? '1' : '0';
    const proxyWork = punches.some(p => p.proxyWork === '1') ? '1' : '0';
    
    let durationMin = null;
    if (inTime && outTime) {
      durationMin = timeToMinutes(outTime) - timeToMinutes(inTime);
      if (durationMin < 0) durationMin = null;
    }

    const name = nameMap.get(enNo) || punches.find(p => p.name)?.name || '';

    rows.push({
      sr:          srNo++,
      enNo,
      name,
      date,
      inTime,
      outTime,
      status,
      mode,
      antipass,
      proxyWork,
      durationMin, // this is saved as a pure Number
      totalPunches: punches.length,
      hasMultiple:  punches.length > 2,
    });
  }
  return rows;
}

/* ─── FINALISE: render UI ────────────────────────────────── */
function finalise(rows, filename, rawCount) {
  allRows      = rows;
  filteredRows = [...rows];
  buildEmployeeDropdown();
  setDefaultDateRange();
  document.getElementById('header-filename').textContent = filename;
  document.getElementById('hdr-total').textContent = rawCount.toLocaleString();
  const uniqueDates = new Set(rows.map(r => r.date));
  document.getElementById('hdr-days').textContent = uniqueDates.size;
  updateStats(rows);
  applyFilters();
  setProgress(100);
  uploadScreen.style.display = 'none';
  app.style.display          = 'flex';
  showToast(`✓ Loaded ${rawCount.toLocaleString()} punches → ${rows.length.toLocaleString()} attendance rows`);
}

function buildEmployeeDropdown() {
  const wrapper = document.getElementById('emp-options');
  if(!wrapper) return;
  wrapper.innerHTML = ''; 

  // Default option
  const defaultOpt = document.createElement('a');
  defaultOpt.href = "#";
  defaultOpt.dataset.val = "";
  defaultOpt.textContent = "All Employees";
  defaultOpt.style.setProperty('--in-delay', `0s`);
  defaultOpt.style.setProperty('--out-delay', `0.2s`);
  wrapper.appendChild(defaultOpt);

  const empMap = new Map();
  for (const r of allRows) {
    if (!empMap.has(r.enNo)) empMap.set(r.enNo, r.name);
    else if (!empMap.get(r.enNo) && r.name) empMap.set(r.enNo, r.name);
  }
  const sorted = [...empMap.entries()].sort((a, b) => {
    const na = (a[1] || 'zzz').toLowerCase();
    const nb = (b[1] || 'zzz').toLowerCase();
    return na.localeCompare(nb);
  });

  let index = 1;
  for (const [enNo, name] of sorted) {
    const opt = document.createElement('a');
    opt.href = "#";
    opt.dataset.val = enNo;
    opt.textContent = `${name || 'Unknown'} (${enNo})`;
    
    // Dynamic stagger calculation (Cap at 0.3s so it doesn't take forever)
    const delay = Math.min(index * 0.02, 0.3);
    opt.style.setProperty('--in-delay', `${delay}s`);
    opt.style.setProperty('--out-delay', `${0.3 - delay}s`);
    
    wrapper.appendChild(opt);
    index++;
  }

  // Bind click logic
  wrapper.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', (e) => {
          e.preventDefault();
          const fEmployee = document.getElementById('f-employee');
          if(fEmployee) fEmployee.value = a.dataset.val;
          
          const empDropdownBtn = document.getElementById('emp-dropdown-btn');
          if(empDropdownBtn) empDropdownBtn.innerHTML = a.dataset.val ? a.textContent + ' ▼' : 'All Employees ▼';
          
          if(empDropdownContainer) empDropdownContainer.classList.remove('active');
          applyFilters();
      });
  });
}

function setDefaultDateRange() {
  const dates = allRows.map(r => r.date).sort();
  if (dates.length) {
    document.getElementById('f-date-from').value = dates[0];
    document.getElementById('f-date-to').value   = dates[dates.length - 1];
  }
}

/* ─── ULTIMATE ACCURATE STATS UPDATER ─── */
function updateStats(rows) {
  const present  = rows.filter(r => r.status === 'both' && !r.isSunday).length;
  const onlyIn   = rows.filter(r => r.status === 'only-in' && !r.isSunday).length;
  const onlyOut  = rows.filter(r => r.status === 'only-out' && !r.isSunday).length;
  const empSet   = new Set(rows.filter(r => !r.isSunday).map(r => r.enNo));
  const dates    = [...new Set(rows.filter(r => !r.isSunday).map(r => r.date))].sort();
  
  // Calculate Total Working Hours explicitly solving the blank rendering
  let totalMins = 0;
  rows.forEach(r => {
      if (!r.isSunday && r.durationMin !== null && r.durationMin !== undefined) {
          totalMins += parseFloat(r.durationMin);
      }
  });
  
  let th = Math.floor(totalMins / 60);
  let tm = Math.round(totalMins % 60);
  // Extremely rare case where JS precision round makes it exactly 60
  if (tm === 60) {
      th += 1;
      tm = 0;
  }
  
  const totalHoursStr = totalMins > 0 ? `${th}h ${tm}m` : '—';
  
  document.getElementById('stat-total').textContent    = rows.filter(r => !r.isSunday).length.toLocaleString();
  document.getElementById('stat-present').textContent  = present.toLocaleString();
  document.getElementById('stat-only-in').textContent  = onlyIn.toLocaleString();
  document.getElementById('stat-only-out').textContent = onlyOut.toLocaleString();
  document.getElementById('stat-emp').textContent      = empSet.size.toLocaleString();
  
  const statHoursEl = document.getElementById('stat-total-hours');
  if (statHoursEl) {
      statHoursEl.textContent = totalHoursStr;
  }
  
  if (dates.length) {
    document.getElementById('stat-daterange').textContent =
      `${formatDate(dates[0])}\n→ ${formatDate(dates[dates.length - 1])}`;
  }
}

function scheduleApply() {
  clearTimeout(applyTimer);
  applyTimer = setTimeout(applyFilters, 280);
}

function applyFilters() {
  const dateFrom = document.getElementById('f-date-from').value;
  const dateTo   = document.getElementById('f-date-to').value;
  
  const fEmployee = document.getElementById('f-employee');
  const employee = fEmployee ? fEmployee.value : '';
  
  const fStatus = document.getElementById('f-status');
  const status   = fStatus ? fStatus.value : '';

  filteredRows = allRows.filter(r => {
    // Redundant text search removed per user request
    if (dateFrom && r.date < dateFrom) return false;
    if (dateTo   && r.date > dateTo)   return false;
    if (employee && r.enNo !== employee) return false;
    if (status   && r.status !== status) return false;
    return true;
  });

  /* ─── INJECT MISSING SUNDAYS DYNAMICALLY ─── */
  if (filteredRows.length > 0) {
    let minDateStr = filteredRows[0].date;
    let maxDateStr = filteredRows[0].date;
    
    for (let i = 1; i < filteredRows.length; i++) {
      if (filteredRows[i].date < minDateStr) minDateStr = filteredRows[i].date;
      if (filteredRows[i].date > maxDateStr) maxDateStr = filteredRows[i].date;
    }

    let currentD = new Date(minDateStr);
    let endD = new Date(maxDateStr);
    currentD.setUTCHours(0,0,0,0);
    endD.setUTCHours(0,0,0,0);

    while (currentD <= endD) {
      if (currentD.getUTCDay() === 0) { 
        let y = currentD.getUTCFullYear();
        let m = String(currentD.getUTCMonth() + 1).padStart(2, '0');
        let d = String(currentD.getUTCDate()).padStart(2, '0');
        let dateStr = `${y}-${m}-${d}`;

        let hasSundayRow = filteredRows.some(r => r.isSunday && r.date === dateStr);
        if (!hasSundayRow) {
           filteredRows.push({
             isSunday: true,
             date: dateStr,
             sr: null,
             enNo: '',
             name: '',
             inTime: '',
             outTime: '',
             durationMin: null,
             status: '',
             antipass: '',
             proxyWork: ''
           });
        }
      }
      currentD.setUTCDate(currentD.getUTCDate() + 1);
    }
  }

  /* ─── APPLY SORTING IF SPECIFIED ─── */
  if (sortCol) {
    filteredRows.sort((a, b) => {
      let va = a[sortCol] ?? '';
      let vb = b[sortCol] ?? '';
      if (sortCol === 'sr' || sortCol === 'durationMin') {
        va = (va === null || va === '') ? -1 : +va;
        vb = (vb === null || vb === '') ? -1 : +vb;
      }
      if (va < vb) return -sortDir;
      if (va > vb) return  sortDir;
      return 0;
    });
  } else {
    // 3rd State logic: Reset back to chronological default
    filteredRows.sort((a, b) => {
        const da = a.date + (a.enNo || '');
        const db = b.date + (b.enNo || '');
        return da.localeCompare(db);
    });
  }

  currentPage = 1;
  updateStats(filteredRows);
  updateFilterBadge('', dateFrom, dateTo, employee, status);
  updateResultCount();
  renderTable();
}

function clearFilters() {
  const fEmployee = document.getElementById('f-employee');
  if(fEmployee) fEmployee.value = '';
  
  const empDropdownBtn = document.getElementById('emp-dropdown-btn');
  if(empDropdownBtn) empDropdownBtn.innerHTML = 'All Employees ▼';
  
  const empSearchInput = document.getElementById('emp-search-input');
  if(empSearchInput) empSearchInput.value = '';
  
  document.querySelectorAll('#emp-options a').forEach(a => a.style.display = 'block');

  const fStatus = document.getElementById('f-status');
  if(fStatus) fStatus.value   = '';
  
  setDefaultDateRange();
  
  // Also clear sorting entirely
  sortCol = '';
  sortDir = 1;
  
  applyFilters();
}

function updateFilterBadge(search, dateFrom, dateTo, employee, status) {
  let count = 0;
  const allDates = allRows.map(r => r.date).sort();
  if (employee) count++;
  if (status)   count++;
  if (allDates.length) {
    if (dateFrom !== allDates[0] || dateTo !== allDates[allDates.length - 1]) count++;
  }
  if (count > 0) {
    filterBadge.style.display = 'inline-flex';
    filterBadge.textContent   = count + ' active';
  } else {
    filterBadge.style.display = 'none';
  }
}

function updateResultCount() {
  const validRows = filteredRows.filter(r => !r.isSunday).length;
  if (validRows === allRows.length) {
    resultCount.innerHTML = `Showing all <b>${allRows.length.toLocaleString()}</b> rows`;
  } else {
    resultCount.innerHTML = `<b>${validRows.toLocaleString()}</b> of ${allRows.length.toLocaleString()} rows`;
  }
}

const COLS = [
  { key: 'sr',          label: 'Sr No',      tip: 'Serial number' },
  { key: 'enNo',        label: 'Enroll No',  tip: 'Enrollment number from machine' },
  { key: 'name',        label: 'Name',       tip: 'Employee name' },
  { key: 'date',        label: 'Date',       tip: 'Attendance date' },
  { key: 'inTime',      label: '⬆ IN Time',  tip: 'First IN punch of the day', grp: true },
  { key: 'outTime',     label: '⬇ OUT Time', tip: 'Last OUT punch of the day' },
  { key: 'durationMin', label: 'Duration',   tip: 'Time between first IN and last OUT' },
  { key: 'status',      label: 'Status',     tip: 'Attendance completeness', grp: true },
  { key: 'antipass',    label: 'Antipass',   tip: 'Antipassback flag' },
  { key: 'proxyWork',   label: 'Proxy',      tip: 'Proxy work flag' },
];

function renderTable() {
  const total = filteredRows.length;
  if (total === 0) {
    tableArea.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-text">No records match your filters</div></div>`;
    pagination.innerHTML = '';
    return;
  }
  const start  = (currentPage - 1) * pageSize;
  const end    = Math.min(start + pageSize, total);
  const page   = filteredRows.slice(start, end);
  let html = '<table><thead><tr>';
  for (const col of COLS) {
    const grpCls  = col.grp ? ' col-group-start' : '';
    // Only display arrows if actively sorting on this column
    const sortCls = sortCol === col.key ? (sortDir === 1 ? ' sort-asc' : ' sort-desc') : '';
    html += `<th class="${grpCls}${sortCls}" data-col="${col.key}" title="${col.tip}">${col.label}</th>`;
  }
  html += '</tr></thead><tbody>';
  for (const r of page) { html += buildRow(r); }
  html += '</tbody></table>';
  tableArea.innerHTML = html;
  
  tableArea.querySelectorAll('thead th[data-col]').forEach(th => {
    th.addEventListener('click', () => sortBy(th.dataset.col));
  });
  renderPagination(total, start, end);
}

function buildRow(r) {
  if (r.isSunday) {
    return `<tr class="sunday-row">
      <td class="td-sr">—</td>
      <td class="td-enno">—</td>
      <td class="td-name">S U N D A Y</td>
      <td class="td-date" style="color:var(--red); font-weight:bold;">${formatDate(r.date)}</td>
      <td colspan="6" style="text-align: center; letter-spacing: 10px;">S U N D A Y &nbsp;&nbsp;&nbsp; S U N D A Y &nbsp;&nbsp;&nbsp; S U N D A Y</td>
    </tr>`;
  }

  const inTd = r.inTime ? `<td class="td-in">${r.inTime}${r.hasMultiple && r.status === 'both' ? '<span class="multi-tag">multi</span>' : ''}</td>` : `<td class="td-in missing">—</td>`;
  const outTd = r.outTime ? `<td class="td-out">${r.outTime}</td>` : `<td class="td-out missing">—</td>`;
  const durTd = r.durationMin !== null ? `<td class="td-duration">${formatDuration(r.durationMin)}</td>` : `<td class="td-duration na">—</td>`;
  let statusBadge = (r.status === 'both') ? `<span class="badge badge-present"><span class="dot dot-green"></span>Present</span>` : (r.status === 'only-in') ? `<span class="badge badge-only-in"><span class="dot dot-amber"></span>Only IN</span>` : `<span class="badge badge-only-out"><span class="dot dot-red"></span>Only OUT</span>`;
  const nameCls = r.name ? 'td-name' : 'td-name no-name';
  
  return `<tr><td class="td-sr">${r.sr}</td><td class="td-enno">${esc(r.enNo)}</td><td class="${nameCls}">${r.name || 'Unknown'}</td><td class="td-date">${formatDate(r.date)}</td>${inTd}${outTd}${durTd}<td class="col-group-start">${statusBadge}</td><td class="${r.antipass === '1' ? 'cell-yes' : 'cell-no'}">${r.antipass === '1' ? 'Yes' : 'No'}</td><td class="${r.proxyWork === '1' ? 'cell-yes' : 'cell-no'}">${r.proxyWork === '1' ? 'Yes' : 'No'}</td></tr>`;
}

/* ─── 3-STATE SORTING LOGIC ─── */
function sortBy(col) {
  if (sortCol === col) {
      if (sortDir === 1) {
          sortDir = -1; // Click 2: Descending
      } else {
          sortCol = ''; // Click 3: Reset
          sortDir = 1;
      }
  } else {
      sortCol = col; // Click 1: Ascending
      sortDir = 1;
  }
  applyFilters();
}

function renderPagination(total, start, end) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) {
    pagination.innerHTML = `<span class="page-info">Showing <b>${start + 1}–${end}</b> of <b>${total.toLocaleString()}</b></span>${pageSizeSelect()}`;
    bindPageSize();
    return;
  }
  const nums = pageNumbers(currentPage, totalPages);
  let html = `<button class="page-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>‹</button>`;
  for (const p of nums) {
    if (p === '…') html += `<span style="color:var(--text3);padding:0 0.2rem">…</span>`;
    else html += `<button class="page-btn ${p === currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`;
  }
  html += `<button class="page-btn" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>›</button>`;
  html += `<span class="page-info" style="margin:0 0.4rem">Showing <b>${start + 1}–${end}</b> of <b>${total.toLocaleString()}</b></span>${pageSizeSelect()}`;
  pagination.innerHTML = html;
  pagination.querySelectorAll('.page-btn[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = parseInt(btn.dataset.page);
      if (p >= 1 && p <= totalPages && !btn.disabled) {
        currentPage = p; renderTable(); tableWrapper.scrollTop = 0;
      }
    });
  });
  bindPageSize();
}

function pageSizeSelect() {
  return `<select class="page-size-select" id="page-size-sel">
    <option value="50" ${pageSize === 50 ? 'selected' : ''}>50 / page</option>
    <option value="100" ${pageSize === 100 ? 'selected' : ''}>100 / page</option>
    <option value="200" ${pageSize === 200 ? 'selected' : ''}>200 / page</option>
    <option value="500" ${pageSize === 500 ? 'selected' : ''}>500 / page</option>
  </select>`;
}

function bindPageSize() {
  const sel = document.getElementById('page-size-sel');
  if (sel) {
    sel.addEventListener('change', () => {
      pageSize = parseInt(sel.value); currentPage = 1; renderTable();
    });
  }
}

function pageNumbers(cur, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [1];
  if (cur > 3) pages.push('…');
  for (let p = Math.max(2, cur - 1); p <= Math.min(total - 1, cur + 1); p++) pages.push(p);
  if (cur < total - 2) pages.push('…');
  pages.push(total);
  return pages;
}

function resetApp() {
  allRows = []; filteredRows = []; nameMap.clear(); originalFileText = ""; originalFileName = "";
  app.style.display = 'none'; uploadScreen.style.display = 'flex';
  loadingBar.style.display = 'none'; fileInput.value = ''; setProgress(0);
}

function timeToMinutes(t) {
  if (!t) return 0;
  const [h, m, s] = t.split(':').map(Number);
  return h * 60 + m + (s || 0) / 60;
}

function formatDuration(mins) {
  if (mins === null || isNaN(mins)) return '—';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

function formatDate(d) {
  if (!d) return '—';
  const [y, mo, day] = d.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(day)} ${months[parseInt(mo) - 1]} ${y}`;
}

function esc(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showToast(msg) {
  toast.textContent = msg; toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3500);
}

/* ─── EXPORT LOGIC ─── */
function getExportData() {
    return filteredRows.map(r => {
        if (r.isSunday) {
            return {
                "Sr No": "---",
                "Enroll No": "---",
                "Name": "S U N D A Y",
                "Date": formatDate(r.date),
                "IN Time": "---",
                "OUT Time": "---",
                "Duration": "---",
                "Status": "SUNDAY",
                "Antipass": "---",
                "Proxy": "---"
            };
        }
        return {
            "Sr No": r.sr,
            "Enroll No": r.enNo,
            "Name": r.name || "Unknown",
            "Date": formatDate(r.date),
            "IN Time": r.inTime || "---",
            "OUT Time": r.outTime || "---",
            "Duration": r.durationMin !== null ? formatDuration(r.durationMin) : "---",
            "Status": r.status === 'both' ? 'Present' : (r.status === 'only-in' ? 'Only IN' : 'Only OUT'),
            "Antipass": r.antipass === '1' ? 'Yes' : 'No',
            "Proxy": r.proxyWork === '1' ? 'Yes' : 'No'
        };
    });
}

function exportToExcel() {
    if(filteredRows.length === 0) return showToast("No data to export!");
    try {
        const ws = XLSX.utils.json_to_sheet(getExportData());
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Attendance");
        XLSX.writeFile(wb, "Attendance_Export.xlsx");
        showToast("Excel downloaded successfully!");
    } catch(e) {
        showToast("Error exporting Excel. Please check internet connection for library.");
    }
}

function exportToPDF() {
    if(filteredRows.length === 0) return showToast("No data to export!");
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const data = getExportData();
        const columns = Object.keys(data[0]);
        const rows = data.map(obj => Object.values(obj));

        doc.text("Attendance Export", 14, 15);
        doc.autoTable({
            head: [columns],
            body: rows,
            startY: 20,
            styles: { fontSize: 8 }
        });
        doc.save("Attendance_Export.pdf");
        showToast("PDF downloaded successfully!");
    } catch(e) {
        showToast("Error exporting PDF. Please check internet connection for library.");
    }
}

function exportToTXT() {
    if(!originalFileText) return showToast("Original file not found!");
    const blob = new Blob([originalFileText], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = originalFileName || "ALOG_Export.txt";
    link.click();
    URL.revokeObjectURL(link.href);
    showToast("Original TXT downloaded successfully!");
}
