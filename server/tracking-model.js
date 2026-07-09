const mongoose = require('mongoose');

const trackingEventSchema = new mongoose.Schema({
  delivery: { type: mongoose.Schema.Types.ObjectId, ref: 'Delivery', required: true },
  event: {
    type: String,
    enum: ['order_placed', 'driver_assigned', 'picked_up', 'in_transit',
      'reached_checkpoint', 'out_for_delivery', 'delivered', 'cancelled'],
    required: true
  },
  description: { type: String, required: true },
  location: {
    lat: { type: Number },
    lng: { type: Number },
    address: { type: String, default: '' }
  },
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('TrackingEvent', trackingEventSchema);
