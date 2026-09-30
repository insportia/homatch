// GramJsDriver.ts — the only file in HOMATCH that imports an MTProto library.
//
// GramJS (`telegram` on npm) is pinned exactly in package.json. It is archived
// upstream; `teleproto` is its maintained fork with a compatible API. Keeping
// the library behind the TelegramDriver interface is what makes that swap a
// change to this one file.
//
// This driver NEVER logs in. It connects with a StringSession that a person
// created out of band and put in Railway Variables. There is no code path that
// asks for a phone number or a login code, and client.start() is deliberately
// not called, because start() is the method that would prompt for one.
//
// Requests are made one at a time by explicit invoke(), not through the
// library's iterators: an iterator decides for itself how many requests to
// send and how long to sleep between them, and the gateway above is the only
// thing allowed to make that decision.

import { Api, TelegramClient, utils } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Logger, LogLevel } from 'telegram/extensions/Logger.js';
import { returnBigInt } from 'telegram/Helpers.js';
import type { TelegramDriver, TelegramEnv } from './TelegramGateway.js';
import type { RawChat, RawMessage } from './TelegramModel.js';

export function createGramJsDriver(env: TelegramEnv): TelegramDriver {
  const client = new TelegramClient(new StringSession(env.session ?? ''), env.apiId ?? 0, env.apiHash ?? '', {
    connectionRetries: 2,
    retryDelay: 2000,
    autoReconnect: true,
    // Never sleep through a FLOOD_WAIT inside the library: the gateway records
    // it, shares it across callers, and the caller reschedules.
    floodSleepThreshold: 0,
    // GramJS logs connection chatter at INFO; none of it is needed and none of
    // it may ever include session material.
    baseLogger: new Logger(LogLevel.NONE),
    deviceModel: 'HOMATCH discovery worker',
    appVersion: '1.0',
    systemVersion: 'server',
  });

  return {
    async connect() {
      await client.connect();
    },
    async disconnect() {
      await client.disconnect();
      await client.destroy().catch(() => undefined);
    },
    async checkAuthorized() {
      return await client.checkAuthorization();
    },
    async resolveUsername(username) {
      const result = await client.invoke(new Api.contacts.ResolveUsername({ username }));
      const entity = [...result.chats, ...result.users].find((e) => peerMatches(result.peer, e));
      if (!entity) throw Object.assign(new Error('unresolved'), { errorMessage: 'USERNAME_NOT_OCCUPIED' });
      return { chat: toRawChat(entity), handle: utils.getInputPeer(entity) };
    },
    async getHistory(handle, { offsetId, limit }) {
      const result = await client.invoke(new Api.messages.GetHistory({
        peer: handle as Api.TypeInputPeer,
        offsetId,
        offsetDate: 0,
        addOffset: 0,
        limit,
        maxId: 0,
        minId: 0,
        hash: returnBigInt(0),
      }));
      return toRawMessages(result);
    },
    async getReplies(handle, messageId, { offsetId, limit }) {
      const result = await client.invoke(new Api.messages.GetReplies({
        peer: handle as Api.TypeInputPeer,
        msgId: messageId,
        offsetId,
        offsetDate: 0,
        addOffset: 0,
        limit,
        maxId: 0,
        minId: 0,
        hash: returnBigInt(0),
      }));
      return toRawMessages(result);
    },
    async searchChats(query, limit) {
      const result = await client.invoke(new Api.contacts.Search({ q: query, limit }));
      return result.chats.map(toRawChat);
    },
  };
}

function peerMatches(peer: Api.TypePeer, entity: Api.TypeChat | Api.TypeUser): boolean {
  const id = String((entity as { id?: unknown }).id ?? '');
  if (peer instanceof Api.PeerChannel) return entity instanceof Api.Channel && String(peer.channelId) === id;
  if (peer instanceof Api.PeerChat) return entity instanceof Api.Chat && String(peer.chatId) === id;
  if (peer instanceof Api.PeerUser) return entity instanceof Api.User && String(peer.userId) === id;
  return false;
}

function publicUsername(entity: { username?: string; usernames?: Api.TypeUsername[] }): string | null {
  if (entity.username) return entity.username;
  const active = (entity.usernames ?? []).find((u) => u instanceof Api.Username && u.active);
  return active instanceof Api.Username ? active.username : null;
}

function toRawChat(entity: Api.TypeChat | Api.TypeUser): RawChat {
  if (entity instanceof Api.Channel) {
    return {
      id: String(entity.id),
      username: publicUsername(entity),
      title: entity.title ?? null,
      type: 'channel',
      broadcast: Boolean(entity.broadcast),
      megagroup: Boolean(entity.megagroup),
      participantsCount: typeof entity.participantsCount === 'number' ? entity.participantsCount : null,
      restricted: Boolean(entity.restricted),
    };
  }
  if (entity instanceof Api.Chat) {
    return {
      id: String(entity.id), username: null, title: entity.title ?? null, type: 'chat',
      broadcast: false, megagroup: false,
      participantsCount: typeof entity.participantsCount === 'number' ? entity.participantsCount : null,
      restricted: false,
    };
  }
  return {
    id: String((entity as { id?: unknown }).id ?? ''), username: null, title: null, type: 'user',
    broadcast: false, megagroup: false, participantsCount: null, restricted: false,
  };
}

function toRawMessages(result: Api.messages.TypeMessages): RawMessage[] {
  if (result instanceof Api.messages.MessagesNotModified) return [];
  const users = new Map<string, Api.User>();
  for (const user of result.users) if (user instanceof Api.User) users.set(String(user.id), user);

  const out: RawMessage[] = [];
  for (const message of result.messages) {
    if (message instanceof Api.MessageEmpty) continue;
    if (message instanceof Api.MessageService) {
      out.push({
        id: message.id, date: message.date, editDate: null, text: '', replyToMsgId: null,
        post: false, fromUsername: null, views: null, service: true,
      });
      continue;
    }
    if (!(message instanceof Api.Message)) continue;
    const from = message.fromId instanceof Api.PeerUser ? users.get(String(message.fromId.userId)) : undefined;
    const reply = message.replyTo instanceof Api.MessageReplyHeader ? message.replyTo.replyToMsgId ?? null : null;
    out.push({
      id: message.id,
      date: message.date,
      editDate: message.editDate ?? null,
      text: message.message ?? '',
      replyToMsgId: reply,
      post: Boolean(message.post),
      // A public @username only. Phone numbers and private names are never read.
      fromUsername: from && !from.bot ? publicUsername(from) : null,
      views: typeof message.views === 'number' ? message.views : null,
      service: false,
    });
  }
  return out;
}
