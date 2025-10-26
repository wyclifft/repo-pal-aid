/**
 * Milk Collection API Routes
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Get all milk collections with filters
router.get('/', async (req, res) => {
  try {
    const { farmer_id, session, date_from, date_to } = req.query;
    
    let query = 'SELECT * FROM milk_collection WHERE 1=1';
    const params = [];

    if (farmer_id) {
      query += ' AND farmer_id = ?';
      params.push(farmer_id);
    }

    if (session) {
      query += ' AND session = ?';
      params.push(session);
    }

    if (date_from) {
      query += ' AND collection_date >= ?';
      params.push(date_from);
    }

    if (date_to) {
      query += ' AND collection_date <= ?';
      params.push(date_to);
    }

    query += ' ORDER BY collection_date DESC';

    const [collections] = await pool.execute(query, params);
    
    res.json({
      success: true,
      data: collections
    });
  } catch (error) {
    console.error('Get milk collections error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch milk collections',
      details: error.message
    });
  }
});

// Get milk collection by reference number
router.get('/ref/:referenceNo', async (req, res) => {
  try {
    const { referenceNo } = req.params;
    
    const [collections] = await pool.execute(
      'SELECT * FROM milk_collection WHERE reference_no = ?',
      [referenceNo]
    );

    if (collections.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Milk collection not found'
      });
    }

    res.json({
      success: true,
      data: collections[0]
    });
  } catch (error) {
    console.error('Get milk collection error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch milk collection',
      details: error.message
    });
  }
});

// Create new milk collection
router.post('/', async (req, res) => {
  try {
    const {
      reference_no,
      farmer_id,
      farmer_name,
      route,
      route_name,
      member_route,
      session,
      weight,
      collected_by,
      clerk_name,
      price_per_liter,
      total_amount,
      collection_date
    } = req.body;

    // Validation
    if (!reference_no || !farmer_id || !farmer_name || !route || !session || !weight || !clerk_name || !collection_date) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    // Verify session is valid
    if (session !== 'AM' && session !== 'PM') {
      return res.status(400).json({
        success: false,
        error: 'Session must be either AM or PM'
      });
    }

    const [result] = await pool.execute(
      `INSERT INTO milk_collection 
       (reference_no, farmer_id, farmer_name, route, route_name, member_route, session, weight, 
        collected_by, clerk_name, price_per_liter, total_amount, collection_date) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reference_no,
        farmer_id,
        farmer_name,
        route,
        route_name || null,
        member_route || null,
        session,
        weight,
        collected_by || null,
        clerk_name,
        price_per_liter || 0,
        total_amount || 0,
        collection_date
      ]
    );

    const [newCollection] = await pool.execute(
      'SELECT * FROM milk_collection WHERE reference_no = ?',
      [reference_no]
    );

    res.status(201).json({
      success: true,
      data: newCollection[0],
      message: 'Milk collection created successfully'
    });
  } catch (error) {
    console.error('Create milk collection error:', error);
    
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        error: 'Reference number already exists'
      });
    }

    if (error.code === 'ER_NO_REFERENCED_ROW_2') {
      return res.status(400).json({
        success: false,
        error: 'Farmer ID does not exist'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to create milk collection',
      details: error.message
    });
  }
});

// Update milk collection (for weight accumulation)
router.put('/ref/:referenceNo', async (req, res) => {
  try {
    const { referenceNo } = req.params;
    const { weight, collection_date } = req.body;

    // Check if collection exists
    const [existing] = await pool.execute(
      'SELECT * FROM milk_collection WHERE reference_no = ?',
      [referenceNo]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Milk collection not found'
      });
    }

    const updates = [];
    const values = [];

    if (weight !== undefined) {
      updates.push('weight = ?');
      values.push(weight);
      
      // Recalculate total amount
      const pricePerLiter = existing[0].price_per_liter;
      updates.push('total_amount = ?');
      values.push(weight * pricePerLiter);
    }

    if (collection_date !== undefined) {
      updates.push('collection_date = ?');
      values.push(collection_date);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update'
      });
    }

    values.push(referenceNo);

    await pool.execute(
      `UPDATE milk_collection SET ${updates.join(', ')} WHERE reference_no = ?`,
      values
    );

    const [updated] = await pool.execute(
      'SELECT * FROM milk_collection WHERE reference_no = ?',
      [referenceNo]
    );

    res.json({
      success: true,
      data: updated[0],
      message: 'Milk collection updated successfully'
    });
  } catch (error) {
    console.error('Update milk collection error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update milk collection',
      details: error.message
    });
  }
});

// Delete milk collection
router.delete('/ref/:referenceNo', async (req, res) => {
  try {
    const { referenceNo } = req.params;

    const [result] = await pool.execute(
      'DELETE FROM milk_collection WHERE reference_no = ?',
      [referenceNo]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Milk collection not found'
      });
    }

    res.json({
      success: true,
      message: 'Milk collection deleted successfully'
    });
  } catch (error) {
    console.error('Delete milk collection error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete milk collection',
      details: error.message
    });
  }
});

module.exports = router;
