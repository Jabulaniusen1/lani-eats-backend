const express = require('express');
const router = express.Router();
const {
    initializePayment,
    verifyPayment,
    paystackWebhook,
} = require('../controllers/payment.controller');
const { protect } = require('../middlewares/auth.middleware');

// Webhook must be public — Paystack calls this directly
// IMPORTANT — no protect middleware here
router.post('/webhook', paystackWebhook);

// Protected routes
router.post('/initialize/:orderId', protect, initializePayment);
router.get('/verify/:reference', protect, verifyPayment);

module.exports = router;