const { Server } = require('socket.io');

let io;

const initializeSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: '*', // lock this down to your app's URL in production
            methods: ['GET', 'POST'],
        },
    });

    io.on('connection', (socket) => {
        console.log(`🔌 Socket connected: ${socket.id}`);

        // ─── JOIN ROOMS ───────────────────────────────────────────
        // Each client joins a room based on their identity
        // so we can send targeted events to specific users

        // Customer joins their personal room to get order updates
        socket.on('join_customer_room', (userId) => {
            socket.join(`customer_${userId}`);
            console.log(`👤 Customer ${userId} joined their room`);
        });

        // Merchant joins their restaurant room to get incoming orders
        socket.on('join_merchant_room', (restaurantId) => {
            socket.join(`restaurant_${restaurantId}`);
            console.log(`🍽️  Merchant joined restaurant room ${restaurantId}`);
        });

        // Rider joins their room for delivery assignments
        socket.on('join_rider_room', (riderId) => {
            socket.join(`rider_${riderId}`);
            console.log(`🏍️  Rider ${riderId} joined their room`);
        });

        // Customer tracks a specific order in real time
        socket.on('track_order', (orderId) => {
            socket.join(`order_${orderId}`);
            console.log(`📦 Tracking order ${orderId}`);
        });

        socket.on('disconnect', () => {
            console.log(`❌ Socket disconnected: ${socket.id}`);
        });
    });

    return io;
};

// Export getIO so any controller can emit events
const getIO = () => {
    if (!io) {
        throw new Error('Socket.io not initialized');
    }
    return io;
};

module.exports = { initializeSocket, getIO };