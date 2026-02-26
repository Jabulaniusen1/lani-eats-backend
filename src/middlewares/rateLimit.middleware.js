const rateLimit = require('express-rate-limit');

// General API limit — 100 requests per 15 minutes per IP
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: {
        success: false,
        message: 'Too many requests. Please try again after 15 minutes',
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Strict limit for auth routes — prevent brute force attacks
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: {
        success: false,
        message: 'Too many login attempts. Please try again after 15 minutes',
    },
    standardHeaders: true,
    legacyHeaders: false,
});

module.exports = { apiLimiter, authLimiter };