const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// GET all items, with total stock computed live from batches (no stored stock field),
// category name and unit short name pulled in via joins.
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT i.item_id, i.item_code, i.name, i.sku, i.category_id, c.name AS category,
                   i.unit_id, u.name AS unit_name, u.short_name AS unit_short_name,
                   COALESCE(SUM(b.qty_remaining), 0) AS total_stock,
                   (SELECT b2.selling_price FROM batches b2
                    WHERE b2.item_id = i.item_id AND b2.qty_remaining > 0
                    ORDER BY b2.date_received ASC, b2.batch_id ASC LIMIT 1) AS next_price
            FROM items i
            LEFT JOIN categories c ON c.category_id = i.category_id
            LEFT JOIN units_of_measure u ON u.unit_id = i.unit_id
            LEFT JOIN batches b ON b.item_id = i.item_id
            GROUP BY i.item_id, c.name, u.name, u.short_name
            ORDER BY i.name ASC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch items' });
    }
});

// GET single item
router.get('/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT i.*, c.name AS category, u.name AS unit_name, u.short_name AS unit_short_name
            FROM items i
            LEFT JOIN categories c ON c.category_id = i.category_id
            LEFT JOIN units_of_measure u ON u.unit_id = i.unit_id
            WHERE i.item_id = $1
        `, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch item' });
    }
});

// CREATE item - name, category, and unit are required. SKU is optional.
// item_code is never taken from the request - it's always assigned from the
// new row's own id right after insert, so it's guaranteed to match item_id.
router.post('/', async (req, res) => {
    const { name, sku, category_id, unit_id } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Item name is required' });
    if (!category_id) return res.status(400).json({ error: 'Category is required' });
    if (!unit_id) return res.status(400).json({ error: 'Unit of measure is required' });
    try {
        const insertResult = await pool.query(
            'INSERT INTO items (name, sku, category_id, unit_id) VALUES ($1, $2, $3, $4) RETURNING *',
            [name.trim(), (sku && sku.trim()) || null, category_id, unit_id]
        );
        const item = insertResult.rows[0];
        const itemCode = String(item.item_id).padStart(4, '0');
        const updateResult = await pool.query(
            'UPDATE items SET item_code = $1 WHERE item_id = $2 RETURNING *',
            [itemCode, item.item_id]
        );
        res.status(201).json(updateResult.rows[0]);
    } catch (err) {
        console.error(err);
        if (err.code === '23505') {
            return res.status(400).json({ error: 'That SKU is already in use' });
        }
        res.status(500).json({ error: 'Failed to create item' });
    }
});

// UPDATE item - name/category/unit required, SKU optional. item_code is
// immutable - it's left out of this query entirely so it can never drift
// from item_id once assigned.
router.put('/:id', async (req, res) => {
    const { name, sku, category_id, unit_id } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Item name is required' });
    if (!category_id) return res.status(400).json({ error: 'Category is required' });
    if (!unit_id) return res.status(400).json({ error: 'Unit of measure is required' });
    try {
        const result = await pool.query(
            'UPDATE items SET name = $1, sku = $2, category_id = $3, unit_id = $4 WHERE item_id = $5 RETURNING *',
            [name.trim(), (sku && sku.trim()) || null, category_id, unit_id, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        if (err.code === '23505') {
            return res.status(400).json({ error: 'That SKU is already in use' });
        }
        res.status(500).json({ error: 'Failed to update item' });
    }
});

// DELETE item - blocked if it has any purchase or sales history, so records
// (and the traceability they provide) are never left pointing at nothing.
router.delete('/:id', async (req, res) => {
    try {
        const item = await pool.query('SELECT name FROM items WHERE item_id = $1', [req.params.id]);
        if (item.rows.length === 0) return res.status(404).json({ error: 'Item not found' });

        const [inBatches, inSales, inPurchaseLines] = await Promise.all([
            pool.query('SELECT 1 FROM batches WHERE item_id = $1 LIMIT 1', [req.params.id]),
            pool.query('SELECT 1 FROM sale_items WHERE item_id = $1 LIMIT 1', [req.params.id]),
            pool.query('SELECT 1 FROM purchase_lines WHERE item_id = $1 LIMIT 1', [req.params.id]),
        ]);

        if (inBatches.rows.length > 0 || inSales.rows.length > 0 || inPurchaseLines.rows.length > 0) {
            return res.status(400).json({
                error: `Sorry, ${item.rows[0].name} can't be deleted, it has purchase or sales history tied to it!`
            });
        }

        await pool.query('DELETE FROM items WHERE item_id = $1', [req.params.id]);
        res.json({ message: 'Item deleted successfully!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete item' });
    }
});

module.exports = router;
