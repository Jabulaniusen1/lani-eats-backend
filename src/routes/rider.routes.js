const express = require('express');
const router = express.Router();
const {
    updateRiderProfile,
    toggleAvailability,
    getAvailableDeliveries,
    acceptDelivery,
    updateDeliveryStatus,
    getMyDeliveries,
    updateLocation,
} = require('../controllers/rider.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');

router.use(protect, authorize('RIDER')); // all rider routes require RIDER role

router.patch('/profile', updateRiderProfile);
router.patch('/availability', toggleAvailability);
router.patch('/location', updateLocation);
router.get('/deliveries/available', getAvailableDeliveries);
router.get('/deliveries/my', getMyDeliveries);
router.patch('/deliveries/:deliveryId/accept', acceptDelivery);
router.patch('/deliveries/:deliveryId/status', updateDeliveryStatus);

module.exports = router;