const prisma = require('../config/prisma');

const sendResponse = (res, statusCode, success, message, data = null) => {
    const response = { success, message };
    if (data) response.data = data;
    return res.status(statusCode).json(response);
};


// ─── DASHBOARD STATS ─────────────────────────────────────────
const getDashboardStats = async (req, res) => {
    try {
        const [
            totalUsers,
            totalMerchants,
            totalRiders,
            totalRestaurants,
            totalOrders,
            totalDelivered,
            totalRevenue,
            pendingMerchants,
            pendingRiders,
        ] = await Promise.all([
            prisma.user.count({ where: { role: 'CUSTOMER' } }),
            prisma.user.count({ where: { role: 'MERCHANT' } }),
            prisma.user.count({ where: { role: 'RIDER' } }),
            prisma.restaurant.count(),
            prisma.order.count(),
            prisma.order.count({ where: { status: 'DELIVERED' } }),
            prisma.order.aggregate({
                where: { paymentStatus: 'PAID' },
                _sum: { total: true },
            }),
            prisma.merchant.count({ where: { isApproved: false } }),
            prisma.rider.count({ where: { isApproved: false } }),
        ]);

        return sendResponse(res, 200, true, 'Dashboard stats fetched', {
            users: {
                customers: totalUsers,
                merchants: totalMerchants,
                riders: totalRiders,
            },
            restaurants: totalRestaurants,
            orders: {
                total: totalOrders,
                delivered: totalDelivered,
            },
            revenue: totalRevenue._sum.total || 0,
            pendingApprovals: {
                merchants: pendingMerchants,
                riders: pendingRiders,
            },
        });

    } catch (error) {
        console.error('getDashboardStats error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── GET ALL USERS ────────────────────────────────────────────
const getAllUsers = async (req, res) => {
    try {
        const { role, search, page = 1, limit = 20 } = req.query;

        const where = {};

        if (role) where.role = role;

        if (search) {
            where.OR = [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where,
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    phone: true,
                    role: true,
                    isVerified: true,
                    isActive: true,
                    createdAt: true,
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: parseInt(limit),
            }),
            prisma.user.count({ where }),
        ]);

        return sendResponse(res, 200, true, 'Users fetched', {
            users,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit)),
            },
        });

    } catch (error) {
        console.error('getAllUsers error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── DEACTIVATE / ACTIVATE USER ───────────────────────────────
const toggleUserActive = async (req, res) => {
    try {
        const { id } = req.params;

        const user = await prisma.user.findUnique({ where: { id } });

        if (!user) {
            return sendResponse(res, 404, false, 'User not found');
        }

        // Prevent admin from deactivating themselves
        if (user.id === req.user.userId) {
            return sendResponse(res, 400, false, 'You cannot deactivate your own account');
        }

        const updated = await prisma.user.update({
            where: { id },
            data: { isActive: !user.isActive },
        });

        return sendResponse(
            res,
            200,
            true,
            `User ${updated.isActive ? 'activated' : 'deactivated'} successfully`,
            { isActive: updated.isActive }
        );

    } catch (error) {
        console.error('toggleUserActive error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── GET PENDING MERCHANTS ────────────────────────────────────
const getPendingMerchants = async (req, res) => {
    try {
        const merchants = await prisma.merchant.findMany({
            where: { isApproved: false },
            include: {
                user: {
                    select: {
                        firstName: true,
                        lastName: true,
                        email: true,
                        phone: true,
                        createdAt: true,
                    },
                },
                restaurants: true,
            },
            orderBy: { createdAt: 'asc' },
        });

        return sendResponse(res, 200, true, 'Pending merchants fetched', { merchants });

    } catch (error) {
        console.error('getPendingMerchants error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── APPROVE / REJECT MERCHANT ────────────────────────────────
const approveMerchant = async (req, res) => {
    try {
        const { id } = req.params;
        const { approve } = req.body; // true or false

        const merchant = await prisma.merchant.findUnique({ where: { id } });

        if (!merchant) {
            return sendResponse(res, 404, false, 'Merchant not found');
        }

        const updated = await prisma.merchant.update({
            where: { id },
            data: { isApproved: approve },
        });

        // Also approve all their restaurants if approving the merchant
        if (approve) {
            await prisma.restaurant.updateMany({
                where: { merchantId: id },
                data: { isApproved: true },
            });
        }

        return sendResponse(
            res,
            200,
            true,
            `Merchant ${approve ? 'approved' : 'rejected'} successfully`,
            { merchant: updated }
        );

    } catch (error) {
        console.error('approveMerchant error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── GET PENDING RIDERS ───────────────────────────────────────
const getPendingRiders = async (req, res) => {
    try {
        const riders = await prisma.rider.findMany({
            where: { isApproved: false },
            include: {
                user: {
                    select: {
                        firstName: true,
                        lastName: true,
                        email: true,
                        phone: true,
                        createdAt: true,
                    },
                },
            },
            orderBy: { createdAt: 'asc' },
        });

        return sendResponse(res, 200, true, 'Pending riders fetched', { riders });

    } catch (error) {
        console.error('getPendingRiders error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── APPROVE / REJECT RIDER ───────────────────────────────────
const approveRider = async (req, res) => {
    try {
        const { id } = req.params;
        const { approve } = req.body;

        const rider = await prisma.rider.findUnique({ where: { id } });

        if (!rider) {
            return sendResponse(res, 404, false, 'Rider not found');
        }

        const updated = await prisma.rider.update({
            where: { id },
            data: { isApproved: approve },
        });

        return sendResponse(
            res,
            200,
            true,
            `Rider ${approve ? 'approved' : 'rejected'} successfully`,
            { rider: updated }
        );

    } catch (error) {
        console.error('approveRider error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── GET ALL ORDERS ───────────────────────────────────────────
const getAllOrders = async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;

        const where = {};
        if (status) where.status = status;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [orders, total] = await Promise.all([
            prisma.order.findMany({
                where,
                include: {
                    user: {
                        select: { firstName: true, lastName: true, phone: true },
                    },
                    restaurant: {
                        select: { name: true },
                    },
                    delivery: {
                        include: {
                            rider: {
                                include: {
                                    user: {
                                        select: { firstName: true, lastName: true },
                                    },
                                },
                            },
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: parseInt(limit),
            }),
            prisma.order.count({ where }),
        ]);

        return sendResponse(res, 200, true, 'Orders fetched', {
            orders,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit)),
            },
        });

    } catch (error) {
        console.error('getAllOrders error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


module.exports = {
    getDashboardStats,
    getAllUsers,
    toggleUserActive,
    getPendingMerchants,
    approveMerchant,
    getPendingRiders,
    approveRider,
    getAllOrders,
};