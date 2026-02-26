const express = require('express');
const router = express.Router();
const {
    submitReview,
    getRestaurantReviews,
    getRiderReviews,
} = require('../controllers/review.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');
const validate = require('../middlewares/validate.middleware');
const { reviewValidator } = require('../middlewares/validators/review.validator');

router.post('/', protect, authorize('CUSTOMER'), reviewValidator, validate, submitReview);
router.get('/restaurant/:restaurantId', getRestaurantReviews);
router.get('/my', protect, authorize('RIDER'), getRiderReviews);

module.exports = router;