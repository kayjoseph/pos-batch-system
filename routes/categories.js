const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// GET all categories, with how many items are assigned to each
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c.category_id, c.category_code, c.name, c.created_at,
                   COUNT(i.item_id) AS item_count
            FROM categories c
            LEFT JOIN items i ON i.category_id = c.category_id
            GROUP BY c.category_id
            ORDER BY c.category_id ASC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch categories' });
    }
});

// CREATE category - code is auto-generated from the new row's own id (CAT-0001, ...)
router.post('/', async (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Category name is required' });
    try {
        const insertResult = await pool.query(
            'INSERT INTO categories (name) VALUES ($1) RETURNING *',
            [name.trim()]
        );
        const category = insertResult.rows[0];
        const categoryCode = `CAT-${String(category.category_id).padStart(4, '0')}`;
        const updateResult = await pool.query(
            'UPDATE categories SET category_code = $1 WHERE category_id = $2 RETURNING *',
            [categoryCode, category.category_id]
        );
        res.status(201).json(updateResult.rows[0]);
    } catch (err) {
        console.error(err);
        if (err.code === '23505') {
            return res.status(400).json({ error: 'That category already exists' });
        }
        res.status(500).json({ error: 'Failed to create category' });
    }
});

// UPDATE category name (code never changes once assigned)
router.put('/:id', async (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Category name is required' });
    try {
        const result = await pool.query(
            'UPDATE categories SET name = $1 WHERE category_id = $2 RETURNING *',
            [name.trim(), req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Category not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        if (err.code === '23505') {
            return res.status(400).json({ error: 'That category already exists' });
        }
        res.status(500).json({ error: 'Failed to update category' });
    }
});

// DELETE category (only if no items are assigned to it, to avoid orphaned items)
router.delete('/:id', async (req, res) => {
    try {
        const category = await pool.query('SELECT name FROM categories WHERE category_id = $1', [req.params.id]);
        if (category.rows.length === 0) return res.status(404).json({ error: 'Category not found' });

        const inUse = await pool.query('SELECT 1 FROM items WHERE category_id = $1 LIMIT 1', [req.params.id]);
        if (inUse.rows.length > 0) {
            return res.status(400).json({
                error: `Sorry, ${category.rows[0].name} can't be deleted, it is tied to item(s)!`
            });
        }

        await pool.query('DELETE FROM categories WHERE category_id = $1', [req.params.id]);
        res.json({ message: 'Category deleted successfully!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete category' });
    }
});

module.exports = router;
