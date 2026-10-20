import fs from 'fs';
import path from 'path';
import { JsonStore } from './jsonStore';
import type { ConversationStats } from '../../shared/ipc';

export type { ConversationStats };

export interface ConversationTurn {
  timestamp: string; // ISO
  userText: string;
  reply: string;
  /** action kinds Raphael planned for this turn, if any */
  actions: string[];
}

const EMPTY_STATS: ConversationStats = {
  firstSeen: '',
  lastSeen: '',
  totalTurns: 0,
  totalActionsPlanned: 0,
  actionsByKind: {},
  successes: 0,
  failures: 0,
  daysActive: [],
  turnsByDay: {}
};

/** Keep only this many recent turns in the fast-access JSON log (journal keeps everything). */
const MAX_TURNS_RETAINED = 500;
/** How many recent turns to feed back into the LLM as memory. */
const HISTORY_FOR_CONTEXT = 8;

/**
 * Persistent, local-first conversation memory (§22 privacy: never leaves the
 * machine). Three artifacts, all under raphael-data/:
 *   - conversations.json : rolling structured log of recent turns
 *   - stats.json         : lifetime usage statistics
 *   - journal/<date>.txt : one human-readable text file per day, titled
 *
 * This lets Raphael carry context across turns (so My Liege doesn't have to
 * re-explain things) and builds a record it can study later.
 */
export class ConversationStore {
  private readonly turns: JsonStore<ConversationTurn[]>;
  private readonly stats: JsonStore<ConversationStats>;
  private readonly journalDir: string;

  constructor(private readonly dataDir: string) {
    this.turns = new JsonStore<ConversationTurn[]>(dataDir, 'conversations.json', []);
    this.stats = new JsonStore<ConversationStats>(dataDir, 'stats.json', EMPTY_STATS);
    this.journalDir = path.join(dataDir, 'journal');
    try {
      fs.mkdirSync(this.journalDir, { recursive: true });
    } catch {
      /* journal is best-effort; a failure here must never block a command */
    }
  }

  /** Record a completed turn (user asked, Raphael replied/planned). */
  recordTurn(userText: string, reply: string, actions: string[]): void {
    const now = new Date();
    const iso = now.toISOString();
    const day = iso.slice(0, 10);

    const list = this.turns.read();
    list.push({ timestamp: iso, userText, reply, actions });
    if (list.length > MAX_TURNS_RETAINED) list.splice(0, list.length - MAX_TURNS_RETAINED);
    this.turns.write(list);

    const s = this.stats.read();
    if (!s.firstSeen) s.firstSeen = iso;
    s.lastSeen = iso;
    s.totalTurns += 1;
    s.totalActionsPlanned += actions.length;
    for (const kind of actions) s.actionsByKind[kind] = (s.actionsByKind[kind] ?? 0) + 1;
    if (!s.daysActive.includes(day)) s.daysActive.push(day);
    s.turnsByDay[day] = (s.turnsByDay[day] ?? 0) + 1;
    this.stats.write(s);

    this.appendJournal(day, `[${timeOf(now)}] My Liege: ${userText}\n            Raphael: ${reply}${actions.length ? ` (actions: ${actions.join(', ')})` : ''}`);
  }

  /** Record the verified outcome of a task so successes/failures aren't guessed. */
  recordOutcome(status: string, success: boolean): void {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const s = this.stats.read();
    if (success) s.successes += 1;
    else s.failures += 1;
    this.stats.write(s);
    this.appendJournal(day, `[${timeOf(now)}] → ${success ? 'OK' : 'FAILED'}: ${status}`);
  }

  /** Recent turns as alternating chat messages, for feeding Raphael its own memory. */
  getHistoryForContext(): Array<{ role: 'user' | 'assistant'; content: string }> {
    const list = this.turns.read().slice(-HISTORY_FOR_CONTEXT);
    const msgs: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const t of list) {
      msgs.push({ role: 'user', content: t.userText });
      msgs.push({ role: 'assistant', content: t.reply });
    }
    return msgs;
  }

  getStats(): ConversationStats {
    return this.stats.read();
  }

  getRecentTurns(limit = 50): ConversationTurn[] {
    return this.turns.read().slice(-limit);
  }

  private appendJournal(day: string, line: string): void {
    try {
      const file = path.join(this.journalDir, `${day}.txt`);
      if (!fs.existsSync(file)) {
        const title = `RAPHAEL DAILY JOURNAL — ${day}\n${'='.repeat(40)}\n\n`;
        fs.writeFileSync(file, title, 'utf8');
      }
      fs.appendFileSync(file, line + '\n', 'utf8');
    } catch {
      /* journaling is best-effort and must never interfere with real work */
    }
  }
}

function timeOf(d: Date): string {
  return d.toTimeString().slice(0, 8);
}
