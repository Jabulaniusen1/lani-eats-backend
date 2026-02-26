const express = require('express');
const router = express.Router();
const {
    getDashboardStats,
    getAllUsers,
    toggleUserActive,
    getPendingMerchants,
    approveMerchant,
    getPendingRiders,
    approveRider,
    getAllOrders,
} = require('../controllers/admin.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');

// All admin routes require ADMIN role
router.use(protect, authorize('ADMIN'));

router.get('/dashboard', getDashboardStats);
router.get('/users', getAllUsers);
router.patch('/users/:id/toggle', toggleUserActive);
router.get('/merchants/pending', getPendingMerchants);
router.patch('/merchants/:id/approve', approveMerchant);
router.get('/riders/pending', getPendingRiders);
router.patch('/riders/:id/approve', approveRider);
router.get('/orders', getAllOrders);

module.exports = router;