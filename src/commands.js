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
    .setDefaultMemberPermissions(managementPermission),

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

  new SlashCommandBuilder()
    .setName("oyun-zamanla")
    .setDescription("Her gün belirli saatte oyunu otomatik yeniler.")
    .setDefaultMemberPermissions(managementPermission)
    .addIntegerOption((option) =>
      option
        .setName("saat")
        .setDescription("0-23 arası saat")
        .setMinValue(0)
        .setMaxValue(23)
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("dakika")
        .setDescription("0-59 arası dakika")
        .setMinValue(0)
        .setMaxValue(59)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("oyun-zamanla-kapat")
    .setDescription("Otomatik oyun yenilemeyi kapatır.")
    .setDefaultMemberPermissions(managementPermission),
];

function getCommandData() {
  return commandBuilders.map((command) => command.toJSON());
}

module.exports = {
  getCommandData,
};
