const userService = require('../shared/user-service');
const system = require('../shared/system');

/**
 * Middleware to resolve user ID from request parameters (either userId or slackId)
 * and attach it to the request object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function resolveUserIdMiddleware(req, res, next) {
  try {
    const { userId, slackId } = req.query;

    if (!userId && !slackId) {
      return res.status(400).send('Missing required parameter: either userId or slackId is required');
    }

    let resolvedUserId;
    if (userId) {
      resolvedUserId = userId;
    } else {
      resolvedUserId = await userService.getUserBySlackId(slackId);
    }

    if (!resolvedUserId) {
      return res.status(401).send('Unauthorized - User not found');
    }

    // Attach userId to request object for handlers to use
    req.userId = resolvedUserId;
    next();
  } catch (error) {
    return system.handleError(res, 500, error, { method: 'resolveUserIdMiddleware' });
  }
}

module.exports = {
  resolveUserIdMiddleware
};
