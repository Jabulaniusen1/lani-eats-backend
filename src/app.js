const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

require('dotenv').config();

const app = express();

app.use('/api/v1/payments/webhook', express.raw({ type: 'application/json' }));

// Middleware
app.use(express.json());
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check route
app.get('/health', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Lanieats API is running',
        environment: process.env.NODE_ENV || 'development',
    });
});

// Routes
const { apiLimiter, authLimiter } = require('./middlewares/rateLimit.middleware');
const authRoutes = require('./routes/auth.routes');
const restaurantRoutes = require('./routes/restaurant.routes');
const menuRoutes = require('./routes/menu.routes');
const addressRoutes = require('./routes/address.routes');
const orderRoutes = require('./routes/order.routes');
const riderRoutes = require('./routes/rider.routes');
const reviewRoutes = require('./routes/review.routes');
const adminRoutes = require('./routes/admin.routes');
const paymentRoutes = require('./routes/payment.routes');
const errorHandler = require('./middlewares/error.middleware');

app.use('/api/v1', apiLimiter);
app.use('/api/v1/auth', authLimiter);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/restaurants', restaurantRoutes);
app.use('/api/v1/restaurants/:restaurantId/menu', menuRoutes);
app.use('/api/v1/addresses', addressRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/rider', riderRoutes);
app.use('/api/v1/reviews', reviewRoutes);
app.use('/api/v1/payments', paymentRoutes);

// Error handler middleware
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Not Found',
    });
});



module.exports = app