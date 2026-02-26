const express = require('express');
const router = express.Router();
const { addAddress, getMyAddresses, deleteAddress } = require('../controllers/address.controller');
const { protect } = require('../middlewares/auth.middleware');

router.use(protect); // all address routes require login

router.post('/', addAddress);
router.get('/', getMyAddresses);
router.delete('/:id', deleteAddress);

module.exports = router;