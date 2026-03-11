const prisma = require('../config/prisma');
const axios = require('axios');

const sendResponse = (res, statusCode, success, message, data = null) => {
    const response = { success, message };
    if (data) response.data = data;
    return res.status(statusCode).json(response);
};

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
// Riders earn the full delivery fee. Adjust this rate to take a platform cut.
const RIDER_DELIVERY_FEE_RATE = parseFloat(process.env.RIDER_DELIVERY_FEE_RATE || '1.0');


// ─── HELPER: CALCULATE RIDER EARNINGS ────────────────────────
const calculateRiderEarnings = async (riderId) => {
    const deliveries = await prisma.delivery.findMany({
        where: {
            riderId,
            status: 'DELIVERED',
            order: { paymentStatus: 'PAID' },
        },
        select: {
            id: true,
            order: { select: { deliveryFee: true } },
        },
    });

    const totalEarned = deliveries.reduce(
        (sum, d) => sum + (d.order.deliveryFee || 0) * RIDER_DELIVERY_FEE_RATE,
        0
    );

    const completedPayouts = await prisma.riderPayoutRequest.aggregate({
        where: { riderId, status: 'COMPLETED' },
        _sum: { amount: true },
    });

    const totalPaidOut = completedPayouts._sum.amount || 0;
    const availableBalance = totalEarned - totalPaidOut;

    return {
        totalEarned: Math.floor(totalEarned),
        totalPaidOut: Math.floor(totalPaidOut),
        availableBalance: Math.floor(availableBalance),
        deliveryCount: deliveries.length,
    };
};


// ─── GET EARNINGS SUMMARY ─────────────────────────────────────
const getRiderEarningsSummary = async (req, res) => {
    try {
        const rider = await prisma.rider.findUnique({
            where: { userId: req.user.userId },
        });

        if (!rider) return sendResponse(res, 404, false, 'Rider profile not found');

        const earnings = await calculateRiderEarnings(rider.id);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        weekStart.setHours(0, 0, 0, 0);

        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

        const [todayData, weekData, monthData] = await Promise.all([
            prisma.delivery.findMany({
                where: {
                    riderId: rider.id,
                    status: 'DELIVERED',
                    order: { paymentStatus: 'PAID' },
                    deliveredAt: { gte: today },
                },
                select: { order: { select: { deliveryFee: true } } },
            }),
            prisma.delivery.findMany({
                where: {
                    riderId: rider.id,
                    status: 'DELIVERED',
                    order: { paymentStatus: 'PAID' },
                    deliveredAt: { gte: weekStart },
                },
                select: { order: { select: { deliveryFee: true } } },
            }),
            prisma.delivery.findMany({
                where: {
                    riderId: rider.id,
                    status: 'DELIVERED',
                    order: { paymentStatus: 'PAID' },
                    deliveredAt: { gte: monthStart },
                },
                select: { order: { select: { deliveryFee: true } } },
            }),
        ]);

        const sumFees = (deliveries) =>
            Math.floor(
                deliveries.reduce((s, d) => s + (d.order.deliveryFee || 0) * RIDER_DELIVERY_FEE_RATE, 0)
            );

        return sendResponse(res, 200, true, 'Earnings fetched', {
            balance: {
                available: earnings.availableBalance,
                totalEarned: earnings.totalEarned,
                totalPaidOut: earnings.totalPaidOut,
            },
            today: { earnings: sumFees(todayData), deliveries: todayData.length },
            thisWeek: { earnings: sumFees(weekData), deliveries: weekData.length },
            thisMonth: { earnings: sumFees(monthData), deliveries: monthData.length },
            riderFeeRate: RIDER_DELIVERY_FEE_RATE,
        });

    } catch (error) {
        console.error('getRiderEarningsSummary error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── GET EARNINGS HISTORY (per-delivery breakdown) ────────────
const getRiderEarningsHistory = async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const rider = await prisma.rider.findUnique({
            where: { userId: req.user.userId },
        });

        if (!rider) return sendResponse(res, 404, false, 'Rider profile not found');

        const [deliveries, total] = await Promise.all([
            prisma.delivery.findMany({
                where: {
                    riderId: rider.id,
                    status: 'DELIVERED',
                    order: { paymentStatus: 'PAID' },
                },
                select: {
                    id: true,
                    deliveredAt: true,
                    pickedUpAt: true,
                    photoProofUrl: true,
                    order: {
                        select: {
                            id: true,
                            deliveryFee: true,
                            restaurant: { select: { name: true, address: true } },
                            address: { select: { street: true, city: true } },
                            user: { select: { firstName: true, lastName: true } },
                        },
                    },
                },
                orderBy: { deliveredAt: 'desc' },
                skip,
                take: parseInt(limit),
            }),
            prisma.delivery.count({
                where: {
                    riderId: rider.id,
                    status: 'DELIVERED',
                    order: { paymentStatus: 'PAID' },
                },
            }),
        ]);

        const history = deliveries.map((d) => ({
            deliveryId: d.id,
            orderId: d.order.id,
            restaurant: d.order.restaurant,
            deliveryAddress: d.order.address,
            customer: d.order.user,
            pickedUpAt: d.pickedUpAt,
            deliveredAt: d.deliveredAt,
            photoProofUrl: d.photoProofUrl,
            deliveryFee: d.order.deliveryFee,
            riderEarning: Math.floor((d.order.deliveryFee || 0) * RIDER_DELIVERY_FEE_RATE),
        }));

        return sendResponse(res, 200, true, 'Earnings history fetched', {
            history,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit)),
            },
        });

    } catch (error) {
        console.error('getRiderEarningsHistory error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── GET MY BANK ACCOUNT ──────────────────────────────────────
const getRiderBankAccount = async (req, res) => {
    try {
        const rider = await prisma.rider.findUnique({
            where: { userId: req.user.userId },
            include: { bankAccount: true },
        });

        if (!rider) return sendResponse(res, 404, false, 'Rider profile not found');

        return sendResponse(res, 200, true, 'Bank account fetched', {
            bankAccount: rider.bankAccount || null,
        });

    } catch (error) {
        console.error('getRiderBankAccount error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── SAVE BANK ACCOUNT ────────────────────────────────────────
const saveRiderBankAccount = async (req, res) => {
    try {
        const { accountName, accountNumber, bankName, bankCode } = req.body;

        if (!accountName || !accountNumber || !bankName || !bankCode) {
            return sendResponse(res, 400, false, 'All bank account fields are required');
        }

        const rider = await prisma.rider.findUnique({
            where: { userId: req.user.userId },
        });

        if (!rider) return sendResponse(res, 404, false, 'Rider profile not found');

        let recipientCode = null;
        try {
            const recipientRes = await axios.post(
                'https://api.paystack.co/transferrecipient',
                {
                    type: 'nuban',
                    name: accountName,
                    account_number: accountNumber,
                    bank_code: bankCode,
                    currency: 'NGN',
                },
                {
                    headers: {
                        Authorization: `Bearer ${PAYSTACK_SECRET}`,
                        'Content-Type': 'application/json',
                    },
                }
            );
            recipientCode = recipientRes.data.data.recipient_code;
        } catch (paystackError) {
            console.error('Paystack recipient creation failed:', paystackError.response?.data);
        }

        const bankAccount = await prisma.riderBankAccount.upsert({
            where: { riderId: rider.id },
            update: { accountName, accountNumber, bankName, bankCode, recipientCode, isVerified: true },
            create: {
                riderId: rider.id,
                accountName,
                accountNumber,
                bankName,
                bankCode,
                recipientCode,
                isVerified: true,
            },
        });

        return sendResponse(res, 200, true, 'Bank account saved successfully', { bankAccount });

    } catch (error) {
        console.error('saveRiderBankAccount error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── REQUEST PAYOUT ───────────────────────────────────────────
const requestRiderPayout = async (req, res) => {
    try {
        const { amount } = req.body;

        if (!amount || amount <= 0) {
            return sendResponse(res, 400, false, 'Valid amount is required');
        }

        const rider = await prisma.rider.findUnique({
            where: { userId: req.user.userId },
            include: { bankAccount: true },
        });

        if (!rider) return sendResponse(res, 404, false, 'Rider profile not found');

        if (!rider.bankAccount?.isVerified) {
            return sendResponse(res, 400, false, 'Please add a verified bank account before requesting a payout');
        }

        if (!rider.bankAccount.recipientCode) {
            return sendResponse(res, 400, false, 'Bank account setup is incomplete. Please re-save your bank account.');
        }

        const earnings = await calculateRiderEarnings(rider.id);

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

        const pendingPayout = await prisma.riderPayoutRequest.findFirst({
            where: { riderId: rider.id, status: { in: ['PENDING', 'PROCESSING'] } },
        });

        if (pendingPayout) {
            return sendResponse(res, 400, false, 'You already have a payout request being processed');
        }

        const transferRef = `RIDER-PAYOUT-${rider.id}-${Date.now()}`;

        const transferRes = await axios.post(
            'https://api.paystack.co/transfer',
            {
                source: 'balance',
                amount: amount * 100,
                recipient: rider.bankAccount.recipientCode,
                reason: `Lanieats rider payout`,
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

        const payoutRequest = await prisma.riderPayoutRequest.create({
            data: {
                riderId: rider.id,
                amount,
                status: transferData.status === 'success' ? 'COMPLETED' : 'PROCESSING',
                reference: transferRef,
                narration: `Payout to ${rider.bankAccount.accountName}`,
                processedAt: transferData.status === 'success' ? new Date() : null,
            },
        });

        return sendResponse(res, 201, true, 'Payout request submitted', {
            payout: payoutRequest,
            bankAccount: {
                accountName: rider.bankAccount.accountName,
                bankName: rider.bankAccount.bankName,
                accountNumber: `****${rider.bankAccount.accountNumber.slice(-4)}`,
            },
        });

    } catch (error) {
        console.error('requestRiderPayout error:', error.response?.data || error);

        if (error.response?.data?.message) {
            return sendResponse(res, 400, false, error.response.data.message);
        }

        return sendResponse(res, 500, false, 'Payout failed. Please try again.');
    }
};


// ─── GET PAYOUT HISTORY ───────────────────────────────────────
const getRiderPayoutHistory = async (req, res) => {
    try {
        const rider = await prisma.rider.findUnique({
            where: { userId: req.user.userId },
        });

        if (!rider) return sendResponse(res, 404, false, 'Rider profile not found');

        const payouts = await prisma.riderPayoutRequest.findMany({
            where: { riderId: rider.id },
            orderBy: { requestedAt: 'desc' },
        });

        return sendResponse(res, 200, true, 'Payout history fetched', { payouts });

    } catch (error) {
        console.error('getRiderPayoutHistory error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


module.exports = {
    getRiderEarningsSummary,
    getRiderEarningsHistory,
    getRiderBankAccount,
    saveRiderBankAccount,
    requestRiderPayout,
    getRiderPayoutHistory,
};
