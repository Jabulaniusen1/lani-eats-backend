const prisma = require('../config/prisma');
const { getIO } = require('../config/socket');

const sendResponse = (res, statusCode, success, message, data = null) => {
    const response = { success, message };
    if (data) response.data = data;
    return res.status(statusCode).json(response);
};


// ─── UPDATE RIDER PROFILE ─────────────────────────────────────
const updateRiderProfile = async (req, res) => {
    try {
        const { vehicleType, vehiclePlate } = req.body;

        const rider = await prisma.rider.update({
            where: { userId: req.user.userId },
            data: {
                vehicleType,
                vehiclePlate,
            },
        });

        return sendResponse(res, 200, true, 'Profile updated', { rider });

    } catch (error) {
        console.error('updateRiderProfile error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── TOGGLE AVAILABILITY ──────────────────────────────────────
const toggleAvailability = async (req, res) => {
    try {
        const { isAvailable, latitude, longitude } = req.body;

        const rider = await prisma.rider.update({
            where: { userId: req.user.userId },
            data: {
                isAvailable,
                currentLatitude: latitude || null,
                currentLongitude: longitude || null,
            },
        });

        return sendResponse(
            res,
            200,
            true,
            `You are now ${isAvailable ? 'online' : 'offline'}`,
            { rider }
        );

    } catch (error) {
        console.error('toggleAvailability error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── GET AVAILABLE DELIVERIES ─────────────────────────────────
const getAvailableDeliveries = async (req, res) => {
    try {
        const deliveries = await prisma.delivery.findMany({
            where: {
                status: 'UNASSIGNED',
                order: {
                    status: { in: ['PREPARING', 'READY_FOR_PICKUP'] },
                },
            },
            include: {
                order: {
                    include: {
                        restaurant: {
                            select: {
                                name: true,
                                address: true,
                                city: true,
                                latitude: true,
                                longitude: true,
                            },
                        },
                        address: true,
                        items: {
                            include: {
                                menuItem: {
                                    select: { name: true },
                                },
                            },
                        },
                        user: {
                            select: { firstName: true, lastName: true, phone: true },
                        },
                    },
                },
            },
            orderBy: { createdAt: 'asc' },
        });

        return sendResponse(res, 200, true, 'Available deliveries fetched', { deliveries });

    } catch (error) {
        console.error('getAvailableDeliveries error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── ACCEPT DELIVERY ──────────────────────────────────────────
const acceptDelivery = async (req, res) => {
    try {
        const { deliveryId } = req.params;

        const rider = await prisma.rider.findUnique({
            where: { userId: req.user.userId },
        });

        if (!rider) {
            return sendResponse(res, 404, false, 'Rider profile not found');
        }

        if (!rider.isApproved) {
            return sendResponse(res, 403, false, 'Your account is pending approval');
        }

        const delivery = await prisma.delivery.findUnique({
            where: { id: deliveryId },
        });

        if (!delivery) {
            return sendResponse(res, 404, false, 'Delivery not found');
        }

        if (delivery.status !== 'UNASSIGNED') {
            return sendResponse(res, 400, false, 'This delivery has already been taken');
        }

        // Check rider doesn't already have an active delivery
        const activeDelivery = await prisma.delivery.findFirst({
            where: {
                riderId: rider.id,
                status: { in: ['ASSIGNED', 'PICKED_UP'] },
            },
        });

        if (activeDelivery) {
            return sendResponse(res, 400, false, 'You already have an active delivery');
        }

        // Assign rider — don't change order status yet, food may still be preparing
        const updated = await prisma.$transaction(async (tx) => {
            const updatedDelivery = await tx.delivery.update({
                where: { id: deliveryId },
                data: {
                    riderId: rider.id,
                    status: 'ASSIGNED',
                },
            });

            return updatedDelivery;
        });

        // Notify customer a rider is heading to the restaurant
        const io = getIO();
        io.to(`order_${delivery.orderId}`).emit('rider_assigned', {
            orderId: delivery.orderId,
            riderName: `${req.user.firstName || 'Your rider'}`,
            message: 'A rider has been assigned and is heading to the restaurant',
        });

        // Notify merchant so they know a rider is coming
        const order = await prisma.order.findUnique({
            where: { id: delivery.orderId },
            select: { restaurantId: true },
        });

        io.to(`restaurant_${order.restaurantId}`).emit('rider_assigned', {
            orderId: delivery.orderId,
            message: 'A rider has accepted this delivery and is on their way',
        });

        return sendResponse(res, 200, true, 'Delivery accepted', { delivery: updated });

    } catch (error) {
        console.error('acceptDelivery error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── UPDATE DELIVERY STATUS ───────────────────────────────────
const updateDeliveryStatus = async (req, res) => {
    try {
        const { deliveryId } = req.params;
        const { status, latitude, longitude } = req.body;

        const allowedStatuses = ['PICKED_UP', 'DELIVERED', 'FAILED'];

        if (!allowedStatuses.includes(status)) {
            return sendResponse(res, 400, false, `Invalid status. Allowed: ${allowedStatuses.join(', ')}`);
        }

        const rider = await prisma.rider.findUnique({
            where: { userId: req.user.userId },
        });

        const delivery = await prisma.delivery.findFirst({
            where: { id: deliveryId, riderId: rider.id },
        });

        if (!delivery) {
            return sendResponse(res, 404, false, 'Delivery not found or access denied');
        }

        const updated = await prisma.$transaction(async (tx) => {
            const updateData = { status };

            if (status === 'PICKED_UP') {
                updateData.pickedUpAt = new Date();

                // Order is now out for delivery
                await tx.order.update({
                    where: { id: delivery.orderId },
                    data: { status: 'OUT_FOR_DELIVERY' },
                });
            }

            if (status === 'DELIVERED') {
                updateData.deliveredAt = new Date();

                await tx.order.update({
                    where: { id: delivery.orderId },
                    data: { status: 'DELIVERED' },
                });

                // Rider is free again after delivery
                await tx.rider.update({
                    where: { id: rider.id },
                    data: {
                        isAvailable: true,
                        currentLatitude: latitude || null,
                        currentLongitude: longitude || null,
                    },
                });
            }

            const updatedDelivery = await tx.delivery.update({
                where: { id: deliveryId },
                data: updateData,
            });

            return updatedDelivery;
        });

        const io = getIO();

        // Notify customer of delivery status change
        io.to(`order_${delivery.orderId}`).emit('delivery_status_updated', {
            orderId: delivery.orderId,
            deliveryStatus: status,
            updatedAt: new Date(),
        });

        // Emit rider's current location to customer if provided
        if (latitude && longitude) {
            io.to(`order_${delivery.orderId}`).emit('rider_location_updated', {
                orderId: delivery.orderId,
                latitude,
                longitude,
            });
        }

        // If delivered, tell customer to leave a review
        if (status === 'DELIVERED') {
            const order = await prisma.order.findUnique({
                where: { id: delivery.orderId },
                select: { userId: true },
            });

            io.to(`customer_${order.userId}`).emit('order_delivered', {
                orderId: delivery.orderId,
                message: 'Your order has been delivered! How was it?',
            });
        }

        return sendResponse(res, 200, true, 'Delivery status updated', { delivery: updated });

    } catch (error) {
        console.error('updateDeliveryStatus error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── GET MY DELIVERIES (rider history) ───────────────────────
const getMyDeliveries = async (req, res) => {
    try {
        const rider = await prisma.rider.findUnique({
            where: { userId: req.user.userId },
        });

        const deliveries = await prisma.delivery.findMany({
            where: { riderId: rider.id },
            include: {
                order: {
                    include: {
                        restaurant: {
                            select: { name: true, address: true },
                        },
                        address: true,
                        user: {
                            select: { firstName: true, lastName: true },
                        },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        return sendResponse(res, 200, true, 'Deliveries fetched', { deliveries });

    } catch (error) {
        console.error('getMyDeliveries error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── UPDATE RIDER LOCATION ────────────────────────────────────
// Called periodically from the mobile app while rider is on a delivery
const updateLocation = async (req, res) => {
    try {
        const { latitude, longitude } = req.body;

        if (!latitude || !longitude) {
            return sendResponse(res, 400, false, 'Latitude and longitude are required');
        }

        const rider = await prisma.rider.update({
            where: { userId: req.user.userId },
            data: {
                currentLatitude: latitude,
                currentLongitude: longitude,
            },
        });

        // Find the rider's active delivery to emit location to the right customer
        const activeDelivery = await prisma.delivery.findFirst({
            where: {
                riderId: rider.id,
                status: { in: ['ASSIGNED', 'PICKED_UP'] },
            },
        });

        if (activeDelivery) {
            const io = getIO();
            io.to(`order_${activeDelivery.orderId}`).emit('rider_location_updated', {
                orderId: activeDelivery.orderId,
                latitude,
                longitude,
            });
        }

        return sendResponse(res, 200, true, 'Location updated', {
            latitude: rider.currentLatitude,
            longitude: rider.currentLongitude,
        });

    } catch (error) {
        console.error('updateLocation error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


module.exports = {
    updateRiderProfile,
    toggleAvailability,
    getAvailableDeliveries,
    acceptDelivery,
    updateDeliveryStatus,
    getMyDeliveries,
    updateLocation,
};