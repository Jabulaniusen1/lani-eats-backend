const express = require('express');
const router = express.Router();
const {
    getEarningsSummary,
    getTransactionHistory,
    requestPayout,
    getPayoutHistory,
} = require('../controllers/payout.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');

router.use(protect, authorize('MERCHANT'));

router.get('/earnings', getEarningsSummary);
router.get('/transactions', getTransactionHistory);
router.post('/request', requestPayout);
router.get('/history', getPayoutHistory);

module.exports = router;
