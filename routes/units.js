const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// GET all units of measure
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM units_of_measure ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch units of measure' });
    }
});

// CREATE a unit of measure
router.post('/', async (req, res) => {
    const { name, short_name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Unit name is required' });
    if (!short_name || !short_name.trim()) return res.status(400).json({ error: 'Short name is required' });
    try {
        const result = await pool.query(
            'INSERT INTO units_of_measure (name, short_name) VALUES ($1, $2) RETURNING *',
            [name.trim(), short_name.trim()]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        if (err.code === '23505') {
            return res.status(400).json({ error: 'That unit already exists' });
        }
        res.status(500).json({ error: 'Failed to create unit' });
    }
});

module.exports = router;
