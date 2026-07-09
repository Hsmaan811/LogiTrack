const jwt = require('jsonwebtoken');
const User = require('./user-model');

const setupSocket = (io) => {
  // Auth middleware for sockets
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = await User.findById(decoded.id).select('-password');
      if (!socket.user) return next(new Error('User not found'));
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user;
    console.log(`🔌 Connected: ${user.name} (${user.role}) — ${socket.id}`);

    // Join role-specific rooms
    if (user.role === 'admin') {
      socket.join('admin_room');
    } else if (user.role === 'driver') {
      socket.join(`driver_${user._id}`);
      socket.join('drivers_room');
      // Update online status
      User.findByIdAndUpdate(user._id, { isOnline: true, isAvailable: true }).exec();
      io.to('admin_room').emit('driver:online', { driverId: user._id, name: user.name });
    } else if (user.role === 'user') {
      socket.join(`user_${user._id}`);
    }

    // Driver sends real-time GPS location
    socket.on('driver:send-location', async (data) => {
      if (user.role !== 'driver') return;
      const { lat, lng, deliveryId } = data;
      try {
        await User.findByIdAndUpdate(user._id, { currentLocation: { lat, lng } });
        const updateData = {
          driverId: user._id,
          name: user.name,
          vehicleType: user.vehicleType,
          avatarColor: user.avatarColor,
          lat, lng,
          timestamp: new Date()
        };
        io.to('admin_room').emit('driver:location-update', updateData);
        io.to(`driver_${user._id}`).emit('driver:location-update', updateData);
        
        if (deliveryId) {
        io.to(`driver_${driverId}`).emit('driver:location-update', updateData);
          const delivery = await Delivery.findById(deliveryId).select('user');
          if (delivery && delivery.user) {
            io.to(`user_${delivery.user}`).emit('driver:location-update', updateData);
          }
        }
      } catch (err) {
        console.error('Location update error:', err.message);
      }
    });

    // Driver adds a checkpoint milestone
    socket.on('delivery:checkpoint', async (data) => {
      if (user.role !== 'driver') return;
      const { deliveryId, description, lat, lng } = data;
      try {
        const TrackingEvent = require('./tracking-model');
        const Delivery = require('./delivery-model');
        const delivery = await Delivery.findOne({ _id: deliveryId, driver: user._id });
        if (!delivery) return;

        const event = await TrackingEvent.create({
          delivery: deliveryId,
          event: 'reached_checkpoint',
          description: description || 'Driver reached a checkpoint',
          location: { lat, lng },
          timestamp: new Date()
        });

        io.to('admin_room').emit('delivery:checkpoint', { deliveryId, event });
        io.to(`user_${delivery.user}`).emit('delivery:milestone', {
          deliveryId,
          trackingId: delivery.trackingId,
          event: 'reached_checkpoint',
          description: description || 'Driver reached a checkpoint',
          timestamp: new Date()
        });
      } catch (err) {
        console.error('Checkpoint error:', err.message);
      }
    });

    socket.on('join:admin', () => {
      if (user.role === 'admin') socket.join('admin_room');
    });

    socket.on('disconnect', async () => {
      console.log(`❌ Disconnected: ${user.name} (${user.role})`);
      if (user.role === 'driver') {
        await User.findByIdAndUpdate(user._id, { isOnline: false });
        io.to('admin_room').emit('driver:offline', { driverId: user._id, name: user.name });
      }
    });
  });
};

module.exports = setupSocket;
