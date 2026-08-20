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
