const cacheService = require('../shared/cache-service');
const system = require('../shared/system');
const userService = require('../shared/user-service');
const { Mutex } = require('async-mutex');

const jobsMutex = new Mutex();
// TODO this should be shared across all instances
let jobs = 0;


/**
 * Refreshes caches for all users in the background
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {object} - Express response with 200 status
 */
const refreshCache = async (req, res) => {
  const isInProgress = await jobsMutex.runExclusive(() => jobs > 0);

  if (isInProgress) {
    return res.status(200).send('Cache refresh already in progress');
  } else {
    res.status(200).send('Cache refresh started for all users');
  }

  try {
    const userIds = await userService.getUsers();
    system.logInfo('Starting cache refresh for all users', { userCount: userIds.length });

    await jobsMutex.runExclusive(() => {
      jobs += userIds.length;
    });

    userIds.forEach(userId => {
      cacheService.refreshCache(userId)
        .then(() => jobsMutex.runExclusive(() => {
            jobs -= 1;
            system.logInfo('Cache refresh completed successfully', { userId, remainingJobs: jobs });
          }))
        .catch(error => jobsMutex.runExclusive(() => {
            jobs -= 1;
            system.logError('Cache refresh failed for user', error, { userId, remainingJobs: jobs });
          }));
    });
  } catch (error) {
    system.logError('Failed to get users for cache refresh', error);
  }
};

module.exports = {
  refreshCache
};
