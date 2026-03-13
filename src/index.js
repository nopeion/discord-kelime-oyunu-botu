require("dotenv").config();

const {
  Client,
  Events,
  GatewayIntentBits,
} = require("discord.js");

const { getCommandData } = require("./commands");
const { createDatabase } = require("./database");
const { createEmbed } = require("./embeds");
const { getShuffledStartWords } = require("./random-words");
const { validateWithTdk } = require("./tdk");
const { getExpectedLetter, normalizeWord, parseWord } = require("./word-utils");

const token = process.env.DISCORD_TOKEN;
const DEFAULT_CONSECUTIVE_WORD_COOLDOWN_MS = 25_000;
const SCHEDULER_CHECK_INTERVAL_MS = 30_000;
const DEFAULT_GAME_TIMEZONE = "Europe/Istanbul";

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
const schedulerTimeZone = process.env.GAME_TIMEZONE || DEFAULT_GAME_TIMEZONE;

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

let isAutoRestartRunning = false;

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

function getTimePartsInZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    dateKey: `${map.year}-${map.month}-${map.day}`,
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

async function findRandomValidStartWord() {
  const candidates = getShuffledStartWords();

  for (const candidate of candidates) {
    const normalized = normalizeWord(candidate);
    const validation = await validateWithTdk(normalized);

    if (validation.valid) {
      return normalized;
    }
  }

  return null;
}

function getStartChannelFromInteraction(interaction, settings) {
  const commandChannelId = interaction.channelId;

  if (!commandChannelId) {
    return {
      ok: false,
      reason: "Komut kanalı algılanamadı.",
    };
  }

  if (!settings) {
    return {
      ok: true,
      channelId: commandChannelId,
      autoAssigned: true,
    };
  }

  if (settings.channel_id !== commandChannelId) {
    return {
      ok: false,
      reason: `Bu komut yalnızca ayarlı oyun kanalında kullanılabilir: <#${settings.channel_id}>`,
    };
  }

  return {
    ok: true,
    channelId: settings.channel_id,
    autoAssigned: false,
  };
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

async function startNewGameWithRandomWord({ guildId, channelId, startedBy }) {
  const startWord = await findRandomValidStartWord();
  if (!startWord) {
    return {
      ok: false,
      reason: "RANDOM_START_WORD_NOT_FOUND",
    };
  }

  const expectedLetter = getExpectedLetter(startWord);
  const result = db.startGame({
    guildId,
    channelId,
    startWord,
    expectedLetter,
    startedBy,
  });

  if (!result.ok) {
    return result;
  }

  const startWordAnnouncementSent = await announceStartWord(
    channelId,
    startWord,
    expectedLetter
  );

  return {
    ok: true,
    startWord,
    expectedLetter,
    startWordAnnouncementSent,
  };
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
  const channelResolution = getStartChannelFromInteraction(interaction, settings);
  if (!channelResolution.ok) {
    await interaction.editReply({
      embeds: [
        createEmbed({
          type: "warning",
          title: "Yanlış Kanal",
          description: channelResolution.reason,
        }),
      ],
    });
    return;
  }

  if (channelResolution.autoAssigned) {
    db.setGuildChannel(guildId, channelResolution.channelId);
  }

  const randomStart = await startNewGameWithRandomWord({
    guildId,
    channelId: channelResolution.channelId,
    startedBy: interaction.user.id,
  });

  if (!randomStart.ok && randomStart.reason === "RANDOM_START_WORD_NOT_FOUND") {
    await interaction.editReply({
      embeds: [
        createEmbed({
          type: "error",
          title: "Başlangıç Kelimesi Bulunamadı",
          description:
            "Rastgele başlangıç kelimesi seçilemedi. Lütfen biraz sonra tekrar dene.",
        }),
      ],
    });
    return;
  }

  if (!randomStart.ok) {
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

  await interaction.editReply({
    embeds: [
      createEmbed({
        type: "success",
        title: "Oyun Başladı",
        description: channelResolution.autoAssigned
          ? "Yeni kelime oyunu başarıyla başlatıldı. Bu kanal oyun kanalı olarak otomatik ayarlandı."
          : "Yeni kelime oyunu başarıyla başlatıldı.",
        fields: [
          {
            name: "Kanal",
            value: `<#${channelResolution.channelId}>`,
            inline: true,
          },
          {
            name: "İlk Kelime",
            value: `\`${randomStart.startWord}\``,
            inline: true,
          },
          {
            name: "Beklenen Harf",
            value: `\`${randomStart.expectedLetter}\``,
            inline: true,
          },
          {
            name: "Kanal Duyurusu",
            value: randomStart.startWordAnnouncementSent
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

async function handleScheduleGame(interaction) {
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

  const hour = interaction.options.getInteger("saat", true);
  const minute = interaction.options.getInteger("dakika", true);
  const settings = db.getGuildSettings(guildId);
  const channelId = settings?.channel_id || interaction.channelId;

  if (!channelId) {
    await interaction.reply({
      ephemeral: true,
      embeds: [
        createEmbed({
          type: "error",
          title: "Kanal Bulunamadı",
          description: "Oyun kanalı algılanamadı. Lütfen tekrar dene.",
        }),
      ],
    });
    return;
  }

  db.setGuildAutoRestartTime({
    guildId,
    channelId,
    hour,
    minute,
  });

  const formattedHour = String(hour).padStart(2, "0");
  const formattedMinute = String(minute).padStart(2, "0");

  await interaction.reply({
    ephemeral: true,
    embeds: [
      createEmbed({
        type: "success",
        title: "Oyun Zamanlandı",
        description:
          `Her gün ${formattedHour}:${formattedMinute} saatinde aktif oyun bitirilip ` +
          "rastgele bir başlangıç kelimesi ile otomatik yeni oyun başlatılacak.",
        fields: [
          {
            name: "Kanal",
            value: `<#${channelId}>`,
            inline: true,
          },
          {
            name: "Saat Dilimi",
            value: schedulerTimeZone,
            inline: true,
          },
        ],
      }),
    ],
  });
}

async function handleDisableScheduleGame(interaction) {
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

  db.disableGuildAutoRestart(guildId);

  await interaction.reply({
    ephemeral: true,
    embeds: [
      createEmbed({
        type: "info",
        title: "Otomatik Yenileme Kapatıldı",
        description: "Zamanlanmış oyun yenileme kapatıldı.",
      }),
    ],
  });
}

async function runAutoRestartForSchedule(schedule, dateKey) {
  const guildId = schedule.guild_id;
  const channelId = schedule.channel_id;

  const activeGame = db.getActiveGame(guildId);
  if (activeGame) {
    db.endActiveGame({
      guildId,
      endedBy: "auto-scheduler",
    });
  }

  const autoStarted = await startNewGameWithRandomWord({
    guildId,
    channelId,
    startedBy: "auto-scheduler",
  });

  if (!autoStarted.ok) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel && channel.isTextBased()) {
      await channel
        .send({
          embeds: [
            createEmbed({
              type: "error",
              title: "Otomatik Oyun Başlatılamadı",
              description:
                "Zamanlanan oyun yenilemesi sırasında yeni başlangıç kelimesi seçilemedi.",
            }),
          ],
        })
        .catch(() => null);
    }
  }

  db.markAutoRestartExecuted(guildId, dateKey);
}

async function processAutoRestarts() {
  if (isAutoRestartRunning) {
    return;
  }

  isAutoRestartRunning = true;

  try {
    const schedules = db.getAutoRestartSchedules();
    if (schedules.length === 0) {
      return;
    }

    const now = getTimePartsInZone(new Date(), schedulerTimeZone);

    for (const schedule of schedules) {
      const hour = Number(schedule.auto_restart_hour);
      const minute = Number(schedule.auto_restart_minute);

      if (hour !== now.hour || minute !== now.minute) {
        continue;
      }

      if (schedule.last_auto_restart_date === now.dateKey) {
        continue;
      }

      await runAutoRestartForSchedule(schedule, now.dateKey);
    }
  } catch (error) {
    console.error("Otomatik oyun zamanlayıcısında hata oluştu:", error);
  } finally {
    isAutoRestartRunning = false;
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`${readyClient.user.tag} olarak giriş yapıldı.`);

  try {
    await registerCommands();
  } catch (error) {
    console.error("Komutlar yüklenirken hata oluştu:", error);
  }

  processAutoRestarts().catch(() => null);
  setInterval(() => {
    processAutoRestarts().catch(() => null);
  }, SCHEDULER_CHECK_INTERVAL_MS);

  console.log(
    `Otomatik oyun zamanlayıcısı aktif. Saat dilimi: ${schedulerTimeZone}`
  );
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
      return;
    }

    if (interaction.commandName === "oyun-zamanla") {
      await handleScheduleGame(interaction);
      return;
    }

    if (interaction.commandName === "oyun-zamanla-kapat") {
      await handleDisableScheduleGame(interaction);
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
