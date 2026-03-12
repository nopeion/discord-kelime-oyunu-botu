const {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");

const managementPermission = PermissionFlagsBits.ManageGuild;

const commandBuilders = [
  new SlashCommandBuilder()
    .setName("kanal-ayarla")
    .setDescription("Kelime oyununun oynanacagi kanali ayarlar.")
    .setDefaultMemberPermissions(managementPermission)
    .addChannelOption((option) =>
      option
        .setName("kanal")
        .setDescription("Oyun mesajlarinin kabul edilecegi kanal")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText)
    ),

  new SlashCommandBuilder()
    .setName("oyun-baslat")
    .setDescription("Yeni bir kelime oyunu baslatir.")
    .setDefaultMemberPermissions(managementPermission)
    .addStringOption((option) =>
      option
        .setName("kelime")
        .setDescription("Oyunu baslatacak ilk kelime")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("oyun-bitir")
    .setDescription("Aktif kelime oyununu bitirir ve istatistikleri gosterir.")
    .setDefaultMemberPermissions(managementPermission),

  new SlashCommandBuilder()
    .setName("oyun-durum")
    .setDescription("Aktif oyunun son durumunu gosterir."),

  new SlashCommandBuilder()
    .setName("istatistik")
    .setDescription("Sunucunun genel kelime oyunu istatistiklerini gosterir."),
];

function getCommandData() {
  return commandBuilders.map((command) => command.toJSON());
}

module.exports = {
  getCommandData,
};
