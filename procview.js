// procview.js
// =========================================================
// Marketshare Brand Processor per Bulan — chart renderer with a
// Bar / Garis (Line) / Area chart-type toggle.
//
// This module owns the rendering of #chartProcStacked and the chart-type
// switcher beside it. It relies on globals defined in app.js:
//   - filteredData            (current filtered dataset)
//   - MONTH_NAMES             (ordered month labels)
//   - charts                  (registry of live Chart instances)
//   - destroyChart(name)      (helper to destroy a chart by key)
//   - gridColor()             (theme-aware grid line color)
//   - currentProcStackedCategory  (Semua / GAMING / NON GAMING)
//
// app.js calls renderProcStackedChart() from renderCharts() and from the
// category tab handler; this file provides that global function.
// =========================================================

// Chart type state for the processor marketshare chart: 'bar' | 'line' | 'area'
let currentProcChartType = 'bar';

const PROC_VIEW_BRANDS = ['Intel', 'Amd', 'Apple', 'Snapdragon'];
const PROC_VIEW_COLORS = { Intel: '#6366f1', Amd: '#f43f5e', Apple: '#94a3b8', Snapdragon: '#f59e0b' };
const PROC_VIEW_BORDER_COLORS = { Intel: '#4f46e5', Amd: '#be123c', Apple: '#64748b', Snapdragon: '#d97706' };

// Add alpha (00-ff hex) to a #rrggbb color for translucent area fills.
function procViewAlpha(hex, alpha) {
    return hex + alpha;
}

// Build the per-month marketshare matrix (% per processor brand).
// Returns { labels, shareByProc } where shareByProc[proc] is an array of
// percentages aligned to labels.
function buildProcMarketshare() {
    const chartData = currentProcStackedCategory === 'all'
        ? filteredData
        : filteredData.filter(d => d.cekGaming === currentProcStackedCategory);

    // month -> proc -> qty
    const monthProc = {};
    MONTH_NAMES.forEach(m => {
        monthProc[m] = {};
        PROC_VIEW_BRANDS.forEach(p => (monthProc[m][p] = 0));
    });

    chartData.forEach(d => {
        if (d.bulanName && PROC_VIEW_BRANDS.includes(d.proc)) {
            monthProc[d.bulanName][d.proc] += d.qty;
        }
    });

    // Only show months that actually have data
    const labels = MONTH_NAMES.filter(m => {
        const total = PROC_VIEW_BRANDS.reduce((s, p) => s + monthProc[m][p], 0);
        return total > 0;
    });

    const shareByProc = {};
    PROC_VIEW_BRANDS.forEach(proc => {
        shareByProc[proc] = labels.map(m => {
            const total = PROC_VIEW_BRANDS.reduce((s, p) => s + monthProc[m][p], 0);
            return total > 0 ? (monthProc[m][proc] / total) * 100 : 0;
        });
    });

    return { labels, shareByProc };
}

// Pseudo-3D shadow plugin — only meaningful for the bar variant.
const procShadow3DPlugin = {
    id: 'procShadow3D',
    beforeDatasetsDraw: (chart) => {
        const ctx = chart.ctx;
        ctx.save();
        chart.data.datasets.forEach((ds, dsIdx) => {
            const meta = chart.getDatasetMeta(dsIdx);
            if (meta.hidden) return;
            meta.data.forEach(element => {
                const { x, y, width, base } = element.getProps(['x', 'y', 'width', 'base']);
                const barHeight = base - y;
                if (barHeight <= 0) return;
                // Shadow offset behind bars
                ctx.fillStyle = (ds.borderColor || ds.backgroundColor) + '44';
                ctx.fillRect(x - width / 2 + 5, y - 3, width, barHeight);
                // Right-side border for depth
                ctx.fillStyle = (ds.borderColor || ds.backgroundColor) + '88';
                ctx.fillRect(x + width / 2 + 3, y - 3, 2, barHeight);
            });
        });
        ctx.restore();
    }
};

// Build Chart.js datasets for the current chart type.
function buildProcDatasets(labels, shareByProc) {
    const type = currentProcChartType;

    return PROC_VIEW_BRANDS.map(proc => {
        const base = {
            label: proc,
            data: shareByProc[proc],
            borderColor: PROC_VIEW_BORDER_COLORS[proc]
        };

        if (type === 'bar') {
            return {
                ...base,
                backgroundColor: PROC_VIEW_COLORS[proc],
                borderRadius: 2,
                borderSkipped: false
            };
        }

        if (type === 'area') {
            // Stacked, filled areas summing to 100%.
            return {
                ...base,
                backgroundColor: procViewAlpha(PROC_VIEW_COLORS[proc], 'cc'),
                borderColor: PROC_VIEW_COLORS[proc],
                borderWidth: 1.5,
                fill: true,
                tension: 0.35,
                pointRadius: 0,
                pointHoverRadius: 5,
                pointBackgroundColor: PROC_VIEW_COLORS[proc]
            };
        }

        // 'line' — un-stacked trend lines (each 0..100%).
        return {
            ...base,
            backgroundColor: 'transparent',
            borderColor: PROC_VIEW_COLORS[proc],
            borderWidth: 2.5,
            fill: false,
            tension: 0.35,
            pointRadius: 3,
            pointHoverRadius: 6,
            pointBackgroundColor: PROC_VIEW_COLORS[proc],
            pointBorderColor: '#fff',
            pointBorderWidth: 1.5
        };
    });
}

// Render (or re-render) the processor marketshare chart honoring the
// currently selected chart type and category.
function renderProcStackedChart() {
    destroyChart('procStacked');

    const canvas = document.getElementById('chartProcStacked');
    if (!canvas) return;

    const type = currentProcChartType;
    const { labels, shareByProc } = buildProcMarketshare();
    const datasets = buildProcDatasets(labels, shareByProc);

    // Chart.js base type: bars use 'bar', line & area both use 'line'.
    const chartJsType = type === 'bar' ? 'bar' : 'line';

    // Stacking: bar & area stack to 100%; plain line does not stack.
    const stacked = type === 'bar' || type === 'area';

    charts.procStacked = new Chart(canvas, {
        type: chartJsType,
        data: { labels, datasets },
        plugins: type === 'bar' ? [procShadow3DPlugin] : [],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: { position: 'top', align: 'end' },
                tooltip: {
                    callbacks: {
                        label: ctx => `${ctx.dataset.label}: ${Number(ctx.raw).toFixed(1)}%`
                    }
                }
            },
            scales: {
                x: { stacked: stacked, grid: { display: false } },
                y: {
                    stacked: stacked,
                    beginAtZero: true,
                    max: 100,
                    ticks: { callback: v => v + '%' },
                    grid: { color: gridColor() }
                }
            }
        }
    });
}

// Wire up the Bar / Garis / Area toggle buttons.
function setupProcViewToggle() {
    const buttons = document.querySelectorAll('.chart-tab-btn[data-proc-chart-type]');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.procChartType;
            if (type === currentProcChartType) return;
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentProcChartType = type;
            // Only re-render if data is loaded; otherwise the next renderCharts() handles it.
            if (typeof filteredData !== 'undefined' && filteredData && filteredData.length) {
                renderProcStackedChart();
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', setupProcViewToggle);
