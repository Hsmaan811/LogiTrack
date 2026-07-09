const express = require('express');
const router = express.Router();
const Delivery = require('./delivery-model');
const TrackingEvent = require('./tracking-model');
const { protect, authorize } = require('./auth-middleware');

router.use(protect, authorize('user'));

// @route POST /api/user/orders
router.post('/orders', async (req, res) => {
  try {
    const { pickupAddress, pickupLat, pickupLng, dropoffAddress, dropoffLat, dropoffLng,
      packageDescription, packageWeight, priority, notes } = req.body;

    if (!pickupLat || !pickupLng || !dropoffLat || !dropoffLng) {
      return res.status(400).json({ message: 'Pickup and dropoff coordinates are required' });
    }

    const delivery = await Delivery.create({
      user: req.user._id,
      pickup: { address: pickupAddress || '', lat: parseFloat(pickupLat), lng: parseFloat(pickupLng) },
      dropoff: { address: dropoffAddress || '', lat: parseFloat(dropoffLat), lng: parseFloat(dropoffLng) },
      packageDescription: packageDescription || 'General Goods',
      packageWeight: packageWeight || '1 kg',
      priority: priority || 'normal',
      notes: notes || '',
      status: 'pending'
    });

    await TrackingEvent.create({
      delivery: delivery._id,
      event: 'order_placed',
      description: 'Your order has been placed and is awaiting assignment',
      location: delivery.pickup,
      timestamp: new Date()
    });

    // Notify admin of new order
    const io = req.app.get('io');
    if (io) io.to('admin_room').emit('delivery:new', delivery);

    res.status(201).json(delivery);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route GET /api/user/orders
router.get('/orders', async (req, res) => {
  try {
    const orders = await Delivery.find({ user: req.user._id })
      .populate('driver', 'name phone vehicleNumber vehicleType avatarColor')
      .sort('-createdAt');
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route GET /api/user/orders/:id
router.get('/orders/:id', async (req, res) => {
  try {
    const delivery = await Delivery.findOne({ _id: req.params.id, user: req.user._id })
      .populate('driver', 'name phone vehicleNumber vehicleType avatarColor');
    if (!delivery) return res.status(404).json({ message: 'Order not found' });

    const events = await TrackingEvent.find({ delivery: delivery._id }).sort('timestamp');
    res.json({ delivery, events });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route GET /api/user/track/:trackingId
// Public-ish route but still needs auth
router.get('/track/:trackingId', async (req, res) => {
  try {
    const delivery = await Delivery.findOne({
      trackingId: req.params.trackingId,
      user: req.user._id
    }).populate('driver', 'name phone vehicleNumber vehicleType avatarColor');

    if (!delivery) return res.status(404).json({ message: 'Tracking ID not found' });

    const events = await TrackingEvent.find({ delivery: delivery._id }).sort('timestamp');
    res.json({ delivery, events });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
