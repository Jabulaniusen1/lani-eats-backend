const { body } = require('express-validator');

const placeOrderValidator = [
    body('restaurantId')
        .notEmpty().withMessage('Restaurant ID is required')
        .isUUID().withMessage('Invalid restaurant ID'),

    body('addressId')
        .notEmpty().withMessage('Address ID is required')
        .isUUID().withMessage('Invalid address ID'),

    body('items')
        .isArray({ min: 1 }).withMessage('At least one item is required'),

    body('items.*.menuItemId')
        .notEmpty().withMessage('Menu item ID is required')
        .isUUID().withMessage('Invalid menu item ID'),

    body('items.*.quantity')
        .isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
];

module.exports = { placeOrderValidator };