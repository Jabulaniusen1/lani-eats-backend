const express = require('express');
const router = express.Router();
const {
    getBanks,
    verifyAccountNumber,
    saveBankAccount,
    getMyBankAccount,
} = require('../controllers/bankAccount.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');

router.use(protect, authorize('MERCHANT'));

router.get('/banks', getBanks);
router.post('/verify', verifyAccountNumber);
router.post('/', saveBankAccount);
router.get('/', getMyBankAccount);

module.exports = router;
