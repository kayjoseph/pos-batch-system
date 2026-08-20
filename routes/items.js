const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// GET all items, with total stock computed live from batches (no stored stock field)
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT i.item_id, i.name, i.sku, i.category,
                   COALESCE(SUM(b.qty_remaining), 0) AS total_stock
            FROM items i
            LEFT JOIN batches b ON b.item_id = i.item_id
            GROUP BY i.item_id
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
        const result = await pool.query('SELECT * FROM items WHERE item_id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch item' });
    }
});

// CREATE item
router.post('/', async (req, res) => {
    const { name, sku, category } = req.body;
    if (!name) return res.status(400).json({ error: 'Item name is required' });
    try {
        const result = await pool.query(
            'INSERT INTO items (name, sku, category) VALUES ($1, $2, $3) RETURNING *',
            [name, sku || null, category || null]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create item' });
    }
});

// UPDATE item
router.put('/:id', async (req, res) => {
    const { name, sku, category } = req.body;
    try {
        const result = await pool.query(
            'UPDATE items SET name = $1, sku = $2, category = $3 WHERE item_id = $4 RETURNING *',
            [name, sku || null, category || null, req.params.id]
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
