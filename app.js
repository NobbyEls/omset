// Dashboard Penjualan Laptop - Live Data Multi-Year (2024, 2025, 2026)
// =========================================================

const DATA_SOURCES = [
    { year: 2024, url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRjuny9-gdftOL5l-uAvSQdIFwsez76bctHX6pjvn8DfTOjF9jgAzlx5UDgllLNasZnNU27WUdHR8MM/pub?gid=539076410&single=true&output=csv", cacheable: true },
    { year: 2025, url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSRqL1HusmRsgCJhR5iic_Ns66d-5WEJNCcHjtuzZQ6i_kUR5tCU9j8laNf9VGKE4cZXjYUWggjpOje/pub?gid=539076410&single=true&output=csv", cacheable: true },
    { year: 2026, url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vR_LC3JSnOjzSp7vfTfaa51oReT8IIy52ZBhloeNwvp9ogx-RGIQjRGxg3o-3wn92Ze-ww0CrMy2Jqm/pub?gid=539076410&single=true&output=csv", cacheable: false }
];

// IndexedDB Cache Configuration
const CACHE_DB_NAME = 'omsetCache';
const CACHE_STORE = 'csvData';
const CACHE_VERSION = 3; // Bump version untuk auto-invalidate cache lama
const CACHE_VERSION_KEY = 'omset_cache_version_v3';

let allData = [];
let filteredData = [];
// Same as filteredData but WITHOUT the year filter applied. Used only by the
// "Trend Penjualan Bulanan — Year over Year" chart so it can always compare
// across all available years regardless of the selected year.
let filteredDataAllYears = [];
let currentPage = 1;
const rowsPerPage = 25;
let charts = {};
let cacheStatus = { 2024: 'unknown', 2025: 'unknown', 2026: 'unknown' };

// Bulan ordering (without year - normalized)
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

// Year colors for comparison
const YEAR_COLORS = { 2024: '#94a3b8', 2025: '#6366f1', 2026: '#ec4899' };

// =========================================================
// INDEXEDDB CACHE HELPERS
// =========================================================

function openCacheDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(CACHE_DB_NAME, CACHE_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(CACHE_STORE)) {
                db.createObjectStore(CACHE_STORE);
            }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

async function getCacheEntry(year) {
    try {
        const db = await openCacheDB();
        return new Promise((resolve) => {
            const tx = db.transaction(CACHE_STORE, 'readonly');
            const req = tx.objectStore(CACHE_STORE).get(`year_${year}`);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        });
    } catch (e) {
        console.warn('Cache read error:', e);
        return null;
    }
}

async function setCacheEntry(year, csvText) {
    try {
        const db = await openCacheDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(CACHE_STORE, 'readwrite');
            tx.objectStore(CACHE_STORE).put({
                csv: csvText,
                timestamp: Date.now(),
                size: csvText.length
            }, `year_${year}`);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    } catch (e) {
        console.warn('Cache write error:', e);
    }
}

async function clearAllCache() {
    try {
        const db = await openCacheDB();
        return new Promise((resolve) => {
            const tx = db.transaction(CACHE_STORE, 'readwrite');
            tx.objectStore(CACHE_STORE).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    } catch (e) {
        console.warn('Cache clear error:', e);
    }
}

// =========================================================
// DATA LOADING - MULTI YEAR with CACHE
// =========================================================

async function loadData(forceRefresh = false) {
    showLoading('Mengecek cache lokal...', 3);
    
    // Auto-invalidate cache lama
    try {
        const storedVersion = localStorage.getItem(CACHE_VERSION_KEY);
        if (!storedVersion || parseInt(storedVersion) < CACHE_VERSION) {
            console.log('Cache version outdated, clearing...');
            await clearAllCache();
            localStorage.setItem(CACHE_VERSION_KEY, String(CACHE_VERSION));
            forceRefresh = true;
        }
    } catch (e) { console.warn('Version check error:', e); }
    
    try {
        allData = [];
        let totalRows = 0;
        
        for (let i = 0; i < DATA_SOURCES.length; i++) {
            const src = DATA_SOURCES[i];
            const baseProgress = 5 + (i * 30);
            let csvText = null;
            let fromCache = false;
            
            // Try cache first if cacheable & not forcing refresh
            if (src.cacheable && !forceRefresh) {
                const cached = await getCacheEntry(src.year);
                if (cached && cached.csv) {
                    csvText = cached.csv;
                    fromCache = true;
                    cacheStatus[src.year] = 'cached';
                    showLoading(`Memuat ${src.year} dari cache (${(csvText.length / 1024 / 1024).toFixed(1)} MB)...`, baseProgress + 10);
                }
            }
            
            // Fetch from network if not cached
            if (!csvText) {
                showLoading(`Mengunduh data ${src.year}...`, baseProgress);
                const response = await fetch(src.url);
                if (!response.ok) throw new Error(`Gagal fetch CSV ${src.year}`);
                
                showLoading(`Memuat ${src.year}...`, baseProgress + 10);
                csvText = await response.text();
                
                cacheStatus[src.year] = src.cacheable ? 'fresh-cached' : 'fresh';
                
                if (src.cacheable) {
                    showLoading(`Menyimpan ${src.year} ke cache...`, baseProgress + 15);
                    await setCacheEntry(src.year, csvText);
                }
            }
            
            showLoading(`Parsing data ${src.year}${fromCache ? ' (cached)' : ''}...`, baseProgress + 20);
            const parsed = Papa.parse(csvText, {
                header: true,
                skipEmptyLines: true,
                dynamicTyping: false
            });
            
            const yearData = parsed.data
                .filter(row => row['Tgl.'] && row['Brand'] && row['Brand'] !== '#N/A')
                .map(row => {
                    const bulan = row['Bulan'] || '';
                    const monthName = bulan.split('-')[0];
                    return {
                        tgl: row['Tgl.'] || '',
                        bulan: bulan,
                        bulanName: monthName,
                        tahun: src.year,
                        noDoc: row['No Dok.'] || '',
                        kodeGudang: row['Kode Gudang'] || '',
                        kodeBarang: row['Kode Barang'] || '',
                        namaBarang: row['Nama Barang'] || '',
                        qty: parseNumber(row['Qty*']),
                        harga: parseNumber(row['Harga']) || 0,
                        total: parseNumber(row['Total (IDR)']) || 0,
                        kodeSales: row['Kode Sales'] || '',
                        cekKota: row['Cek Kota'] || '',
                        cekGaming: (row['Cek Gaming'] || '').trim(),
                        typeLaptop: row['Type Laptop'] || '',
                        proc: row['Proc'] || '',
                        seriProc: row['Seri Proc'] || '',
                        seriProc2: row['Seri Proc 2'] || '',
                        brand: row['Brand'] || '',
                        brand2: row['Brand 2'] || '',
                        cekHarga: row['Cek Harga'] || '',
                        cekHargaNon: row['Cek Harga NON'] || '',
                        cekJutaa: parseNumber(row['Cek Jutaa']) || 0,
                        vga: row['VGA'] || '',
                        week: parseNumber(row['WEEK']) || 0,
                        procLengkap: row['Processor lengkap'] || '',
                        divisi: (row['Divisi'] || '').trim()
                    };
                })
                .filter(d => d.bulan && d.bulan !== '#NUM!' && d.cekKota && d.cekKota !== '#N/A' && MONTH_NAMES.includes(d.bulanName));
            
            allData = allData.concat(yearData);
            totalRows += yearData.length;
        }
        
        showLoading(`Berhasil load ${totalRows.toLocaleString('id-ID')} transaksi dari 3 tahun`, 95);
        
        await new Promise(r => setTimeout(r, 200));
        
        populateFilters();
        applyFilters();
        updateLastUpdate();
        updateCacheStatusUI();
        
        showLoading('Selesai!', 100);
        await new Promise(r => setTimeout(r, 200));
        hideLoading();
        
    } catch (err) {
        console.error('Error loading data:', err);
        showLoadingError('Gagal memuat data. Cek koneksi internet & URL CSV.');
    }
}

function parseNumber(val) {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    // Remove dots (thousand separator), replace comma with dot, then parse
    const cleaned = String(val).replace(/\./g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
}

// Normalize processor brand (kolom U) - fix typos & inkonsistensi kapitalisasi
function normalizeProc(val) {
    if (!val) return '';
    const upper = val.toUpperCase();
    if (upper === 'INTEL') return 'Intel';
    if (upper === 'AMD' || upper === 'AMD') return 'Amd';
    if (upper === 'APPLE') return 'Apple';
    if (upper === 'SNAPDRAGON') return 'Snapdragon';
    return val;
}

function showLoading(status, progress) {
    document.getElementById('loadingStatus').textContent = status;
    document.getElementById('progressFill').style.width = progress + '%';
    document.getElementById('loadingDetail').textContent = '';
}

function showLoadingError(msg) {
    document.getElementById('loadingStatus').textContent = 'Error';
    document.getElementById('loadingDetail').textContent = msg;
    document.getElementById('progressFill').style.background = '#ef4444';
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.add('hidden');
}

function showLoadingAgain() {
    document.getElementById('loadingOverlay').classList.remove('hidden');
}

function updateLastUpdate() {
    const now = new Date();
    const time = now.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
    document.getElementById('lastUpdateText').textContent = time;
}

function updateCacheStatusUI() {
    const el = document.getElementById('cacheStatus');
    if (!el) return;
    
    const statusBadge = (year) => {
        const status = cacheStatus[year];
        let cls, text;
        if (status === 'cached') {
            cls = 'cache-badge cache-cached';
            text = `${year} ⚡`;
        } else if (status === 'fresh-cached') {
            cls = 'cache-badge cache-fresh-cached';
            text = `${year} 💾`;
        } else if (status === 'fresh') {
            cls = 'cache-badge cache-fresh';
            text = `${year} 🔴`;
        } else {
            cls = 'cache-badge';
            text = `${year}`;
        }
        return `<span class="${cls}" title="${cacheStatusLabel(status)}">${text}</span>`;
    };
    
    el.innerHTML = [2024, 2025, 2026].map(statusBadge).join('');
}

function cacheStatusLabel(status) {
    return {
        'cached': 'Loaded dari cache lokal (cepat)',
        'fresh-cached': 'Baru di-fetch dan disimpan ke cache',
        'fresh': 'Live data (tidak di-cache)',
        'unknown': 'Belum dimuat'
    }[status] || '';
}

// =========================================================
// FILTERS
// =========================================================

function populateFilters() {
    populateYearFilter();
    populateSelect('filterBulan', getUniqueSorted('bulanName', MONTH_NAMES));
    populateSelect('filterKota', getUniqueSorted('cekKota'));
    populateSelect('filterBrand', getUniqueSorted('brand'));
    populateSelect('filterDivisi', getUniqueSorted('divisi'));
}

// Returns the most recent year present in the data (as a string), or '' if none.
function getLatestYear() {
    const years = getUniqueSorted('tahun').map(Number).filter(n => !Number.isNaN(n));
    return years.length ? String(Math.max(...years)) : '';
}

// The year filter has NO "Semua Tahun" option — only individual years,
// listed oldest-first (newest at the bottom), defaulting to the latest year.
function populateYearFilter() {
    const select = document.getElementById('filterTahun');
    if (!select) return;
    const years = getUniqueSorted('tahun').map(Number).filter(n => !Number.isNaN(n)).sort((a, b) => a - b);
    select.innerHTML = '';
    years.forEach(y => {
        const o = document.createElement('option');
        o.value = String(y);
        o.textContent = String(y);
        select.appendChild(o);
    });
    if (years.length) select.value = String(years[years.length - 1]); // default = latest year (last in list)
}

function getUniqueSorted(field, customOrder) {
    const unique = [...new Set(allData.map(d => d[field]).filter(Boolean))];
    if (customOrder) {
        return unique.sort((a, b) => {
            const ia = customOrder.indexOf(a);
            const ib = customOrder.indexOf(b);
            if (ia === -1 && ib === -1) return a.localeCompare(b);
            if (ia === -1) return 1;
            if (ib === -1) return -1;
            return ia - ib;
        });
    }
    return unique.sort();
}

function populateSelect(id, options) {
    const select = document.getElementById(id);
    // Keep first option (Semua/all)
    const first = select.firstElementChild.outerHTML;
    select.innerHTML = first;
    options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        select.appendChild(o);
    });
}

function applyFilters() {
    const fTahun = document.getElementById('filterTahun').value;
    const fBulan = document.getElementById('filterBulan').value;
    const fKota = document.getElementById('filterKota').value;
    const fBrand = document.getElementById('filterBrand').value;
    const fKategori = document.getElementById('filterKategori').value;
    const fDivisi = document.getElementById('filterDivisi').value;
    const fProc = document.getElementById('filterProc').value;
    const search = (document.getElementById('searchTable')?.value || '').toLowerCase();

    filteredData = allData.filter(d => {
        if (fTahun !== 'all' && String(d.tahun) !== fTahun) return false;
        if (fBulan !== 'all' && d.bulanName !== fBulan) return false;
        if (fKota !== 'all' && d.cekKota !== fKota) return false;
        if (fBrand !== 'all' && d.brand !== fBrand) return false;
        if (fKategori !== 'all' && d.cekGaming !== fKategori) return false;
        if (fDivisi !== 'all' && d.divisi !== fDivisi) return false;
        if (fProc !== 'all' && d.proc !== fProc) return false;
        if (search) {
            const hay = `${d.namaBarang} ${d.kodeSales} ${d.noDoc} ${d.brand}`.toLowerCase();
            if (!hay.includes(search)) return false;
        }
        return true;
    });

    // Same filters EXCEPT the year — feeds the YoY trend chart so it always
    // compares across every available year.
    filteredDataAllYears = allData.filter(d => {
        if (fBulan !== 'all' && d.bulanName !== fBulan) return false;
        if (fKota !== 'all' && d.cekKota !== fKota) return false;
        if (fBrand !== 'all' && d.brand !== fBrand) return false;
        if (fKategori !== 'all' && d.cekGaming !== fKategori) return false;
        if (fDivisi !== 'all' && d.divisi !== fDivisi) return false;
        if (fProc !== 'all' && d.proc !== fProc) return false;
        if (search) {
            const hay = `${d.namaBarang} ${d.kodeSales} ${d.noDoc} ${d.brand}`.toLowerCase();
            if (!hay.includes(search)) return false;
        }
        return true;
    });

    currentPage = 1;
    // Render each major section independently — a failure in one cannot stop the others.
    const safeRender = (fn, name) => {
        try { fn(); }
        catch (e) { console.error('applyFilters() render failed in:', name, e); }
    };
    safeRender(updateKPIs, 'updateKPIs');
    safeRender(renderCharts, 'renderCharts');
    safeRender(renderMarketshareTable, 'renderMarketshareTable');
}

function resetFilters() {
    document.getElementById('filterTahun').value = getLatestYear();
    document.getElementById('filterBulan').value = 'all';
    document.getElementById('filterKota').value = 'all';
    document.getElementById('filterBrand').value = 'all';
    document.getElementById('filterKategori').value = 'all';
    document.getElementById('filterDivisi').value = 'all';
    document.getElementById('filterProc').value = 'all';
    const searchEl = document.getElementById('searchTable');
    if (searchEl) searchEl.value = '';
    applyFilters();
}

// =========================================================
// FORMATTING
// =========================================================

function formatCurrency(num) {
    return 'Rp ' + Math.round(num).toLocaleString('id-ID');
}

function formatCurrencyShort(num) {
    if (num >= 1000000000) return 'Rp ' + (num / 1000000000).toFixed(2) + ' M';
    if (num >= 1000000) return 'Rp ' + (num / 1000000).toFixed(1) + ' Jt';
    if (num >= 1000) return 'Rp ' + (num / 1000).toFixed(0) + ' Rb';
    return 'Rp ' + Math.round(num).toLocaleString('id-ID');
}

// Format dari nilai sudah-dalam-juta:
// - Jika >= 1000 juta (1 milyar): tampil sebagai Milyar
// - Else: tampil sebagai Juta
function formatJutaSmart(jutaValue) {
    if (Math.abs(jutaValue) >= 1000) {
        return 'Rp ' + (jutaValue / 1000).toFixed(2) + ' M';
    }
    return 'Rp ' + jutaValue.toFixed(1) + ' Jt';
}

// Format axis tick: dari nilai juta, tampil singkat
function formatJutaAxis(jutaValue) {
    if (Math.abs(jutaValue) >= 1000) {
        return 'Rp ' + (jutaValue / 1000).toFixed(1) + ' M';
    }
    return 'Rp ' + jutaValue + ' Jt';
}

function formatNumber(num) {
    return num.toLocaleString('id-ID');
}

// =========================================================
// KPI
// =========================================================

function updateKPIs() {
    // KPI section dihapus - tidak ada yang di-update
    return;
}

function updateGrowthBadges() {
    return; // KPI section removed
}

function sumField(data, field) {
    return data.reduce((s, d) => s + (d[field] || 0), 0);
}

function setGrowth(elementId, current, previous, label) {
    const el = document.getElementById(elementId);
    if (!el) return;
    
    if (previous === 0 || current === 0) {
        el.innerHTML = `<span class="trend-neutral">${label}: data tidak tersedia</span>`;
        return;
    }
    
    const growth = ((current - previous) / previous) * 100;
    const isPositive = growth >= 0;
    const arrow = isPositive ? '▲' : '▼';
    const cls = isPositive ? 'trend-up' : 'trend-down';
    el.innerHTML = `<span class="${cls}">${arrow} ${Math.abs(growth).toFixed(1)}%</span> <span class="trend-label">${label}</span>`;
}

function aggregateBy(data, key, sumField) {
    const out = {};
    data.forEach(d => {
        const k = d[key] || '(kosong)';
        out[k] = (out[k] || 0) + (d[sumField] || 0);
    });
    return out;
}

// =========================================================
// CHARTS
// =========================================================

let currentTopProdCategory = 'all';
let currentTrendMetric = 'qty'; // 'qty' | 'value' (total omset) for the YoY trend chart

const COLORS = [
    '#6366f1', '#ec4899', '#10b981', '#f59e0b', '#06b6d4',
    '#a855f7', '#3b82f6', '#f43f5e', '#84cc16', '#0ea5e9',
    '#8b5cf6', '#22d3ee', '#fb923c', '#34d399', '#e879f9',
    '#fbbf24', '#60a5fa', '#f472b6', '#a3e635', '#2dd4bf'
];

// =========================================================
// THEME (light / dark)
// =========================================================
const THEME_KEY = 'omset_theme';

function isLightTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light';
}

// Grid line color for chart axes — evaluated at chart render time so it
// reflects the current theme whenever charts are (re)rendered.
function gridColor() {
    return isLightTheme() ? 'rgba(15, 23, 42, 0.08)' : 'rgba(255, 255, 255, 0.04)';
}

// Apply theme-dependent colors to Chart.js global defaults.
function applyChartThemeColors() {
    const light = isLightTheme();
    Chart.defaults.color = light ? '#475569' : '#e2e8f0';
    Chart.defaults.borderColor = light ? 'rgba(15, 23, 42, 0.08)' : 'rgba(255, 255, 255, 0.06)';
    Chart.defaults.plugins.tooltip.backgroundColor = light ? 'rgba(255, 255, 255, 0.97)' : 'rgba(15, 20, 36, 0.95)';
    Chart.defaults.plugins.tooltip.titleColor = light ? '#0f172a' : '#f1f5f9';
    Chart.defaults.plugins.tooltip.bodyColor = light ? '#334155' : '#f1f5f9';
    Chart.defaults.plugins.tooltip.borderColor = light ? 'rgba(15, 23, 42, 0.12)' : 'rgba(255, 255, 255, 0.1)';
}

// Switch theme, persist it, update charts and the toggle button.
function setTheme(theme) {
    if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ }
    updateThemeButton();
    applyChartThemeColors();
    // Re-render charts so baked-in colors (grid, ticks, tooltip) match the theme.
    if (filteredData && filteredData.length) {
        renderCharts();
    }
}

function toggleTheme() {
    setTheme(isLightTheme() ? 'dark' : 'light');
}

// Keep the toggle button's tooltip in sync (icon swap is handled by CSS).
function updateThemeButton() {
    const btn = document.getElementById('btnTheme');
    if (!btn) return;
    btn.title = isLightTheme() ? 'Ganti ke tema gelap' : 'Ganti ke tema terang';
}

// Configure Chart.js global defaults for dark theme
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.06)';
Chart.defaults.font.family = "'Inter', -apple-system, sans-serif";
Chart.defaults.font.size = 12;
Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(15, 20, 36, 0.95)';
Chart.defaults.plugins.tooltip.titleColor = '#f1f5f9';
Chart.defaults.plugins.tooltip.bodyColor = '#cbd5e1';
Chart.defaults.plugins.tooltip.borderColor = 'rgba(255, 255, 255, 0.1)';
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.padding = 12;
Chart.defaults.plugins.tooltip.cornerRadius = 8;
Chart.defaults.plugins.tooltip.titleFont = { weight: '600', size: 13 };
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.padding = 14;
// Override the static defaults above with theme-aware colors (handles light mode on load).
applyChartThemeColors();

// Register chartjs-plugin-datalabels per-chart on doughnut charts only.
// Datalabels are disabled (display: false) on all doughnut charts;
// legend & tooltip remain active. ChartDataLabels is NOT registered
// globally, so bar/line/stacked charts never show labels.

// Stamp the currently selected year onto every per-year chart title.
// Titles of YoY charts (which span all years) are intentionally left alone.
function updateChartTitleYears() {
    const year = document.getElementById('filterTahun')?.value || '';
    document.querySelectorAll('[data-title-year]').forEach(el => {
        el.textContent = year ? ` — ${year}` : '';
    });
}

function renderCharts() {
    updateChartTitleYears();
    renderTrendChart();
    renderYoYRevenueChart();
    renderYoYBrandChart();
    renderYoYKotaChart();
    renderBrandChart();
    renderKotaChart();
    renderGamingChart();
    renderHargaChart();
    renderProcChart();
    renderDivisiChart();
    renderSalesChart();
    renderSeriProcChart();
    renderRevenueBrandChart();
    renderTopProductsChart();
    renderProcStackedChart();
}

function destroyChart(name) {
    if (charts[name]) charts[name].destroy();
}

function makeBarChart(canvasId, labels, data, label, colors, opts = {}) {
    return new Chart(document.getElementById(canvasId), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label,
                data,
                backgroundColor: colors,
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: opts.yTicks || {},
                    grid: { color: gridColor() }
                },
                x: {
                    grid: { display: false }
                }
            },
            ...opts.chartOpts
        }
    });
}

function renderTrendChart() {
    destroyChart('trend');

    const isValue = currentTrendMetric === 'value';

    // Group by year+month for trend - separate dataset per year.
    // Uses filteredDataAllYears so the year filter does NOT limit this chart;
    // all other active filters still apply.
    const yearMonths = {};
    filteredDataAllYears.forEach(d => {
        if (!yearMonths[d.tahun]) yearMonths[d.tahun] = {};
        if (!yearMonths[d.tahun][d.bulanName]) yearMonths[d.tahun][d.bulanName] = { qty: 0, revenue: 0 };
        yearMonths[d.tahun][d.bulanName].qty += d.qty;
        yearMonths[d.tahun][d.bulanName].revenue += d.total;
    });
    
    const years = Object.keys(yearMonths).sort();
    const labels = MONTH_NAMES;

    // Keep the subtitle in sync with the selected metric
    const subEl = document.getElementById('trendSubtitle');
    if (subEl) {
        subEl.textContent = (isValue
            ? 'Perbandingan total omset (Juta IDR) per bulan: '
            : 'Perbandingan unit terjual per bulan: ') + years.join(' vs ');
    }

    const datasets = [];
    years.forEach((year, idx) => {
        const color = YEAR_COLORS[year] || COLORS[idx % COLORS.length];
        datasets.push({
            label: `${year} - ${isValue ? 'Value' : 'Unit'}`,
            data: labels.map(m => {
                const cell = yearMonths[year][m];
                if (!cell) return null;
                return isValue ? cell.revenue / 1000000 : cell.qty;
            }),
            borderColor: color,
            backgroundColor: 'transparent',
            yAxisID: 'y',
            tension: 0.4,
            fill: false,
            borderWidth: 2.5,
            pointBackgroundColor: color,
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 7,
            spanGaps: true
        });
    });

    charts.trend = new Chart(document.getElementById('chartTrend'), {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: { position: 'top', align: 'end' },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            if (ctx.parsed.y == null) return `${ctx.dataset.label}: -`;
                            return `${ctx.dataset.label}: ` + (isValue
                                ? formatJutaSmart(ctx.parsed.y)
                                : formatNumber(ctx.parsed.y) + ' unit');
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: isValue ? 'Revenue (Juta IDR)' : 'Unit Terjual' },
                    ticks: isValue ? { callback: v => formatJutaAxis(v) } : {},
                    grid: { color: gridColor() }
                },
                x: { grid: { color: gridColor() } }
            }
        }
    });
}

function renderYoYRevenueChart() {
    destroyChart('yoyRev');
    
    // Always compares across all years — ignores the year filter (other filters apply).
    const yearMonths = {};
    filteredDataAllYears.forEach(d => {
        if (!yearMonths[d.tahun]) yearMonths[d.tahun] = {};
        if (!yearMonths[d.tahun][d.bulanName]) yearMonths[d.tahun][d.bulanName] = 0;
        yearMonths[d.tahun][d.bulanName] += d.total;
    });
    
    const years = Object.keys(yearMonths).sort();
    const labels = MONTH_NAMES;
    
    const datasets = years.map((year, idx) => {
        const color = YEAR_COLORS[year] || COLORS[idx % COLORS.length];
        return {
            label: String(year),
            data: labels.map(m => yearMonths[year][m] ? yearMonths[year][m] / 1000000 : 0),
            backgroundColor: color + 'cc',
            borderColor: color,
            borderWidth: 1,
            borderRadius: 6,
            borderSkipped: false
        };
    });

    charts.yoyRev = new Chart(document.getElementById('chartYoYRevenue'), {
        type: 'bar',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: { position: 'top', align: 'end' },
                tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatJutaSmart(ctx.raw)}` } }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: v => formatJutaAxis(v) },
                    grid: { color: gridColor() },
                    title: { display: true, text: 'Revenue' }
                },
                x: { grid: { display: false } }
            }
        }
    });
}

function renderYoYBrandChart() {
    destroyChart('yoyBrand');
    
    // Top 8 brands aggregated across all years — ignores the year filter (other filters apply).
    const brandTotal = {};
    filteredDataAllYears.forEach(d => { brandTotal[d.brand] = (brandTotal[d.brand] || 0) + d.qty; });
    const topBrands = Object.entries(brandTotal).sort((a, b) => b[1] - a[1]).slice(0, 8).map(s => s[0]);
    
    // Group by brand+year
    const brandYear = {};
    topBrands.forEach(b => brandYear[b] = {});
    filteredDataAllYears.forEach(d => {
        if (topBrands.includes(d.brand)) {
            brandYear[d.brand][d.tahun] = (brandYear[d.brand][d.tahun] || 0) + d.qty;
        }
    });
    
    const years = [...new Set(filteredDataAllYears.map(d => d.tahun))].sort();
    
    const datasets = years.map((year, idx) => {
        const color = YEAR_COLORS[year] || COLORS[idx % COLORS.length];
        return {
            label: String(year),
            data: topBrands.map(b => brandYear[b][year] || 0),
            backgroundColor: color + 'cc',
            borderColor: color,
            borderWidth: 1,
            borderRadius: 6,
            borderSkipped: false
        };
    });

    charts.yoyBrand = new Chart(document.getElementById('chartYoYBrand'), {
        type: 'bar',
        data: { labels: topBrands, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: { legend: { position: 'top', align: 'end' } },
            scales: {
                y: { beginAtZero: true, grid: { color: gridColor() } },
                x: { grid: { display: false } }
            }
        }
    });
}

function renderYoYKotaChart() {
    destroyChart('yoyKota');
    
    // Always compares across all years — ignores the year filter (other filters apply).
    const kotaYear = {};
    filteredDataAllYears.forEach(d => {
        if (!kotaYear[d.cekKota]) kotaYear[d.cekKota] = {};
        kotaYear[d.cekKota][d.tahun] = (kotaYear[d.cekKota][d.tahun] || 0) + d.qty;
    });
    
    const kotas = Object.keys(kotaYear).sort();
    const years = [...new Set(filteredDataAllYears.map(d => d.tahun))].sort();
    
    const datasets = years.map((year, idx) => {
        const color = YEAR_COLORS[year] || COLORS[idx % COLORS.length];
        return {
            label: String(year),
            data: kotas.map(k => kotaYear[k][year] || 0),
            backgroundColor: color + 'cc',
            borderColor: color,
            borderWidth: 1,
            borderRadius: 6,
            borderSkipped: false
        };
    });

    charts.yoyKota = new Chart(document.getElementById('chartYoYKota'), {
        type: 'bar',
        data: { labels: kotas, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: { legend: { position: 'top', align: 'end' } },
            scales: {
                y: { beginAtZero: true, grid: { color: gridColor() } },
                x: { grid: { display: false } }
            }
        }
    });
}

function renderBrandChart() {
    destroyChart('brand');
    const data = aggregateBy(filteredData, 'brand', 'qty');
    const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]);
    charts.brand = makeBarChart('chartBrand', sorted.map(s => s[0]), sorted.map(s => s[1]),
        'Unit', sorted.map((_, i) => COLORS[i % COLORS.length]));
}

function renderKotaChart() {
    destroyChart('kota');
    const data = aggregateBy(filteredData, 'cekKota', 'qty');
    const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]);
    charts.kota = makeBarChart('chartKota', sorted.map(s => s[0]), sorted.map(s => s[1]),
        'Unit', sorted.map((_, i) => COLORS[i % COLORS.length]));
}

function renderGamingChart() {
    destroyChart('gaming');
    const data = aggregateBy(filteredData, 'cekGaming', 'qty');
    charts.gaming = new Chart(document.getElementById('chartGaming'), {
        type: 'doughnut',
        plugins: [ChartDataLabels],
        data: {
            labels: Object.keys(data),
            datasets: [{
                data: Object.values(data),
                backgroundColor: ['#f43f5e', '#3b82f6', '#10b981'],
                borderWidth: 0,
                borderColor: 'transparent',
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            cutout: '65%',
            layout: { padding: 30 },
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = ((ctx.raw / total) * 100).toFixed(1);
                            return `${ctx.label}: ${formatNumber(ctx.raw)} unit (${pct}%)`;
                        }
                    }
                },
                datalabels: { display: false }
            }
        }
    });
}

function renderHargaChart() {
    destroyChart('harga');
    const data = aggregateBy(filteredData, 'cekHargaNon', 'qty');
    const order = ['Dibawah 5 Juta', '5 Juta - 10 Juta', '10 Juta - 15 Juta', '15 Juta - 20 Juta', 'Diatas 20 Juta'];
    const sorted = order.filter(o => data[o]).map(o => [o, data[o]]);
    Object.entries(data).forEach(([k, v]) => {
        if (!order.includes(k)) sorted.push([k, v]);
    });
    charts.harga = makeBarChart('chartHarga', sorted.map(s => s[0]), sorted.map(s => s[1]),
        'Unit', ['#10b981', '#3b82f6', '#f59e0b', '#ec4899', '#a855f7', '#06b6d4']);
}

function renderProcChart() {
    destroyChart('proc');
    const data = aggregateBy(filteredData, 'proc', 'qty');
    charts.proc = new Chart(document.getElementById('chartProc'), {
        type: 'doughnut',
        plugins: [ChartDataLabels],
        data: {
            labels: Object.keys(data),
            datasets: [{
                data: Object.values(data),
                backgroundColor: ['#6366f1', '#f43f5e', '#10b981', '#a855f7'],
                borderWidth: 0,
                borderColor: 'transparent',
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            cutout: '65%',
            layout: { padding: 30 },
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = ((ctx.raw / total) * 100).toFixed(1);
                            return `${ctx.label}: ${formatNumber(ctx.raw)} unit (${pct}%)`;
                        }
                    }
                },
                datalabels: { display: false }
            }
        }
    });
}

function renderDivisiChart() {
    destroyChart('divisi');
    const data = aggregateBy(filteredData, 'divisi', 'qty');
    const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]);
    charts.divisi = new Chart(document.getElementById('chartDivisi'), {
        type: 'doughnut',
        plugins: [ChartDataLabels],
        data: {
            labels: sorted.map(s => s[0]),
            datasets: [{
                data: sorted.map(s => s[1]),
                backgroundColor: ['#6366f1', '#f59e0b', '#10b981', '#a855f7', '#f43f5e'],
                borderWidth: 0,
                borderColor: 'transparent',
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            cutout: '65%',
            layout: { padding: 30 },
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = ((ctx.raw / total) * 100).toFixed(1);
                            return `${ctx.label}: ${formatNumber(ctx.raw)} unit (${pct}%)`;
                        }
                    }
                },
                datalabels: { display: false }
            }
        }
    });
}

function renderSalesChart() {
    destroyChart('sales');
    const data = aggregateBy(filteredData, 'kodeSales', 'total');
    const sorted = Object.entries(data).filter(s => s[0]).sort((a, b) => b[1] - a[1]).slice(0, 15);
    
    charts.sales = new Chart(document.getElementById('chartSales'), {
        type: 'bar',
        data: {
            labels: sorted.map(s => s[0].replace('SYK-', '')),
            datasets: [{
                label: 'Revenue',
                data: sorted.map(s => s[1] / 1000000),
                backgroundColor: ctx => {
                    const c = ctx.chart.ctx;
                    const g = c.createLinearGradient(0, 0, c.canvas.width, 0);
                    g.addColorStop(0, '#6366f1');
                    g.addColorStop(1, '#ec4899');
                    return g;
                },
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index', axis: 'y' },
            hover: { intersect: false, mode: 'index', axis: 'y' },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => formatJutaSmart(ctx.raw) } }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: { callback: v => formatJutaAxis(v) },
                    grid: { color: gridColor() }
                },
                y: { grid: { display: false } }
            }
        }
    });
}

function renderSeriProcChart() {
    destroyChart('seriProc');
    const data = aggregateBy(filteredData, 'seriProc', 'qty');
    const sorted = Object.entries(data).filter(s => s[0]).sort((a, b) => b[1] - a[1]);
    charts.seriProc = makeBarChart('chartSeriProc', sorted.map(s => s[0]), sorted.map(s => s[1]),
        'Unit', sorted.map((_, i) => COLORS[i % COLORS.length]));
}

function renderRevenueBrandChart() {
    destroyChart('revBrand');
    const data = aggregateBy(filteredData, 'brand', 'total');
    const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]);
    charts.revBrand = new Chart(document.getElementById('chartRevenueBrand'), {
        type: 'bar',
        data: {
            labels: sorted.map(s => s[0]),
            datasets: [{
                label: 'Revenue',
                data: sorted.map(s => s[1] / 1000000),
                backgroundColor: ctx => {
                    const c = ctx.chart.ctx;
                    const g = c.createLinearGradient(0, 0, 0, 400);
                    g.addColorStop(0, '#10b981');
                    g.addColorStop(1, '#06b6d4');
                    return g;
                },
                borderRadius: 8,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => formatJutaSmart(ctx.raw) } }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: v => formatJutaAxis(v) },
                    grid: { color: gridColor() }
                },
                x: { grid: { display: false } }
            }
        }
    });
}

function renderTopProductsChart() {
    destroyChart('topProd');
    
    // Apply top products filters
    let topProdData = filteredData;
    if (currentTopProdCategory !== 'all') {
        topProdData = topProdData.filter(d => d.cekGaming === currentTopProdCategory);
    }
    
    const data = aggregateBy(topProdData, 'namaBarang', 'qty');
    const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, 15);
    charts.topProd = new Chart(document.getElementById('chartTopProducts'), {
        type: 'bar',
        data: {
            labels: sorted.map(s => s[0].length > 50 ? s[0].substring(0, 50) + '...' : s[0]),
            datasets: [{
                label: 'Unit Terjual',
                data: sorted.map(s => s[1]),
                backgroundColor: ctx => {
                    const c = ctx.chart.ctx;
                    const g = c.createLinearGradient(0, 0, c.canvas.width, 0);
                    g.addColorStop(0, '#a855f7');
                    g.addColorStop(1, '#ec4899');
                    return g;
                },
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index', axis: 'y' },
            hover: { intersect: false, mode: 'index', axis: 'y' },
            plugins: { legend: { display: false } },
            scales: {
                x: { beginAtZero: true, grid: { color: gridColor() } },
                y: { grid: { display: false } }
            }
        }
    });
}

// renderProcStackedChart() lives in procview.js — it renders the
// "Marketshare Brand Processor per Bulan" chart and supports the
// Bar / Garis / Area chart-type toggle. It uses the globals defined here
// (filteredData, MONTH_NAMES, charts, destroyChart, gridColor,
// currentProcStackedCategory).

// =========================================================
// TABLE
// =========================================================

function renderTable() {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return; // Section dihapus
    const totalPages = Math.max(1, Math.ceil(filteredData.length / rowsPerPage));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * rowsPerPage;
    const end = start + rowsPerPage;
    const page = filteredData.slice(start, end);

    let html = '';
    page.forEach((d, i) => {
        const gamingBadge = d.cekGaming === 'GAMING'
            ? '<span class="badge badge-gaming">Gaming</span>'
            : '<span class="badge badge-nongaming">Non Gaming</span>';
        const divisiClass = {
            'Retail': 'badge-retail',
            'Online': 'badge-online',
            'Distribusi': 'badge-distribusi',
            'Project': 'badge-project'
        }[d.divisi] || 'badge-retail';
        const divisiBadge = `<span class="badge ${divisiClass}">${d.divisi}</span>`;
        const yearBadge = `<span class="badge badge-year-${d.tahun}">${d.tahun}</span>`;

        html += `
            <tr>
                <td>${start + i + 1}</td>
                <td>${yearBadge}</td>
                <td>${d.tgl}</td>
                <td class="mono small">${d.noDoc}</td>
                <td>${d.cekKota}</td>
                <td class="nama-barang">${escapeHtml(d.namaBarang)}</td>
                <td><strong>${d.brand}</strong></td>
                <td class="num">${formatCurrency(d.harga)}</td>
                <td class="num"><strong>${formatCurrency(d.total)}</strong></td>
                <td class="mono small">${d.kodeSales}</td>
                <td>${gamingBadge}</td>
                <td>${d.seriProc} <small>(${d.proc})</small></td>
                <td>${divisiBadge}</td>
            </tr>
        `;
    });
    tbody.innerHTML = html;

    document.getElementById('tableInfo').textContent =
        `${formatNumber(start + 1)}-${formatNumber(Math.min(end, filteredData.length))} dari ${formatNumber(filteredData.length)} transaksi`;
    document.getElementById('pageInfo').textContent = `Hal. ${currentPage} / ${totalPages}`;
    document.getElementById('firstPage').disabled = currentPage <= 1;
    document.getElementById('prevPage').disabled = currentPage <= 1;
    document.getElementById('nextPage').disabled = currentPage >= totalPages;
    document.getElementById('lastPage').disabled = currentPage >= totalPages;
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// =========================================================
// MARKETSHARE TABLE (Per Brand · Per Bulan · Growth)
// =========================================================

let currentMSCategory = 'all';
let currentMSMetric = 'qty'; // 'qty' | 'value' (total omset) for the marketshare table
let currentProcStackedCategory = 'all';

// Hanya 8 brand yang ditampilkan, sisanya OTHER
const ALLOWED_BRANDS = ['ASUS', 'LENOVO', 'ACER', 'APPLE', 'AXIOO', 'ADVAN', 'HP', 'MSI'];

function renderMarketshareTable() {
    renderMarketshareTableGeneric({
        groupField: 'brand',
        allowedValues: ALLOWED_BRANDS,
        otherLabel: 'OTHER',
        category: currentMSCategory,
        metric: currentMSMetric,
        elementIds: {
            yearInfo: 'msYearInfo',
            head: 'msTableHead',
            body: 'msTableBody',
            foot: 'msTableFoot'
        }
    });
}

function renderMarketshareTableGeneric(config) {
    const { groupField, allowedValues, topN, otherLabel, category, metric, elementIds } = config;
    const isValue = metric === 'value';
    const valField = isValue ? 'total' : 'qty';
    const fmtV = (n) => isValue ? formatCurrencyShort(n) : formatNumber(n);
    
    const fTahun = document.getElementById('filterTahun').value;
    const targetYear = fTahun !== 'all' ? parseInt(fTahun) : 2026;
    const prevYear = targetYear - 1;
    
    document.getElementById(elementIds.yearInfo).innerHTML = 
        `<strong>Tahun ${targetYear}</strong> · YoY dibandingkan <strong>${prevYear}</strong> · Kategori: <strong>${category === 'all' ? 'Semua' : category}</strong> · Basis: <strong>${isValue ? 'Value (Omset)' : 'Qty (Unit)'}</strong>`;
    
    const fKota = document.getElementById('filterKota').value;
    const fDivisi = document.getElementById('filterDivisi').value;
    const fProc = document.getElementById('filterProc').value;
    
    const matchesContext = (d) => {
        if (fKota !== 'all' && d.cekKota !== fKota) return false;
        if (fDivisi !== 'all' && d.divisi !== fDivisi) return false;
        if (fProc !== 'all' && d.proc !== fProc) return false;
        if (category !== 'all' && d.cekGaming !== category) return false;
        return true;
    };
    
    const curYearData = allData.filter(d => d.tahun === targetYear && matchesContext(d));
    const prevYearData = allData.filter(d => d.tahun === prevYear && matchesContext(d));
    
    // Determine display values based on config
    let displayValues, otherValues;
    if (allowedValues) {
        displayValues = [...allowedValues];
        const allValues = new Set();
        curYearData.forEach(d => { if (d[groupField]) allValues.add(d[groupField]); });
        otherValues = [...allValues].filter(v => !allowedValues.includes(v));
    } else {
        const valueTotals = {};
        curYearData.forEach(d => {
            const v = d[groupField] || '(kosong)';
            valueTotals[v] = (valueTotals[v] || 0) + d[valField];
        });
        const sortedValues = Object.entries(valueTotals).sort((a, b) => b[1] - a[1]);
        const topValues = sortedValues.slice(0, topN || 9).map(s => s[0]);
        displayValues = topValues;
        otherValues = sortedValues.slice(topN || 9).map(s => s[0]);
    }
    
    const valueWithOther = [...displayValues, '_OTHER'];
    
    // Build matrix
    const matrix = {};
    MONTH_NAMES.forEach(m => {
        matrix[m] = {};
        valueWithOther.forEach(v => matrix[m][v] = 0);
    });
    
    curYearData.forEach(d => {
        const val = displayValues.includes(d[groupField]) ? d[groupField] : '_OTHER';
        if (matrix[d.bulanName]) {
            matrix[d.bulanName][val] = (matrix[d.bulanName][val] || 0) + d[valField];
        }
    });
    
    // Previous year matrix (just monthly grand totals)
    const prevMatrix = {};
    MONTH_NAMES.forEach(m => prevMatrix[m] = 0);
    prevYearData.forEach(d => {
        if (prevMatrix[d.bulanName] !== undefined) {
            prevMatrix[d.bulanName] += d[valField];
        }
    });
    
    // Max day per month for estimasi closing
    const monthMaxDay = {};
    MONTH_NAMES.forEach(m => monthMaxDay[m] = 0);
    curYearData.forEach(d => {
        const dayNum = parseInt(String(d.tgl).split(' ')[0]);
        if (!isNaN(dayNum) && dayNum > 0 && dayNum > monthMaxDay[d.bulanName]) {
            monthMaxDay[d.bulanName] = dayNum;
        }
    });
    
    // Estimasi only for current/latest year
    const latestYear = Math.max(...DATA_SOURCES.map(s => s.year));
    const isCurrentYear = (targetYear === latestYear);
    
    let runningMonthIdx = -1;
    let lastMonthWithData = -1;
    MONTH_NAMES.forEach((m, idx) => {
        if (monthMaxDay[m] > 0) {
            lastMonthWithData = idx;
            if (isCurrentYear) {
                const totalDays = daysInMonth(idx, targetYear);
                if (monthMaxDay[m] < totalDays) runningMonthIdx = idx;
            }
        }
    });
    
    // Cumulative growth
    let cumulativeCur = 0;
    let cumulativePrev = 0;
    if (lastMonthWithData >= 0) {
        for (let i = 0; i <= lastMonthWithData; i++) {
            const monthName = MONTH_NAMES[i];
            const monthCur = valueWithOther.reduce((s, v) => s + matrix[monthName][v], 0);
            
            if (i === runningMonthIdx && monthCur > 0 && isCurrentYear) {
                const maxDay = monthMaxDay[monthName];
                const totalDays = daysInMonth(i, targetYear);
                cumulativeCur += Math.round((monthCur / maxDay) * totalDays);
            } else {
                cumulativeCur += monthCur;
            }
            cumulativePrev += prevMatrix[monthName] || 0;
        }
    }
    
    let mergedGrowthHtml = '<span class="trend-neutral">-</span>';
    if (cumulativePrev > 0 && cumulativeCur > 0) {
        const growth = ((cumulativeCur - cumulativePrev) / cumulativePrev) * 100;
        mergedGrowthHtml = formatGrowthCell(growth);
    }
    const growthLabel = lastMonthWithData >= 0 
        ? (runningMonthIdx === lastMonthWithData
            ? `Jan - ${MONTH_NAMES[lastMonthWithData]} ${targetYear}<br><em>(${MONTH_NAMES[lastMonthWithData]}: estimasi closing)</em><br>vs Jan - ${MONTH_NAMES[lastMonthWithData]} ${prevYear}`
            : `Jan - ${MONTH_NAMES[lastMonthWithData]} ${targetYear}<br>vs Jan - ${MONTH_NAMES[lastMonthWithData]} ${prevYear}`)
        : '-';
    
    // Build HEAD
    const head = document.getElementById(elementIds.head);
    head.innerHTML = `
        <tr class="ms-head-1">
            <th rowspan="2" class="ms-bulan">Bulan</th>
            ${valueWithOther.map(v => `
                <th colspan="2" class="ms-brand-${v === '_OTHER' ? 'other' : sanitizeClass(v)}">
                    ${v === '_OTHER' ? `${otherLabel} (${otherValues.length})` : escapeHtml(v)}
                </th>
            `).join('')}
            <th rowspan="2" class="ms-total ms-total-center">Grand<br>Total</th>
            <th rowspan="2" class="ms-mom">MoM<br><small>${targetYear}</small></th>
            <th rowspan="2" class="ms-yoy">YoY<br><small>vs ${prevYear}</small></th>
            <th rowspan="2" class="ms-est">Estimasi<br>Closing</th>
            <th rowspan="2" class="ms-growth">Growth<br><small>${targetYear} vs ${prevYear}</small></th>
        </tr>
        <tr class="ms-head-2">
            ${valueWithOther.map(() => `<th>${isValue ? 'VALUE' : 'QTY'}</th><th>%</th>`).join('')}
        </tr>
    `;
    
    // Build BODY
    const body = document.getElementById(elementIds.body);
    let bodyHtml = '';
    let prevMonthGrandTotal = null;
    
    // Jan comparison: prev year December % per value
    const prevYearDecMatrix = {};
    valueWithOther.forEach(v => prevYearDecMatrix[v] = 0);
    prevYearData.forEach(d => {
        if (d.bulanName === 'Des') {
            const val = displayValues.includes(d[groupField]) ? d[groupField] : '_OTHER';
            prevYearDecMatrix[val] = (prevYearDecMatrix[val] || 0) + d[valField];
        }
    });
    const prevYearDecTotal = Object.values(prevYearDecMatrix).reduce((a, b) => a + b, 0);
    
    const prevMonthPct = {};
    valueWithOther.forEach(v => {
        prevMonthPct[v] = prevYearDecTotal > 0 ? (prevYearDecMatrix[v] / prevYearDecTotal) * 100 : null;
    });
    if (prevYearDecTotal > 0) prevMonthGrandTotal = prevYearDecTotal;
    
    MONTH_NAMES.forEach((month, idx) => {
        const monthGrandTotal = valueWithOther.reduce((s, v) => s + matrix[month][v], 0);
        const hasData = monthGrandTotal > 0;
        const prevYearMonthTotal = prevMatrix[month];
        
        // Hitung estimasi closing untuk bulan berjalan
        let estimasiClosing = null;
        if (idx === runningMonthIdx && hasData && isCurrentYear) {
            const maxDay = monthMaxDay[month];
            const totalDays = daysInMonth(idx, targetYear);
            estimasiClosing = Math.round((monthGrandTotal / maxDay) * totalDays);
        }
        
        // MoM: bulan berjalan pakai estimasi closing, bulan lain pakai grand total
        const currentValueForMoM = (estimasiClosing !== null) ? estimasiClosing : monthGrandTotal;
        let momHtml = '<span class="trend-neutral">-</span>';
        if (hasData && prevMonthGrandTotal !== null && prevMonthGrandTotal > 0) {
            const mom = ((currentValueForMoM - prevMonthGrandTotal) / prevMonthGrandTotal) * 100;
            momHtml = formatGrowthCell(mom);
        }
        
        // YoY: bulan berjalan pakai estimasi closing, bulan lain pakai grand total
        const currentValueForYoY = (estimasiClosing !== null) ? estimasiClosing : monthGrandTotal;
        let yoyHtml = '<span class="trend-neutral">-</span>';
        if (hasData && prevYearMonthTotal > 0) {
            const yoy = ((currentValueForYoY - prevYearMonthTotal) / prevYearMonthTotal) * 100;
            yoyHtml = formatGrowthCell(yoy);
        }
        
        let estHtml = '&nbsp;';
        if (estimasiClosing !== null) {
            const maxDay = monthMaxDay[month];
            const totalDays = daysInMonth(idx, targetYear);
            estHtml = `<strong>${fmtV(estimasiClosing)}</strong><small class="est-detail">${maxDay}/${totalDays} hari</small>`;
        }
        
        const growthCell = idx === 0 
            ? `<td class="ms-growth-cell ms-growth-merged" rowspan="12"><div class="growth-merged">${mergedGrowthHtml}<small class="growth-period">${growthLabel}</small></div></td>`
            : '';
        
        bodyHtml += `<tr class="${hasData ? '' : 'ms-empty-row'}">
            <td class="ms-bulan-cell"><strong>${month}</strong></td>
            ${valueWithOther.map(v => {
                const qty = matrix[month][v];
                const pct = monthGrandTotal > 0 ? (qty / monthGrandTotal) * 100 : 0;
                let pctHtml;
                if (!hasData) {
                    pctHtml = '&nbsp;';
                } else {
                    const previousPct = prevMonthPct[v];
                    pctHtml = formatPctCell(pct, previousPct);
                    prevMonthPct[v] = pct;
                }
                return `
                    <td class="ms-qty">${hasData ? fmtV(qty) : '&nbsp;'}</td>
                    <td class="ms-pct">${pctHtml}</td>
                `;
            }).join('')}
            <td class="ms-total-cell"><strong>${hasData ? fmtV(monthGrandTotal) : '&nbsp;'}</strong></td>
            <td class="ms-mom-cell">${momHtml}</td>
            <td class="ms-yoy-cell">${yoyHtml}</td>
            <td class="ms-est-cell">${estHtml}</td>
            ${growthCell}
        </tr>`;
        
        // Untuk MoM bulan berikutnya: pakai estimasi closing kalau running, else grand total
        if (hasData) prevMonthGrandTotal = (estimasiClosing !== null) ? estimasiClosing : monthGrandTotal;
    });
    
    body.innerHTML = bodyHtml;
    
    // FOOTER
    const foot = document.getElementById(elementIds.foot);
    const grandPerValue = {};
    valueWithOther.forEach(v => {
        grandPerValue[v] = MONTH_NAMES.reduce((s, m) => s + matrix[m][v], 0);
    });
    const grandSum = Object.values(grandPerValue).reduce((a, b) => a + b, 0);
    
    foot.innerHTML = `<tr class="ms-grand-row">
        <td><strong>Grand Total</strong></td>
        ${valueWithOther.map(v => {
            const qty = grandPerValue[v];
            const pct = grandSum > 0 ? (qty / grandSum) * 100 : 0;
            return `<td class="ms-qty"><strong>${fmtV(qty)}</strong></td><td class="ms-pct"><strong>${pct.toFixed(2)}%</strong></td>`;
        }).join('')}
        <td class="ms-total-cell"><strong>${fmtV(grandSum)}</strong></td>
        <td class="ms-mom-cell">&nbsp;</td>
        <td class="ms-yoy-cell">&nbsp;</td>
        <td class="ms-est-cell">&nbsp;</td>
    </tr>`;
}

// =========================================================
// FORMATTING
// =========================================================

function sanitizeClass(str) {
    return String(str).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Days in each month (handles leap year for Feb)
function daysInMonth(monthIdx, year) {
    if (monthIdx === 1) {
        const isLeap = (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0));
        return isLeap ? 29 : 28;
    }
    const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return days[monthIdx];
}

function formatGrowthCell(value) {
    if (value === null || value === undefined || isNaN(value)) return '<span class="trend-neutral">-</span>';
    const isPositive = value >= 0;
    const cls = isPositive ? 'trend-up' : 'trend-down';
    const arrow = isPositive ? '▲' : '▼';
    return `<span class="${cls}">${arrow} ${Math.abs(value).toFixed(2)}%</span>`;
}

// Format % marketshare cell - compare current vs previous month
function formatPctCell(currentPct, previousPct) {
    const formatted = currentPct.toFixed(2) + '%';
    
    // First month or no previous data: black/neutral
    if (previousPct === null || previousPct === undefined) {
        return `<span class="pct-flat">${formatted}</span>`;
    }
    
    // Calculate diff with small epsilon for "stuck"
    const diff = currentPct - previousPct;
    const epsilon = 0.005; // < 0.005% considered stuck
    
    if (Math.abs(diff) < epsilon || currentPct === 0) {
        return `<span class="pct-flat">${formatted}</span>`;
    }
    
    if (diff > 0) {
        return `<span class="pct-up">▲ ${formatted}</span>`;
    } else {
        return `<span class="pct-down">▼ ${formatted}</span>`;
    }
}

// =========================================================
// EXPORT
// =========================================================

function exportCSV() {
    if (filteredData.length === 0) {
        alert('Tidak ada data untuk di-export');
        return;
    }
    const headers = ['Tahun', 'Tanggal', 'Bulan', 'No Dok', 'Kota', 'Nama Barang', 'Brand', 'Qty', 'Harga', 'Total', 'Sales', 'Kategori', 'Prosesor', 'Divisi'];
    const rows = filteredData.map(d => [
        d.tahun, d.tgl, d.bulan, d.noDoc, d.cekKota, d.namaBarang, d.brand,
        d.qty, d.harga, d.total, d.kodeSales, d.cekGaming, d.proc, d.divisi
    ]);
    const csv = [headers, ...rows].map(r =>
        r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `penjualan-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// =========================================================
// EVENTS
// =========================================================

// =========================================================
// DOWNLOAD AS IMAGE (charts & tables)
// =========================================================

function makeImageFilename(target) {
    const titleEl = target.querySelector('h3, h4');
    let base = titleEl ? titleEl.textContent : 'analisa';
    base = base.replace(/[—·•:]/g, '-')
               .replace(/[^\w\s-]/g, '')
               .trim()
               .replace(/\s+/g, '-')
               .slice(0, 60);
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return `${base || 'analisa'}-${stamp}`;
}

// Build a small "label: value (pct%)" breakdown for a donut chart, used only
// in the exported PNG (donuts have no on-chart labels on screen).
function buildDonutBreakdownEl(chart) {
    const ds = chart.data.datasets[0] || {};
    const data = ds.data || [];
    const labels = chart.data.labels || [];
    const colors = ds.backgroundColor;
    const total = data.reduce((a, b) => a + (Number(b) || 0), 0);
    const wrap = document.createElement('div');
    wrap.className = 'dl-donut-breakdown';
    labels.forEach((lab, i) => {
        const val = Number(data[i]) || 0;
        const pct = total > 0 ? (val / total * 100).toFixed(1) : '0.0';
        const color = Array.isArray(colors) ? (colors[i] || '#64748b') : (colors || '#64748b');
        const item = document.createElement('span');
        item.className = 'dl-donut-item';
        item.innerHTML = `<i style="background:${color}"></i><span>${lab}: <strong>${formatNumber(val)}</strong> (${pct}%)</span>`;
        wrap.appendChild(item);
    });
    return wrap;
}

// Render a chart card or table block to a PNG and trigger a download.
async function captureAndDownload(target, btn) {
    if (!target) return;
    if (typeof html2canvas === 'undefined') {
        alert('Modul gambar belum siap. Coba lagi sebentar.');
        return;
    }
    if (btn) btn.classList.add('is-busy');

    // Temporarily expand any inner scrollable table wrapper so the FULL table
    // (not just the visible scrolled part) is captured.
    const wrappers = target.querySelectorAll('.table-wrapper');
    const restore = [];
    wrappers.forEach(w => {
        const prevMax = w.style.maxHeight;
        const prevOvf = w.style.overflow;
        restore.push(() => { w.style.maxHeight = prevMax; w.style.overflow = prevOvf; });
        w.style.maxHeight = 'none';
        w.style.overflow = 'visible';
    });

    // Donut charts have no on-chart labels; add a value/percentage breakdown
    // below each donut so the exported PNG is self-explanatory.
    Object.values(charts).forEach(ch => {
        if (!ch || !ch.config || ch.config.type !== 'doughnut' || !ch.canvas) return;
        if (!target.contains(ch.canvas)) return;
        const card = ch.canvas.closest('.chart-card');
        const host = card || ch.canvas.closest('.monthly-cat-chart-col') || ch.canvas.parentElement;
        if (card) {
            const prevH = card.style.height;
            restore.push(() => { card.style.height = prevH; });
            card.style.height = 'auto'; // let the card grow so the donut isn't squished
        }
        const el = buildDonutBreakdownEl(ch);
        host.appendChild(el);
        restore.push(() => el.remove());
    });

    const bg = isLightTheme() ? '#eef1f7' : '#07091a';
    try {
        const canvas = await html2canvas(target, {
            backgroundColor: bg,
            scale: 2,
            useCORS: true,
            logging: false,
            ignoreElements: el => el.classList && el.classList.contains('btn-download'),
            width: target.scrollWidth,
            height: target.scrollHeight
        });
        const link = document.createElement('a');
        link.download = makeImageFilename(target) + '.png';
        link.href = canvas.toDataURL('image/png');
        document.body.appendChild(link);
        link.click();
        link.remove();
    } catch (e) {
        console.error('Gagal membuat gambar:', e);
        alert('Gagal membuat gambar. Coba lagi.');
    } finally {
        restore.forEach(fn => fn());
        if (btn) btn.classList.remove('is-busy');
    }
}

function createDownloadButton(getTarget) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-download';
    btn.title = 'Download sebagai gambar (PNG)';
    btn.setAttribute('aria-label', 'Download sebagai gambar');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>PNG</span>';
    btn.addEventListener('click', () => captureAndDownload(getTarget(), btn));
    return btn;
}

// Ensure a chart header has a right-aligned container (keeps the title on the
// left) so the download button can sit next to the existing tag/tabs.
function ensureChartHeaderRight(header) {
    let right = header.querySelector(':scope > .chart-header-right');
    if (right) return right;
    right = document.createElement('div');
    right.className = 'chart-header-right';
    const kids = Array.from(header.children);
    kids.slice(1).forEach(k => right.appendChild(k)); // first child = title block
    header.appendChild(right);
    return right;
}

function setupDownloadButtons() {
    // Charts — one button per chart card (captures the title + chart)
    document.querySelectorAll('.chart-card').forEach(card => {
        const header = card.querySelector('.chart-header');
        if (!header) return;
        const right = ensureChartHeaderRight(header);
        right.insertBefore(createDownloadButton(() => card), right.firstChild);
    });

    // Marketshare per Brand (Analisa Tahunan) — captures the whole table section
    const msSection = document.querySelector('.marketshare-section:not(.monthly-analysis-section)');
    if (msSection) {
        const header = msSection.querySelector('.table-header');
        const controls = header && header.querySelector('.ms-header-controls');
        const btn = createDownloadButton(() => msSection);
        if (controls) controls.insertBefore(btn, controls.firstChild);
        else if (header) header.appendChild(btn);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    setupDownloadButtons();
    ['filterTahun', 'filterBulan', 'filterKota', 'filterBrand', 'filterKategori', 'filterDivisi', 'filterProc'].forEach(id => {
        document.getElementById(id).addEventListener('change', applyFilters);
    });
    
    const searchEl = document.getElementById('searchTable');
    if (searchEl) {
        let searchTimer;
        searchEl.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(applyFilters, 300);
        });
    }

    document.getElementById('btnReset').addEventListener('click', resetFilters);

    // Theme toggle (light / dark). The saved theme is applied pre-paint via an
    // inline script in <head>; here we just sync the button and wire the click.
    updateThemeButton();
    const btnTheme = document.getElementById('btnTheme');
    if (btnTheme) btnTheme.addEventListener('click', toggleTheme);

    const btnExport = document.getElementById('btnExport');
    if (btnExport) btnExport.addEventListener('click', exportCSV);
    document.getElementById('btnRefresh').addEventListener('click', () => {
        showLoadingAgain();
        document.getElementById('progressFill').style.background = '';
        loadData(false);
    });
    
    const btnForceRefresh = document.getElementById('btnForceRefresh');
    if (btnForceRefresh) {
        btnForceRefresh.addEventListener('click', async () => {
            if (!confirm('Hapus cache 2024 & 2025 dan unduh ulang dari Google Sheets?')) return;
            await clearAllCache();
            localStorage.removeItem(CACHE_VERSION_KEY);
            window.location.reload(true);
        });
    }

    // Tab handlers - marketshare table
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentMSCategory = btn.dataset.cat;
            renderMarketshareTable();
        });
    });

    // Marketshare metric toggle (Qty / Value omset) — beside the category tabs
    document.querySelectorAll('.chart-tab-btn[data-ms-metric]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.chart-tab-btn[data-ms-metric]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentMSMetric = btn.dataset.msMetric;
            renderMarketshareTable();
        });
    });

    // Trend chart metric toggle (Qty / Value omset) — beside the YoY · Trend tag
    document.querySelectorAll('.chart-tab-btn[data-trend-metric]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.chart-tab-btn[data-trend-metric]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentTrendMetric = btn.dataset.trendMetric;
            renderTrendChart();
        });
    });

    // Tab handlers - processor stacked chart category
    document.querySelectorAll('.chart-tab-btn[data-proc-cat]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.chart-tab-btn[data-proc-cat]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentProcStackedCategory = btn.dataset.procCat;
            renderProcStackedChart();
        });
    });

    // Monthly category tabs (Semua / Gaming / Non Gaming) — kept for any remaining uses
    // (no-op now that monthly analysis is removed, querySelectorAll returns empty list)
    document.querySelectorAll('.monthly-cat-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.monthly-cat-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Top Products category tabs (Semua / Gaming / Non Gaming)
    document.querySelectorAll('.top-prod-cat-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.top-prod-cat-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentTopProdCategory = btn.dataset.topProdCat;
            renderTopProductsChart();
        });
    });

    // Top Products processor dropdown
    const filterTopProdProc = document.getElementById('filterTopProdProc');
    if (filterTopProdProc) {
        filterTopProdProc.addEventListener('change', () => {
            renderTopProductsChart();
        });
    }

    // Main Navigation Tabs (Analisa Tahunan / Analisa Bulanan)
    document.querySelectorAll('.main-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.main-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const targetId = btn.dataset.tab;
            document.querySelectorAll('.tab-content').forEach(panel => {
                panel.classList.toggle('active', panel.id === targetId);
            });
        });
    });

    // Pagination - only if table exists
    const firstPage = document.getElementById('firstPage');
    if (firstPage) {
        firstPage.addEventListener('click', () => { currentPage = 1; renderTable(); });
        document.getElementById('prevPage').addEventListener('click', () => { currentPage--; renderTable(); });
        document.getElementById('nextPage').addEventListener('click', () => { currentPage++; renderTable(); });
        document.getElementById('lastPage').addEventListener('click', () => {
            currentPage = Math.ceil(filteredData.length / rowsPerPage);
            renderTable();
        });
    }

    loadData();
});



// =========================================================
// MARKETSHARE PER BRAND PROC (processor brand: Intel / AMD / Apple / Snapdragon)
// Same format as the brand marketshare table, grouped by the `proc` field.
// =========================================================
var currentMSProcCategory = 'all';
var currentMSProcMetric = 'qty'; // 'qty' | 'value' (total omset)
var ALLOWED_PROC_BRANDS = ['Intel', 'Amd', 'Apple', 'Snapdragon'];

function renderMarketshareProcTable() {
    if (!document.getElementById('msProcTableHead')) return;
    renderMarketshareTableGeneric({
        groupField: 'proc',
        allowedValues: ALLOWED_PROC_BRANDS,
        otherLabel: 'LAINNYA',
        category: currentMSProcCategory,
        metric: currentMSProcMetric,
        elementIds: {
            yearInfo: 'msProcYearInfo',
            head: 'msProcTableHead',
            body: 'msProcTableBody',
            foot: 'msProcTableFoot'
        }
    });
}

// Render the processor-brand table whenever the brand marketshare table renders
// (so it stays in sync with the global filters without touching the core flow).
(function () {
    if (typeof renderMarketshareTable === 'function') {
        var _origRenderMarketshareTable = renderMarketshareTable;
        renderMarketshareTable = function () {
            var result = _origRenderMarketshareTable.apply(this, arguments);
            try { renderMarketshareProcTable(); } catch (e) { console.error('renderMarketshareProcTable:', e); }
            return result;
        };
    }
})();

document.addEventListener('DOMContentLoaded', function () {
    // Category tabs (Semua / Gaming / Non Gaming)
    document.querySelectorAll('.proc-cat-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.proc-cat-btn').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            currentMSProcCategory = btn.dataset.msprocCat;
            renderMarketshareProcTable();
        });
    });

    // Metric toggle (Qty / Value omset)
    document.querySelectorAll('.chart-tab-btn[data-msproc-metric]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.chart-tab-btn[data-msproc-metric]').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            currentMSProcMetric = btn.dataset.msprocMetric;
            renderMarketshareProcTable();
        });
    });

    // PNG download button for the processor-brand marketshare section
    var procTable = document.getElementById('marketshareProcTable');
    var procSection = procTable ? procTable.closest('.marketshare-section') : null;
    if (procSection && typeof createDownloadButton === 'function') {
        var header = procSection.querySelector('.table-header');
        var controls = header && header.querySelector('.ms-header-controls');
        var dbtn = createDownloadButton(function () { return procSection; });
        if (controls) controls.insertBefore(dbtn, controls.firstChild);
        else if (header) header.appendChild(dbtn);
    }
});
