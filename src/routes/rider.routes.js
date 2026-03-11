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
    declineDelivery,
    getRiderStats,
    reportDeliveryIssue,
    uploadDeliveryProof,
} = require('../controllers/rider.controller');
const {
    getRiderEarningsSummary,
    getRiderEarningsHistory,
    getRiderBankAccount,
    saveRiderBankAccount,
    requestRiderPayout,
    getRiderPayoutHistory,
} = require('../controllers/riderWallet.controller');
const { getBanks, verifyAccountNumber } = require('../controllers/bankAccount.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');
const upload = require('../middlewares/upload.middleware');

router.use(protect, authorize('RIDER')); // all rider routes require RIDER role

// ── Profile & availability ────────────────────────────────────
router.patch('/profile', updateRiderProfile);
router.patch('/availability', toggleAvailability);
router.patch('/location', updateLocation);

// ── Deliveries ────────────────────────────────────────────────
router.get('/deliveries/available', getAvailableDeliveries);
router.get('/deliveries/my', getMyDeliveries);
router.patch('/deliveries/:deliveryId/accept', acceptDelivery);
router.patch('/deliveries/:deliveryId/decline', declineDelivery);
router.patch('/deliveries/:deliveryId/status', updateDeliveryStatus);
router.post('/deliveries/:deliveryId/issue', reportDeliveryIssue);
router.post('/deliveries/:deliveryId/proof', upload.single('photo'), uploadDeliveryProof);

// ── Performance & stats ───────────────────────────────────────
router.get('/stats', getRiderStats);

// ── Earnings & wallet ─────────────────────────────────────────
router.get('/wallet/earnings', getRiderEarningsSummary);
router.get('/wallet/history', getRiderEarningsHistory);
router.get('/wallet/payouts', getRiderPayoutHistory);
router.post('/wallet/payouts', requestRiderPayout);

// ── Bank account ──────────────────────────────────────────────
router.get('/bank-account', getRiderBankAccount);
router.post('/bank-account', saveRiderBankAccount);
router.get('/banks', getBanks);
router.post('/bank-account/verify', verifyAccountNumber);

module.exports = router;
