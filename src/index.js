require("dotenv").config();

const {
  Client,
  Events,
  GatewayIntentBits,
} = require("discord.js");

const { getCommandData } = require("./commands");
const { createDatabase } = require("./database");
const { createEmbed } = require("./embeds");
const { validateWithTdk } = require("./tdk");
const { getExpectedLetter, parseWord } = require("./word-utils");

const token = process.env.DISCORD_TOKEN;
const DEFAULT_CONSECUTIVE_WORD_COOLDOWN_MS = 25_000;

function resolveConsecutiveWordCooldownMs(rawValue) {
  if (!rawValue) {
    return DEFAULT_CONSECUTIVE_WORD_COOLDOWN_MS;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.warn(
      "CONSECUTIVE_WORD_COOLDOWN_MS geçersiz. Varsayılan 25000 ms kullanılacak."
    );
    return DEFAULT_CONSECUTIVE_WORD_COOLDOWN_MS;
  }

  return Math.floor(parsed);
}

const consecutiveWordCooldownMs = resolveConsecutiveWordCooldownMs(
  process.env.CONSECUTIVE_WORD_COOLDOWN_MS
);

if (!token) {
  console.error("DISCORD_TOKEN bulunamadı. .env dosyasını kontrol et.");
  process.exit(1);
}

const db = createDatabase(process.env.DATABASE_PATH);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}sa ${minutes}dk ${seconds}sn`;
  }

  if (minutes > 0) {
    return `${minutes}dk ${seconds}sn`;
  }

  return `${seconds}sn`;
}

async function sendTemporaryInvalidEmbed(channel, reason) {
  const embed = createEmbed({
    type: "error",
    title: "Geçersiz Kelime",
    description: reason,
  });

  const sentMessage = await channel.send({ embeds: [embed] }).catch(() => null);

  if (sentMessage) {
    setTimeout(() => {
      sentMessage.delete().catch(() => null);
    }, 10_000);
  }
}

async function rejectWordMessage(message, reason) {
  await message.delete().catch(() => null);
  await sendTemporaryInvalidEmbed(message.channel, reason);
}

async function announceStartWord(channelId, startWord, expectedLetter) {
  const channel = await client.channels.fetch(channelId).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    return false;
  }

  const sentMessage = await channel
    .send({
      embeds: [
        createEmbed({
          type: "info",
          title: "Oyun Başladı",
          description: `İlk kelime: \`${startWord}\``,
          fields: [
            {
              name: "Beklenen Harf",
              value: `\`${expectedLetter}\``,
              inline: true,
            },
          ],
        }),
      ],
    })
    .catch(() => null);

  return Boolean(sentMessage);
}

function mapAddWordErrorToReason(result) {
  if (result.reason === "WORD_ALREADY_USED") {
    return "Bu kelime bu oyunda daha önce kullanıldı.";
  }

  if (result.reason === "WRONG_FIRST_LETTER") {
    return `Kelime \`${result.expectedLetter}\` harfi ile başlamalı.`;
  }

  if (result.reason === "WRONG_CHANNEL") {
    return `Oyun yalnızca <#${result.channelId}> kanalında oynanabilir.`;
  }

  if (result.reason === "SAME_USER_COOLDOWN") {
    const remainingMs = Number(result.remainingMs ?? 0);

    if (Number.isFinite(remainingMs) && remainingMs > 0) {
      const availableAtUnix = Math.ceil((Date.now() + remainingMs) / 1000);
      return `Aynı kullanıcı tekrar yazmak için <t:${availableAtUnix}:R> beklemeli.`;
    }

    return "Aynı kullanıcı tekrar yazmak için biraz beklemeli.";
  }

  if (result.reason === "NO_ACTIVE_GAME") {
    return "Şu anda aktif bir oyun yok.";
  }

  return "Bu kelime kabul edilemedi.";
}

async function registerCommands() {
  const commands = getCommandData();

  if (process.env.DEV_GUILD_ID) {
    const guild = await client.guilds.fetch(process.env.DEV_GUILD_ID).catch(() => null);

    if (guild) {
      await guild.commands.set(commands);
      console.log(
        `Slash komutlar ${guild.name} sunucusuna yüklendi (${commands.length} adet).`
      );
      return;
    }

    console.warn(
      "DEV_GUILD_ID bulundu ama sunucuya erişilemedi. Komutlar global olarak yüklenecek."
    );
  }

  await client.application.commands.set(commands);
  console.log(`Slash komutlar global olarak yüklendi (${commands.length} adet).`);
}

async function handleSetChannel(interaction) {
  const channel = interaction.options.getChannel("kanal", true);
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({
      ephemeral: true,
      embeds: [
        createEmbed({
          type: "error",
          title: "Hata",
          description: "Bu komut sadece bir sunucuda kullanılabilir.",
        }),
      ],
    });
    return;
  }

  const activeGame = db.getActiveGame(guildId);
  if (activeGame && activeGame.channel_id !== channel.id) {
    await interaction.reply({
      ephemeral: true,
      embeds: [
        createEmbed({
          type: "warning",
          title: "Aktif Oyun Var",
          description:
            "Kanal değiştirmek için önce aktif oyunu bitirmelisin. Oyun kanalını oyun sırasında değiştirmiyorum.",
        }),
      ],
    });
    return;
  }

  db.setGuildChannel(guildId, channel.id);

  await interaction.reply({
    ephemeral: true,
    embeds: [
      createEmbed({
        type: "success",
        title: "Kanal Ayarlandı",
        description: `Kelime oyunu kanalı <#${channel.id}> olarak kaydedildi.`,
      }),
    ],
  });
}

async function handleStartGame(interaction) {
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({
      ephemeral: true,
      embeds: [
        createEmbed({
          type: "error",
          title: "Hata",
          description: "Bu komut sadece bir sunucuda kullanılabilir.",
        }),
      ],
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const settings = db.getGuildSettings(guildId);
  if (!settings) {
    await interaction.editReply({
      embeds: [
        createEmbed({
          type: "warning",
          title: "Kanal Ayarı Gerekli",
          description: "Önce /kanal-ayarla komutu ile oyun kanalını seçmelisin.",
        }),
      ],
    });
    return;
  }

  const parsed = parseWord(interaction.options.getString("kelime", true));
  if (!parsed.ok) {
    await interaction.editReply({
      embeds: [
        createEmbed({
          type: "error",
          title: "Geçersiz Başlangıç Kelimesi",
          description: parsed.reason,
        }),
      ],
    });
    return;
  }

  const tdkValidation = await validateWithTdk(parsed.normalized);
  if (!tdkValidation.valid) {
    await interaction.editReply({
      embeds: [
        createEmbed({
          type: "error",
          title: "Başlangıç Kelimesi Reddedildi",
          description: tdkValidation.reason,
        }),
      ],
    });
    return;
  }

  const expectedLetter = getExpectedLetter(parsed.normalized);
  const result = db.startGame({
    guildId,
    channelId: settings.channel_id,
    startWord: parsed.normalized,
    expectedLetter,
    startedBy: interaction.user.id,
  });

  if (!result.ok) {
    await interaction.editReply({
      embeds: [
        createEmbed({
          type: "warning",
          title: "Oyun Zaten Aktif",
          description:
            "Bu sunucuda zaten aktif bir oyun var. Yeni oyun için önce /oyun-bitir kullan.",
        }),
      ],
    });
    return;
  }

  const startWordAnnouncementSent = await announceStartWord(
    settings.channel_id,
    parsed.normalized,
    expectedLetter
  );

  await interaction.editReply({
    embeds: [
      createEmbed({
        type: "success",
        title: "Oyun Başladı",
        description: "Yeni kelime oyunu başarıyla başlatıldı.",
        fields: [
          { name: "Kanal", value: `<#${settings.channel_id}>`, inline: true },
          { name: "İlk Kelime", value: `\`${parsed.normalized}\``, inline: true },
          {
            name: "Beklenen Harf",
            value: `\`${expectedLetter}\``,
            inline: true,
          },
          {
            name: "Kanal Duyurusu",
            value: startWordAnnouncementSent
              ? "Başlangıç kelimesi kanala gönderildi."
              : "Başlangıç kelimesi kanala gönderilemedi. Bot izinlerini kontrol et.",
            inline: false,
          },
        ],
      }),
    ],
  });
}

async function handleEndGame(interaction) {
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({
      ephemeral: true,
      embeds: [
        createEmbed({
          type: "error",
          title: "Hata",
          description: "Bu komut sadece bir sunucuda kullanılabilir.",
        }),
      ],
    });
    return;
  }

  const result = db.endActiveGame({
    guildId,
    endedBy: interaction.user.id,
  });

  if (!result.ok) {
    await interaction.reply({
      ephemeral: true,
      embeds: [
        createEmbed({
          type: "warning",
          title: "Aktif Oyun Yok",
          description: "Bitirilecek aktif bir oyun bulunamadı.",
        }),
      ],
    });
    return;
  }

  const game = result.game;
  const summary = result.summary;
  const duration = formatDuration(game.ended_at - game.started_at);

  await interaction.reply({
    ephemeral: true,
    embeds: [
      createEmbed({
        type: "info",
        title: "Oyun Bitirildi",
        description: `Bu oyun **${summary.totalWords}** kelime ilerledi.`,
        fields: [
          { name: "Kanal", value: `<#${game.channel_id}>`, inline: true },
          { name: "Süre", value: duration, inline: true },
          {
            name: "Oyuncu Sayısı",
            value: String(summary.uniquePlayers),
            inline: true,
          },
          {
            name: "En Çok Kelime",
            value: summary.topPlayerId
              ? `<@${summary.topPlayerId}> (${summary.topPlayerCount})`
              : "Veri yok",
            inline: false,
          },
        ],
      }),
    ],
  });
}

async function handleStatus(interaction) {
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({
      ephemeral: true,
      embeds: [
        createEmbed({
          type: "error",
          title: "Hata",
          description: "Bu komut sadece bir sunucuda kullanılabilir.",
        }),
      ],
    });
    return;
  }

  const settings = db.getGuildSettings(guildId);
  const activeGame = db.getActiveGame(guildId);

  if (!settings) {
    await interaction.reply({
      ephemeral: true,
      embeds: [
        createEmbed({
          type: "warning",
          title: "Kanal Ayarı Yok",
          description: "Henüz oyun kanalı ayarlanmamış. /kanal-ayarla kullan.",
        }),
      ],
    });
    return;
  }

  if (!activeGame) {
    await interaction.reply({
      ephemeral: true,
      embeds: [
        createEmbed({
          type: "info",
          title: "Oyun Durumu",
          description: "Şu anda aktif oyun yok.",
          fields: [
            {
              name: "Ayarlı Kanal",
              value: `<#${settings.channel_id}>`,
              inline: true,
            },
          ],
        }),
      ],
    });
    return;
  }

  await interaction.reply({
    ephemeral: true,
    embeds: [
      createEmbed({
        type: "info",
        title: "Aktif Oyun",
        description: "Kelime oyunu aktif olarak devam ediyor.",
        fields: [
          { name: "Kanal", value: `<#${activeGame.channel_id}>`, inline: true },
          {
            name: "Son Kelime",
            value: `\`${activeGame.current_word}\``,
            inline: true,
          },
          {
            name: "Beklenen Harf",
            value: `\`${activeGame.expected_letter}\``,
            inline: true,
          },
          {
            name: "İlerleme",
            value: `${activeGame.total_words} kelime`,
            inline: true,
          },
          {
            name: "Süre",
            value: formatDuration(Date.now() - activeGame.started_at),
            inline: true,
          },
        ],
      }),
    ],
  });
}

async function handleStats(interaction) {
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({
      ephemeral: true,
      embeds: [
        createEmbed({
          type: "error",
          title: "Hata",
          description: "Bu komut sadece bir sunucuda kullanılabilir.",
        }),
      ],
    });
    return;
  }

  const stats = db.getGuildStats(guildId);

  if (stats.totalGames === 0) {
    await interaction.reply({
      ephemeral: true,
      embeds: [
        createEmbed({
          type: "info",
          title: "İstatistik",
          description: "Bu sunucuda henüz bitmiş oyun bulunmuyor.",
        }),
      ],
    });
    return;
  }

  await interaction.reply({
    ephemeral: true,
    embeds: [
      createEmbed({
        type: "info",
        title: "Genel İstatistikler",
        fields: [
          {
            name: "Toplam Oyun",
            value: String(stats.totalGames),
            inline: true,
          },
          {
            name: "Toplam Kelime",
            value: String(stats.totalWords),
            inline: true,
          },
          {
            name: "Oyun Başına Ortalama",
            value: stats.averageWords.toFixed(2),
            inline: true,
          },
          {
            name: "En Uzun Oyun",
            value: `${stats.bestGameWords} kelime`,
            inline: true,
          },
          {
            name: "Son Oyun",
            value: stats.lastGame
              ? `${stats.lastGame.total_words} kelime`
              : "Veri yok",
            inline: true,
          },
          {
            name: "Tüm Zamanlar Lideri",
            value: stats.topContributor
              ? `<@${stats.topContributor.user_id}> (${stats.topContributor.word_count})`
              : "Veri yok",
            inline: true,
          },
        ],
      }),
    ],
  });
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`${readyClient.user.tag} olarak giriş yapıldı.`);

  try {
    await registerCommands();
  } catch (error) {
    console.error("Komutlar yüklenirken hata oluştu:", error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  try {
    if (interaction.commandName === "kanal-ayarla") {
      await handleSetChannel(interaction);
      return;
    }

    if (interaction.commandName === "oyun-baslat") {
      await handleStartGame(interaction);
      return;
    }

    if (interaction.commandName === "oyun-bitir") {
      await handleEndGame(interaction);
      return;
    }

    if (interaction.commandName === "oyun-durum") {
      await handleStatus(interaction);
      return;
    }

    if (interaction.commandName === "istatistik") {
      await handleStats(interaction);
    }
  } catch (error) {
    console.error("Komut işlenirken hata oluştu:", error);

    const errorEmbed = createEmbed({
      type: "error",
      title: "Beklenmeyen Hata",
      description: "Bir şeyler ters gitti. Lütfen tekrar dene.",
    });

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [errorEmbed] }).catch(() => null);
      return;
    }

    await interaction.reply({
      ephemeral: true,
      embeds: [errorEmbed],
    });
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guildId) {
    return;
  }

  const activeGame = db.getActiveGame(message.guildId);
  if (!activeGame) {
    return;
  }

  if (message.channelId !== activeGame.channel_id) {
    return;
  }

  const trimmedContent = message.content.trim();

  if (trimmedContent.startsWith("-")) {
    return;
  }

  const parsed = parseWord(trimmedContent);
  if (!parsed.ok) {
    await rejectWordMessage(message, parsed.reason);
    return;
  }

  const firstLetter = parsed.normalized[0];
  const nextExpectedLetter = getExpectedLetter(parsed.normalized);
  if (firstLetter !== activeGame.expected_letter) {
    await rejectWordMessage(
      message,
      `Kelime \`${activeGame.expected_letter}\` harfi ile başlamalı.`
    );
    return;
  }

  const tdkValidation = await validateWithTdk(parsed.normalized);
  if (!tdkValidation.valid) {
    await rejectWordMessage(message, tdkValidation.reason);
    return;
  }

  const addResult = db.addWordToActiveGame({
    guildId: message.guildId,
    channelId: message.channelId,
    userId: message.author.id,
    word: parsed.normalized,
    normalizedWord: parsed.normalized,
    expectedLetter: firstLetter,
    nextExpectedLetter,
    cooldownMs: consecutiveWordCooldownMs,
  });

  if (!addResult.ok) {
    await rejectWordMessage(message, mapAddWordErrorToReason(addResult));
    return;
  }

  await message.react("✅").catch(() => null);
});

client.login(token);
