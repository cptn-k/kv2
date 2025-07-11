const ClickUpAuthDriver = require('../shared/clickup-auth-driver');
const userService = require('../shared/user-service');
const system = require('../shared/system');
const secretService = require('../shared/secret-service');

async function getClickUpDriver() {
  const clientId = await secretService.getClickUpClientId();
  const clientSecret = await secretService.getClickUpClientSecret();
  return new ClickUpAuthDriver(clientId, clientSecret, `${system.getBaseUrl()}/clickup/auth/callback`);
}

/**
 * Handles the OAuth callback from ClickUp
 */
async function handleAuthCallback(req, res) {
  const { code, state: userId } = req.query;
  
  if (!code || !userId) {
    return res.status(400).send('Invalid or missing parameters.');
  }

  const driver = await getClickUpDriver();
  try {
    const token = await driver.getAccessToken(code);

    const accountData = {
      accessToken: token,
    };
    
    await userService.addUserAccount(userId, 'clickup', accountData);
    res.redirect(`/backdoor/accounts?userId=${userId}`);
  } catch (error) {
    return system.handleError(res, 500, error, {userId, code});
  }
}

module.exports = {
  handleAuthCallback,
};
