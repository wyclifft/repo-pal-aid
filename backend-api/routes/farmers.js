/**
 * Farmers API Routes
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Get all farmers (with optional search)
router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    
    let query = 'SELECT * FROM farmers';
    let params = [];

    if (search) {
      query += ' WHERE farmer_id LIKE ? OR name LIKE ?';
      params = [`%${search}%`, `%${search}%`];
    }

    query += ' ORDER BY name ASC';

    const [farmers] = await pool.execute(query, params);
    
    res.json({
      success: true,
      data: farmers
    });
  } catch (error) {
    console.error('Get farmers error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch farmers',
      details: error.message
    });
  }
});

// Get farmer by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const [farmers] = await pool.execute(
      'SELECT * FROM farmers WHERE farmer_id = ?',
      [id]
    );

    if (farmers.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Farmer not found'
      });
    }

    res.json({
      success: true,
      data: farmers[0]
    });
  } catch (error) {
    console.error('Get farmer error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch farmer',
      details: error.message
    });
  }
});

// Create new farmer
router.post('/', async (req, res) => {
  try {
    const { farmer_id, name, route, route_name, member_route } = req.body;

    // Validation
    if (!farmer_id || !name || !route) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: farmer_id, name, route'
      });
    }

    const [result] = await pool.execute(
      'INSERT INTO farmers (farmer_id, name, route, route_name, member_route) VALUES (?, ?, ?, ?, ?)',
      [farmer_id, name, route, route_name || null, member_route || null]
    );

    const [newFarmer] = await pool.execute(
      'SELECT * FROM farmers WHERE farmer_id = ?',
      [farmer_id]
    );

    res.status(201).json({
      success: true,
      data: newFarmer[0],
      message: 'Farmer created successfully'
    });
  } catch (error) {
    console.error('Create farmer error:', error);
    
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        error: 'Farmer ID already exists'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to create farmer',
      details: error.message
    });
  }
});

// Update farmer
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, route, route_name, member_route } = req.body;

    // Check if farmer exists
    const [existing] = await pool.execute(
      'SELECT * FROM farmers WHERE farmer_id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Farmer not found'
      });
    }

    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (route !== undefined) {
      updates.push('route = ?');
      values.push(route);
    }
    if (route_name !== undefined) {
      updates.push('route_name = ?');
      values.push(route_name);
    }
    if (member_route !== undefined) {
      updates.push('member_route = ?');
      values.push(member_route);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update'
      });
    }

    values.push(id);

    await pool.execute(
      `UPDATE farmers SET ${updates.join(', ')} WHERE farmer_id = ?`,
      values
    );

    const [updated] = await pool.execute(
      'SELECT * FROM farmers WHERE farmer_id = ?',
      [id]
    );

    res.json({
      success: true,
      data: updated[0],
      message: 'Farmer updated successfully'
    });
  } catch (error) {
    console.error('Update farmer error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update farmer',
      details: error.message
    });
  }
});

// Delete farmer
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await pool.execute(
      'DELETE FROM farmers WHERE farmer_id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Farmer not found'
      });
    }

    res.json({
      success: true,
      message: 'Farmer deleted successfully'
    });
  } catch (error) {
    console.error('Delete farmer error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete farmer',
      details: error.message
    });
  }
});

module.exports = router;
