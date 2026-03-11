const express = require('express');
const router = express.Router();
const {
    getOverviewStats,
    getRevenueChart,
    getBestSellingItems,
    getPeakHours,
} = require('../controllers/analytics.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');

router.use(protect, authorize('MERCHANT'));

router.get('/:restaurantId/overview', getOverviewStats);
router.get('/:restaurantId/revenue', getRevenueChart);
router.get('/:restaurantId/best-sellers', getBestSellingItems);
router.get('/:restaurantId/peak-hours', getPeakHours);

module.exports = router;
