const prisma = require('../config/prisma');
const axios = require('axios');

const sendResponse = (res, statusCode, success, message, data = null) => {
    const response = { success, message };
    if (data) response.data = data;
    return res.status(statusCode).json(response);
};

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;


// ─── GET ALL NIGERIAN BANKS ───────────────────────────────────
const getBanks = async (req, res) => {
    try {
        const response = await axios.get('https://api.paystack.co/bank', {
            headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
        });

        const banks = response.data.data.map((bank) => ({
            name: bank.name,
            code: bank.code,
        }));

        return sendResponse(res, 200, true, 'Banks fetched', { banks });

    } catch (error) {
        console.error('getBanks error:', error.response?.data || error);
        return sendResponse(res, 500, false, 'Could not fetch banks');
    }
};


// ─── VERIFY ACCOUNT NUMBER ────────────────────────────────────
const verifyAccountNumber = async (req, res) => {
    try {
        const { accountNumber, bankCode } = req.body;

        if (!accountNumber || !bankCode) {
            return sendResponse(res, 400, false, 'Account number and bank code are required');
        }

        const response = await axios.get(
            `https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
            {
                headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
            }
        );

        const { account_name, account_number } = response.data.data;

        return sendResponse(res, 200, true, 'Account verified', {
            accountName: account_name,
            accountNumber: account_number,
        });

    } catch (error) {
        console.error('verifyAccountNumber error:', error.response?.data || error);
        return sendResponse(res, 400, false, 'Could not verify account. Check the account number and bank.');
    }
};


// ─── SAVE BANK ACCOUNT ────────────────────────────────────────
const saveBankAccount = async (req, res) => {
    try {
        const { accountName, accountNumber, bankName, bankCode } = req.body;

        if (!accountName || !accountNumber || !bankName || !bankCode) {
            return sendResponse(res, 400, false, 'All bank account fields are required');
        }

        const merchant = await prisma.merchant.findUnique({
            where: { userId: req.user.userId },
        });

        if (!merchant) {
            return sendResponse(res, 404, false, 'Merchant profile not found');
        }

        // Create a Paystack Transfer Recipient
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
            // Continue saving even if recipient creation fails
        }

        const bankAccount = await prisma.merchantBankAccount.upsert({
            where: { merchantId: merchant.id },
            update: {
                accountName,
                accountNumber,
                bankName,
                bankCode,
                recipientCode,
                isVerified: true,
            },
            create: {
                merchantId: merchant.id,
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
        console.error('saveBankAccount error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


// ─── GET MY BANK ACCOUNT ─────────────────────────────────────
const getMyBankAccount = async (req, res) => {
    try {
        const merchant = await prisma.merchant.findUnique({
            where: { userId: req.user.userId },
            include: { bankAccount: true },
        });

        if (!merchant) {
            return sendResponse(res, 404, false, 'Merchant not found');
        }

        return sendResponse(res, 200, true, 'Bank account fetched', {
            bankAccount: merchant.bankAccount || null,
        });

    } catch (error) {
        console.error('getMyBankAccount error:', error);
        return sendResponse(res, 500, false, 'Something went wrong');
    }
};


module.exports = { getBanks, verifyAccountNumber, saveBankAccount, getMyBankAccount };
