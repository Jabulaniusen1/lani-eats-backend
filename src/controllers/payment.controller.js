const axios = require('axios');
const prisma = require('../config/prisma');
const crypto = require('crypto');
const { getIO } = require('../config/socket');

const sendResponse = (res, statusCode, success, message, data = null) => {
    const response = { success, message };
    if (data) response.data = data;
    return res.status(statusCode).json(response);
};

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

// ─── INITIALIZE PAYMENT ───────────────────────────────────────
// Customer calls this after placing an order
// We call Paystack and return a payment link to the mobile app
const initializePayment = async (req, res) => {
    try {
        const { orderId } = req.params;

        // Fetch the order
        const order = await prisma.order.findFirst({
            where: {
                id: orderId,
                userId: req.user.userId,
            },
            include: {
                user: true,
            },
        });

        if (!order) {
            return sendResponse(res, 404, false, 'Order not found');
        }

        if (order.paymentStatus === 'PAID') {
            return sendResponse(res, 400, false, 'Order is already paid');
        }

        if (order.status === 'CANCELLED') {
            return sendResponse(res, 400, false, 'Cannot pay for a cancelled order');
        }

        // Call Paystack to initialize transaction
        const response = await axios.post(
            'https://api.paystack.co/transaction/initialize',
            {
                email: order.user.email,
                amount: Math.round(order.total * 100), // Paystack uses kobo — multiply by 100
                reference: `CHOPFAST-${orderId}-${Date.now()}`,
                metadata: {
                    orderId: order.id,
                    userId: order.userId,
                },
            },
            {
                headers: {
                    Authorization: `Bearer ${PAYSTACK_SECRET}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        const { authorization_url, reference } = response.data.data;

        // Save the reference on the order so we can verify later
        await prisma.order.update({
            where: { id: orderId },
            data: { paymentRef: reference },
        });

        return sendResponse(res, 200, true, 'Payment initialized', {
            paymentUrl: authorization_url, // send this to mobile app — open in browser/webview
            reference,
        });

    } catch (error) {
        console.error('initializePayment error:', error.response?.data || error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── VERIFY PAYMENT ───────────────────────────────────────────
// Called manually to check a payment status
// Useful if webhook fails or for double-checking
const verifyPayment = async (req, res) => {
    try {
        const { reference } = req.params;

        const response = await axios.get(
            `https://api.paystack.co/transaction/verify/${reference}`,
            {
                headers: {
                    Authorization: `Bearer ${PAYSTACK_SECRET}`,
                },
            }
        );

        const { status, metadata } = response.data.data;

        if (status === 'success') {
            const confirmedOrder = await prisma.order.update({
                where: { id: metadata.orderId },
                data: {
                    paymentStatus: 'PAID',
                    status: 'CONFIRMED',
                },
                include: {
                    restaurant: { select: { id: true } },
                },
            });

            const io = getIO();
            io.to(`restaurant_${confirmedOrder.restaurant.id}`).emit('order_confirmed', {
                orderId: metadata.orderId,
                message: 'Payment received. Order confirmed.',
            });
            io.to(`order_${metadata.orderId}`).emit('order_status_updated', {
                orderId: metadata.orderId,
                status: 'CONFIRMED',
                updatedAt: confirmedOrder.updatedAt,
            });

            return sendResponse(res, 200, true, 'Payment verified', {
                status: 'success',
                orderId: metadata.orderId,
            });
        }

        return sendResponse(res, 400, false, 'Payment not successful', {
            status,
        });

    } catch (error) {
        console.error('verifyPayment error:', error.response?.data || error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── PAYSTACK WEBHOOK ─────────────────────────────────────────
// Paystack calls this URL automatically when a payment is completed
// This is the most reliable way to confirm payment
const paystackWebhook = async (req, res) => {
    try {
        // 1. Verify the request is actually from Paystack
        // Paystack signs every webhook with your secret key
        const hash = crypto
            .createHmac('sha512', PAYSTACK_SECRET)
            .update(req.body) // req.body is a raw Buffer from express.raw()
            .digest('hex');

        if (hash !== req.headers['x-paystack-signature']) {
            return res.status(401).send('Invalid signature');
        }

        const event = JSON.parse(req.body);

        // 2. Handle the charge.success event
        if (event.event === 'charge.success') {
            const { reference, metadata } = event.data;
            const { orderId } = metadata;

            const order = await prisma.order.findUnique({
                where: { id: orderId },
            });

            if (!order) {
                return res.status(200).send('Order not found but acknowledged');
            }

            // Prevent processing same webhook twice
            if (order.paymentStatus === 'PAID') {
                return res.status(200).send('Already processed');
            }

            const confirmedOrder = await prisma.order.update({
                where: { id: orderId },
                data: {
                    paymentStatus: 'PAID',
                    paymentRef: reference,
                    status: 'CONFIRMED',
                },
                include: {
                    restaurant: { select: { id: true, name: true } },
                },
            });

            // Notify merchant to start preparing
            const io = getIO();
            io.to(`restaurant_${confirmedOrder.restaurant.id}`).emit('order_confirmed', {
                orderId,
                message: 'Payment received. Order confirmed.',
            });

            // Notify customer their order is confirmed
            io.to(`order_${orderId}`).emit('order_status_updated', {
                orderId,
                status: 'CONFIRMED',
                updatedAt: confirmedOrder.updatedAt,
            });

            console.log(`✅ Payment confirmed for order ${orderId}`);
        }

        // Always return 200 to Paystack — even if we don't handle the event
        // If you return anything else, Paystack will keep retrying
        return res.status(200).send('Webhook received');

    } catch (error) {
        console.error('paystackWebhook error:', error);
        return res.status(200).send('Webhook error acknowledged');
    }
};


module.exports = { initializePayment, verifyPayment, paystackWebhook };