/****
 * BucketDriver - Handles saving and retrieving images to/from a Google Cloud Storage bucket.
 *
 * Provides methods to save image data and get image streams,
 * suitable for wiring to Express PUT and GET endpoints.
 */
const { Storage } = require('@google-cloud/storage');
const system = require("./system");




class BucketDriver {


  /**
   * Creates a new BucketDriver.
   * @param {string} bucketName - GCS bucket name.
   */
  constructor(bucketName) {
    if (!bucketName) {
      throw new Error('Bucket name is required to create BucketDriver');
    }
    const storage = new Storage(system.googleCredentials);
    this._bucket = storage.bucket(bucketName);
  }


  /**
   * Saves image data to GCS.
   * @param {string} key - GCS object key.
   * @param {Buffer|Uint8Array|string} body - Image data.
   * @param {string} [contentType] - MIME type of the image.
   * @returns {Promise<void>}
   */
  saveImage(key, body, contentType) {
    const file = this._bucket.file(key);

    return file.save(body, {
      metadata: {
        contentType
      }
    });
  }


  /**
   * Retrieves image data from GCS.
   * @param {string} key - GCS object key.
   * @returns {Promise<{ stream: Readable, contentType: string }>}
   */
  getImage(key) {
    const file = this._bucket.file(key);

    return file
      .getMetadata()
      .then(([metadata]) => ({
        stream: file.createReadStream(),
        contentType: metadata.contentType
      }));
  }
}




module.exports = BucketDriver;