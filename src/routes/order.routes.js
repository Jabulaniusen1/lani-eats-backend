const express = require('express');
const router = express.Router();
const {
    placeOrder,
    getMyOrders,
    getOrderById,
    getRestaurantOrders,
    updateOrderStatus,
    cancelOrder,
} = require('../controllers/order.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');
const validate = require('../middlewares/validate.middleware');
const { placeOrderValidator } = require('../middlewares/validators/order.validator');

router.post('/', protect, authorize('CUSTOMER'), placeOrderValidator, validate, placeOrder);
router.get('/my', protect, authorize('CUSTOMER'), getMyOrders);
router.patch('/:id/cancel', protect, authorize('CUSTOMER'), cancelOrder);
router.get('/:id', protect, getOrderById);
router.get('/restaurant/:restaurantId', protect, authorize('MERCHANT'), getRestaurantOrders);
router.patch('/:id/status', protect, authorize('MERCHANT'), updateOrderStatus);

module.exports = router;