const prisma = require('../config/prisma');
const cloudinary = require('../config/cloudinary');

const uploadToCloudinary = (buffer, folder) =>
    new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder, resource_type: 'image' },
            (error, result) => {
                if (error) reject(error);
                else resolve(result.secure_url);
            }
        );
        stream.end(buffer);
    });

const sendResponse = (res, statusCode, success, message, data = null) => {
    const response = { success, message };
    if (data) response.data = data;
    return res.status(statusCode).json(response);
};


// ─── CREATE RESTAURANT ───────────────────────────────────────
const createRestaurant = async (req, res) => {
    try {
        const { name, description, address, city, state, openingTime, closingTime } = req.body;

        if (!name || !address || !city || !state) {
            return sendResponse(res, 400, false, 'Name, address, city and state are required');
        }

        // Get the merchant profile linked to this user
        const merchant = await prisma.merchant.findUnique({
            where: { userId: req.user.userId },
        });

        if (!merchant) {
            return sendResponse(res, 404, false, 'Merchant profile not found');
        }

        const restaurant = await prisma.restaurant.create({
            data: {
                merchantId: merchant.id,
                name,
                description,
                address,
                city,
                state,
                openingTime,
                closingTime,
            },
        });

        return sendResponse(res, 201, true, 'Restaurant created successfully', { restaurant });

    } catch (error) {
        console.error('createRestaurant error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── GET MY RESTAURANTS (merchant sees their own) ─────────────
const getMyRestaurants = async (req, res) => {
    try {
        const merchant = await prisma.merchant.findUnique({
            where: { userId: req.user.userId },
        });

        if (!merchant) {
            return sendResponse(res, 404, false, 'Merchant profile not found');
        }

        const restaurants = await prisma.restaurant.findMany({
            where: { merchantId: merchant.id },
            include: {
                categories: true,
                _count: { select: { menuItems: true, orders: true } },
            },
        });

        return sendResponse(res, 200, true, 'Restaurants fetched', { restaurants });

    } catch (error) {
        console.error('getMyRestaurants error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── GET ALL RESTAURANTS (customers browse) ──────────────────
const getAllRestaurants = async (req, res) => {
    try {
        const { city, search } = req.query;

        const where = {
            isApproved: true,
        };

        if (city) {
            where.city = { contains: city, mode: 'insensitive' };
        }

        if (search) {
            where.name = { contains: search, mode: 'insensitive' };
        }

        const restaurants = await prisma.restaurant.findMany({
            where,
            select: {
                id: true,
                name: true,
                description: true,
                address: true,
                city: true,
                state: true,
                logoUrl: true,
                coverUrl: true,
                isOpen: true,
                rating: true,
                totalReviews: true,
                openingTime: true,
                closingTime: true,
            },
            orderBy: { rating: 'desc' },
        });

        return sendResponse(res, 200, true, 'Restaurants fetched', { restaurants });

    } catch (error) {
        console.error('getAllRestaurants error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── GET SINGLE RESTAURANT (with full menu) ──────────────────
const getRestaurantById = async (req, res) => {
    try {
        const { id } = req.params;

        const restaurant = await prisma.restaurant.findUnique({
            where: { id },
            include: {
                categories: {
                    include: {
                        menuItems: {
                            where: { isAvailable: true },
                        },
                    },
                },
            },
        });

        if (!restaurant) {
            return sendResponse(res, 404, false, 'Restaurant not found');
        }

        return sendResponse(res, 200, true, 'Restaurant fetched', { restaurant });

    } catch (error) {
        console.error('getRestaurantById error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── UPDATE RESTAURANT ───────────────────────────────────────
const updateRestaurant = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, address, city, state, openingTime, closingTime, isOpen } = req.body;

        // Make sure this restaurant belongs to the requesting merchant
        const merchant = await prisma.merchant.findUnique({
            where: { userId: req.user.userId },
        });

        const restaurant = await prisma.restaurant.findFirst({
            where: { id, merchantId: merchant.id },
        });

        if (!restaurant) {
            return sendResponse(res, 404, false, 'Restaurant not found or access denied');
        }

        const updated = await prisma.restaurant.update({
            where: { id },
            data: {
                name,
                description,
                address,
                city,
                state,
                openingTime,
                closingTime,
                isOpen,
            },
        });

        return sendResponse(res, 200, true, 'Restaurant updated', { restaurant: updated });

    } catch (error) {
        console.error('updateRestaurant error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── UPLOAD RESTAURANT LOGO ──────────────────────────────────
const uploadRestaurantLogo = async (req, res) => {
    try {
        const { id } = req.params;

        if (!req.file) {
            return sendResponse(res, 400, false, 'Image file is required');
        }

        const merchant = await prisma.merchant.findUnique({ where: { userId: req.user.userId } });
        const restaurant = await prisma.restaurant.findFirst({ where: { id, merchantId: merchant?.id } });

        if (!restaurant) {
            return sendResponse(res, 404, false, 'Restaurant not found or access denied');
        }

        const logoUrl = await uploadToCloudinary(req.file.buffer, 'lanieats/logos');

        const updated = await prisma.restaurant.update({ where: { id }, data: { logoUrl } });

        return sendResponse(res, 200, true, 'Logo uploaded', { restaurant: updated });

    } catch (error) {
        console.error('uploadRestaurantLogo error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── UPLOAD RESTAURANT COVER ─────────────────────────────────
const uploadRestaurantCover = async (req, res) => {
    try {
        const { id } = req.params;

        if (!req.file) {
            return sendResponse(res, 400, false, 'Image file is required');
        }

        const merchant = await prisma.merchant.findUnique({ where: { userId: req.user.userId } });
        const restaurant = await prisma.restaurant.findFirst({ where: { id, merchantId: merchant?.id } });

        if (!restaurant) {
            return sendResponse(res, 404, false, 'Restaurant not found or access denied');
        }

        const coverUrl = await uploadToCloudinary(req.file.buffer, 'lanieats/covers');

        const updated = await prisma.restaurant.update({ where: { id }, data: { coverUrl } });

        return sendResponse(res, 200, true, 'Cover uploaded', { restaurant: updated });

    } catch (error) {
        console.error('uploadRestaurantCover error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


module.exports = {
    createRestaurant,
    getMyRestaurants,
    getAllRestaurants,
    getRestaurantById,
    updateRestaurant,
    uploadRestaurantLogo,
    uploadRestaurantCover,
};