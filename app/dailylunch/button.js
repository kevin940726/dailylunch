const logger = require('../logger');
const {
  orderLunch,
  getMessageLunch,
  getMessageIsClosed,
  setMessageClose,
  updateMessage,
  updateMessageTS,
} = require('../store');
const { respondMessage } = require('../slack');
const { getLunch, buildAttachments } = require('../utils');
const {
  CLOSE_ACTION,
  CLOSE_TEXT,
  REOPEN_TEXT,
  CLOSE_USER_WHITE_LIST,
} = require('../constants');

const handleCloseAction = async (
  ctx,
  {
    closeAction,
    userID,
    responseURL,
    messageID,
    isClosed,
    lunchOrder,
    originalMessage,
  }
) => {
  const closeUserWhiteList = CLOSE_USER_WHITE_LIST.concat(
    closeAction.actions[0].value
  );

  if (!closeUserWhiteList.includes(userID)) {
    logger.error('Authorized staffs only!');

    ctx.status = 200;
    ctx.body = '';

    respondMessage(responseURL, {
      response_type: 'ephemeral',
      replace_original: false,
      text: '❎  Authorized staffs only!',
      color: 'danger',
    });

    return;
  }

  const nextLunch = await getMessageLunch(messageID);
  const nextLunchList = lunchOrder.map(launchID => nextLunch[launchID]);
  const lunches = getLunch(nextLunchList);

  let lunchAttachments;

  if (isClosed) {
    // closed, reopen
    closeAction.actions[0].text = CLOSE_TEXT;
    setMessageClose(messageID, false);

    lunchAttachments = buildAttachments(lunches);
  } else {
    // opened, close
    closeAction.actions[0].text = REOPEN_TEXT;
    setMessageClose(messageID, true);

    lunchAttachments = buildAttachments(lunches, { isClosed: true });
  }

  ctx.status = 200;
  ctx.body = null;

  return respondMessage(responseURL, {
    ...originalMessage,
    attachments: lunchAttachments.concat(closeAction),
  });
};

const button = async ctx => {
  const body = JSON.parse(ctx.request.body.payload);

  const {
    actions: [{ value: action }],
    callback_id: callbackID,
    user: { id: userID },
    message_ts: messageTS,
    original_message: originalMessage,
    response_url: responseURL,
  } = body;

  const closeAction = originalMessage.attachments.find(
    attachment =>
      attachment.actions &&
      attachment.actions.find(act => act.value === CLOSE_ACTION)
  );

  const lunchID = callbackID;
  const messageID = closeAction.callback_id;
  const isClosed = await getMessageIsClosed(messageID);

  const lunchOrder = originalMessage.attachments
    .map(attachment => attachment.callback_id)
    .filter(lunchID => lunchID !== messageID);

  logger.log('/button', {
    userID,
    lunchID,
    messageID,
    action,
    isClosed,
  });

  updateMessageTS(messageID, messageTS);

  /**
   * press close/reopen button by authorized users
   */
  if (action === CLOSE_ACTION) {
    return handleCloseAction(ctx, {
      closeAction,
      userID,
      responseURL,
      messageID,
      isClosed,
      lunchOrder,
      originalMessage,
    });
  }

  /**
   * order closed
   */
  if (isClosed) {
    logger.warn('The order is closed!');

    ctx.status = 200;
    ctx.body = '';

    respondMessage(responseURL, {
      response_type: 'ephemeral',
      replace_original: false,
      text: '⚠️ The order is closed!',
      color: 'warning',
    });

    return;
  }

  /**
   * usual user click on plus button
   */
  const messagesShouldUpdate = await orderLunch(lunchID, {
    userID,
    action,
  });

  ctx.status = 200;
  ctx.body = null;

  messagesShouldUpdate.forEach(messageID => {
    updateMessage(messageID);
  });
};

module.exports = button;
