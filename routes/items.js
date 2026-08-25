const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// GET all items, with total stock computed live from batches (no stored stock field)
// and category name pulled in from the categories table.
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT i.item_id, i.name, i.sku, i.category_id, c.name AS category,
                   COALESCE(SUM(b.qty_remaining), 0) AS total_stock,
                   (SELECT b2.selling_price FROM batches b2
                    WHERE b2.item_id = i.item_id AND b2.qty_remaining > 0
                    ORDER BY b2.date_received ASC, b2.batch_id ASC LIMIT 1) AS next_price
            FROM items i
            LEFT JOIN categories c ON c.category_id = i.category_id
            LEFT JOIN batches b ON b.item_id = i.item_id
            GROUP BY i.item_id, c.name
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
            SELECT i.*, c.name AS category
            FROM items i
            LEFT JOIN categories c ON c.category_id = i.category_id
            WHERE i.item_id = $1
        `, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch item' });
    }
});

// CREATE item. If no SKU is given, auto-assign one from the item's own id
// (e.g. the 10th item ever registered gets "0010") - so every item always
// has a code to search and sort by, even if the person skips the field.
router.post('/', async (req, res) => {
    const { name, sku, category_id } = req.body;
    if (!name) return res.status(400).json({ error: 'Item name is required' });
    try {
        const insertResult = await pool.query(
            'INSERT INTO items (name, sku, category_id) VALUES ($1, $2, $3) RETURNING *',
            [name, (sku && sku.trim()) || null, category_id || null]
        );
        let item = insertResult.rows[0];

        if (!item.sku) {
            const autoSku = String(item.item_id).padStart(4, '0');
            const updateResult = await pool.query(
                'UPDATE items SET sku = $1 WHERE item_id = $2 RETURNING *',
                [autoSku, item.item_id]
            );
            item = updateResult.rows[0];
        }

        res.status(201).json(item);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create item' });
    }
});

// UPDATE item
router.put('/:id', async (req, res) => {
    const { name, sku, category_id } = req.body;
    try {
        const result = await pool.query(
            'UPDATE items SET name = $1, sku = $2, category_id = $3 WHERE item_id = $4 RETURNING *',
            [name, sku || null, category_id || null, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update item' });
    }
});

// DELETE item
router.delete('/:id', async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM items WHERE item_id = $1 RETURNING *', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
        res.json({ message: 'Item deleted' });
    } catch (err) {
        console.error(err);
        // Likely a foreign key issue (item has batches/sales history)
        res.status(400).json({ error: 'Cannot delete item - it may have batch or sales history' });
    }
});

module.exports = router;
