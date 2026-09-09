const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');

// GET the active login mode - the login page itself uses this to decide
// whether to show a username field or just a password field.
router.get('/mode', async (req, res) => {
    try {
        const result = await pool.query('SELECT login_mode, username FROM login_settings WHERE id = 1');
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch login mode' });
    }
});

// POST credentials to attempt a login. Username and password are both
// case-insensitive, and there is no minimum length or complexity requirement -
// a single character password is valid if that's what's been set.
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (password === undefined || password === null || password === '') {
        return res.status(400).json({ error: 'Password is required' });
    }

    const normalizedPassword = password.toLowerCase();
    const normalizedUsername = (username || '').trim().toLowerCase();

    try {
        const result = await pool.query('SELECT * FROM login_settings WHERE id = 1');
        const settings = result.rows[0];

        // Superadmin is a hardcoded override, not a database row - it always
        // works regardless of the configured login mode, has full admin
        // access, and can never be deleted because there's nothing to delete.
        const isSuperadmin = settings.login_mode === 'username_password'
            ? normalizedUsername === 'superadmin' && normalizedPassword === 'superadmin'
            : normalizedPassword === 'superadmin';

        if (isSuperadmin) {
            return res.json({ success: true, role: 'superadmin' });
        }

        if (settings.login_mode === 'username_password') {
            if (!normalizedUsername) {
                return res.status(400).json({ error: 'Username is required' });
            }
            if (normalizedUsername !== (settings.username || '').toLowerCase()) {
                return res.status(401).json({ error: 'Invalid username or password' });
            }
        }

        const match = await bcrypt.compare(normalizedPassword, settings.password_hash);
        if (!match) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        res.json({ success: true, role: 'admin' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Login failed' });
    }
});

module.exports = router;
