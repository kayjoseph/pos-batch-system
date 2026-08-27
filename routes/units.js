const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// GET all units, with how many items are assigned to each
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.unit_id, u.unit_code, u.name, u.short_name, u.created_at,
                   COUNT(i.item_id) AS item_count
            FROM units_of_measure u
            LEFT JOIN items i ON i.unit_id = u.unit_id
            GROUP BY u.unit_id
            ORDER BY u.unit_id ASC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch units of measure' });
    }
});

// CREATE a unit - code is auto-generated from the new row's own id (UOM-0001, ...)
router.post('/', async (req, res) => {
    const { name, short_name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Unit name is required' });
    if (!short_name || !short_name.trim()) return res.status(400).json({ error: 'Short name is required' });
    try {
        const insertResult = await pool.query(
            'INSERT INTO units_of_measure (name, short_name) VALUES ($1, $2) RETURNING *',
            [name.trim(), short_name.trim()]
        );
        const unit = insertResult.rows[0];
        const unitCode = `UOM-${String(unit.unit_id).padStart(4, '0')}`;
        const updateResult = await pool.query(
            'UPDATE units_of_measure SET unit_code = $1 WHERE unit_id = $2 RETURNING *',
            [unitCode, unit.unit_id]
        );
        res.status(201).json(updateResult.rows[0]);
    } catch (err) {
        console.error(err);
        if (err.code === '23505') {
            return res.status(400).json({ error: 'That unit already exists' });
        }
        res.status(500).json({ error: 'Failed to create unit' });
    }
});

// UPDATE a unit's name/short name (code never changes once assigned)
router.put('/:id', async (req, res) => {
    const { name, short_name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Unit name is required' });
    if (!short_name || !short_name.trim()) return res.status(400).json({ error: 'Short name is required' });
    try {
        const result = await pool.query(
            'UPDATE units_of_measure SET name = $1, short_name = $2 WHERE unit_id = $3 RETURNING *',
            [name.trim(), short_name.trim(), req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Unit not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        if (err.code === '23505') {
            return res.status(400).json({ error: 'That unit already exists' });
        }
        res.status(500).json({ error: 'Failed to update unit' });
    }
});

// DELETE a unit - only when no items use it, so nothing is left pointing at
// a unit that no longer exists.
router.delete('/:id', async (req, res) => {
    try {
        const unit = await pool.query('SELECT name FROM units_of_measure WHERE unit_id = $1', [req.params.id]);
        if (unit.rows.length === 0) return res.status(404).json({ error: 'Unit not found' });

        const inUse = await pool.query('SELECT 1 FROM items WHERE unit_id = $1 LIMIT 1', [req.params.id]);
        if (inUse.rows.length > 0) {
            return res.status(400).json({
                error: `Sorry, ${unit.rows[0].name} can't be deleted, it is tied to item(s)!`
            });
        }

        await pool.query('DELETE FROM units_of_measure WHERE unit_id = $1', [req.params.id]);
        res.json({ message: 'Unit deleted successfully!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete unit' });
    }
});

module.exports = router;
