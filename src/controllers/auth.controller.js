const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');

// Helper to generate token
const generateToken = (userId, role) => {
    return jwt.sign(
        { userId, role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN }
    );
};

// Helper for consistent responses
const sendResponse = (res, statusCode, success, message, data = null) => {
    const response = { success, message };
    if (data) response.data = data;
    return res.status(statusCode).json(response);
};


// ─── REGISTER ───────────────────────────────────────────────
const register = async (req, res) => {
    try {
        const { firstName, lastName, email, phone, password, role } = req.body;

        // 1. Validate required fields
        if (!firstName || !lastName || !email || !phone || !password) {
            return sendResponse(res, 400, false, 'All fields are required');
        }

        // 2. Only allow valid roles from the client
        const allowedRoles = ['CUSTOMER', 'RIDER', 'MERCHANT'];
        const userRole = role && allowedRoles.includes(role) ? role : 'CUSTOMER';

        // 3. Check if email or phone already exists
        const existingUser = await prisma.user.findFirst({
            where: {
                OR: [{ email }, { phone }],
            },
        });

        if (existingUser) {
            const field = existingUser.email === email ? 'Email' : 'Phone number';
            return sendResponse(res, 409, false, `${field} is already registered`);
        }

        // 4. Hash password
        const hashedPassword = await bcrypt.hash(
            password,
            parseInt(process.env.BCRYPT_ROUNDS)
        );

        // 5. Create user
        const user = await prisma.user.create({
            data: {
                firstName,
                lastName,
                email,
                phone,
                password: hashedPassword,
                role: userRole,
            },
        });

        // 6. If merchant or rider, create their profile automatically
        if (userRole === 'MERCHANT') {
            await prisma.merchant.create({
                data: {
                    userId: user.id,
                    businessName: `${firstName}'s Business`, // they update this later
                    businessPhone: phone,
                },
            });
        }

        if (userRole === 'RIDER') {
            await prisma.rider.create({
                data: {
                    userId: user.id,
                    vehicleType: 'bike', // default, they update later
                },
            });
        }

        // 7. Generate token
        const token = generateToken(user.id, user.role);

        // 8. Return user without password
        const { password: _, ...userWithoutPassword } = user;

        return sendResponse(res, 201, true, 'Registration successful', {
            token,
            user: userWithoutPassword,
        });

    } catch (error) {
        console.error('Register error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── LOGIN ───────────────────────────────────────────────────
const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // 1. Validate
        if (!email || !password) {
            return sendResponse(res, 400, false, 'Email and password are required');
        }

        // 2. Find user
        const user = await prisma.user.findUnique({
            where: { email },
        });

        if (!user) {
            // Same message for both cases — don't tell attacker which one failed
            return sendResponse(res, 401, false, 'Invalid email or password');
        }

        // 3. Check if account is active
        if (!user.isActive) {
            return sendResponse(res, 403, false, 'Your account has been deactivated');
        }

        // 4. Compare password
        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            return sendResponse(res, 401, false, 'Invalid email or password');
        }

        // 5. Generate token
        const token = generateToken(user.id, user.role);

        // 6. Return user without password
        const { password: _, ...userWithoutPassword } = user;

        return sendResponse(res, 200, true, 'Login successful', {
            token,
            user: userWithoutPassword,
        });

    } catch (error) {
        console.error('Login error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── GET CURRENT USER ────────────────────────────────────────
const getMe = async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.userId },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                role: true,
                isVerified: true,
                createdAt: true,
                merchant: true,
                rider: true,
            },
        });

        if (!user) {
            return sendResponse(res, 404, false, 'User not found');
        }

        return sendResponse(res, 200, true, 'User fetched', { user });

    } catch (error) {
        console.error('GetMe error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


module.exports = { register, login, getMe };