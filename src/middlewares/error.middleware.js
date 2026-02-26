const errorHandler = (err, req, res, next) => {
    console.error(`❌ Error: ${err.message}`);
    console.error(err.stack);

    // Prisma known errors
    if (err.code === 'P2002') {
        return res.status(409).json({
            success: false,
            message: `A record with this ${err.meta?.target?.join(', ')} already exists`,
        });
    }

    if (err.code === 'P2025') {
        return res.status(404).json({
            success: false,
            message: 'Record not found',
        });
    }

    // JWT errors
    if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({
            success: false,
            message: 'Invalid token',
        });
    }

    if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
            success: false,
            message: 'Token has expired. Please log in again',
        });
    }

    // Default error
    return res.status(err.statusCode || 500).json({
        success: false,
        message: err.message || 'Internal server error',
    });
};

module.exports = errorHandler;