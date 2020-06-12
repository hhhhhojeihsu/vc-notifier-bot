let sigtermReceived = false;

const VARIABLE_DATA_FILE_PATH = 'data/variable_data.json';

const config = require('config');

const DISCORD_BOT_TOKEN = config.get('botToken');

const Discord = require('discord.js');
const SimpleVoiceState = require('./SimpleVoiceState');

({
  DEFAULT_NOTIFICATION_CHANNEL_NAME,
  DEFAULT_NOTIFICATION_CHANNEL_CREATION_DESCRIPTION,
  NOTIFICATION_CHANNEL_CREATION_MESSAGES,
  CHANNEL_MESSAGES,
} = require('./text_data'));

const client = new Discord.Client();

({ getVariableDataFromFile, saveVariableDataToFile } = require('./variableData'));

({
  // each key is a guild, each guild is an object with channel IDs as keys,
  // and each channel has an array of member IDs
  guildVoiceData,

  // data matching IDs and display names of Guilds, Channels, and Members
  guildDisplayNames,
  channelDisplayNames,
  memberDisplayNames,

  // notification text channel for each guild
  guildNotificationChannels,

  // list of notified member IDs for each guild
  guildNotifiedMemberIDs,
} = getVariableDataFromFile(VARIABLE_DATA_FILE_PATH));

client.on('ready', () => {
  console.log(`Logged in as '${client.user.tag}'.`);
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  if (sigtermReceived) {
    return;
  }

  oldState = new SimpleVoiceState(oldState);
  newState = new SimpleVoiceState(newState);

  if (newState.isActive()) {
    const guildID = newState.getGuild().id;
    const channelID = newState.getChannel().id;
    const memberID = newState.getMember().id;

    updateNameData(newState);

    const channelBefore = getChannelData(guildID, channelID).copy();
    addMemberToChannel(guildID, channelID, memberID);
    const channelAfter = getChannelData(guildID, channelID).copy();

    if (hasJoinedChannel(memberID, channelBefore, channelAfter)) {
      const message = `${memberDisplayNames[memberID]} has joined voice chat ${channelDisplayNames[channelID]}.`;
      await notifyMembers(message, guildID, { omittedMemberID: memberID });
    }
  } else {
    const guildID = oldState.getGuild().id;
    const channelID = oldState.getChannel().id;
    const memberID = oldState.getMember().id;

    const channelBefore = getChannelData(guildID, channelID).copy();
    removeMemberFromChannel(guildID, channelID, memberID);
    const channelAfter = getChannelData(guildID, channelID).copy();

    if (hasLeftChannel(memberID, channelBefore, channelAfter)) {
      const message = `${memberDisplayNames[memberID]} has left voice chat ${channelDisplayNames[channelID]}.`;
      notifyMembers(message, guildID, { omittedMemberID: memberID });
    }
  }

  saveVariableDataToFile(
    {
      guildVoiceData,

      guildDisplayNames,
      channelDisplayNames,
      memberDisplayNames,

      guildNotificationChannels,
      guildNotifiedMemberIDs,
    },
    VARIABLE_DATA_FILE_PATH
  );
});

client.on('message', async (msg) => {
  if (sigtermReceived) {
    return;
  }

  if (!msg.guild) {
    return;
  }

  const msgGuildID = msg.guild.id;
  const msgChannelID = msg.channel.id;
  const msgContent = msg.content;
  const msgSenderMemberID = msg.member.user.id;

  let notifiedMemberIDs = getNotifiedMemberIDs(msgGuildID);

  if (flagMatches(msgContent, CHANNEL_MESSAGES.flags['notificationSubscribe'])) {
    if (notifiedMemberIDs.contains(msgSenderMemberID)) {
      msg.reply(CHANNEL_MESSAGES.textMessages['alreadySubscribed']);
    } else {
      addToNotifiedUserIDs(msgGuildID, msgSenderMemberID);
      msg.reply(CHANNEL_MESSAGES.textMessages['successfullySubscribed']);
    }
  } else if (flagMatches(msgContent, CHANNEL_MESSAGES.flags['notificationUnsubscribe'])) {
    if (notifiedMemberIDs.contains(msgSenderMemberID)) {
      guildNotifiedMemberIDs[msgGuildID].splice(guildNotifiedMemberIDs[msgGuildID].indexOf(msgSenderMemberID), 1);
      msg.reply(CHANNEL_MESSAGES.textMessages['successfullyUnsubscribed']);
    } else {
      msg.reply(CHANNEL_MESSAGES.textMessages['alreadyUnsubscribed']);
    }
  } else if (flagMatches(msgContent, CHANNEL_MESSAGES.flags['notificationChannelSet'])) {
    if (guildNotificationChannels[msgGuildID] === msgChannelID) {
      msg.reply(CHANNEL_MESSAGES.textMessages['alreadySetAsNotificationChannel']);
    } else {
      guildNotificationChannels[msgGuildID] = msgChannelID;
      msg.reply(CHANNEL_MESSAGES.textMessages['successfullySetAsNotificationChannel']);
    }
  }

  saveVariableDataToFile(
    {
      guildVoiceData,

      guildDisplayNames,
      channelDisplayNames,
      memberDisplayNames,

      guildNotificationChannels,
      guildNotifiedMemberIDs,
    },
    VARIABLE_DATA_FILE_PATH
  );
});

process.on('SIGTERM', () => {
  saveVariableDataToFile(
    {
      guildVoiceData,

      guildDisplayNames,
      channelDisplayNames,
      memberDisplayNames,

      guildNotificationChannels,
      guildNotifiedMemberIDs,
    },
    VARIABLE_DATA_FILE_PATH
  );

  sigtermReceived = true;
});

const flagMatches = (str, flag) => {
  return str.startsWith(flag);
};

const hasJoinedChannel = (memberID, channelBefore, channelAfter) => {
  return !channelBefore.contains(memberID) && channelAfter.contains(memberID);
};
const hasLeftChannel = (memberID, channelBefore, channelAfter) => {
  return channelBefore.contains(memberID) && !channelAfter.contains(memberID);
};

const sendNotificationChannelCreationMessages = (notificationChannel) => {
  notificationChannel.send(NOTIFICATION_CHANNEL_CREATION_MESSAGES.join('\n\n'));
};

const notifyMembers = async (message, guildID, options = {}) => {
  let notificationChannel = await getNotificationChannel(guildID);

  if (notificationChannel === null) {
    notificationChannel = await createAndGetNotificationChannel(guildID);
    sendNotificationChannelCreationMessages(notificationChannel);
  }

  const notifiedMemberIDs = getNotifiedMemberIDs(guildID).copy();

  if (options.omittedMemberID) {
    if (notifiedMemberIDs.contains(options.omittedMemberID)) {
      notifiedMemberIDs.splice(notifiedMemberIDs.indexOf(options.omittedMemberID), 1);
    }
  }

  let mentions = '';
  notifiedMemberIDs.forEach((memberID, idx) => {
    const member = client.users.cache.get(memberID);
    mentions += `${member}`;

    if (idx === notifiedMemberIDs.length - 1) {
      mentions += ': ';
    } else if (idx === notifiedMemberIDs.length - 2) {
      mentions += ', & ';
    } else if (idx <= notifiedMemberIDs.length - 2) {
      mentions += ', ';
    }
  });

  let fullMessage = mentions + '**' + message + '**';

  notificationChannel.send(fullMessage);
};

const addToNotifiedUserIDs = (guildID, memberID) => {
  if (!guildNotifiedMemberIDs[guildID]) {
    guildNotifiedMemberIDs[guildID] = [];
  }

  guildNotifiedMemberIDs[guildID].push(memberID);
};

const getNotifiedMemberIDs = (guildID) => {
  const notifiedMemberIDs = guildNotifiedMemberIDs[guildID];
  if (notifiedMemberIDs) {
    return notifiedMemberIDs;
  }
  return [];
};

const createAndGetNotificationChannel = async (guildID) => {
  const guild = client.guilds.cache.get(guildID);
  if (guild) {
    const notificationChannel = await guild.channels.create(DEFAULT_NOTIFICATION_CHANNEL_NAME, {
      reason: DEFAULT_NOTIFICATION_CHANNEL_CREATION_DESCRIPTION,
    });
    const notificationChannelID = notificationChannel.id;

    guildNotificationChannels[guildID] = notificationChannelID;

    return getNotificationChannel(guildID);
  } else {
    throw new Error(`Guild with ID '${guildID}' does not exist`);
  }
};

const getNotificationChannel = async (guildID) => {
  const notificationChannelID = guildNotificationChannels[guildID];
  if (notificationChannelID) {
    const notificationChannel = await client.channels.cache.get(notificationChannelID);
    if (notificationChannel) {
      return notificationChannel;
    }
  }
  return null;
};

const addMemberToChannel = (guildID, channelID, memberID) => {
  // if member is being added to a channel, they can't be in any other channels as well
  // As of 2020/06/09, Discord prohibits users from joining multiple voice channels at once
  removeMemberFromAllChannelsInGuild(guildID, memberID);

  targetChannel = getChannelData(guildID, channelID);

  if (!targetChannel.contains(memberID)) {
    targetChannel.push(memberID);
  }
};

const removeMemberFromChannel = (guildID, channelID, memberID) => {
  targetChannel = getChannelData(guildID, channelID);

  if (targetChannel.contains(memberID)) {
    targetChannel.splice(targetChannel.indexOf(memberID), 1);
  }
};

const removeMemberFromAllChannelsInGuild = (guildID, memberID) => {
  const targetGuild = guildVoiceData[guildID];
  if (targetGuild) {
    const targetGuild = guildVoiceData[guildID];
    Object.keys(targetGuild).forEach((channelID) => {
      const channelMembers = targetGuild[channelID];

      // remove all occurrences of member in channel
      let memberInChannel = true;
      while (memberInChannel) {
        if (channelMembers.contains(memberID)) {
          memberInChannel = true;
          channelMembers.splice(channelMembers.indexOf(memberID), 1);
        } else {
          memberInChannel = false;
        }
      }
    });
  }
};

const getChannelData = (guildID, channelID) => {
  let targetGuild = guildVoiceData[guildID];

  if (!targetGuild) {
    guildVoiceData[guildID] = {};
  }

  let targetChannel = guildVoiceData[guildID][channelID];

  if (!targetChannel) {
    guildVoiceData[guildID][channelID] = [];
  }

  return guildVoiceData[guildID][channelID];
};

const updateNameData = (simpleVoiceStateObj) => {
  guild = simpleVoiceStateObj.getGuild();
  channel = simpleVoiceStateObj.getChannel();
  member = simpleVoiceStateObj.getMember();

  updateGuildDisplayName(guild.id, guild.displayName);
  updateChannelDisplayName(channel.id, channel.displayName);
  updateMemberDisplayName(member.id, member.displayName);
};

const updateGuildDisplayName = (guildID, guildDisplayName) => {
  guildDisplayNames[guildID] = guildDisplayName;
};
const updateChannelDisplayName = (channelID, channelDisplayName) => {
  channelDisplayNames[channelID] = channelDisplayName;
};
const updateMemberDisplayName = (memberID, memberDisplayName) => {
  memberDisplayNames[memberID] = memberDisplayName;
};

Array.prototype.contains = function (elm) {
  return this.indexOf(elm) > -1;
};
Object.prototype.copy = function () {
  return JSON.parse(JSON.stringify(this));
};

client.login(DISCORD_BOT_TOKEN);
