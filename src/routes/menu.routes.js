const express = require('express');
const router = express.Router({ mergeParams: true }); // mergeParams to access restaurantId
const {
    createCategory,
    createMenuItem,
    getMenuItems,
    updateMenuItem,
    deleteMenuItem,
    uploadMenuItemImage,
} = require('../controllers/menu.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');
const upload = require('../middlewares/upload.middleware');

// Public
router.get('/', getMenuItems);

// Merchant only
router.post('/categories', protect, authorize('MERCHANT'), createCategory);
router.post('/', protect, authorize('MERCHANT'), createMenuItem);
router.put('/:itemId', protect, authorize('MERCHANT'), updateMenuItem);
router.delete('/:itemId', protect, authorize('MERCHANT'), deleteMenuItem);
router.post('/:itemId/image', protect, authorize('MERCHANT'), upload.single('image'), uploadMenuItemImage);

module.exports = router;