const prisma = require('../config/prisma');
const { getIO } = require('../config/socket');
const cloudinary = require('../config/cloudinary');

const sendResponse = (res, statusCode, success, message, data = null) => {
    const response = { success, message };
    if (data) response.data = data;
    return res.status(statusCode).json(response);
};

// ─── HAVERSINE DISTANCE (km) ──────────────────────────────────
const haversineDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// Average rider speed in Nigerian traffic (km/h)
const AVG_SPEED_KMH = 25;


// ─── COMPLETE RIDER ONBOARDING ────────────────────────────────
// Called after signup to submit KYC details (NIN, DOB, etc.)
const completeOnboarding = async (req, res) => {
    try {
        const { vehicleType, vehiclePlate, nin, dateOfBirth, gender, homeAddress } = req.body;

        if (!vehicleType || !nin || !dateOfBirth || !gender || !homeAddress) {
            return sendResponse(res, 400, false, 'vehicleType, nin, dateOfBirth, gender, and homeAddress are required');
        }

        const validVehicles = ['bike', 'bicycle', 'car'];
        if (!validVehicles.includes(vehicleType)) {
            return sendResponse(res, 400, false, `Invalid vehicleType. Allowed: ${validVehicles.join(', ')}`);
        }

        const validGenders = ['male', 'female'];
        if (!validGenders.includes(gender)) {
            return sendResponse(res, 400, false, `Invalid gender. Allowed: ${validGenders.join(', ')}`);
        }

        const rider = await prisma.rider.update({
            where: { userId: req.user.userId },
            data: {
                vehicleType,
                vehiclePlate: vehiclePlate || null,
                nin,
                dateOfBirth: new Date(dateOfBirth),
                gender,
                homeAddress,
                isOnboarded: true,
            },
        });

        return sendResponse(res, 200, true, 'Onboarding details saved', { rider });

    } catch (error) {
        console.error('completeOnboarding error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── UPLOAD RIDER PHOTOGRAPH ──────────────────────────────────
const uploadRiderPhoto = async (req, res) => {
    try {
        if (!req.file) {
            return sendResponse(res, 400, false, 'Photo is required');
        }

        const uploadResult = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                { folder: 'rider-photos', resource_type: 'image' },
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            );
            stream.end(req.file.buffer);
        });

        const rider = await prisma.rider.update({
            where: { userId: req.user.userId },
            data: { photographUrl: uploadResult.secure_url },
        });

        return sendResponse(res, 200, true, 'Photo uploaded', { photographUrl: rider.photographUrl });

    } catch (error) {
        console.error('uploadRiderPhoto error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
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
// Pass ?latitude=x&longitude=y to get distance and ETA estimates
const getAvailableDeliveries = async (req, res) => {
    try {
        const riderLat = parseFloat(req.query.latitude);
        const riderLon = parseFloat(req.query.longitude);
        const hasLocation = !isNaN(riderLat) && !isNaN(riderLon);

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
                                avgPrepTime: true,
                            },
                        },
                        address: {
                            select: {
                                street: true,
                                city: true,
                                state: true,
                                latitude: true,
                                longitude: true,
                            },
                        },
                        items: {
                            include: {
                                menuItem: { select: { name: true } },
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

        const enriched = deliveries.map((delivery) => {
            const restaurant = delivery.order.restaurant;
            const dropoff = delivery.order.address;
            let distanceInfo = null;

            if (
                hasLocation &&
                restaurant.latitude &&
                restaurant.longitude &&
                dropoff.latitude &&
                dropoff.longitude
            ) {
                const distToRestaurant = haversineDistance(
                    riderLat, riderLon,
                    restaurant.latitude, restaurant.longitude
                );
                const distToCustomer = haversineDistance(
                    restaurant.latitude, restaurant.longitude,
                    dropoff.latitude, dropoff.longitude
                );
                const totalDistance = distToRestaurant + distToCustomer;

                // ETA = time to reach restaurant + prep time remaining + time to customer
                const timeToRestaurantMin = Math.ceil((distToRestaurant / AVG_SPEED_KMH) * 60);
                const timeToCustomerMin = Math.ceil((distToCustomer / AVG_SPEED_KMH) * 60);
                const estimatedTotalMin = timeToRestaurantMin + timeToCustomerMin;

                distanceInfo = {
                    distanceToRestaurantKm: parseFloat(distToRestaurant.toFixed(1)),
                    distanceToCustomerKm: parseFloat(distToCustomer.toFixed(1)),
                    totalDistanceKm: parseFloat(totalDistance.toFixed(1)),
                    etaToRestaurantMin: timeToRestaurantMin,
                    etaToCustomerMin: timeToCustomerMin,
                    estimatedTotalMin,
                    label: `${totalDistance.toFixed(1)} km · ~${estimatedTotalMin} min`,
                };
            }

            return { ...delivery, distanceInfo };
        });

        return sendResponse(res, 200, true, 'Available deliveries fetched', { deliveries: enriched });

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
        const { status, latitude, longitude, confirmationCode } = req.body;

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

        // ── Verify confirmation code before marking delivered ──────
        if (status === 'DELIVERED') {
            if (!confirmationCode) {
                return sendResponse(res, 400, false, 'Confirmation code is required to complete delivery');
            }

            const order = await prisma.order.findUnique({
                where: { id: delivery.orderId },
                select: { deliveryCode: true },
            });

            if (!order.deliveryCode) {
                return sendResponse(res, 400, false, 'Delivery code not generated yet. Mark as PICKED_UP first');
            }

            if (String(confirmationCode) !== String(order.deliveryCode)) {
                return sendResponse(res, 400, false, 'Incorrect confirmation code. Cannot hand over food');
            }
        }

        let deliveryCodeForRider = null;

        const updated = await prisma.$transaction(async (tx) => {
            const updateData = { status };

            if (status === 'PICKED_UP') {
                updateData.pickedUpAt = new Date();

                // Generate 4-digit delivery code
                const code = String(Math.floor(1000 + Math.random() * 9000));
                deliveryCodeForRider = code;

                // Save code to order, move order to OUT_FOR_DELIVERY
                await tx.order.update({
                    where: { id: delivery.orderId },
                    data: {
                        status: 'OUT_FOR_DELIVERY',
                        deliveryCode: code,
                    },
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

        // When food is picked up, send code to customer and rider sees it in the response
        if (status === 'PICKED_UP' && deliveryCodeForRider) {
            io.to(`order_${delivery.orderId}`).emit('delivery_code_issued', {
                orderId: delivery.orderId,
                deliveryCode: deliveryCodeForRider,
                message: `Your delivery code is ${deliveryCodeForRider}. Share this with your rider to receive your food.`,
            });
        }

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

        const responseData = { delivery: updated };
        // Return the code to the rider so they know what to ask for
        if (deliveryCodeForRider) {
            responseData.deliveryCode = deliveryCodeForRider;
        }

        return sendResponse(res, 200, true, 'Delivery status updated', responseData);

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


// ─── DECLINE DELIVERY ─────────────────────────────────────────
const declineDelivery = async (req, res) => {
    try {
        const { deliveryId } = req.params;

        const delivery = await prisma.delivery.findUnique({
            where: { id: deliveryId },
        });

        if (!delivery) {
            return sendResponse(res, 404, false, 'Delivery not found');
        }

        if (delivery.status !== 'UNASSIGNED') {
            return sendResponse(res, 400, false, 'This delivery is no longer available');
        }

        // Increment rider's declined count for acceptance rate tracking
        await prisma.rider.update({
            where: { userId: req.user.userId },
            data: { totalDeclined: { increment: 1 } },
        });

        return sendResponse(res, 200, true, 'Delivery declined');

    } catch (error) {
        console.error('declineDelivery error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── GET RIDER PERFORMANCE STATS ─────────────────────────────
const getRiderStats = async (req, res) => {
    try {
        const rider = await prisma.rider.findUnique({
            where: { userId: req.user.userId },
            include: {
                reviews: {
                    orderBy: { createdAt: 'desc' },
                    take: 10,
                    include: {
                        user: { select: { firstName: true, lastName: true } },
                        order: { select: { id: true } },
                    },
                },
            },
        });

        if (!rider) return sendResponse(res, 404, false, 'Rider profile not found');

        const [delivered, failed, accepted] = await Promise.all([
            prisma.delivery.count({ where: { riderId: rider.id, status: 'DELIVERED' } }),
            prisma.delivery.count({ where: { riderId: rider.id, status: 'FAILED' } }),
            prisma.delivery.count({
                where: { riderId: rider.id, status: { in: ['ASSIGNED', 'PICKED_UP', 'DELIVERED', 'FAILED'] } },
            }),
        ]);

        const totalCompleted = delivered + failed;
        const completionRate = totalCompleted > 0 ? Math.round((delivered / totalCompleted) * 100) : 100;

        const totalOffered = accepted + rider.totalDeclined;
        const acceptanceRate = totalOffered > 0 ? Math.round((accepted / totalOffered) * 100) : 100;

        // Performance tier
        let tier = 'Bronze';
        if (completionRate >= 95 && acceptanceRate >= 80 && rider.rating >= 4.5) tier = 'Gold';
        else if (completionRate >= 85 && acceptanceRate >= 70 && rider.rating >= 4.0) tier = 'Silver';

        return sendResponse(res, 200, true, 'Performance stats fetched', {
            rating: rider.rating,
            totalReviews: rider.totalReviews,
            recentReviews: rider.reviews,
            deliveries: {
                total: accepted,
                delivered,
                failed,
                completionRate,
            },
            acceptanceRate,
            tier,
        });

    } catch (error) {
        console.error('getRiderStats error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── REPORT DELIVERY ISSUE ────────────────────────────────────
const reportDeliveryIssue = async (req, res) => {
    try {
        const { deliveryId } = req.params;
        const { type, description } = req.body;

        const validTypes = [
            'CANT_FIND_CUSTOMER',
            'WRONG_ADDRESS',
            'CUSTOMER_REFUSED',
            'ITEM_DAMAGED',
            'RESTAURANT_NOT_READY',
            'OTHER',
        ];

        if (!type || !validTypes.includes(type)) {
            return sendResponse(res, 400, false, `Invalid issue type. Valid: ${validTypes.join(', ')}`);
        }

        const rider = await prisma.rider.findUnique({
            where: { userId: req.user.userId },
        });

        if (!rider) return sendResponse(res, 404, false, 'Rider profile not found');

        const delivery = await prisma.delivery.findFirst({
            where: { id: deliveryId, riderId: rider.id },
        });

        if (!delivery) {
            return sendResponse(res, 404, false, 'Delivery not found or access denied');
        }

        const issue = await prisma.deliveryIssue.create({
            data: {
                deliveryId,
                riderId: rider.id,
                type,
                description: description || null,
            },
        });

        // Notify admin via socket
        const io = getIO();
        io.to('admin').emit('delivery_issue_reported', {
            deliveryId,
            riderId: rider.id,
            type,
            description,
            createdAt: issue.createdAt,
        });

        return sendResponse(res, 201, true, 'Issue reported successfully', { issue });

    } catch (error) {
        console.error('reportDeliveryIssue error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── UPLOAD DELIVERY PHOTO PROOF ─────────────────────────────
const uploadDeliveryProof = async (req, res) => {
    try {
        const { deliveryId } = req.params;

        if (!req.file) {
            return sendResponse(res, 400, false, 'Photo is required');
        }

        const rider = await prisma.rider.findUnique({
            where: { userId: req.user.userId },
        });

        if (!rider) return sendResponse(res, 404, false, 'Rider profile not found');

        const delivery = await prisma.delivery.findFirst({
            where: { id: deliveryId, riderId: rider.id },
        });

        if (!delivery) {
            return sendResponse(res, 404, false, 'Delivery not found or access denied');
        }

        // Upload to Cloudinary
        const uploadResult = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                { folder: 'delivery-proofs', resource_type: 'image' },
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            );
            stream.end(req.file.buffer);
        });

        const updated = await prisma.delivery.update({
            where: { id: deliveryId },
            data: { photoProofUrl: uploadResult.secure_url },
        });

        return sendResponse(res, 200, true, 'Photo proof uploaded', {
            photoProofUrl: updated.photoProofUrl,
        });

    } catch (error) {
        console.error('uploadDeliveryProof error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


module.exports = {
    completeOnboarding,
    uploadRiderPhoto,
    updateRiderProfile,
    toggleAvailability,
    getAvailableDeliveries,
    acceptDelivery,
    updateDeliveryStatus,
    getMyDeliveries,
    updateLocation,
    declineDelivery,
    getRiderStats,
    reportDeliveryIssue,
    uploadDeliveryProof,
};