const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// ============ Company ============
router.get('/company', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM company_settings WHERE id = 1');
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch company settings' });
    }
});

router.put('/company', async (req, res) => {
    const { company_name, phone, email, address, location, registration_no } = req.body;
    if (!company_name || !company_name.trim()) return res.status(400).json({ error: 'Company name is required' });
    try {
        const result = await pool.query(
            `UPDATE company_settings
             SET company_name = $1, phone = $2, email = $3, address = $4, location = $5, registration_no = $6, updated_at = NOW()
             WHERE id = 1 RETURNING *`,
            [
                company_name.trim(),
                (phone && phone.trim()) || null,
                (email && email.trim()) || null,
                (address && address.trim()) || null,
                (location && location.trim()) || null,
                (registration_no && registration_no.trim()) || null,
            ]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update company settings' });
    }
});

// ============ Printer ============
router.get('/printer', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM printer_settings WHERE id = 1');
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch printer settings' });
    }
});

router.put('/printer', async (req, res) => {
    const { paper_size, connection_type, receipt_font_size } = req.body;
    const validPaperSizes = ['58mm', '80mm', 'other'];
    const validConnections = ['usb', 'bluetooth', 'network'];
    const fontSize = Number(receipt_font_size);

    if (!validPaperSizes.includes(paper_size)) return res.status(400).json({ error: 'Invalid paper size' });
    if (!validConnections.includes(connection_type)) return res.status(400).json({ error: 'Invalid connection type' });
    if (!Number.isInteger(fontSize) || fontSize < 8 || fontSize > 14) {
        return res.status(400).json({ error: 'Font size must be a whole number between 8 and 14' });
    }

    try {
        const result = await pool.query(
            `UPDATE printer_settings
             SET paper_size = $1, connection_type = $2, receipt_font_size = $3, updated_at = NOW()
             WHERE id = 1 RETURNING *`,
            [paper_size, connection_type, fontSize]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update printer settings' });
    }
});

// ============ Site (logo/branding) ============
router.get('/site', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM site_settings WHERE id = 1');
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch site settings' });
    }
});

router.put('/site', async (req, res) => {
    const { logo_data, logo_size } = req.body;
    const validSizes = ['small', 'medium', 'large'];
    if (!validSizes.includes(logo_size)) return res.status(400).json({ error: 'Invalid logo size' });

    try {
        const result = await pool.query(
            `UPDATE site_settings SET logo_data = $1, logo_size = $2, updated_at = NOW() WHERE id = 1 RETURNING *`,
            [logo_data || null, logo_size]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update site settings' });
    }
});

module.exports = router;
