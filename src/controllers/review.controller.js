const prisma = require('../config/prisma');

const sendResponse = (res, statusCode, success, message, data = null) => {
    const response = { success, message };
    if (data) response.data = data;
    return res.status(statusCode).json(response);
};


// ─── SUBMIT REVIEW ────────────────────────────────────────────
const submitReview = async (req, res) => {
    try {
        const { orderId, restaurantRating, riderRating, comment } = req.body;

        if (!orderId || !restaurantRating) {
            return sendResponse(res, 400, false, 'Order ID and restaurant rating are required');
        }

        if (restaurantRating < 1 || restaurantRating > 5) {
            return sendResponse(res, 400, false, 'Rating must be between 1 and 5');
        }

        // Verify order belongs to this customer and is delivered
        const order = await prisma.order.findFirst({
            where: {
                id: orderId,
                userId: req.user.userId,
                status: 'DELIVERED',
            },
            include: {
                delivery: {
                    include: { rider: true },
                },
            },
        });

        if (!order) {
            return sendResponse(res, 404, false, 'Order not found or not yet delivered');
        }

        // Prevent duplicate reviews
        const existingReview = await prisma.review.findUnique({
            where: { orderId },
        });

        if (existingReview) {
            return sendResponse(res, 400, false, 'You have already reviewed this order');
        }

        const riderId = order.delivery?.rider?.id || null;

        // Create review and update ratings in one transaction
        const review = await prisma.$transaction(async (tx) => {
            // Create the review
            const newReview = await tx.review.create({
                data: {
                    userId: req.user.userId,
                    orderId,
                    restaurantId: order.restaurantId,
                    riderId: riderRating && riderId ? riderId : null,
                    rating: restaurantRating,
                    comment: comment || null,
                },
            });

            // Recalculate restaurant rating
            const restaurantReviews = await tx.review.aggregate({
                where: { restaurantId: order.restaurantId },
                _avg: { rating: true },
                _count: { rating: true },
            });

            await tx.restaurant.update({
                where: { id: order.restaurantId },
                data: {
                    rating: restaurantReviews._avg.rating || 0,
                    totalReviews: restaurantReviews._count.rating,
                },
            });

            // Recalculate rider rating if they were rated
            if (riderRating && riderId) {
                if (riderRating < 1 || riderRating > 5) {
                    throw new Error('Rider rating must be between 1 and 5');
                }

                const riderReviews = await tx.review.aggregate({
                    where: { riderId },
                    _avg: { rating: true },
                    _count: { rating: true },
                });

                await tx.rider.update({
                    where: { id: riderId },
                    data: {
                        rating: riderReviews._avg.rating || 0,
                        totalReviews: riderReviews._count.rating,
                    },
                });
            }

            return newReview;
        });

        return sendResponse(res, 201, true, 'Review submitted. Thank you!', { review });

    } catch (error) {
        console.error('submitReview error:', error);
        return sendResponse(res, 500, false, error.message || 'Something went wrong');
    }
};


// ─── GET RESTAURANT REVIEWS ───────────────────────────────────
const getRestaurantReviews = async (req, res) => {
    try {
        const { restaurantId } = req.params;

        const reviews = await prisma.review.findMany({
            where: { restaurantId },
            include: {
                user: {
                    select: { firstName: true, lastName: true },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        return sendResponse(res, 200, true, 'Reviews fetched', { reviews });

    } catch (error) {
        console.error('getRestaurantReviews error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── GET RIDER REVIEWS ────────────────────────────────────────
const getRiderReviews = async (req, res) => {
    try {
        const rider = await prisma.rider.findUnique({
            where: { userId: req.user.userId },
        });

        if (!rider) {
            return sendResponse(res, 404, false, 'Rider not found');
        }

        const reviews = await prisma.review.findMany({
            where: { riderId: rider.id },
            include: {
                user: {
                    select: { firstName: true, lastName: true },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        return sendResponse(res, 200, true, 'Reviews fetched', { reviews });

    } catch (error) {
        console.error('getRiderReviews error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


module.exports = { submitReview, getRestaurantReviews, getRiderReviews };