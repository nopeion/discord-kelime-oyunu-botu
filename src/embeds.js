const { EmbedBuilder } = require("discord.js");

const COLORS = {
  success: 0x2ecc71,
  error: 0xe74c3c,
  info: 0x3498db,
  warning: 0xf39c12,
};

function createEmbed({ type = "info", title, description, fields = [] }) {
  const embed = new EmbedBuilder()
    .setColor(COLORS[type] ?? COLORS.info)
    .setTitle(title)
    .setTimestamp();

  if (description) {
    embed.setDescription(description);
  }

  if (fields.length > 0) {
    embed.addFields(fields);
  }

  return embed;
}

module.exports = {
  createEmbed,
};
