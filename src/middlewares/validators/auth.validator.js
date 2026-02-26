const { body } = require('express-validator');

const registerValidator = [
    body('firstName')
        .trim()
        .notEmpty().withMessage('First name is required')
        .isLength({ min: 2 }).withMessage('First name must be at least 2 characters'),

    body('lastName')
        .trim()
        .notEmpty().withMessage('Last name is required')
        .isLength({ min: 2 }).withMessage('Last name must be at least 2 characters'),

    body('email')
        .trim()
        .notEmpty().withMessage('Email is required')
        .isEmail().withMessage('Please provide a valid email'),

    body('phone')
        .trim()
        .notEmpty().withMessage('Phone number is required')
        .matches(/^(\+234|0)[789][01]\d{8}$/).withMessage('Please provide a valid Nigerian phone number'),

    body('password')
        .notEmpty().withMessage('Password is required')
        .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
];

const loginValidator = [
    body('email')
        .trim()
        .notEmpty().withMessage('Email is required')
        .isEmail().withMessage('Please provide a valid email'),

    body('password')
        .notEmpty().withMessage('Password is required'),
];

module.exports = { registerValidator, loginValidator };