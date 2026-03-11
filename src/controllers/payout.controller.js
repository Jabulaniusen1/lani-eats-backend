const prisma = require('../config/prisma');
const axios = require('axios');

const sendResponse = (res, statusCode, success, message, data = null) => {
    const response = { success, message };
    if (data) response.data = data;
    return res.status(statusCode).json(response);
};

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
// Merchant keeps 90% of subtotal. Platform takes 10% + the full service charge.
const MERCHANT_COMMISSION_RATE = parseFloat(process.env.MERCHANT_COMMISSION_RATE || '0.90');


// ─── HELPER: CALCULATE MERCHANT EARNINGS ─────────────────────
const calculateEarnings = async (merchantId, restaurantIds) => {
    const orders = await prisma.order.findMany({
        where: {
            restaurantId: { in: restaurantIds },
            status: 'DELIVERED',
            paymentStatus: 'PAID',
        },
        select: {
            id: true,
            subtotal: true,
            createdAt: true,
        },
    });

    const totalEarned = orders.reduce(
        (sum, order) => sum + order.subtotal * MERCHANT_COMMISSION_RATE,
        0
    );

    const completedPayouts = await prisma.payoutRequest.aggregate({
        where: {
            merchantId,
            status: 'COMPLETED',
        },
        _sum: { amount: true },
    });

    const totalPaidOut = completedPayouts._sum.amount || 0;
    const availableBalance = totalEarned - totalPaidOut;

    return {
        totalEarned: Math.floor(totalEarned),
        totalPaidOut: Math.floor(totalPaidOut),
        availableBalance: Math.floor(availableBalance),
        orderCount: orders.length,
    };
};


// ─── GET EARNINGS SUMMARY ─────────────────────────────────────
const getEarningsSummary = async (req, res) => {
    try {
        const merchant = await prisma.merchant.findUnique({
            where: { userId: req.user.userId },
            include: { restaurants: { select: { id: true } } },
        });

        if (!merchant) {
            return sendResponse(res, 404, false, 'Merchant not found');
        }

        const restaurantIds = merchant.restaurants.map((r) => r.id);
        const earnings = await calculateEarnings(merchant.id, restaurantIds);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const todayOrders = await prisma.order.aggregate({
            where: {
                restaurantId: { in: restaurantIds },
                status: 'DELIVERED',
                paymentStatus: 'PAID',
                createdAt: { gte: today },
            },
            _sum: { subtotal: true },
            _count: true,
        });

        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        weekStart.setHours(0, 0, 0, 0);

        const weekOrders = await prisma.order.aggregate({
            where: {
                restaurantId: { in: restaurantIds },
                status: 'DELIVERED',
                paymentStatus: 'PAID',
                createdAt: { gte: weekStart },
            },
            _sum: { subtotal: true },
            _count: true,
        });

        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

        const monthOrders = await prisma.order.aggregate({
            where: {
                restaurantId: { in: restaurantIds },
                status: 'DELIVERED',
                paymentStatus: 'PAID',
                createdAt: { gte: monthStart },
            },
            _sum: { subtotal: true },
            _count: true,
        });

        return sendResponse(res, 200, true, 'Earnings fetched', {
            balance: {
                available: earnings.availableBalance,
                totalEarned: earnings.totalEarned,
                totalPaidOut: earnings.totalPaidOut,
            },
            today: {
                earnings: Math.floor((todayOrders._sum.subtotal || 0) * MERCHANT_COMMISSION_RATE),
                orders: todayOrders._count,
            },
            thisWeek: {
                earnings: Math.floor((weekOrders._sum.subtotal || 0) * MERCHANT_COMMISSION_RATE),
                orders: weekOrders._count,
            },
            thisMonth: {
                earnings: Math.floor((monthOrders._sum.subtotal || 0) * MERCHANT_COMMISSION_RATE),
                orders: monthOrders._count,
            },
            commissionRate: MERCHANT_COMMISSION_RATE,
        });

    } catch (error) {
        console.error('getEarningsSummary error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── GET TRANSACTION HISTORY ──────────────────────────────────
const getTransactionHistory = async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const merchant = await prisma.merchant.findUnique({
            where: { userId: req.user.userId },
            include: { restaurants: { select: { id: true } } },
        });

        if (!merchant) {
            return sendResponse(res, 404, false, 'Merchant not found');
        }

        const restaurantIds = merchant.restaurants.map((r) => r.id);

        const [orders, total] = await Promise.all([
            prisma.order.findMany({
                where: {
                    restaurantId: { in: restaurantIds },
                    paymentStatus: 'PAID',
                },
                select: {
                    id: true,
                    subtotal: true,
                    total: true,
                    serviceCharge: true,
                    status: true,
                    createdAt: true,
                    restaurant: { select: { name: true } },
                    user: { select: { firstName: true, lastName: true } },
                    items: {
                        select: { quantity: true, menuItem: { select: { name: true } } },
                    },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: parseInt(limit),
            }),
            prisma.order.count({
                where: {
                    restaurantId: { in: restaurantIds },
                    paymentStatus: 'PAID',
                },
            }),
        ]);

        const transactions = orders.map((order) => ({
            ...order,
            merchantEarning: Math.floor(order.subtotal * MERCHANT_COMMISSION_RATE),
            // Platform keeps 10% of subtotal + the full service charge
            platformFee: Math.floor(order.subtotal * (1 - MERCHANT_COMMISSION_RATE)) + (order.serviceCharge || 0),
        }));

        return sendResponse(res, 200, true, 'Transactions fetched', {
            transactions,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit)),
            },
        });

    } catch (error) {
        console.error('getTransactionHistory error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── REQUEST PAYOUT ───────────────────────────────────────────
const requestPayout = async (req, res) => {
    try {
        const { amount } = req.body;

        if (!amount || amount <= 0) {
            return sendResponse(res, 400, false, 'Valid amount is required');
        }

        const merchant = await prisma.merchant.findUnique({
            where: { userId: req.user.userId },
            include: {
                bankAccount: true,
                restaurants: { select: { id: true } },
            },
        });

        if (!merchant) {
            return sendResponse(res, 404, false, 'Merchant not found');
        }

        if (!merchant.bankAccount || !merchant.bankAccount.isVerified) {
            return sendResponse(res, 400, false, 'Please add a verified bank account before requesting a payout');
        }

        if (!merchant.bankAccount.recipientCode) {
            return sendResponse(res, 400, false, 'Bank account setup is incomplete. Please re-save your bank account.');
        }

        const restaurantIds = merchant.restaurants.map((r) => r.id);
        const earnings = await calculateEarnings(merchant.id, restaurantIds);

        if (amount > earnings.availableBalance) {
            return sendResponse(
                res,
                400,
                false,
                `Insufficient balance. Available: ₦${earnings.availableBalance.toLocaleString()}`
            );
        }

        const MIN_PAYOUT = 1000;
        if (amount < MIN_PAYOUT) {
            return sendResponse(res, 400, false, `Minimum payout amount is ₦${MIN_PAYOUT.toLocaleString()}`);
        }

        const pendingPayout = await prisma.payoutRequest.findFirst({
            where: { merchantId: merchant.id, status: { in: ['PENDING', 'PROCESSING'] } },
        });

        if (pendingPayout) {
            return sendResponse(res, 400, false, 'You already have a payout request being processed');
        }

        const transferRef = `PAYOUT-${merchant.id}-${Date.now()}`;

        const transferRes = await axios.post(
            'https://api.paystack.co/transfer',
            {
                source: 'balance',
                amount: amount * 100,
                recipient: merchant.bankAccount.recipientCode,
                reason: `Lanieats payout — ${merchant.businessName}`,
                reference: transferRef,
            },
            {
                headers: {
                    Authorization: `Bearer ${PAYSTACK_SECRET}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        const transferData = transferRes.data.data;

        const payoutRequest = await prisma.payoutRequest.create({
            data: {
                merchantId: merchant.id,
                amount,
                status: transferData.status === 'success' ? 'COMPLETED' : 'PROCESSING',
                reference: transferRef,
                narration: `Payout to ${merchant.bankAccount.accountName}`,
                processedAt: transferData.status === 'success' ? new Date() : null,
            },
        });

        return sendResponse(res, 201, true, 'Payout request submitted', {
            payout: payoutRequest,
            bankAccount: {
                accountName: merchant.bankAccount.accountName,
                bankName: merchant.bankAccount.bankName,
                accountNumber: `****${merchant.bankAccount.accountNumber.slice(-4)}`,
            },
        });

    } catch (error) {
        console.error('requestPayout error:', error.response?.data || error);

        if (error.response?.data?.message) {
            return sendResponse(res, 400, false, error.response.data.message);
        }

        return sendResponse(res, 500, false, 'Payout failed. Please try again.');
    }
};


// ─── GET PAYOUT HISTORY ───────────────────────────────────────
const getPayoutHistory = async (req, res) => {
    try {
        const merchant = await prisma.merchant.findUnique({
            where: { userId: req.user.userId },
        });

        if (!merchant) {
            return sendResponse(res, 404, false, 'Merchant not found');
        }

        const payouts = await prisma.payoutRequest.findMany({
            where: { merchantId: merchant.id },
            orderBy: { requestedAt: 'desc' },
        });

        return sendResponse(res, 200, true, 'Payout history fetched', { payouts });

    } catch (error) {
        console.error('getPayoutHistory error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


module.exports = {
    getEarningsSummary,
    getTransactionHistory,
    requestPayout,
    getPayoutHistory,
};
