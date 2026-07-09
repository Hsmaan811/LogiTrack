const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./server/models/User');
const Delivery = require('./server/models/Delivery');
const TrackingEvent = require('./server/models/TrackingEvent');

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Clear existing data
    await Promise.all([User.deleteMany(), Delivery.deleteMany(), TrackingEvent.deleteMany()]);
    console.log('🗑️  Cleared existing data');

    // Create Admin
    const admin = await User.create({
      name: 'Admin Manager', email: 'admin@logistics.com', password: 'admin123',
      phone: '+91-9000000001', role: 'admin', avatarColor: '#ef4444'
    });

    // Create Drivers
    const driverData = [
      { name: 'Ravi Kumar', email: 'ravi@driver.com', phone: '+91-9111111111', vehicleNumber: 'DL-01-AB-1234', vehicleType: 'van', avatarColor: '#3b82f6', currentLocation: { lat: 28.6139, lng: 77.2090 } },
      { name: 'Priya Singh', email: 'priya@driver.com', phone: '+91-9222222222', vehicleNumber: 'MH-12-CD-5678', vehicleType: 'bike', avatarColor: '#8b5cf6', currentLocation: { lat: 19.0760, lng: 72.8777 } },
      { name: 'Amit Sharma', email: 'amit@driver.com', phone: '+91-9333333333', vehicleNumber: 'KA-05-EF-9012', vehicleType: 'truck', avatarColor: '#10b981', currentLocation: { lat: 12.9716, lng: 77.5946 } },
    ];

    const drivers = [];
    for (const d of driverData) {
      const driver = await User.create({ ...d, password: 'driver123', role: 'driver', isOnline: true, isAvailable: true });
      drivers.push(driver);
    }

    // Create Users
    const userData = [
      { name: 'Neha Gupta', email: 'neha@user.com', phone: '+91-9444444444', avatarColor: '#f59e0b' },
      { name: 'Arjun Patel', email: 'arjun@user.com', phone: '+91-9555555555', avatarColor: '#06b6d4' },
    ];

    const users = [];
    for (const u of userData) {
      const user = await User.create({ ...u, password: 'user123', role: 'user' });
      users.push(user);
    }

    // Create Deliveries
    const deliveryDefs = [
      {
        user: users[0]._id, driver: drivers[0]._id,
        pickup: { address: 'Connaught Place, New Delhi', lat: 28.6315, lng: 77.2167 },
        dropoff: { address: 'Sector 18, Noida', lat: 28.5697, lng: 77.3215 },
        packageDescription: 'Electronics - Laptop', packageWeight: '3 kg',
        status: 'in_transit', priority: 'express'
      },
      {
        user: users[1]._id, driver: drivers[1]._id,
        pickup: { address: 'Bandra West, Mumbai', lat: 19.0596, lng: 72.8295 },
        dropoff: { address: 'Andheri East, Mumbai', lat: 19.1136, lng: 72.8697 },
        packageDescription: 'Clothing & Accessories', packageWeight: '2 kg',
        status: 'picked_up', priority: 'normal'
      },
      {
        user: users[0]._id, driver: null,
        pickup: { address: 'MG Road, Bengaluru', lat: 12.9756, lng: 77.6099 },
        dropoff: { address: 'Electronic City, Bengaluru', lat: 12.8456, lng: 77.6603 },
        packageDescription: 'Books & Stationery', packageWeight: '1.5 kg',
        status: 'pending', priority: 'normal'
      },
      {
        user: users[1]._id, driver: drivers[2]._id,
        pickup: { address: 'Koramangala, Bengaluru', lat: 12.9352, lng: 77.6245 },
        dropoff: { address: 'Whitefield, Bengaluru', lat: 12.9698, lng: 77.7500 },
        packageDescription: 'Medical Supplies', packageWeight: '0.5 kg',
        status: 'delivered', priority: 'urgent'
      },
      {
        user: users[0]._id, driver: drivers[0]._id,
        pickup: { address: 'Karol Bagh, New Delhi', lat: 28.6519, lng: 77.1909 },
        dropoff: { address: 'Dwarka Sector 21, New Delhi', lat: 28.5526, lng: 77.0577 },
        packageDescription: 'Home Appliances - Mixer', packageWeight: '5 kg',
        status: 'assigned', priority: 'normal'
      }
    ];

    const deliveries = [];
    for (const d of deliveryDefs) {
      const del = await Delivery.create(d);
      deliveries.push(del);
    }

    // Create Tracking Events
    const now = new Date();
    const eventsData = [
      // Delivery 0 - in_transit
      { delivery: deliveries[0]._id, event: 'order_placed', description: 'Order placed and awaiting pickup', location: deliveries[0].pickup, timestamp: new Date(now - 4 * 3600000) },
      { delivery: deliveries[0]._id, event: 'driver_assigned', description: `Driver Ravi Kumar assigned`, location: deliveries[0].pickup, timestamp: new Date(now - 3 * 3600000) },
      { delivery: deliveries[0]._id, event: 'picked_up', description: 'Package picked up by driver', location: deliveries[0].pickup, timestamp: new Date(now - 2 * 3600000) },
      { delivery: deliveries[0]._id, event: 'in_transit', description: 'Package is in transit to destination', location: { lat: 28.6 , lng: 77.25 }, timestamp: new Date(now - 1 * 3600000) },

      // Delivery 1 - picked_up
      { delivery: deliveries[1]._id, event: 'order_placed', description: 'Order placed', location: deliveries[1].pickup, timestamp: new Date(now - 2 * 3600000) },
      { delivery: deliveries[1]._id, event: 'driver_assigned', description: 'Driver Priya Singh assigned', location: deliveries[1].pickup, timestamp: new Date(now - 1.5 * 3600000) },
      { delivery: deliveries[1]._id, event: 'picked_up', description: 'Package picked up', location: deliveries[1].pickup, timestamp: new Date(now - 0.5 * 3600000) },

      // Delivery 2 - pending
      { delivery: deliveries[2]._id, event: 'order_placed', description: 'Order placed and awaiting driver assignment', location: deliveries[2].pickup, timestamp: new Date(now - 0.5 * 3600000) },

      // Delivery 3 - delivered
      { delivery: deliveries[3]._id, event: 'order_placed', description: 'Order placed', location: deliveries[3].pickup, timestamp: new Date(now - 8 * 3600000) },
      { delivery: deliveries[3]._id, event: 'driver_assigned', description: 'Driver Amit Sharma assigned', location: deliveries[3].pickup, timestamp: new Date(now - 7 * 3600000) },
      { delivery: deliveries[3]._id, event: 'picked_up', description: 'Package picked up', location: deliveries[3].pickup, timestamp: new Date(now - 6 * 3600000) },
      { delivery: deliveries[3]._id, event: 'in_transit', description: 'In transit', location: { lat: 12.95, lng: 77.68 }, timestamp: new Date(now - 4 * 3600000) },
      { delivery: deliveries[3]._id, event: 'out_for_delivery', description: 'Out for delivery in your area', location: { lat: 12.965, lng: 77.745 }, timestamp: new Date(now - 2 * 3600000) },
      { delivery: deliveries[3]._id, event: 'delivered', description: 'Package delivered successfully!', location: deliveries[3].dropoff, timestamp: new Date(now - 1 * 3600000) },

      // Delivery 4 - assigned
      { delivery: deliveries[4]._id, event: 'order_placed', description: 'Order placed', location: deliveries[4].pickup, timestamp: new Date(now - 1 * 3600000) },
      { delivery: deliveries[4]._id, event: 'driver_assigned', description: 'Driver Ravi Kumar assigned', location: deliveries[4].pickup, timestamp: new Date(now - 0.5 * 3600000) },
    ];

    await TrackingEvent.insertMany(eventsData);

    console.log('\n🌱 Database seeded successfully!\n');
    console.log('═══════════════════════════════════════');
    console.log('📋 Login Credentials:');
    console.log('───────────────────────────────────────');
    console.log('👑 Admin:  admin@logistics.com / admin123');
    console.log('🚛 Driver: ravi@driver.com / driver123');
    console.log('🚛 Driver: priya@driver.com / driver123');
    console.log('🚛 Driver: amit@driver.com / driver123');
    console.log('📦 User:   neha@user.com / user123');
    console.log('📦 User:   arjun@user.com / user123');
    console.log('═══════════════════════════════════════\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Seed error:', error);
    process.exit(1);
  }
};

seed();
