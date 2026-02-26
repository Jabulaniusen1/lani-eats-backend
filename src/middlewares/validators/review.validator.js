const { body } = require('express-validator');

const reviewValidator = [
    body('orderId')
        .notEmpty().withMessage('Order ID is required')
        .isUUID().withMessage('Invalid order ID'),

    body('restaurantRating')
        .notEmpty().withMessage('Restaurant rating is required')
        .isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),

    body('riderRating')
        .optional()
        .isInt({ min: 1, max: 5 }).withMessage('Rider rating must be between 1 and 5'),

    body('comment')
        .optional()
        .trim()
        .isLength({ max: 500 }).withMessage('Comment cannot exceed 500 characters'),
];

module.exports = { reviewValidator };