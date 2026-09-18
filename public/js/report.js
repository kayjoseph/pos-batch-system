// Shared engine for every report page. The backend returns a generic
// { columns, rows, totals } shape, so one renderer covers all report types -
// each page only supplies its endpoint and its list of report types.
 
function moneyFmt(n) {
    return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
 
function numFmt(n) {
    return Number(n || 0).toLocaleString();
}
 
function formatCell(value, type) {
    if (value === null || value === undefined || value === '') return '-';
    switch (type) {
        case 'money': return moneyFmt(value);
        case 'num': return numFmt(value);
        case 'date': return String(value).substring(0, 10);
        case 'datetime': return new Date(value).toLocaleString();
        case 'badge': return `<span class="badge ${value}">${value}</span>`;
        case 'expiry': {
            const d = String(value).substring(0, 10);
            return `<span class="${expiryClass(value)}">${d}</span>`;
        }
        default: return value;
    }
}
 
function cellClass(type) {
    return ['money', 'num', 'mono', 'date', 'datetime', 'expiry'].includes(type) ? 'mono' : '';
}
 
// config: { endpoint, types: [{value,label}], usesDateRange (default true) }
function initReport(config) {
    const usesDateRange = config.usesDateRange !== false;
 
    const typeSelect = document.getElementById('reportType');
    typeSelect.innerHTML = config.types.map(t => `<option value="${t.value}">${t.label}</option>`).join('');
 
    if (!usesDateRange) {
        const rangeEls = document.getElementById('dateRangeFields');
        if (rangeEls) rangeEls.style.display = 'none';
    }
 
    window.runReport = async function () {
        const type = typeSelect.value;
        let url = `${config.endpoint}?type=${encodeURIComponent(type)}`;
        if (usesDateRange) {
            const today = new Date().toISOString().substring(0, 10);
            const fromField = document.getElementById('reportFrom');
            const toField = document.getElementById('reportTo');
 
            // Left blank? Default to today only, rather than guessing a range.
            const from = fromField.value || today;
            const to = toField.value || today;
            fromField.value = from;
            toField.value = to;
 
            url += `&from=${from}&to=${to}`;
        }
 
        try {
            const data = await api(url);
            renderReport(data);
        } catch (err) {
            toast(err.message);
        }
    };
 
    window.printReport = function () { window.print(); };
 
    runReport();
}
 
// A printed report needs to stand on its own as a document: which business,
// which report, what period, and when it was run. This block is hidden on
// screen and only appears in the printout.
let cachedCompanyName = null;
 
async function updatePrintHeader(data) {
    let holder = document.getElementById('printHeader');
    if (!holder) {
        holder = document.createElement('div');
        holder.id = 'printHeader';
        const content = document.querySelector('.content');
        content.insertBefore(holder, content.firstChild);
    }
 
    if (cachedCompanyName === null) {
        try {
            const company = await api('/settings/company');
            cachedCompanyName = (company && company.company_name) || '';
        } catch (err) {
            cachedCompanyName = '';
        }
    }
 
    const typeSelect = document.getElementById('reportType');
    const reportLabel = typeSelect.options[typeSelect.selectedIndex]
        ? typeSelect.options[typeSelect.selectedIndex].text : '';
    const pageTitle = document.title.split(' - ')[0];
 
    const period = (data.from && data.to)
        ? `Period: ${data.from} to ${data.to}`
        : 'Current snapshot';
 
    holder.innerHTML = `
        ${cachedCompanyName ? `<div class="print-company">${cachedCompanyName}</div>` : ''}
        <div class="print-title">${pageTitle}${reportLabel ? ' - ' + reportLabel : ''}</div>
        <div class="print-meta">${period} &nbsp;|&nbsp; Generated: ${new Date().toLocaleString()}</div>
    `;
}
 
function renderReport(data) {
    const head = document.getElementById('reportHead');
    const body = document.getElementById('reportBody');
    const foot = document.getElementById('reportFoot');
 
    updatePrintHeader(data);
 
    head.innerHTML = `<tr>${data.columns.map(c => `<th>${c.label}</th>`).join('')}</tr>`;
 
    if (!data.rows || data.rows.length === 0) {
        body.innerHTML = `<tr><td colspan="${data.columns.length}"><div class="empty-state">No data for this report.</div></td></tr>`;
        foot.innerHTML = '';
        return;
    }
 
    body.innerHTML = data.rows.map(row => `
        <tr>${data.columns.map(c =>
            `<td class="${cellClass(c.type)}">${formatCell(row[c.key], c.type)}</td>`
        ).join('')}</tr>
    `).join('');
 
    // Totals row - only for the numeric columns the report flagged as summable
    if (data.totals && data.totals.length > 0) {
        const sums = {};
        data.totals.forEach(key => {
            sums[key] = data.rows.reduce((acc, r) => acc + Number(r[key] || 0), 0);
        });
        foot.innerHTML = `<tr>${data.columns.map((c, idx) => {
            if (idx === 0) return `<td><strong>Total</strong></td>`;
            if (sums[c.key] === undefined) return `<td></td>`;
            return `<td class="mono"><strong>${c.type === 'money' ? moneyFmt(sums[c.key]) : numFmt(sums[c.key])}</strong></td>`;
        }).join('')}</tr>`;
    } else {
        foot.innerHTML = '';
    }
}
 