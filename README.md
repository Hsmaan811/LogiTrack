# Logistics Tracker

A full-stack, real-time fleet logistics tracking platform that utilizes Socket.IO and Leaflet.js to seamlessly synchronize delivery workflows between administrators, drivers, and customers.

## Features

- Admin dashboard for managing drivers, deliveries, and live tracking
- Driver dashboard for viewing assigned deliveries, updating delivery status, and sharing live location
- User dashboard for placing orders and tracking shipments
- Real-time updates with Socket.IO
- MongoDB-backed data models for users, deliveries, and tracking events
- Route generation and simulation support for delivery movement
- Responsive browser UI with separate pages for each role

## Tech Stack

- Node.js
- Express.js
- Socket.IO
- MongoDB with Mongoose
- Vanilla JavaScript
- Leaflet and Leaflet Routing Machine for maps
  
#Images
![Landingpage](assets/landingpage.jpg)
![admin](assets/admindash.png)
![adminlivedash](assets/liveadmin.jpg)
![order](assets/order.jpg)
![packagedriver](assets/packagesdriver.jpg)

## Project Structure

```text
logistics-tracker/
  client/
    admin.html
    admin.js
    driver.html
    driver.js
    index.html
    login.html
    register.html
    styles.css
    user.html
    user.js
    utils.js
    icons/
  server/
    admin-routes.js
    auth-middleware.js
    auth-routes.js
    db.js
    delivery-model.js
    driver-routes.js
    server.js
    socket-handler.js
    tracking-model.js
    user-model.js
    user-routes.js
  seed.js
  server.js
  package.json
```

## Requirements

- Node.js 18+ recommended
- MongoDB database
- Internet connection for the map tiles and Socket.IO client CDN used by the frontend pages

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file in the project root with the required variables:

```env
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
PORT=5000
```

3. Seed the database if needed:

```bash
npm run seed
```

4. Start the app:

```bash
npm start
```

5. Open the app in your browser:

If port 5000 is already in use, the server will automatically try the next available port and print the final URL in the terminal.

- Admin: `http://localhost:5000/admin.html`
- Driver: `http://localhost:5000/driver.html`
- User: `http://localhost:5000/user.html`

## How It Works

### Server

The Express app in `server/server.js`:

- connects to MongoDB
- serves the static frontend from `client/`
- mounts API routes under `/api/*`
- sets up Socket.IO for realtime events
- provides a health check endpoint

### Client

The browser app in `client/`:

- uses `fetch()` through shared helpers in `client/utils.js`
- stores auth data in `localStorage`
- creates a Socket.IO client connection with `createSocket()`
- updates the UI with realtime delivery and location events

## Realtime Events

Some of the main Socket.IO events used in the app:

- `driver:send-location`
- `driver:location-update`
- `driver:online`
- `driver:offline`
- `delivery:assigned`
- `delivery:updated`
- `delivery:milestone`
- `delivery:checkpoint`

## API Overview

### Auth

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/profile`

### Driver

- `GET /api/driver/deliveries`
- `GET /api/driver/deliveries/active`
- `PUT /api/driver/deliveries/:id/status`
- `PUT /api/driver/location`
- `PUT /api/driver/availability`
- `PUT /api/driver/deliveries/:id/route`
- `POST /api/driver/deliveries/:id/simulate`
- `POST /api/driver/simulate/stop`

### User

- `GET /api/user/orders`
- `POST /api/user/orders`
- `GET /api/user/orders/:id`
- `GET /api/user/track/:trackingId`

### Admin

- `GET /api/admin/stats`
- `GET /api/admin/drivers`
- `GET /api/admin/deliveries`

## Notes

- The root `server.js` starts the app by loading `server/server.js`.
- If you rename folders again, update the static path and the root entry file accordingly.
- The app currently uses the Socket.IO browser client from a CDN in the HTML pages.

## License

ISC
