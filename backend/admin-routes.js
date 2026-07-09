const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('./user-model');
const Delivery = require('./delivery-model');
const TrackingEvent = require('./tracking-model');
const { protect, authorize } = require('./auth-middleware');

router.use(protect, authorize('admin'));


router.get('/stats', async (req, res) => {
  try {
    const [totalDeliveries, pendingDeliveries, activeDeliveries, completedDeliveries,
      totalDrivers, onlineDrivers, availableDrivers, totalUsers] = await Promise.all([
      Delivery.countDocuments(),
      Delivery.countDocuments({ status: 'pending' }),
      Delivery.countDocuments({ status: { $in: ['assigned', 'picked_up', 'in_transit', 'out_for_delivery'] } }),
      Delivery.countDocuments({ status: 'delivered' }),
      User.countDocuments({ role: 'driver' }),
      User.countDocuments({ role: 'driver', isOnline: true }),
      User.countDocuments({ role: 'driver', isAvailable: true, isOnline: true }),
      User.countDocuments({ role: 'user' })
    ]);

    res.json({
      totalDeliveries, pendingDeliveries, activeDeliveries, completedDeliveries,
      totalDrivers, onlineDrivers, availableDrivers, totalUsers
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/drivers', async (req, res) => {
  try {
    const drivers = await User.find({ role: 'driver' }).select('-password').sort('-createdAt');
    const driversWithStats = await Promise.all(drivers.map(async (d) => {
      const activeCount = await Delivery.countDocuments({
        driver: d._id,
        status: { $in: ['assigned', 'picked_up', 'in_transit', 'out_for_delivery'] }
      });
      const totalCount = await Delivery.countDocuments({ driver: d._id });
      return { ...d.toObject(), activeDeliveries: activeCount, totalDeliveries: totalCount };
    }));
    res.json(driversWithStats);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/drivers', async (req, res) => {
  try {
    const { name, email, password, phone, vehicleNumber, vehicleType } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: 'Name, email, password are required' });

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ message: 'Email already registered' });

    const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];
    const driver = await User.create({
      name, email, password: password || 'driver123',
      phone: phone || '', role: 'driver',
      vehicleNumber: vehicleNumber || '', vehicleType: vehicleType || 'van',
      avatarColor: colors[Math.floor(Math.random() * colors.length)]
    });

    const { password: _, ...driverData } = driver.toObject();
    res.status(201).json(driverData);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
router.delete('/drivers/:id', async (req, res) => {
  try {
    const driver = await User.findById(req.params.id);
    if (!driver || driver.role !== 'driver') return res.status(404).json({ message: 'Driver not found' });

    await Delivery.updateMany(
      { driver: req.params.id, status: { $in: ['assigned', 'picked_up', 'in_transit', 'out_for_delivery'] } },
      { $set: { driver: null, status: 'pending' } }
    );

    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'Driver deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
router.get('/deliveries', async (req, res) => {
  try {
    const { status, driver, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status && status !== 'all') filter.status = status;
    if (driver) filter.driver = driver;

    const deliveries = await Delivery.find(filter)
      .populate('user', 'name email phone')
      .populate('driver', 'name email phone vehicleNumber vehicleType currentLocation isOnline avatarColor')
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Delivery.countDocuments(filter);
    res.json({ deliveries, total, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route PUT /api/admin/deliveries/:id/assign
router.put('/deliveries/:id/assign', async (req, res) => {
  try {
    const { driverId } = req.body;
    const delivery = await Delivery.findById(req.params.id);
    if (!delivery) return res.status(404).json({ message: 'Delivery not found' });
    if (delivery.status !== 'pending' && delivery.status !== 'assigned') {
      return res.status(400).json({ message: 'Cannot reassign an in-progress delivery' });
    }

    const driver = await User.findById(driverId);
    if (!driver || driver.role !== 'driver') return res.status(404).json({ message: 'Driver not found' });

    delivery.driver = driverId;
    delivery.status = 'assigned';
    await delivery.save();

    // Create tracking event
    await TrackingEvent.create({
      delivery: delivery._id,
      event: 'driver_assigned',
      description: `Driver ${driver.name} has been assigned to your delivery`,
      location: delivery.pickup,
      timestamp: new Date()
    });

    const populated = await Delivery.findById(delivery._id)
      .populate('user', 'name email phone')
      .populate('driver', 'name email phone vehicleNumber vehicleType avatarColor');

    // Emit socket event via app.get('io')
    const io = req.app.get('io');
    if (io) {
      io.to(`driver_${driverId}`).emit('delivery:assigned', populated);
      io.to('admin_room').emit('delivery:updated', populated);
      if (populated.user) {
        io.to(`user_${populated.user._id}`).emit('delivery:updated', populated);
      }
    }

    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
router.get('/deliveries/:id', async (req, res) => {
  try {
    const delivery = await Delivery.findById(req.params.id)
      .populate('user', 'name email phone')
      .populate('driver', 'name email phone vehicleNumber vehicleType avatarColor currentLocation');
    if (!delivery) return res.status(404).json({ message: 'Delivery not found' });

    const events = await TrackingEvent.find({ delivery: delivery._id }).sort('timestamp');
    res.json({ delivery, events });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/drivers/locations', async (req, res) => {
  try {
    const drivers = await User.find({ role: 'driver', isOnline: true })
      .select('name currentLocation isAvailable vehicleType avatarColor');
    res.json(drivers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
