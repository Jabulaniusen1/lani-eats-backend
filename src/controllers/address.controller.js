const axios = require('axios');
const prisma = require('../config/prisma');

const geocodeAddress = async (street, city, state) => {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    const address = `${street}, ${city}, ${state}, Nigeria`;

    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
        params: { address, key: apiKey },
    });

    const result = response.data.results[0];
    if (!result) return { latitude: null, longitude: null };

    const { lat, lng } = result.geometry.location;
    return { latitude: lat, longitude: lng };
};

const sendResponse = (res, statusCode, success, message, data = null) => {
    const response = { success, message };
    if (data) response.data = data;
    return res.status(statusCode).json(response);
};


// ─── ADD ADDRESS ─────────────────────────────────────────────
const addAddress = async (req, res) => {
    try {
        const { label, street, city, state, latitude, longitude, isDefault } = req.body;

        if (!street || !city || !state) {
            return sendResponse(res, 400, false, 'Street, city and state are required');
        }

        // If this is being set as default, unset all other defaults first
        if (isDefault) {
            await prisma.address.updateMany({
                where: { userId: req.user.userId },
                data: { isDefault: false },
            });
        }

        // Auto-geocode if coordinates not provided by client
        let lat = latitude || null;
        let lng = longitude || null;

        if (!lat || !lng) {
            try {
                const coords = await geocodeAddress(street, city, state);
                lat = coords.latitude;
                lng = coords.longitude;
            } catch (geocodeError) {
                console.error('Geocoding failed, saving without coordinates:', geocodeError.message);
            }
        }

        const address = await prisma.address.create({
            data: {
                userId: req.user.userId,
                label: label || 'Home',
                street,
                city,
                state,
                latitude: lat,
                longitude: lng,
                isDefault: isDefault || false,
            },
        });

        return sendResponse(res, 201, true, 'Address added', { address });

    } catch (error) {
        console.error('addAddress error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── GET MY ADDRESSES ─────────────────────────────────────────
const getMyAddresses = async (req, res) => {
    try {
        const addresses = await prisma.address.findMany({
            where: { userId: req.user.userId },
            orderBy: { isDefault: 'desc' },
        });

        return sendResponse(res, 200, true, 'Addresses fetched', { addresses });

    } catch (error) {
        console.error('getMyAddresses error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── DELETE ADDRESS ──────────────────────────────────────────
const deleteAddress = async (req, res) => {
    try {
        const { id } = req.params;

        const address = await prisma.address.findFirst({
            where: { id, userId: req.user.userId },
        });

        if (!address) {
            return sendResponse(res, 404, false, 'Address not found');
        }

        await prisma.address.delete({ where: { id } });

        return sendResponse(res, 200, true, 'Address deleted');

    } catch (error) {
        console.error('deleteAddress error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


module.exports = { addAddress, getMyAddresses, deleteAddress };