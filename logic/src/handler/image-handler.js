const { randomUUID } = require('crypto');
const BucketDriver = require('../shared/bucket-driver');

// Initialize bucket driver
const bucketDriver = new BucketDriver("k2o-dev-input-images");

/**
 * Handles the upload of a new image
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
function uploadImage(req, res, next) {
  const contentType = req.get('Content-Type');

  if (!['image/png', 'image/jpeg'].includes(contentType)) {
    return res.status(415).send('Unsupported Media Type');
  }

  const ext = contentType === 'image/png' ? '.png' : '.jpg';
  const key = `${randomUUID()}${ext}`;

  bucketDriver.saveImage(key, req.body, contentType)
    .then(() => res.status(201).json({ key }))
    .catch(next);
}

/**
 * Retrieves an image by its key
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
function getImage(req, res, next) {
  const { key } = req.params;
  bucketDriver.getImage(key)
    .then(({ stream, contentType }) => {
      res.set('Content-Type', contentType);
      stream.pipe(res);
    })
    .catch(next);
}

module.exports = {
  uploadImage,
  getImage
};