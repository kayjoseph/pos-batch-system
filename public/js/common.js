async function api(path, options = {}) {
    const res = await fetch(`/api${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
}

function toast(message) {
    const el = document.getElementById('toast');
    if (!el) { alert(message); return; }
    el.textContent = message;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 3000);
}

function daysUntil(dateStr) {
    if (!dateStr) return null;
    const diff = new Date(dateStr) - new Date();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function expiryClass(dateStr) {
    const days = daysUntil(dateStr);
    if (days === null) return '';
    if (days < 0) return 'expired';
    if (days <= 30) return 'expiring';
    return '';
}

/* ============ Sidebar ============ */
// activePage one of:
// 'items-register', 'items-list', 'categories', 'units', 'stock-manager', 'purchase-add', 'purchase-list',
// 'pos-terminal', 'invoice', 'sales'
function renderSidebar(activePage) {
    const icons = {
        items: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8L12 3 3 8l9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>',
        purchase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2l1.5 5h9L18 2"/><path d="M3.5 7h17l-1.6 11.2a2 2 0 0 1-2 1.8H7.1a2 2 0 0 1-2-1.8L3.5 7z"/><path d="M10 11v4M14 11v4"/></svg>',
        pos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 12h18"/><path d="M8 16h.01M12 16h.01"/></svg>',
        sales: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12v19l-3-2-3 2-3-2-3 2V2z"/><path d="M8.5 8h7M8.5 12h7"/></svg>',
        chevron: '<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
    };

    const itemsOpen = ['items-register', 'items-list', 'categories', 'units', 'stock-manager'].includes(activePage);
    const purchaseOpen = activePage === 'purchase-add' || activePage === 'purchase-list';
    const posOpen = activePage === 'pos-terminal' || activePage === 'invoice';

    const html = `
    <nav class="sidebar">
        <div class="sidebar-brand"><span class="tag-dot"></span> POS Batch System</div>

        <div class="nav-item">
            <div class="nav-link" id="itemsToggle">
                ${icons.items}<span>Items</span>${icons.chevron}
            </div>
            <div class="nav-sublist ${itemsOpen ? 'open' : ''}" id="itemsSublist">
                <a class="nav-sublink ${activePage === 'items-register' ? 'active' : ''}" href="items-register.html">Register Item</a>
                <a class="nav-sublink ${activePage === 'items-list' ? 'active' : ''}" href="items.html">Items List</a>
                <a class="nav-sublink ${activePage === 'categories' ? 'active' : ''}" href="categories.html">Categories</a>
                <a class="nav-sublink ${activePage === 'units' ? 'active' : ''}" href="units.html">Units of Measure</a>
                <a class="nav-sublink ${activePage === 'stock-manager' ? 'active' : ''}" href="stock-manager.html">Stock Manager</a>
            </div>
        </div>

        <div class="nav-item">
            <div class="nav-link" id="purchaseToggle">
                ${icons.purchase}<span>Purchase</span>${icons.chevron}
            </div>
            <div class="nav-sublist ${purchaseOpen ? 'open' : ''}" id="purchaseSublist">
                <a class="nav-sublink ${activePage === 'purchase-add' ? 'active' : ''}" href="purchase-add.html">Add Purchase</a>
                <a class="nav-sublink ${activePage === 'purchase-list' ? 'active' : ''}" href="purchase.html">Purchase List</a>
            </div>
        </div>

        <div class="nav-item">
            <div class="nav-link" id="posToggle">
                ${icons.pos}<span>POS</span>${icons.chevron}
            </div>
            <div class="nav-sublist ${posOpen ? 'open' : ''}" id="posSublist">
                <a class="nav-sublink ${activePage === 'pos-terminal' ? 'active' : ''}" href="pos-terminal.html">POS Terminal</a>
                <a class="nav-sublink ${activePage === 'invoice' ? 'active' : ''}" href="invoice.html">Invoice Entry</a>
            </div>
        </div>

        <div class="nav-item">
            <a class="nav-link ${activePage === 'sales' ? 'active' : ''}" href="sales.html">
                ${icons.sales}<span>Sales</span>
            </a>
        </div>
    </nav>`;

    document.getElementById('sidebarMount').outerHTML = html;

    // Wire up all dropdowns the same way
    [
        { toggleId: 'itemsToggle', sublistId: 'itemsSublist', open: itemsOpen },
        { toggleId: 'purchaseToggle', sublistId: 'purchaseSublist', open: purchaseOpen },
        { toggleId: 'posToggle', sublistId: 'posSublist', open: posOpen },
    ].forEach(({ toggleId, sublistId, open }) => {
        const toggle = document.getElementById(toggleId);
        const sublist = document.getElementById(sublistId);
        const chevron = toggle.querySelector('.chevron');
        if (open) chevron.classList.add('open');
        toggle.addEventListener('click', () => {
            sublist.classList.toggle('open');
            chevron.classList.toggle('open');
        });
    });
}
