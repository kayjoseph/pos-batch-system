const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

router.get('/summary', async (req, res) => {
    try {
        const [
            salesTotals,
            purchaseTotals,
            expenseTotals,
            grossProfit,
            itemStats,
            stockValue,
            expiringBatches,
            salesTrend,
            topItems,
            recentSales,
            customerBalance,
            supplierBalance,
        ] = await Promise.all([
            pool.query(`
                SELECT
                    COALESCE(SUM(total) FILTER (WHERE sale_date::date = CURRENT_DATE), 0) AS sales_today,
                    COALESCE(SUM(total) FILTER (WHERE sale_date >= date_trunc('week', CURRENT_DATE)), 0) AS sales_week,
                    COALESCE(SUM(total) FILTER (WHERE sale_date >= date_trunc('month', CURRENT_DATE)), 0) AS sales_month,
                    COUNT(*) FILTER (WHERE sale_date::date = CURRENT_DATE) AS sales_count_today
                FROM sales
            `),
            pool.query(`
                SELECT
                    COALESCE(SUM(total) FILTER (WHERE purchase_date >= date_trunc('month', CURRENT_DATE)), 0) AS purchases_month,
                    COUNT(*) FILTER (WHERE status = 'lpo') AS pending_lpo_count
                FROM purchases
            `),
            pool.query(`
                SELECT COALESCE(SUM(amount) FILTER (WHERE expense_date >= date_trunc('month', CURRENT_DATE)), 0) AS expenses_month
                FROM expenses
            `),
            pool.query(`
                SELECT COALESCE(SUM((si.unit_price - b.cost_price) * si.qty), 0) AS gross_profit_month
                FROM sale_items si
                JOIN sales s ON s.sale_id = si.sale_id
                JOIN batches b ON b.batch_id = si.batch_id
                WHERE s.sale_date >= date_trunc('month', CURRENT_DATE)
            `),
            pool.query(`
                SELECT
                    COUNT(*) AS total_items,
                    COUNT(*) FILTER (WHERE stock = 0) AS out_of_stock_items
                FROM (
                    SELECT i.item_id, COALESCE(SUM(b.qty_remaining), 0) AS stock
                    FROM items i LEFT JOIN batches b ON b.item_id = i.item_id
                    GROUP BY i.item_id
                ) t
            `),
            pool.query(`SELECT COALESCE(SUM(qty_remaining * cost_price), 0) AS stock_value FROM batches`),
            pool.query(`
                SELECT b.batch_ref_no, b.expiry_date, b.qty_remaining, i.name AS item_name
                FROM batches b
                JOIN items i ON i.item_id = b.item_id
                WHERE b.qty_remaining > 0 AND b.expiry_date IS NOT NULL
                  AND b.expiry_date <= CURRENT_DATE + INTERVAL '30 days'
                ORDER BY b.expiry_date ASC
                LIMIT 8
            `),
            pool.query(`
                SELECT to_char(d::date, 'Dy') AS day_label, to_char(d::date, 'YYYY-MM-DD') AS day_key,
                       COALESCE(SUM(s.total), 0) AS total
                FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day') d
                LEFT JOIN sales s ON s.sale_date::date = d::date
                GROUP BY d
                ORDER BY d ASC
            `),
            pool.query(`
                SELECT i.name, SUM(si.qty) AS qty_sold
                FROM sale_items si
                JOIN sales s ON s.sale_id = si.sale_id
                JOIN items i ON i.item_id = si.item_id
                WHERE s.sale_date >= date_trunc('month', CURRENT_DATE)
                GROUP BY i.name
                ORDER BY qty_sold DESC
                LIMIT 5
            `),
            pool.query(`
                SELECT sale_id, invoice_no, customer_name, total, status, sale_date
                FROM sales ORDER BY sale_date DESC LIMIT 8
            `),
            pool.query(`SELECT COALESCE(SUM(opening_balance) FILTER (WHERE opening_balance > 0), 0) AS amount FROM customers`),
            pool.query(`SELECT COALESCE(SUM(opening_balance) FILTER (WHERE opening_balance > 0), 0) AS amount FROM suppliers`),
        ]);

        res.json({
            sales: salesTotals.rows[0],
            purchases: purchaseTotals.rows[0],
            expenses: expenseTotals.rows[0],
            gross_profit_month: grossProfit.rows[0].gross_profit_month,
            items: itemStats.rows[0],
            stock_value: stockValue.rows[0].stock_value,
            expiring_batches: expiringBatches.rows,
            sales_trend: salesTrend.rows,
            top_items: topItems.rows,
            recent_sales: recentSales.rows,
            customers_owe_us: customerBalance.rows[0].amount,
            we_owe_suppliers: supplierBalance.rows[0].amount,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to load dashboard summary' });
    }
});

module.exports = router;
