const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

function resolveDatabasePath(databasePath) {
  const resolvedPath = path.resolve(databasePath || "./data/wordbot.sqlite");
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  return resolvedPath;
}

function createDatabase(databasePath) {
  const db = new Database(resolveDatabasePath(databasePath));

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      start_word TEXT NOT NULL,
      current_word TEXT NOT NULL,
      expected_letter TEXT NOT NULL,
      started_by TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'ended')),
      total_words INTEGER NOT NULL DEFAULT 1,
      ended_at INTEGER,
      ended_by TEXT,
      unique_players INTEGER,
      top_player_id TEXT,
      top_player_count INTEGER
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_games_one_active_per_guild
      ON games(guild_id, status)
      WHERE status = 'active';

    CREATE TABLE IF NOT EXISTS game_words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      word TEXT NOT NULL,
      normalized_word TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_game_words_game_id ON game_words(game_id);
    CREATE INDEX IF NOT EXISTS idx_game_words_game_word
      ON game_words(game_id, normalized_word);
  `);

  const statements = {
    getGuildSettings: db.prepare(
      `SELECT guild_id, channel_id, updated_at FROM guild_settings WHERE guild_id = ?`
    ),

    upsertGuildSettings: db.prepare(`
      INSERT INTO guild_settings (guild_id, channel_id, updated_at)
      VALUES (@guildId, @channelId, @updatedAt)
      ON CONFLICT(guild_id)
      DO UPDATE SET
        channel_id = excluded.channel_id,
        updated_at = excluded.updated_at
    `),

    getActiveGame: db.prepare(
      `SELECT * FROM games WHERE guild_id = ? AND status = 'active' LIMIT 1`
    ),

    getGameById: db.prepare(`SELECT * FROM games WHERE id = ? LIMIT 1`),

    insertGame: db.prepare(`
      INSERT INTO games (
        guild_id,
        channel_id,
        start_word,
        current_word,
        expected_letter,
        started_by,
        started_at,
        status,
        total_words
      ) VALUES (
        @guildId,
        @channelId,
        @startWord,
        @currentWord,
        @expectedLetter,
        @startedBy,
        @startedAt,
        'active',
        1
      )
    `),

    insertGameWord: db.prepare(`
      INSERT INTO game_words (
        game_id,
        guild_id,
        user_id,
        word,
        normalized_word,
        created_at
      ) VALUES (
        @gameId,
        @guildId,
        @userId,
        @word,
        @normalizedWord,
        @createdAt
      )
    `),

    countWordInGame: db.prepare(
      `SELECT COUNT(1) AS total FROM game_words WHERE game_id = ? AND normalized_word = ?`
    ),

    getLastWordPlayerInGame: db.prepare(`
      SELECT user_id, created_at
      FROM game_words
      WHERE game_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `),

    updateActiveGameState: db.prepare(`
      UPDATE games
      SET
        current_word = @currentWord,
        expected_letter = @expectedLetter,
        total_words = total_words + 1
      WHERE id = @gameId
    `),

    countGameWords: db.prepare(
      `SELECT COUNT(1) AS total FROM game_words WHERE game_id = ?`
    ),

    countUniquePlayers: db.prepare(
      `SELECT COUNT(DISTINCT user_id) AS total FROM game_words WHERE game_id = ?`
    ),

    getTopPlayer: db.prepare(`
      SELECT user_id, COUNT(1) AS word_count
      FROM game_words
      WHERE game_id = ?
      GROUP BY user_id
      ORDER BY word_count DESC, user_id ASC
      LIMIT 1
    `),

    endGame: db.prepare(`
      UPDATE games
      SET
        status = 'ended',
        ended_at = @endedAt,
        ended_by = @endedBy,
        total_words = @totalWords,
        unique_players = @uniquePlayers,
        top_player_id = @topPlayerId,
        top_player_count = @topPlayerCount
      WHERE id = @gameId
    `),

    getGuildFinishedStats: db.prepare(`
      SELECT
        COUNT(1) AS total_games,
        COALESCE(SUM(total_words), 0) AS total_words,
        COALESCE(AVG(total_words), 0) AS avg_words,
        COALESCE(MAX(total_words), 0) AS best_game_words
      FROM games
      WHERE guild_id = ? AND status = 'ended'
    `),

    getLastFinishedGame: db.prepare(`
      SELECT id, total_words, ended_at
      FROM games
      WHERE guild_id = ? AND status = 'ended'
      ORDER BY ended_at DESC
      LIMIT 1
    `),

    getTopContributorAcrossGuild: db.prepare(`
      SELECT gw.user_id, COUNT(1) AS word_count
      FROM game_words gw
      INNER JOIN games g ON g.id = gw.game_id
      WHERE g.guild_id = ? AND g.status = 'ended'
      GROUP BY gw.user_id
      ORDER BY word_count DESC, gw.user_id ASC
      LIMIT 1
    `),
  };

  function getGuildSettings(guildId) {
    return statements.getGuildSettings.get(guildId) || null;
  }

  function setGuildChannel(guildId, channelId) {
    statements.upsertGuildSettings.run({
      guildId,
      channelId,
      updatedAt: Date.now(),
    });
  }

  function getActiveGame(guildId) {
    return statements.getActiveGame.get(guildId) || null;
  }

  const startGameTx = db.transaction(
    ({ guildId, channelId, startWord, expectedLetter, startedBy }) => {
      const existingGame = statements.getActiveGame.get(guildId);
      if (existingGame) {
        return {
          ok: false,
          reason: "ACTIVE_GAME_EXISTS",
          game: existingGame,
        };
      }

      const startedAt = Date.now();

      const result = statements.insertGame.run({
        guildId,
        channelId,
        startWord,
        currentWord: startWord,
        expectedLetter,
        startedBy,
        startedAt,
      });

      const gameId = Number(result.lastInsertRowid);

      statements.insertGameWord.run({
        gameId,
        guildId,
        userId: startedBy,
        word: startWord,
        normalizedWord: startWord,
        createdAt: startedAt,
      });

      return {
        ok: true,
        game: statements.getGameById.get(gameId),
      };
    }
  );

  function startGame(payload) {
    return startGameTx(payload);
  }

  const addWordToActiveGameTx = db.transaction(
    ({
      guildId,
      channelId,
      userId,
      word,
      normalizedWord,
      expectedLetter,
      nextExpectedLetter,
      cooldownMs,
    }) => {
      const activeGame = statements.getActiveGame.get(guildId);
      const now = Date.now();

      if (!activeGame) {
        return { ok: false, reason: "NO_ACTIVE_GAME" };
      }

      if (activeGame.channel_id !== channelId) {
        return {
          ok: false,
          reason: "WRONG_CHANNEL",
          channelId: activeGame.channel_id,
        };
      }

      if (activeGame.expected_letter !== expectedLetter) {
        return {
          ok: false,
          reason: "WRONG_FIRST_LETTER",
          expectedLetter: activeGame.expected_letter,
        };
      }

      const lastWordPlayer = statements.getLastWordPlayerInGame.get(activeGame.id);

      const appliedCooldownMs = Number.isFinite(cooldownMs)
        ? Math.max(0, Math.floor(cooldownMs))
        : 0;

      if (
        appliedCooldownMs > 0 &&
        lastWordPlayer &&
        lastWordPlayer.user_id === userId
      ) {
        const lastCreatedAt = Number(lastWordPlayer.created_at ?? 0);
        const elapsedMs = Math.max(0, now - lastCreatedAt);

        if (elapsedMs < appliedCooldownMs) {
          return {
            ok: false,
            reason: "SAME_USER_COOLDOWN",
            remainingMs: appliedCooldownMs - elapsedMs,
          };
        }
      }

      const alreadyUsed = statements.countWordInGame.get(
        activeGame.id,
        normalizedWord
      );

      if (alreadyUsed.total > 0) {
        return {
          ok: false,
          reason: "WORD_ALREADY_USED",
        };
      }

      statements.insertGameWord.run({
        gameId: activeGame.id,
        guildId,
        userId,
        word,
        normalizedWord,
        createdAt: now,
      });

      statements.updateActiveGameState.run({
        gameId: activeGame.id,
        currentWord: normalizedWord,
        expectedLetter: nextExpectedLetter,
      });

      return {
        ok: true,
        game: statements.getGameById.get(activeGame.id),
      };
    }
  );

  function addWordToActiveGame(payload) {
    return addWordToActiveGameTx(payload);
  }

  const endActiveGameTx = db.transaction(({ guildId, endedBy }) => {
    const activeGame = statements.getActiveGame.get(guildId);

    if (!activeGame) {
      return {
        ok: false,
        reason: "NO_ACTIVE_GAME",
      };
    }

    const endedAt = Date.now();
    const totalWords = statements.countGameWords.get(activeGame.id).total;
    const uniquePlayers = statements.countUniquePlayers.get(activeGame.id).total;
    const topPlayer = statements.getTopPlayer.get(activeGame.id) || {
      user_id: null,
      word_count: 0,
    };

    statements.endGame.run({
      gameId: activeGame.id,
      endedAt,
      endedBy,
      totalWords,
      uniquePlayers,
      topPlayerId: topPlayer.user_id,
      topPlayerCount: topPlayer.word_count,
    });

    return {
      ok: true,
      game: statements.getGameById.get(activeGame.id),
      summary: {
        totalWords,
        uniquePlayers,
        topPlayerId: topPlayer.user_id,
        topPlayerCount: topPlayer.word_count,
      },
    };
  });

  function endActiveGame(payload) {
    return endActiveGameTx(payload);
  }

  function getGuildStats(guildId) {
    const overall = statements.getGuildFinishedStats.get(guildId);
    const lastGame = statements.getLastFinishedGame.get(guildId) || null;
    const topContributor =
      statements.getTopContributorAcrossGuild.get(guildId) || null;

    return {
      totalGames: overall.total_games,
      totalWords: overall.total_words,
      averageWords: Number(overall.avg_words ?? 0),
      bestGameWords: overall.best_game_words,
      lastGame,
      topContributor,
    };
  }

  return {
    addWordToActiveGame,
    endActiveGame,
    getActiveGame,
    getGuildSettings,
    getGuildStats,
    setGuildChannel,
    startGame,
  };
}

module.exports = {
  createDatabase,
};
