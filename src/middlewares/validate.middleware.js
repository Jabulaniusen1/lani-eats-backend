const { validationResult } = require('express-validator');

// This middleware runs after your validation rules
// and returns a clean error response if anything failed
const validate = (req, res, next) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: errors.array().map((err) => ({
                field: err.path,
                message: err.msg,
            })),
        });
    }

    next();
};

module.exports = validate;