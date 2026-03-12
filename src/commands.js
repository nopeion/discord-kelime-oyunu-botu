const {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");

const managementPermission = PermissionFlagsBits.ManageGuild;

const commandBuilders = [
  new SlashCommandBuilder()
    .setName("kanal-ayarla")
    .setDescription("Kelime oyununun oynanacağı kanalı ayarlar.")
    .setDefaultMemberPermissions(managementPermission)
    .addChannelOption((option) =>
      option
        .setName("kanal")
        .setDescription("Oyun mesajlarının kabul edileceği kanal")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText)
    ),

  new SlashCommandBuilder()
    .setName("oyun-baslat")
    .setDescription("Yeni bir kelime oyunu başlatır.")
    .setDefaultMemberPermissions(managementPermission)
    .addStringOption((option) =>
      option
        .setName("kelime")
        .setDescription("Oyunu başlatacak ilk kelime")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("oyun-bitir")
    .setDescription("Aktif kelime oyununu bitirir ve istatistikleri gösterir.")
    .setDefaultMemberPermissions(managementPermission),

  new SlashCommandBuilder()
    .setName("oyun-durum")
    .setDescription("Aktif oyunun son durumunu gösterir."),

  new SlashCommandBuilder()
    .setName("istatistik")
    .setDescription("Sunucunun genel kelime oyunu istatistiklerini gösterir."),
];

function getCommandData() {
  return commandBuilders.map((command) => command.toJSON());
}

module.exports = {
  getCommandData,
};
