const express = require('express');
const router = express.Router();
const {
    createRestaurant,
    getMyRestaurants,
    getAllRestaurants,
    getRestaurantById,
    updateRestaurant,
    uploadRestaurantLogo,
    uploadRestaurantCover,
} = require('../controllers/restaurant.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');
const upload = require('../middlewares/upload.middleware');

// Public routes
router.get('/', getAllRestaurants);

// Static routes BEFORE dynamic ones
router.get('/merchant/me', protect, authorize('MERCHANT'), getMyRestaurants);

// Dynamic routes after
router.get('/:id', getRestaurantById);

// Merchant only
router.post('/', protect, authorize('MERCHANT'), createRestaurant);
router.patch('/:id', protect, authorize('MERCHANT'), updateRestaurant);
router.post('/:id/logo', protect, authorize('MERCHANT'), upload.single('image'), uploadRestaurantLogo);
router.post('/:id/cover', protect, authorize('MERCHANT'), upload.single('image'), uploadRestaurantCover);

module.exports = router;