const prisma = require('../config/prisma');

const sendResponse = (res, statusCode, success, message, data = null) => {
    const response = { success, message };
    if (data) response.data = data;
    return res.status(statusCode).json(response);
};


// ─── OVERVIEW STATS ───────────────────────────────────────────
const getOverviewStats = async (req, res) => {
    try {
        const { restaurantId } = req.params;
        const { period = '7d' } = req.query; // '1d' | '7d' | '30d'

        const merchant = await prisma.merchant.findUnique({
            where: { userId: req.user.userId },
        });

        const restaurant = await prisma.restaurant.findFirst({
            where: { id: restaurantId, merchantId: merchant.id },
        });

        if (!restaurant) {
            return sendResponse(res, 404, false, 'Restaurant not found');
        }

        const now = new Date();
        const periodMap = { '1d': 1, '7d': 7, '30d': 30 };
        const days = periodMap[period] || 7;
        const startDate = new Date(now);
        startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0);

        const [
            totalOrders,
            deliveredOrders,
            cancelledOrders,
            revenue,
            avgOrderValue,
        ] = await Promise.all([
            prisma.order.count({
                where: { restaurantId, createdAt: { gte: startDate } },
            }),
            prisma.order.count({
                where: { restaurantId, status: 'DELIVERED', createdAt: { gte: startDate } },
            }),
            prisma.order.count({
                where: { restaurantId, status: 'CANCELLED', createdAt: { gte: startDate } },
            }),
            prisma.order.aggregate({
                where: {
                    restaurantId,
                    status: 'DELIVERED',
                    paymentStatus: 'PAID',
                    createdAt: { gte: startDate },
                },
                _sum: { subtotal: true },
            }),
            prisma.order.aggregate({
                where: {
                    restaurantId,
                    status: 'DELIVERED',
                    createdAt: { gte: startDate },
                },
                _avg: { total: true },
            }),
        ]);

        const completionRate = totalOrders > 0
            ? Math.round((deliveredOrders / totalOrders) * 100)
            : 0;

        return sendResponse(res, 200, true, 'Stats fetched', {
            period,
            totalOrders,
            deliveredOrders,
            cancelledOrders,
            completionRate,
            revenue: Math.floor(revenue._sum.subtotal || 0),
            avgOrderValue: Math.floor(avgOrderValue._avg.total || 0),
        });

    } catch (error) {
        console.error('getOverviewStats error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── REVENUE CHART ────────────────────────────────────────────
const getRevenueChart = async (req, res) => {
    try {
        const { restaurantId } = req.params;
        const { days = 7 } = req.query;

        const merchant = await prisma.merchant.findUnique({
            where: { userId: req.user.userId },
        });

        const restaurant = await prisma.restaurant.findFirst({
            where: { id: restaurantId, merchantId: merchant.id },
        });

        if (!restaurant) {
            return sendResponse(res, 404, false, 'Restaurant not found');
        }

        const chartData = [];
        const numDays = parseInt(days);

        for (let i = numDays - 1; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            date.setHours(0, 0, 0, 0);

            const nextDate = new Date(date);
            nextDate.setDate(nextDate.getDate() + 1);

            const result = await prisma.order.aggregate({
                where: {
                    restaurantId,
                    status: 'DELIVERED',
                    paymentStatus: 'PAID',
                    createdAt: { gte: date, lt: nextDate },
                },
                _sum: { subtotal: true },
                _count: true,
            });

            chartData.push({
                date: date.toISOString().split('T')[0],
                label: date.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric' }),
                revenue: Math.floor(result._sum.subtotal || 0),
                orders: result._count,
            });
        }

        return sendResponse(res, 200, true, 'Revenue chart fetched', { chartData });

    } catch (error) {
        console.error('getRevenueChart error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── BEST SELLING ITEMS ───────────────────────────────────────
const getBestSellingItems = async (req, res) => {
    try {
        const { restaurantId } = req.params;
        const { limit = 10 } = req.query;

        const merchant = await prisma.merchant.findUnique({
            where: { userId: req.user.userId },
        });

        const restaurant = await prisma.restaurant.findFirst({
            where: { id: restaurantId, merchantId: merchant.id },
        });

        if (!restaurant) {
            return sendResponse(res, 404, false, 'Restaurant not found');
        }

        const bestSellers = await prisma.orderItem.groupBy({
            by: ['menuItemId'],
            where: {
                order: {
                    restaurantId,
                    status: 'DELIVERED',
                },
            },
            _sum: { quantity: true, totalPrice: true },
            _count: { menuItemId: true },
            orderBy: { _sum: { quantity: 'desc' } },
            take: parseInt(limit),
        });

        const menuItemIds = bestSellers.map((item) => item.menuItemId);
        const menuItems = await prisma.menuItem.findMany({
            where: { id: { in: menuItemIds } },
            select: { id: true, name: true, price: true, imageUrl: true },
        });

        const result = bestSellers.map((item) => {
            const menuItem = menuItems.find((m) => m.id === item.menuItemId);
            return {
                menuItemId: item.menuItemId,
                name: menuItem?.name || 'Unknown Item',
                imageUrl: menuItem?.imageUrl || null,
                price: menuItem?.price || 0,
                totalQuantitySold: item._sum.quantity,
                totalRevenue: Math.floor(item._sum.totalPrice || 0),
                orderCount: item._count.menuItemId,
            };
        });

        return sendResponse(res, 200, true, 'Best sellers fetched', { bestSellers: result });

    } catch (error) {
        console.error('getBestSellingItems error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── PEAK HOURS ───────────────────────────────────────────────
const getPeakHours = async (req, res) => {
    try {
        const { restaurantId } = req.params;

        const merchant = await prisma.merchant.findUnique({
            where: { userId: req.user.userId },
        });

        const restaurant = await prisma.restaurant.findFirst({
            where: { id: restaurantId, merchantId: merchant.id },
        });

        if (!restaurant) {
            return sendResponse(res, 404, false, 'Restaurant not found');
        }

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const orders = await prisma.order.findMany({
            where: {
                restaurantId,
                status: 'DELIVERED',
                createdAt: { gte: thirtyDaysAgo },
            },
            select: { createdAt: true },
        });

        const hourCounts = new Array(24).fill(0);
        orders.forEach((order) => {
            const hour = new Date(order.createdAt).getHours();
            hourCounts[hour]++;
        });

        const peakHours = hourCounts.map((count, hour) => ({
            hour,
            label: `${hour.toString().padStart(2, '0')}:00`,
            orders: count,
        }));

        const peakHour = peakHours.reduce((max, h) => (h.orders > max.orders ? h : max), peakHours[0]);

        return sendResponse(res, 200, true, 'Peak hours fetched', {
            peakHours,
            peakHour: peakHour.label,
        });

    } catch (error) {
        console.error('getPeakHours error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


module.exports = {
    getOverviewStats,
    getRevenueChart,
    getBestSellingItems,
    getPeakHours,
};
