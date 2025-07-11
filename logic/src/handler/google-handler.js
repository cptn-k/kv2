const user = require('../shared/user-service');
const secretService = require('../shared/secret-service');
const system = require('../shared/system');
const GoogleDriver = require('../shared/google-driver');


async function getGoogleDriver() {
  const clientId = await secretService.getGoogleClientId();
  const clientSecret = await secretService.getGoogleClientSecret();

  return new GoogleDriver(clientId, clientSecret);
}


async function startAuth(req, res) {
  const userId = req.query.userId;
  if (!userId) {
    return res.status(400).send('Missing user ID');
  }
  try {
    const driver = await getGoogleDriver();

    const url = await driver.getAuthUrl(userId);
    res.send(`<a href="${url}">Authorize with Google</a>`);
  } catch (err) {
    return system.handleError(res, 500, err, { userId });
  }
}


async function handleAuthCallback(req, res) {
  const driver = await getGoogleDriver();

  const { code, state } = req.query;
  
  try {
    const { userId, accountId } = JSON.parse(state);

    const tokens = await driver.getTokensFromCode(code);
    if (!tokens.refresh_token) {
      return res.status(500).send('No refresh token received');
    }

    const accountData = {
      email: tokens.id_token ? JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64').toString()).email : 'unknown',
      token: tokens.refresh_token
    };
    
    if (accountId) {
      await user.updateAccountToken(userId, accountId, tokens.refresh_token);
    } else {
      await user.addUserAccount(userId, 'google', accountData);
    }
    
    res.redirect(`/backdoor/accounts?userId=${userId}`);
  } catch (err) {
    return system.handleError(res, 500, err, { state, code });
  }
}

module.exports = { startAuth, handleAuthCallback };
