const mongoose = require('mongoose');
const crypto = require('crypto');

const locationSchema = new mongoose.Schema({
  address: { type: String, default: '' },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true }
}, { _id: false });

const deliverySchema = new mongoose.Schema({
  trackingId: {
    type: String,
    unique: true,
    default: () => 'LT-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase()
  },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  driver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  pickup: { type: locationSchema, required: true },
  dropoff: { type: locationSchema, required: true },

  packageDescription: { type: String, default: 'General Goods' },
  packageWeight: { type: String, default: '1 kg' },

  status: {
    type: String,
    enum: ['pending', 'assigned', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'cancelled'],
    default: 'pending'
  },

  // Stored route from OSRM calculation
  routeWaypoints: [{ lat: Number, lng: Number }],
  estimatedDistance: { type: String, default: '' },
  estimatedDuration: { type: String, default: '' },

  // Driver's current position index along route (for simulation)
  currentRouteIndex: { type: Number, default: 0 },

  priority: { type: String, enum: ['normal', 'express', 'urgent'], default: 'normal' },
  notes: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('Delivery', deliverySchema);
