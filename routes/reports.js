const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
 
// Reports default to the last 30 days when no range is supplied.
function resolveDateRange(req) {
    const to = req.query.to || new Date().toISOString().substring(0, 10);
    const from = req.query.from
        || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
    return { from, to };
}
 
// Each report returns { from, to, columns, rows, totals } so the frontend can
// render any of them with one generic table renderer - no per-report markup.
function reply(res, from, to, columns, rows, totals) {
    res.json({ from, to, columns, rows, totals: totals || null });
}
 
// ============ Sales reports ============
router.get('/sales', async (req, res) => {
    const { from, to } = resolveDateRange(req);
    const type = req.query.type || 'summary';
    try {
        if (type === 'summary') {
            const result = await pool.query(`
                SELECT sale_date::date AS day,
                       COUNT(*) AS sales_count,
                       SUM(total) AS total,
                       SUM(amount_paid) AS paid,
                       SUM(total - amount_paid) AS balance
                FROM sales
                WHERE sale_date::date BETWEEN $1 AND $2
                GROUP BY day ORDER BY day DESC
            `, [from, to]);
            return reply(res, from, to,
                [
                    { key: 'day', label: 'Date', type: 'date' },
                    { key: 'sales_count', label: 'Sales', type: 'num' },
                    { key: 'total', label: 'Total', type: 'money' },
                    { key: 'paid', label: 'Paid', type: 'money' },
                    { key: 'balance', label: 'Balance', type: 'money' },
                ],
                result.rows,
                ['total', 'paid', 'balance']);
        }
 
        if (type === 'by-item') {
            const result = await pool.query(`
                SELECT i.item_code, i.name AS item,
                       SUM(si.qty) AS qty_sold,
                       SUM(si.line_total) AS revenue,
                       SUM(si.qty * b.cost_price) AS cost,
                       SUM(si.line_total - (si.qty * b.cost_price)) AS profit
                FROM sale_items si
                JOIN sales s ON s.sale_id = si.sale_id
                JOIN items i ON i.item_id = si.item_id
                JOIN batches b ON b.batch_id = si.batch_id
                WHERE s.sale_date::date BETWEEN $1 AND $2
                GROUP BY i.item_code, i.name ORDER BY revenue DESC
            `, [from, to]);
            return reply(res, from, to,
                [
                    { key: 'item_code', label: 'Code', type: 'mono' },
                    { key: 'item', label: 'Item' },
                    { key: 'qty_sold', label: 'Qty Sold', type: 'num' },
                    { key: 'revenue', label: 'Revenue', type: 'money' },
                    { key: 'cost', label: 'Cost', type: 'money' },
                    { key: 'profit', label: 'Profit', type: 'money' },
                ],
                result.rows,
                ['qty_sold', 'revenue', 'cost', 'profit']);
        }
 
        if (type === 'by-customer') {
            const result = await pool.query(`
                SELECT COALESCE(customer_name, 'Walk-in') AS customer,
                       COUNT(*) AS sales_count,
                       SUM(total) AS total,
                       SUM(total - amount_paid) AS balance
                FROM sales
                WHERE sale_date::date BETWEEN $1 AND $2
                GROUP BY customer ORDER BY total DESC
            `, [from, to]);
            return reply(res, from, to,
                [
                    { key: 'customer', label: 'Customer' },
                    { key: 'sales_count', label: 'Sales', type: 'num' },
                    { key: 'total', label: 'Total', type: 'money' },
                    { key: 'balance', label: 'Balance', type: 'money' },
                ],
                result.rows,
                ['total', 'balance']);
        }
 
        if (type === 'by-payment-method') {
            const result = await pool.query(`
                SELECT sp.method, COUNT(*) AS payments_count, SUM(sp.amount) AS total
                FROM sale_payments sp
                JOIN sales s ON s.sale_id = sp.sale_id
                WHERE s.sale_date::date BETWEEN $1 AND $2
                GROUP BY sp.method ORDER BY total DESC
            `, [from, to]);
            return reply(res, from, to,
                [
                    { key: 'method', label: 'Method' },
                    { key: 'payments_count', label: 'Payments', type: 'num' },
                    { key: 'total', label: 'Total', type: 'money' },
                ],
                result.rows,
                ['total']);
        }
 
        if (type === 'profit') {
            const result = await pool.query(`
                SELECT s.sale_date::date AS day,
                       SUM(si.line_total) AS revenue,
                       SUM(si.qty * b.cost_price) AS cost,
                       SUM(si.line_total - (si.qty * b.cost_price)) AS profit
                FROM sale_items si
                JOIN sales s ON s.sale_id = si.sale_id
                JOIN batches b ON b.batch_id = si.batch_id
                WHERE s.sale_date::date BETWEEN $1 AND $2
                GROUP BY day ORDER BY day DESC
            `, [from, to]);
            return reply(res, from, to,
                [
                    { key: 'day', label: 'Date', type: 'date' },
                    { key: 'revenue', label: 'Revenue', type: 'money' },
                    { key: 'cost', label: 'Cost', type: 'money' },
                    { key: 'profit', label: 'Gross Profit', type: 'money' },
                ],
                result.rows,
                ['revenue', 'cost', 'profit']);
        }
 
        if (type === 'detailed') {
            const result = await pool.query(`
                SELECT s.invoice_no, s.sale_date, COALESCE(s.customer_name, 'Walk-in') AS customer,
                       s.total, s.amount_paid, (s.total - s.amount_paid) AS balance,
                       s.status, s.created_by
                FROM sales s
                WHERE s.sale_date::date BETWEEN $1 AND $2
                ORDER BY s.sale_date DESC
            `, [from, to]);
            return reply(res, from, to,
                [
                    { key: 'invoice_no', label: 'Invoice', type: 'mono' },
                    { key: 'sale_date', label: 'Date', type: 'datetime' },
                    { key: 'customer', label: 'Customer' },
                    { key: 'total', label: 'Total', type: 'money' },
                    { key: 'amount_paid', label: 'Paid', type: 'money' },
                    { key: 'balance', label: 'Balance', type: 'money' },
                    { key: 'status', label: 'Status', type: 'badge' },
                    { key: 'created_by', label: 'Created By' },
                ],
                result.rows,
                ['total', 'amount_paid', 'balance']);
        }
 
        res.status(400).json({ error: 'Unknown sales report type' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to build sales report' });
    }
});
 
// ============ Purchase reports ============
router.get('/purchases', async (req, res) => {
    const { from, to } = resolveDateRange(req);
    const type = req.query.type || 'summary';
    try {
        if (type === 'summary') {
            const result = await pool.query(`
                SELECT purchase_date::date AS day,
                       COUNT(*) AS purchases_count,
                       SUM(total) AS total,
                       SUM(amount_paid) AS paid,
                       SUM(total - amount_paid) AS balance
                FROM purchases
                WHERE purchase_date::date BETWEEN $1 AND $2
                GROUP BY day ORDER BY day DESC
            `, [from, to]);
            return reply(res, from, to,
                [
                    { key: 'day', label: 'Date', type: 'date' },
                    { key: 'purchases_count', label: 'Purchases', type: 'num' },
                    { key: 'total', label: 'Total', type: 'money' },
                    { key: 'paid', label: 'Paid', type: 'money' },
                    { key: 'balance', label: 'Balance', type: 'money' },
                ],
                result.rows,
                ['total', 'paid', 'balance']);
        }
 
        if (type === 'by-supplier') {
            const result = await pool.query(`
                SELECT COALESCE(supplier, 'General Supplier') AS supplier,
                       COUNT(*) AS purchases_count,
                       SUM(total) AS total,
                       SUM(total - amount_paid) AS balance
                FROM purchases
                WHERE purchase_date::date BETWEEN $1 AND $2
                GROUP BY supplier ORDER BY total DESC
            `, [from, to]);
            return reply(res, from, to,
                [
                    { key: 'supplier', label: 'Supplier' },
                    { key: 'purchases_count', label: 'Purchases', type: 'num' },
                    { key: 'total', label: 'Total', type: 'money' },
                    { key: 'balance', label: 'Balance Owed', type: 'money' },
                ],
                result.rows,
                ['total', 'balance']);
        }
 
        if (type === 'by-item') {
            const result = await pool.query(`
                SELECT i.item_code, i.name AS item,
                       SUM(pl.qty) AS qty_purchased,
                       SUM(pl.qty * pl.cost_price) AS cost_total
                FROM purchase_lines pl
                JOIN purchases p ON p.purchase_id = pl.purchase_id
                JOIN items i ON i.item_id = pl.item_id
                WHERE p.purchase_date::date BETWEEN $1 AND $2
                GROUP BY i.item_code, i.name ORDER BY cost_total DESC
            `, [from, to]);
            return reply(res, from, to,
                [
                    { key: 'item_code', label: 'Code', type: 'mono' },
                    { key: 'item', label: 'Item' },
                    { key: 'qty_purchased', label: 'Qty Purchased', type: 'num' },
                    { key: 'cost_total', label: 'Cost Total', type: 'money' },
                ],
                result.rows,
                ['qty_purchased', 'cost_total']);
        }
 
        if (type === 'outstanding') {
            const result = await pool.query(`
                SELECT purchase_invoice_no, purchase_date,
                       COALESCE(supplier, 'General Supplier') AS supplier,
                       total, amount_paid, (total - amount_paid) AS balance, payment_status
                FROM purchases
                WHERE purchase_date::date BETWEEN $1 AND $2
                  AND payment_status <> 'paid'
                ORDER BY purchase_date DESC
            `, [from, to]);
            return reply(res, from, to,
                [
                    { key: 'purchase_invoice_no', label: 'Invoice', type: 'mono' },
                    { key: 'purchase_date', label: 'Date', type: 'date' },
                    { key: 'supplier', label: 'Supplier' },
                    { key: 'total', label: 'Total', type: 'money' },
                    { key: 'amount_paid', label: 'Paid', type: 'money' },
                    { key: 'balance', label: 'Balance', type: 'money' },
                    { key: 'payment_status', label: 'Status', type: 'badge' },
                ],
                result.rows,
                ['total', 'amount_paid', 'balance']);
        }
 
        if (type === 'pending-lpo') {
            const result = await pool.query(`
                SELECT purchase_invoice_no, purchase_date,
                       COALESCE(supplier, 'General Supplier') AS supplier,
                       total, status
                FROM purchases
                WHERE purchase_date::date BETWEEN $1 AND $2 AND status = 'lpo'
                ORDER BY purchase_date DESC
            `, [from, to]);
            return reply(res, from, to,
                [
                    { key: 'purchase_invoice_no', label: 'Invoice', type: 'mono' },
                    { key: 'purchase_date', label: 'Date', type: 'date' },
                    { key: 'supplier', label: 'Supplier' },
                    { key: 'total', label: 'Total', type: 'money' },
                    { key: 'status', label: 'Status', type: 'badge' },
                ],
                result.rows,
                ['total']);
        }
 
        if (type === 'detailed') {
            const result = await pool.query(`
                SELECT purchase_invoice_no, purchase_date,
                       COALESCE(supplier, 'General Supplier') AS supplier,
                       status, total, amount_paid, (total - amount_paid) AS balance,
                       payment_status, created_by
                FROM purchases
                WHERE purchase_date::date BETWEEN $1 AND $2
                ORDER BY purchase_date DESC
            `, [from, to]);
            return reply(res, from, to,
                [
                    { key: 'purchase_invoice_no', label: 'Invoice', type: 'mono' },
                    { key: 'purchase_date', label: 'Date', type: 'date' },
                    { key: 'supplier', label: 'Supplier' },
                    { key: 'status', label: 'Status', type: 'badge' },
                    { key: 'total', label: 'Total', type: 'money' },
                    { key: 'amount_paid', label: 'Paid', type: 'money' },
                    { key: 'balance', label: 'Balance', type: 'money' },
                    { key: 'payment_status', label: 'Payment', type: 'badge' },
                    { key: 'created_by', label: 'Created By' },
                ],
                result.rows,
                ['total', 'amount_paid', 'balance']);
        }
 
        res.status(400).json({ error: 'Unknown purchase report type' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to build purchase report' });
    }
});
 
// ============ Expense reports ============
router.get('/expenses', async (req, res) => {
    const { from, to } = resolveDateRange(req);
    const type = req.query.type || 'by-category';
    try {
        if (type === 'by-category') {
            const result = await pool.query(`
                SELECT category, COUNT(*) AS entries, SUM(amount) AS total
                FROM expenses WHERE expense_date BETWEEN $1 AND $2
                GROUP BY category ORDER BY total DESC
            `, [from, to]);
            return reply(res, from, to,
                [
                    { key: 'category', label: 'Category' },
                    { key: 'entries', label: 'Entries', type: 'num' },
                    { key: 'total', label: 'Total', type: 'money' },
                ],
                result.rows,
                ['total']);
        }
 
        if (type === 'daily') {
            const result = await pool.query(`
                SELECT expense_date AS day, COUNT(*) AS entries, SUM(amount) AS total
                FROM expenses WHERE expense_date BETWEEN $1 AND $2
                GROUP BY day ORDER BY day DESC
            `, [from, to]);
            return reply(res, from, to,
                [
                    { key: 'day', label: 'Date', type: 'date' },
                    { key: 'entries', label: 'Entries', type: 'num' },
                    { key: 'total', label: 'Total', type: 'money' },
                ],
                result.rows,
                ['total']);
        }
 
        if (type === 'by-payment-method') {
            const result = await pool.query(`
                SELECT COALESCE(payment_method, 'unspecified') AS method,
                       COUNT(*) AS entries, SUM(amount) AS total
                FROM expenses WHERE expense_date BETWEEN $1 AND $2
                GROUP BY method ORDER BY total DESC
            `, [from, to]);
            return reply(res, from, to,
                [
                    { key: 'method', label: 'Method' },
                    { key: 'entries', label: 'Entries', type: 'num' },
                    { key: 'total', label: 'Total', type: 'money' },
                ],
                result.rows,
                ['total']);
        }
 
        if (type === 'detailed') {
            const result = await pool.query(`
                SELECT expense_code, expense_date, category, description,
                       amount, payment_method, paid_to
                FROM expenses WHERE expense_date BETWEEN $1 AND $2
                ORDER BY expense_date DESC
            `, [from, to]);
            return reply(res, from, to,
                [
                    { key: 'expense_code', label: 'Code', type: 'mono' },
                    { key: 'expense_date', label: 'Date', type: 'date' },
                    { key: 'category', label: 'Category' },
                    { key: 'description', label: 'Description' },
                    { key: 'amount', label: 'Amount', type: 'money' },
                    { key: 'payment_method', label: 'Method' },
                    { key: 'paid_to', label: 'Paid To' },
                ],
                result.rows,
                ['amount']);
        }
 
        res.status(400).json({ error: 'Unknown expense report type' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to build expense report' });
    }
});
 
// ============ Stock reports ============
// These are a snapshot of stock as it stands right now, so they deliberately
// ignore the date range - "stock on hand" isn't a date-range question.
router.get('/stock', async (req, res) => {
    const type = req.query.type || 'current';
    try {
        if (type === 'current') {
            const result = await pool.query(`
                SELECT i.item_code, i.name AS item, c.name AS category, u.short_name AS unit,
                       COALESCE(SUM(b.qty_remaining), 0) AS stock,
                       COALESCE(SUM(b.qty_remaining * b.cost_price), 0) AS stock_value
                FROM items i
                LEFT JOIN categories c ON c.category_id = i.category_id
                LEFT JOIN units_of_measure u ON u.unit_id = i.unit_id
                LEFT JOIN batches b ON b.item_id = i.item_id
                GROUP BY i.item_code, i.name, c.name, u.short_name
                ORDER BY i.name ASC
            `);
            return reply(res, null, null,
                [
                    { key: 'item_code', label: 'Code', type: 'mono' },
                    { key: 'item', label: 'Item' },
                    { key: 'category', label: 'Category' },
                    { key: 'unit', label: 'Unit', type: 'mono' },
                    { key: 'stock', label: 'Stock', type: 'num' },
                    { key: 'stock_value', label: 'Value (Cost)', type: 'money' },
                ],
                result.rows,
                ['stock', 'stock_value']);
        }
 
        if (type === 'by-category') {
            const result = await pool.query(`
                SELECT COALESCE(c.name, 'Uncategorised') AS category,
                       COUNT(DISTINCT i.item_id) AS items,
                       COALESCE(SUM(b.qty_remaining), 0) AS stock,
                       COALESCE(SUM(b.qty_remaining * b.cost_price), 0) AS stock_value
                FROM items i
                LEFT JOIN categories c ON c.category_id = i.category_id
                LEFT JOIN batches b ON b.item_id = i.item_id
                GROUP BY category ORDER BY stock_value DESC
            `);
            return reply(res, null, null,
                [
                    { key: 'category', label: 'Category' },
                    { key: 'items', label: 'Items', type: 'num' },
                    { key: 'stock', label: 'Stock', type: 'num' },
                    { key: 'stock_value', label: 'Value (Cost)', type: 'money' },
                ],
                result.rows,
                ['items', 'stock', 'stock_value']);
        }
 
        if (type === 'out-of-stock') {
            const result = await pool.query(`
                SELECT i.item_code, i.name AS item, c.name AS category
                FROM items i
                LEFT JOIN categories c ON c.category_id = i.category_id
                LEFT JOIN batches b ON b.item_id = i.item_id
                GROUP BY i.item_code, i.name, c.name
                HAVING COALESCE(SUM(b.qty_remaining), 0) = 0
                ORDER BY i.name ASC
            `);
            return reply(res, null, null,
                [
                    { key: 'item_code', label: 'Code', type: 'mono' },
                    { key: 'item', label: 'Item' },
                    { key: 'category', label: 'Category' },
                ],
                result.rows, null);
        }
 
        if (type === 'batches') {
            const result = await pool.query(`
                SELECT b.batch_ref_no, i.name AS item, b.expiry_date,
                       b.qty_in, b.qty_remaining, b.cost_price, b.selling_price,
                       b.date_received
                FROM batches b
                JOIN items i ON i.item_id = b.item_id
                WHERE b.qty_remaining > 0
                ORDER BY b.date_received ASC
            `);
            return reply(res, null, null,
                [
                    { key: 'batch_ref_no', label: 'Batch', type: 'mono' },
                    { key: 'item', label: 'Item' },
                    { key: 'expiry_date', label: 'Expiry', type: 'expiry' },
                    { key: 'qty_in', label: 'Qty In', type: 'num' },
                    { key: 'qty_remaining', label: 'Remaining', type: 'num' },
                    { key: 'cost_price', label: 'Cost', type: 'money' },
                    { key: 'selling_price', label: 'Selling', type: 'money' },
                    { key: 'date_received', label: 'Received', type: 'date' },
                ],
                result.rows,
                ['qty_in', 'qty_remaining']);
        }
 
        if (type === 'expiring') {
            const days = Number(req.query.days) || 30;
            const result = await pool.query(`
                SELECT b.batch_ref_no, i.name AS item, b.expiry_date,
                       b.qty_remaining, b.qty_remaining * b.cost_price AS value_at_risk
                FROM batches b
                JOIN items i ON i.item_id = b.item_id
                WHERE b.qty_remaining > 0
                  AND b.expiry_date IS NOT NULL
                  AND b.expiry_date <= CURRENT_DATE + make_interval(days => $1::int)
                ORDER BY b.expiry_date ASC
            `, [days]);
            return reply(res, null, null,
                [
                    { key: 'batch_ref_no', label: 'Batch', type: 'mono' },
                    { key: 'item', label: 'Item' },
                    { key: 'expiry_date', label: 'Expiry', type: 'expiry' },
                    { key: 'qty_remaining', label: 'Remaining', type: 'num' },
                    { key: 'value_at_risk', label: 'Value at Risk', type: 'money' },
                ],
                result.rows,
                ['qty_remaining', 'value_at_risk']);
        }
 
        res.status(400).json({ error: 'Unknown stock report type' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to build stock report' });
    }
});
 
module.exports = router;
 