const express = require('express');
const router = express.Router();
const User = require('./user-model');
const Delivery = require('./delivery-model');
const TrackingEvent = require('./tracking-model');
const { protect, authorize } = require('./auth-middleware');

router.use(protect, authorize('driver'));

const STATUS_FLOW = {
  assigned: 'picked_up',
  picked_up: 'in_transit',
  in_transit: 'out_for_delivery',
  out_for_delivery: 'delivered'
};

const STATUS_EVENTS = {
  picked_up: { event: 'picked_up', description: 'Package has been picked up by the driver' },
  in_transit: { event: 'in_transit', description: 'Package is in transit' },
  out_for_delivery: { event: 'out_for_delivery', description: 'Package is out for delivery' },
  delivered: { event: 'delivered', description: 'Package has been delivered successfully!' }
};

// @route GET /api/driver/deliveries
router.get('/deliveries', async (req, res) => {
  try {
    const deliveries = await Delivery.find({ driver: req.user._id })
      .populate('user', 'name email phone')
      .sort('-createdAt');
    res.json(deliveries);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route GET /api/driver/deliveries/active
router.get('/deliveries/active', async (req, res) => {
  try {
    const deliveries = await Delivery.find({
      driver: req.user._id,
      status: { $in: ['assigned', 'picked_up', 'in_transit', 'out_for_delivery'] }
    })
      .populate('user', 'name email phone')
      .sort('-createdAt');
    res.json(deliveries);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route PUT /api/driver/deliveries/:id/status
router.put('/deliveries/:id/status', async (req, res) => {
  try {
    const delivery = await Delivery.findOne({ _id: req.params.id, driver: req.user._id });
    if (!delivery) return res.status(404).json({ message: 'Delivery not found' });

    const nextStatus = STATUS_FLOW[delivery.status];
    if (!nextStatus) return res.status(400).json({ message: 'Cannot advance status further' });

    delivery.status = nextStatus;
    await delivery.save();

    const eventData = STATUS_EVENTS[nextStatus];
    const driver = req.user;

    await TrackingEvent.create({
      delivery: delivery._id,
      event: eventData.event,
      description: eventData.description,
      location: nextStatus === 'picked_up' ? delivery.pickup :
        nextStatus === 'delivered' ? delivery.dropoff :
          { lat: driver.currentLocation?.lat || delivery.pickup.lat, lng: driver.currentLocation?.lng || delivery.pickup.lng },
      timestamp: new Date()
    });

    const populated = await Delivery.findById(delivery._id).populate('user', 'name email phone');

    const io = req.app.get('io');
    if (io) {
      io.to('admin_room').emit('delivery:updated', populated);
      if (populated.user) {
        io.to(`user_${populated.user._id}`).emit('delivery:milestone', {
          deliveryId: delivery._id,
          trackingId: delivery.trackingId,
          status: nextStatus,
          description: eventData.description,
          timestamp: new Date()
        });
      }
    }

    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route PUT /api/driver/location
router.put('/location', async (req, res) => {
  try {
    const { lat, lng } = req.body;
    if (!lat || !lng) return res.status(400).json({ message: 'lat and lng required' });

    await User.findByIdAndUpdate(req.user._id, { currentLocation: { lat, lng } });

    const io = req.app.get('io');
    if (io) {
      const updateData = {
        driverId: req.user._id,
        name: req.user.name,
        vehicleType: req.user.vehicleType,
        avatarColor: req.user.avatarColor,
        lat, lng,
        timestamp: new Date()
      };

      io.to('admin_room').emit('driver:location-update', updateData);
      io.to(`driver_${req.user._id}`).emit('driver:location-update', updateData);

      const activeDelivery = await Delivery.findOne({
        driver: req.user._id,
        status: { $in: ['assigned', 'picked_up', 'in_transit', 'out_for_delivery'] }
      }).select('user');
              io.to(`driver_${req.user._id}`).emit('driver:location-update', updateData);

      if (activeDelivery?.user) {
        io.to(`user_${activeDelivery.user}`).emit('driver:location-update', updateData);
      }
    }

    res.json({ message: 'Location updated' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route PUT /api/driver/availability
router.put('/availability', async (req, res) => {
  try {
    const { isOnline } = req.body;
    const driver = await User.findByIdAndUpdate(
      req.user._id,
      { isOnline, isAvailable: isOnline },
      { new: true }
    ).select('-password');

    const io = req.app.get('io');
    if (io) {
      io.to('admin_room').emit(isOnline ? 'driver:online' : 'driver:offline', {
        driverId: driver._id, name: driver.name
      });
    }

    res.json(driver);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route PUT /api/driver/deliveries/:id/route
router.put('/deliveries/:id/route', async (req, res) => {
  try {
    const { waypoints, distance, duration } = req.body;
    await Delivery.findByIdAndUpdate(req.params.id, {
      routeWaypoints: waypoints,
      estimatedDistance: distance,
      estimatedDuration: duration
    });
    res.json({ message: 'Route saved' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Store active simulation intervals
const activeSimulations = new Map();

// @route POST /api/driver/deliveries/:id/simulate
router.post('/deliveries/:id/simulate', async (req, res) => {
  try {
    const delivery = await Delivery.findOne({ _id: req.params.id, driver: req.user._id });
    if (!delivery) return res.status(404).json({ message: 'Delivery not found' });
    if (!delivery.routeWaypoints || delivery.routeWaypoints.length === 0) {
      return res.status(400).json({ message: 'Route not calculated yet' });
    }

    const driverId = req.user._id.toString();
    const io = req.app.get('io');
    const waypoints = delivery.routeWaypoints;
    const name = req.user.name;
    const speed = req.body.speed || 3;

    // Stop existing simulation for this driver if any
    if (activeSimulations.has(driverId)) {
      clearInterval(activeSimulations.get(driverId));
    }

    let currentIndex = 0;
    const interval = setInterval(async () => {
      if (currentIndex >= waypoints.length) {
        clearInterval(activeSimulations.get(driverId));
        activeSimulations.delete(driverId);
        return;
      }

      const point = waypoints[currentIndex];
      currentIndex += speed; // Advance by speed

      // Update DB
      await User.findByIdAndUpdate(driverId, { currentLocation: { lat: point.lat, lng: point.lng } });

      // Emit to sockets
      if (io) {
        const updateData = {
          driverId, name,
          lat: point.lat, lng: point.lng,
          timestamp: new Date()
        };
        io.to('admin_room').emit('driver:location-update', updateData);
        io.to(`driver_${driverId}`).emit('driver:location-update', updateData);
        if (delivery.user) {
          io.to(`user_${delivery.user}`).emit('driver:location-update', updateData);
        }
      }
    }, 2000); // Move every 2 seconds

    activeSimulations.set(driverId, interval);

    res.json({ message: 'Backend simulation started' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route POST /api/driver/simulate/stop
router.post('/simulate/stop', async (req, res) => {
  const driverId = req.user._id.toString();
  if (activeSimulations.has(driverId)) {
    clearInterval(activeSimulations.get(driverId));
    activeSimulations.delete(driverId);
  }
  res.json({ message: 'Simulation stopped' });
});

module.exports = router;
