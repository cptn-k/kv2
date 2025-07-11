const secretService = require('../shared/secret-service');
const system = require('../shared/system');
const userService = require('../shared/user-service');
const chatService = require('../shared/chat-service');
const Slack = require('../shared/slack-driver');


async function getSlackDriver() {
  const clientId = await secretService.getSlackClientId();
  const clientSecret = await secretService.getSlackClientSecret();
  const botToken = await secretService.getSlackBotToken();

  return Slack.create(botToken, clientId, clientSecret);
}


const handleEvent = async (req, res) => {
  const body = req.body;

  if (body.type === 'url_verification') {
    return res.send(body.challenge);
  }

  if (body.type === 'event_callback') {
    try {
      await chatService.handleSlackEvent(body.event);
      return res.sendStatus(200);
    } catch (error) {
      return system.handleError(res, 500, error, { event: body.event });
    }
  }

  return res.status(400).send('Unsupported event type');
};


const authStart = async (req, res) => {
  const userId = req.query.userId;
  if (!userId) {
    return res.status(400).send('Missing user ID');
  }

  try {
    const driver = await getSlackDriver();

    const url = driver.getAuthUrl(userId);
    res.redirect(url);
  } catch (err) {
    return system.handleError(res, 500, err, { userId });
  }
};


const handleAuthCallback = async (req, res) => {
  try {
    const driver = await getSlackDriver();

    const { code, state: userId } = req.query;
    if (!code || !userId) {
      return res.status(400).send('Missing required parameters');
    }

    const data = await driver.getTokensFromCode(code);

    const accountData = {
      token: data.access_token,
      team: data.team?.name || 'Unknown Team',
      email: data.authed_user?.email || 'unknown',
      slackUserId: data.authed_user?.id
    };

    await userService.addUserAccount(userId, 'slack', accountData);

    res.redirect(`/backdoor/accounts?userId=${userId}`);
  } catch (err) {
    return system.handleError(res, 500, err, { code: req.query.code, state: req.query.state });
  }
};

module.exports = { handleEvent, authStart, handleAuthCallback };
