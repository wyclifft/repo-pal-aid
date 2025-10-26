/**
 * Approved Devices API Routes
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Get device by device ID
router.get('/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    
    const [devices] = await pool.execute(
      'SELECT * FROM approved_devices WHERE device_id = ?',
      [deviceId]
    );

    if (devices.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Device not found'
      });
    }

    res.json({
      success: true,
      data: devices[0]
    });
  } catch (error) {
    console.error('Get device error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch device',
      details: error.message
    });
  }
});

// Register or update device (upsert)
router.post('/', async (req, res) => {
  try {
    const { device_id, user_id, approved, device_info } = req.body;

    // Validation
    if (!device_id || !user_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: device_id, user_id'
      });
    }

    // Check if device exists
    const [existing] = await pool.execute(
      'SELECT * FROM approved_devices WHERE device_id = ?',
      [device_id]
    );

    let result;

    if (existing.length > 0) {
      // Update existing device
      await pool.execute(
        `UPDATE approved_devices 
         SET user_id = ?, approved = ?, device_info = ?, last_synced = CURRENT_TIMESTAMP 
         WHERE device_id = ?`,
        [user_id, approved !== undefined ? approved : existing[0].approved, device_info || null, device_id]
      );
    } else {
      // Insert new device
      await pool.execute(
        `INSERT INTO approved_devices (device_id, user_id, approved, device_info) 
         VALUES (?, ?, ?, ?)`,
        [device_id, user_id, approved !== undefined ? approved : false, device_info || null]
      );
    }

    const [device] = await pool.execute(
      'SELECT * FROM approved_devices WHERE device_id = ?',
      [device_id]
    );

    res.status(existing.length > 0 ? 200 : 201).json({
      success: true,
      data: device[0],
      message: existing.length > 0 ? 'Device updated successfully' : 'Device registered successfully'
    });
  } catch (error) {
    console.error('Upsert device error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to register/update device',
      details: error.message
    });
  }
});

// Update device status
router.put('/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { approved, user_id } = req.body;

    // Check if device exists
    const [existing] = await pool.execute(
      'SELECT * FROM approved_devices WHERE device_id = ?',
      [deviceId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Device not found'
      });
    }

    const updates = [];
    const values = [];

    if (approved !== undefined) {
      updates.push('approved = ?');
      values.push(approved);
    }

    if (user_id !== undefined) {
      updates.push('user_id = ?');
      values.push(user_id);
    }

    updates.push('last_synced = CURRENT_TIMESTAMP');

    if (updates.length === 1) { // Only timestamp update
      return res.status(400).json({
        success: false,
        error: 'No fields to update'
      });
    }

    values.push(deviceId);

    await pool.execute(
      `UPDATE approved_devices SET ${updates.join(', ')} WHERE device_id = ?`,
      values
    );

    const [updated] = await pool.execute(
      'SELECT * FROM approved_devices WHERE device_id = ?',
      [deviceId]
    );

    res.json({
      success: true,
      data: updated[0],
      message: 'Device updated successfully'
    });
  } catch (error) {
    console.error('Update device error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update device',
      details: error.message
    });
  }
});

// Delete device
router.delete('/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;

    const [result] = await pool.execute(
      'DELETE FROM approved_devices WHERE device_id = ?',
      [deviceId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Device not found'
      });
    }

    res.json({
      success: true,
      message: 'Device deleted successfully'
    });
  } catch (error) {
    console.error('Delete device error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete device',
      details: error.message
    });
  }
});

module.exports = router;
