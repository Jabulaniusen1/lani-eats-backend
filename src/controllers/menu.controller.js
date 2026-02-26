const prisma = require('../config/prisma');

const sendResponse = (res, statusCode, success, message, data = null) => {
    const response = { success, message };
    if (data) response.data = data;
    return res.status(statusCode).json(response);
};

// Helper — verify restaurant belongs to merchant making the request
const verifyRestaurantOwner = async (restaurantId, userId) => {
    const merchant = await prisma.merchant.findUnique({
        where: { userId },
    });

    if (!merchant) return null;

    const restaurant = await prisma.restaurant.findFirst({
        where: { id: restaurantId, merchantId: merchant.id },
    });

    return restaurant;
};


// ─── CREATE CATEGORY ─────────────────────────────────────────
const createCategory = async (req, res) => {
    try {
        const { restaurantId } = req.params;
        const { name } = req.body;

        if (!name) {
            return sendResponse(res, 400, false, 'Category name is required');
        }

        const restaurant = await verifyRestaurantOwner(restaurantId, req.user.userId);
        if (!restaurant) {
            return sendResponse(res, 404, false, 'Restaurant not found or access denied');
        }

        const category = await prisma.restaurantCategory.create({
            data: { restaurantId, name },
        });

        return sendResponse(res, 201, true, 'Category created', { category });

    } catch (error) {
        console.error('createCategory error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── CREATE MENU ITEM ─────────────────────────────────────────
const createMenuItem = async (req, res) => {
    try {
        const { restaurantId } = req.params;
        const { name, description, price, categoryId, imageUrl } = req.body;

        if (!name || !price) {
            return sendResponse(res, 400, false, 'Name and price are required');
        }

        const restaurant = await verifyRestaurantOwner(restaurantId, req.user.userId);
        if (!restaurant) {
            return sendResponse(res, 404, false, 'Restaurant not found or access denied');
        }

        const menuItem = await prisma.menuItem.create({
            data: {
                restaurantId,
                name,
                description,
                price: parseFloat(price),
                categoryId: categoryId || null,
                imageUrl: imageUrl || null,
            },
        });

        return sendResponse(res, 201, true, 'Menu item created', { menuItem });

    } catch (error) {
        console.error('createMenuItem error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── GET MENU ITEMS (for a restaurant) ───────────────────────
const getMenuItems = async (req, res) => {
    try {
        const { restaurantId } = req.params;

        const menuItems = await prisma.menuItem.findMany({
            where: { restaurantId },
            include: { category: true },
            orderBy: { createdAt: 'desc' },
        });

        return sendResponse(res, 200, true, 'Menu items fetched', { menuItems });

    } catch (error) {
        console.error('getMenuItems error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── UPDATE MENU ITEM ─────────────────────────────────────────
const updateMenuItem = async (req, res) => {
    try {
        const { restaurantId, itemId } = req.params;
        const { name, description, price, categoryId, isAvailable, imageUrl } = req.body;

        const restaurant = await verifyRestaurantOwner(restaurantId, req.user.userId);
        if (!restaurant) {
            return sendResponse(res, 404, false, 'Restaurant not found or access denied');
        }

        const updated = await prisma.menuItem.update({
            where: { id: itemId },
            data: {
                name,
                description,
                price: price ? parseFloat(price) : undefined,
                categoryId,
                isAvailable,
                imageUrl,
            },
        });

        return sendResponse(res, 200, true, 'Menu item updated', { menuItem: updated });

    } catch (error) {
        console.error('updateMenuItem error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── DELETE MENU ITEM ─────────────────────────────────────────
const deleteMenuItem = async (req, res) => {
    try {
        const { restaurantId, itemId } = req.params;

        const restaurant = await verifyRestaurantOwner(restaurantId, req.user.userId);
        if (!restaurant) {
            return sendResponse(res, 404, false, 'Restaurant not found or access denied');
        }

        await prisma.menuItem.delete({ where: { id: itemId } });

        return sendResponse(res, 200, true, 'Menu item deleted');

    } catch (error) {
        console.error('deleteMenuItem error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


module.exports = {
    createCategory,
    createMenuItem,
    getMenuItems,
    updateMenuItem,
    deleteMenuItem,
};