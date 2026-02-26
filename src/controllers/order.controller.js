const prisma = require('../config/prisma');
const { getIO } = require('../config/socket');

const sendResponse = (res, statusCode, success, message, data = null) => {
    const response = { success, message };
    if (data) response.data = data;
    return res.status(statusCode).json(response);
};

const DELIVERY_FEE = 500; // flat fee for now, make dynamic later


// ─── PLACE ORDER ─────────────────────────────────────────────
const placeOrder = async (req, res) => {
    try {
        const { restaurantId, addressId, items, note } = req.body;

        if (!restaurantId || !addressId || !items || items.length === 0) {
            return sendResponse(res, 400, false, 'Restaurant, address and items are required');
        }

        // 1. Verify restaurant exists and is open
        const restaurant = await prisma.restaurant.findUnique({
            where: { id: restaurantId },
        });

        if (!restaurant) {
            return sendResponse(res, 404, false, 'Restaurant not found');
        }

        if (!restaurant.isOpen) {
            return sendResponse(res, 400, false, 'Restaurant is currently closed');
        }

        // 2. Verify address belongs to this user
        const address = await prisma.address.findFirst({
            where: { id: addressId, userId: req.user.userId },
        });

        if (!address) {
            return sendResponse(res, 404, false, 'Address not found');
        }

        // 3. Fetch all menu items being ordered
        const menuItemIds = items.map((i) => i.menuItemId);

        const menuItems = await prisma.menuItem.findMany({
            where: {
                id: { in: menuItemIds },
                restaurantId,
                isAvailable: true,
            },
        });

        if (menuItems.length !== menuItemIds.length) {
            return sendResponse(res, 400, false, 'One or more items are unavailable or invalid');
        }

        // 4. Calculate totals
        let subtotal = 0;

        const orderItemsData = items.map((item) => {
            const menuItem = menuItems.find((m) => m.id === item.menuItemId);
            const totalPrice = menuItem.price * item.quantity;
            subtotal += totalPrice;

            return {
                menuItemId: item.menuItemId,
                quantity: item.quantity,
                unitPrice: menuItem.price,
                totalPrice,
            };
        });

        const total = subtotal + DELIVERY_FEE;

        // 5. Create order + order items + delivery record in one transaction
        const order = await prisma.$transaction(async (tx) => {
            const newOrder = await tx.order.create({
                data: {
                    userId: req.user.userId,
                    restaurantId,
                    addressId,
                    subtotal,
                    deliveryFee: DELIVERY_FEE,
                    total,
                    note: note || null,
                    items: {
                        create: orderItemsData,
                    },
                },
                include: {
                    items: {
                        include: { menuItem: true },
                    },
                    address: true,
                    restaurant: true,
                },
            });

            // Create delivery record immediately — starts as UNASSIGNED
            await tx.delivery.create({
                data: {
                    orderId: newOrder.id,
                    status: 'UNASSIGNED',
                },
            });

            return newOrder;
        });

        // Notify merchant of new order in real time
        const io = getIO();
        io.to(`restaurant_${restaurantId}`).emit('new_order', {
            orderId: order.id,
            total: order.total,
            itemCount: order.items.length,
            preview: order.items[0]?.menuItem?.name,
            createdAt: order.createdAt,
        });

        return sendResponse(res, 201, true, 'Order placed successfully', { order });

    } catch (error) {
        console.error('placeOrder error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── GET MY ORDERS (customer) ─────────────────────────────────
const getMyOrders = async (req, res) => {
    try {
        const orders = await prisma.order.findMany({
            where: { userId: req.user.userId },
            include: {
                restaurant: {
                    select: { id: true, name: true, logoUrl: true },
                },
                items: {
                    include: {
                        menuItem: {
                            select: { name: true, imageUrl: true },
                        },
                    },
                },
                delivery: true,
            },
            orderBy: { createdAt: 'desc' },
        });

        return sendResponse(res, 200, true, 'Orders fetched', { orders });

    } catch (error) {
        console.error('getMyOrders error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── GET SINGLE ORDER ─────────────────────────────────────────
const getOrderById = async (req, res) => {
    try {
        const { id } = req.params;

        const order = await prisma.order.findUnique({
            where: { id },
            include: {
                restaurant: true,
                address: true,
                items: {
                    include: { menuItem: true },
                },
                delivery: {
                    include: {
                        rider: {
                            include: {
                                user: {
                                    select: { firstName: true, lastName: true, phone: true },
                                },
                            },
                        },
                    },
                },
            },
        });

        if (!order) {
            return sendResponse(res, 404, false, 'Order not found');
        }

        // Only the customer, the restaurant merchant, or the assigned rider can view
        const isMerchant = req.user.role === 'MERCHANT';
        const isCustomer = order.userId === req.user.userId;
        const isRider = order.delivery?.rider?.userId === req.user.userId;

        if (!isCustomer && !isMerchant && !isRider) {
            return sendResponse(res, 403, false, 'Access denied');
        }

        return sendResponse(res, 200, true, 'Order fetched', { order });

    } catch (error) {
        console.error('getOrderById error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── GET RESTAURANT ORDERS (merchant sees incoming orders) ────
const getRestaurantOrders = async (req, res) => {
    try {
        const { restaurantId } = req.params;
        const { status } = req.query;

        const merchant = await prisma.merchant.findUnique({
            where: { userId: req.user.userId },
        });

        const restaurant = await prisma.restaurant.findFirst({
            where: { id: restaurantId, merchantId: merchant.id },
        });

        if (!restaurant) {
            return sendResponse(res, 404, false, 'Restaurant not found or access denied');
        }

        const where = { restaurantId };
        if (status) where.status = status;

        const orders = await prisma.order.findMany({
            where,
            include: {
                user: {
                    select: { firstName: true, lastName: true, phone: true },
                },
                items: {
                    include: { menuItem: true },
                },
                address: true,
                delivery: true,
            },
            orderBy: { createdAt: 'desc' },
        });

        return sendResponse(res, 200, true, 'Orders fetched', { orders });

    } catch (error) {
        console.error('getRestaurantOrders error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── UPDATE ORDER STATUS (merchant updates) ──────────────────
const updateOrderStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const allowedStatuses = ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'CANCELLED'];

        if (!allowedStatuses.includes(status)) {
            return sendResponse(res, 400, false, `Invalid status. Allowed: ${allowedStatuses.join(', ')}`);
        }

        const merchant = await prisma.merchant.findUnique({
            where: { userId: req.user.userId },
        });

        // Include restaurant so we can emit its name to riders
        const order = await prisma.order.findFirst({
            where: {
                id,
                restaurant: { merchantId: merchant.id },
            },
            include: {
                restaurant: {
                    select: { name: true },
                },
            },
        });

        if (!order) {
            return sendResponse(res, 404, false, 'Order not found or access denied');
        }

        if (['DELIVERED', 'CANCELLED'].includes(order.status)) {
            return sendResponse(res, 400, false, `Cannot update an order that is already ${order.status}`);
        }

        const updated = await prisma.order.update({
            where: { id },
            data: { status },
        });

        const io = getIO();

        // Notify customer tracking this order
        io.to(`order_${id}`).emit('order_status_updated', {
            orderId: id,
            status: updated.status,
            updatedAt: updated.updatedAt,
        });

        // Notify riders when food is being prepared or is ready
        if (status === 'PREPARING' || status === 'READY_FOR_PICKUP') {
            io.emit('delivery_available', {
                orderId: id,
                status: updated.status,
                restaurantName: order.restaurant?.name,
            });
        }

        // Notify customer if order was cancelled by merchant
        if (status === 'CANCELLED') {
            io.to(`customer_${order.userId}`).emit('order_cancelled', {
                orderId: id,
                message: 'Your order was cancelled by the restaurant',
            });
        }

        return sendResponse(res, 200, true, 'Order status updated', { order: updated });

    } catch (error) {
        console.error('updateOrderStatus error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── CANCEL ORDER (customer cancels) ─────────────────────────
const cancelOrder = async (req, res) => {
    try {
        const { id } = req.params;

        const order = await prisma.order.findFirst({
            where: { id, userId: req.user.userId },
        });

        if (!order) {
            return sendResponse(res, 404, false, 'Order not found');
        }

        if (order.status !== 'PENDING') {
            return sendResponse(res, 400, false, 'You can only cancel a pending order');
        }

        const updated = await prisma.order.update({
            where: { id },
            data: { status: 'CANCELLED' },
        });

        // Notify merchant that customer cancelled
        const io = getIO();
        io.to(`restaurant_${order.restaurantId}`).emit('order_cancelled', {
            orderId: id,
            message: 'Customer cancelled the order',
        });

        return sendResponse(res, 200, true, 'Order cancelled', { order: updated });

    } catch (error) {
        console.error('cancelOrder error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


module.exports = {
    placeOrder,
    getMyOrders,
    getOrderById,
    getRestaurantOrders,
    updateOrderStatus,
    cancelOrder,
};